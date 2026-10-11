# Portable demo dataset and Supabase seed

This directory prepares mapped demo data for Supabase. The merged Supabase integration provides
login and photo storage; collection records still use DynamoDB/Moto through the existing API.
Importing these tables alone does not switch that API to Supabase. A future collection-data
adapter must map the import tables below to the existing v3 domain contract.
No Supabase project, credentials, users or authentication policies are created by this seed.

## Build the local dataset

From the repository root, using the existing Python development environment:

```powershell
python scripts/export_demo_dataset.py --date 2026-10-12
python scripts/seed_supabase.py --date 2026-10-12
```

The second command is a dry run. The export produces `data/exports/feedsure_demo.json`,
three table JSON payloads, three CSV files and `supabase/seed.sql`. There are ten venue
references, ten readiness states (seven ready, one not ready, two unconfirmed), and fourteen
days of simulated history per venue. Dates can be regenerated for another demo day.

Exact saved OSM names and coordinates come from `data/demo_kitchens_osm.json`.
`venue_name` is the mapped name; `name` includes `(demo)`. Each profile retains its OSM element
URL, point/feature-center distinction, source date and ODbL attribution. No waste measurement,
supplier enrolment, actual operation, or pickup entrance is verified. Operational values and
history are explicitly `SIMULATED`. There are no tokens, passwords or private contact details.

## Load Supabase when the project is ready

Apply `migrations/20261011140000_demo_dataset.sql` first, then `seed.sql` in the project's SQL
editor or with the upcoming PR's migration tooling. The SQL seed runs all inserts in one
transaction. It inserts missing primary keys and preserves existing edited rows on every rerun.
Schema statements stay in the migration, as recommended by
[Supabase's seed documentation](https://supabase.com/docs/guides/local-development/seeding-your-database).
The CSV files can also be imported into the corresponding tables after the migration.

For direct REST insertion, set `SUPABASE_URL` and a legacy JWT `SUPABASE_SERVICE_ROLE_KEY` in
the **server's private environment**, then run:

```powershell
python scripts/seed_supabase.py --date 2026-10-12 --apply
```

Do not place the server key in frontend `VITE_*` variables or commit it. REST insertion processes
profiles, readiness and history in order. Each request ignores existing keys; a later failure
can leave earlier tables inserted. Correct the failure and rerun, or use the transactional SQL
seed. The script blocks redirects and never prints credentials or server error bodies.

## Contract for a collection-data adapter

| Table | Primary key | Existing domain fields |
|---|---|---|
| `public.feedsure_demo_generators` | `generator_id` | `generatorId`, `name`, `type`, `address`, `lat`, `lng`, `locationSource`, `simulated` |
| `public.feedsure_demo_readiness` | `generator_id`, `collection_date` | `generatorId`, `collectionDate`, `status`, `confirmedKg`, `weightSource`, `window`, `reason` |
| `public.feedsure_demo_history` | `generator_id`, `date` | `generatorId`, `date`, `kg`, `simulated` |

`UNCONFIRMED` is a snapshot state, not a readiness mutation: the current domain seed skips
those two confirmations. `NOT_READY` has zero kg and no window; `UNCONFIRMED` has null kg and
no window. Default profile language is `en` and the demo default pickup window is `06:00–09:00`.
Generate credentials privately in the target application; this export intentionally cannot
grant login access. The seed includes no plans, dispatched snapshots, pickups or gate records.

RLS is enabled, with no browser read/write policies. The trusted backend service role can
select and insert; the incoming adapter should retain scoped supplier/admin access rather than
publish all operational records to anonymous clients. Demo tables use a `feedsure_demo_` prefix
to avoid guessing or overwriting a future collection adapter's production schema.

## Why the old local page still shows fictional kitchens

At the start of this investigation, the port-5200 frontend pointed to the old port-8800 API.
That process holds fictional profiles in its process-local Moto database. Files changing on
disk do not refresh that database, and the non-destructive seed keeps existing profile edits,
credentials, confirmations and frozen routes. The session's port-5200 frontend was restarted
against a fresh mapped API on port 8890, with the existing local login accounts read privately.
The old port-8800 API and its demo records were left running. A separate mapped preview also
uses frontend 5210 / API 8810. These process choices are local to this session; start a fresh
demo from this branch for a repeatable installation, rather than resetting an active database.

## Research

- [OSM food-source mapping](https://wiki.openstreetmap.org/wiki/Food_security) lists restaurants
  and cafés as potential sources of compostable material and explicitly distinguishes a mapped
  venue from an owner agreeing to supply material.
- [EPA Excess Food Opportunities Map](https://www.epa.gov/sustainable-management-food/excess-food-opportunities-map)
  offers downloadable facility locations and estimated excess-food data for the United States.
  It is useful as a precedent, not as local Harohalli supplier data.
- [Bengaluru's official waste-stream summary](https://apps.bbmpgov.in/SWM/Home/Forms/Publicwastestream.aspx?Page=index)
  provides aggregate waste statistics, not a local venue-by-venue measured pickup dataset.
- [CPCB's SWM portal](https://www.swm.cpcb.gov.in/) registers bulk waste generators, but the
  public page inspected did not provide a downloadable Harohalli register with coordinates and
  measured quantities. No such dataset was found in this research; that is not proof none exists.

Research checked 11 October 2026. Dataset provenance and licensing are in
[`data/README.md`](../data/README.md).

## Verification

The export/readiness tests run with the existing pytest suite. Optional SQL verification uses
PGlite (a development-only PostgreSQL WASM runner, installed in ignored `.tmp`):

```powershell
npm install --prefix .tmp/sql-check --no-save --package-lock=false @electric-sql/pglite
node scripts/verify_supabase_seed.cjs
```

This runs migration and seed twice in an in-memory database, checks exact coordinates and row
counts, preserves an edited profile, exercises constraints and foreign keys, and checks RLS,
anonymous denial and trusted service-role access. It never reads project credentials or writes
to Supabase. An actual hosted Supabase import remains to be checked when that project is ready.

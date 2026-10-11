# Local demo venue locations

`demo_kitchens_osm.json` is a small OpenStreetMap-derived dataset, retrieved on 11 October 2026
through the read-only Overpass API. © OpenStreetMap contributors. This dataset is distributed
under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); see
[OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

The ten stable `demo-kitchen-01` through `demo-kitchen-10` IDs now reference mapped restaurants,
a café, a campus mess and hostels in the existing Harohalli pilot area. Each record retains its
OSM element link, mapped name and coordinate. Node coordinates are OSM points; relation coordinates
are feature centers from Overpass `out center`, not verified entrances or collection gates.
The file records the source database snapshot timestamps and selected source tags. It intentionally
does not add phone numbers, individual names or inferred postal addresses.

These venue references do not establish that a business is still operating, produces a particular
waste stream or participates in FeedSure. The application adds `(demo)` to its displayed names and
keeps readiness, quantities, photos and collection histories simulated. Hostel mess participation
is a demo role, not a surveyed kitchen. The pilot depot is still its existing approximate point.

Startup reads the saved fixture without internet requests. It retains the cancellation, two
unconfirmed suppliers, tight window and oversized-load cases. IDs and credential scopes do not
change. Re-running the non-destructive seed never overwrites an existing profile's name, position,
token or history. Use a **fresh isolated local demo** to see the new venue references; preserve any
active demo and its private access manifest. There is no automatic update to running in-memory
data or dispatched route snapshots. See [local run instructions](../docs/DEPLOYMENT.md).

`pilot_zone.json` and the legacy v1 seed remain historical synthetic scenarios; the mapped fixture
is used by `seed_v3_database` and the disposable local demo runner. A custom depot does not shift
mapped venues: the planner applies the configured service radius to their actual saved coordinates.

The portable local dataset and Supabase import are generated with
`python scripts/export_demo_dataset.py --date 2026-10-12`. JSON, table JSON payloads and CSVs
live in `data/exports`; migration and replayable insertions live in `supabase`. See the
[Supabase seed and integration contract](../supabase/README.md). These files prepare the incoming
collection-data adapter; the existing demo backend continues to use DynamoDB/Moto.

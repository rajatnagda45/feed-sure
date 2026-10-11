# DATABASE — FeedSure CBG (DynamoDB, on-demand)

## Shipped v3 storage

Existing keys for Generators, History, Submissions and Plans are retained. Only `schemaVersion:3`
readiness heads define current availability. Legacy photo verdicts never imply confirmation.

| Table | Partition / sort key | Role |
|---|---|---|
| Operations | collectionDate / recordKey | Strongly read META revision, readiness and hazard heads |
| Pickups | planKey / generatorId | Current stop outcomes; byGenerator GSI for own kitchen receipts |
| GateLogs | date / short planId | Current trip intake and gate revision |
| MutationLog | scopeKey / idempotencyKey | Immutable AUDIT records and separate expiring DEDUP records |

Readiness/history/head updates and dispatch/mutation guards use DynamoDB transactions. Current
pickups alone define totals; old corrections are not added as extra collections. DEDUP rows expire
after seven days, audit rows have no TTL. Plans have no operational expiry; only matrix cache rows
carry TTL. GPS expiry metadata does not remove fields automatically; a removal job remains needed.
See [V3-CONTRACT.md](V3-CONTRACT.md) for item shapes and retention boundaries.

The following v1 layouts and destructive seed instructions are historical, not the v3 run path.

> **Version note:** This is a legacy v1 reference; some described features remain unimplemented.
> [PRD v3](PRD.md) governs the target workflows, calculations, contracts and build order.
> Where these documents conflict, PRD v3 wins. Update this reference as each workflow is implemented.

Table names come from env vars and are prefixed with the stage, e.g. `feedsure-dev-Generators`.
Store numbers as DynamoDB Numbers (Decimal in boto3; convert at the edges in `common/db.py`).

## 1. Generators
| Attribute | Type | Notes |
|---|---|---|
| **PK** `generatorId` | S | slug, e.g. `hostel-3` |
| `name` | S | "Hostel 3 Mess" |
| `type` | S | `hostel_mess` · `hotel` · `corporate_cafeteria` · `hospital_canteen` · `college_canteen` · `veg_market` |
| `lat`, `lng` | N | |
| `pickupStart`, `pickupEnd` | S | `HH:MM` |
| `defaultLang` | S | `en` / `hi` |
| `tokenHash` | S | SHA-256 of the access token (never store the raw token) |
| `priorAccept` | N | default 0.7 |
| `priorContamPct` | N | default 2 |
| `simulated` | BOOL | true for seeded generators |

## 2. History (simulated daily volumes)
| Attribute | Type | Notes |
|---|---|---|
| **PK** `generatorId` | S | |
| **SK** `date` | S | `YYYY-MM-DD` |
| `kg` | N | |
| `simulated` | BOOL | |

Query: the last 14 days per generator (`date BETWEEN`).

## 3. Submissions
| Attribute | Type | Notes |
|---|---|---|
| **PK** `generatorId` | S | |
| **SK** `ts` | S | `{date}T{HH:MM:SS}Z` (sortable; latest = highest) |
| `date` | S | for the GSI |
| `reportedKg` | N | |
| `photoKeys` | L<S> | 2 S3 keys |
| `lang` | S | |
| `verdict` | S | ACCEPT / INSPECT / HOLD |
| `reason` | S | see ARCHITECTURE §5.2 |
| `instruction` | S | |
| `items` | L<M> | `{type, count}` |
| `visibleContaminantPct` | N | |
| `hazard` | BOOL | |
| `imageQuality` | S | |
| `confidence` | N | |
| `modelId` | S | |
| `rawModelText` | S | truncated to 2 KB, for debugging and the eval |

**GSI `byDate`**: PK `date`, SK `ts`, projection ALL. "Latest per generator for a date" = query the
GSI and keep the max `ts` per `generatorId` in code.

## 4. Plans
| Attribute | Type | Notes |
|---|---|---|
| **PK** `date` | S | |
| **SK** `planId` | S | `p-{shortid}`; also `MATRIX#{hash}` items for the matrix cache |
| `params` | M | |
| `plan`, `baseline`, `shortfall`, `excluded` | M / L | as in API.md |
| `matrixSource` | S | |
| `createdAt` | S | ISO |
| `ttl` | N | optional, 30 days |

Matrix cache item: `SK = MATRIX#{sha1(sorted point ids)}`, with `points`, `km` (L of L),
`min` (L of L), `source`, and `ttl` of 2 days.

## 5. Stretch: GateLogs
PK `date`, SK `generatorId`, `outcome`, `actualKg`, `loggedAt`.

## 6. Seed data (`scripts/seed_data.py`)

Input: `data/pilot_zone.json` (plant name and coordinates, radius, generator mix, RNG seed).

- Place 10 generators at random points 2–12 km from the plant (fixed seed, so it is reproducible).
- Generator mix and kg/day ranges:

| type | count | kg/day |
|---|---|---|
| hostel_mess | 4 | 100–160 |
| hotel | 2 | 150–300 |
| corporate_cafeteria | 1 | 120–200 |
| hospital_canteen | 1 | 100–150 |
| college_canteen | 1 | 80–120 |
| veg_market | 1 | 400–700 |

- History: 14 days per generator. Base = midpoint of the range; weekday factor
  (Sat/Sun × 0.7 for canteens and cafeterias, × 1.2 for hotels, × 1.3 for the market); ±15 % noise.
- Pickup windows: hotels 06:00–08:30, messes 06:30–09:00, market 06:00–07:30, others 07:00–10:00.
- Generate one access token per generator. Store only the hash. Print the generator links once to the
  console and write them to `seed_links.local.txt` (gitignored).
- Flags: `--stage dev`, `--local` (use the moto/LocalStack endpoint), `--reset` (delete and reseed).
- Normal runs are idempotent upserts by each table's primary key. `--reset` clears all four configured
  tables before writing the same deterministic seed records again.
- `--demo DATE`: also write simulated ACCEPT submissions for every generator on DATE except
  `hostel-3`, which is left for the live demo. Mark them `simulated: true`, with no photos.
- **Demo tuning (required):** after seeding, compute `U` = planned usable kg with every generator
  ACCEPTed. Print `suggested TARGET_KG = round(U - 0.5 × usable(hostel-3))`. Then a HOLD on hostel-3
  creates a visible shortfall and its ACCEPT restores the target. Put the value in `.env` as `TARGET_KG`.
  (The seeded mix forecasts about 1,900 kg/day, so the default 2,000 kg truck is never the limit.)

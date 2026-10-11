# API — FeedSure CBG

Supabase registration, account lifecycle and owner intake contracts are in
[ACCOUNTS.md](ACCOUNTS.md). `/auth/*` is enabled only by the loopback demo, never by SAM.

## Shipped v3 API

### Mapped demo venue references

Seeded demo profiles optionally include `locationSource`: OSM element type/ID/URL, node versus
feature-center coordinate kind, attribution, license links and retrieval date. The kitchen page
links to the mapped venue and credits OpenStreetMap contributors. Names have a `(demo)` suffix;
`simulated:true` still describes collection records, not verification of business participation.
Existing profiles without this field remain supported. See [data sources](../data/README.md).

### Separate plant owner access

`GET /intake?date=YYYY-MM-DD` requires `X-Plant-Token: <PLANT_OWNER_TOKEN>` and returns `{schemaVersion:3,collectionDate,database,trips}`. Each trip contains `planKey`, `collectionDate`, `dispatchedAt`, `returnAt`, `simulated`, pickup summaries (`generatorId,name,outcome,kg,weightSource,recordedAt`), the current `gate`, and recomputed `reconciliation`. Only dispatched v3 trips for that date appear; drafts, driver credentials, kitchen readiness inputs and precise pickup GPS are omitted.

`POST /gate-logs` accepts `X-Plant-Token` with the existing gate request, revision and `Idempotency-Key`. Owner writes record actor `{type:"PLANT_OWNER",id:"plant-owner"}`. Existing admin gate access remains compatible, while the admin UI directs intake recording to `/owner`. Invalid owner headers fail closed, even if an admin header is also supplied. The owner credential grants no kitchen, planner, dispatcher or driver access. Gate updates remain visible in the admin dashboard, driver trip and own-kitchen receipt.

Use [V3-CONTRACT.md](V3-CONTRACT.md) for the active payloads, headers, route table, revisions and
JSON examples. Generator credentials use `X-Generator-Token`; driver access uses `X-Driver-Token`;
dispatch, pickup and gate mutations also require `Idempotency-Key`. Tokens in request bodies or
query strings are not accepted by active v3 routes.

`POST /submissions` saves readiness with zero photos. Plan requests use `collectionDate`, and
latest-plan reads return `{plan:null}` when absent and prefer the active dispatched trip over
newer drafts for that date, keeping pickup/gate execution reachable after refresh. Public plan keys contain `#` and must be URL
encoded. A dispatch freezes the reviewed version/input revision. Pickups and gate logs are shipped
P0 endpoints with corrections and reconciliation, not stretch features. Optional JPEG/PNG evidence
and observation-only screening are now implemented. See the photo addendum in
[V3-CONTRACT.md](V3-CONTRACT.md) and [repair-photos handoff](handoffs/repair-photos.md).

### Optional photo repair (11 October 2026)

`POST /uploads` accepts `{generatorId,contentType}` with a kitchen/admin auth header and returns
one `{slot:"top",key,url,fields,transport:"local"|"s3"}` in `uploads`. No body token is accepted.
Save readiness first; upload failure never rolls it back. Production uses a private S3 form;
only the explicit loopback runner enables authenticated binary `POST /local-photos/{key}`.

`POST /submissions/{encodedSubmissionId}/photo` accepts `{photoKey,expectedPhotoRevision}`;
`photoKey:null` removes the attachment. `POST /submissions/{encodedSubmissionId}/screen` accepts
`{expectedPhotoRevision}` and checks the attached bytes. Both require `Idempotency-Key`, ownership,
and the current readiness head. Responses are `{submission,inputRevision}`. The initial photo
revision is zero. Same key/payload replays; changed payload, stale revision or newer readiness
returns 409. A model is attempted at most twice; malformed/failed analysis persists NOT_CHECKED.

`GET /generators/{generatorId}/readiness?date=YYYY-MM-DD` returns
`{submission:record|null,unresolvedHazard:record|null,collectionPlan:{state,stale}|null}` for the owning kitchen/admin.
`GET /submissions/{encodedSubmissionId}/evidence` returns an authenticated, no-store
`{url,transport}` response: local validated bytes as a data URL, or a short-lived private S3 GET.
Cross-kitchen reads/mutations are rejected. Presigned GET links remain bearer access until expiry.
Analysis explicitly reports `mode:mock|aws|nvidia`; mock fixtures do not describe the selected photo.
`PHOTO_ANALYSIS_PROVIDER=nvidia` selects NVIDIA for this optional v3 screen endpoint.
The observation schema, one retry, `NOT_CHECKED` failure state and human hazard resolution
are shared with Bedrock. Hazard records use `source:nvidia` for NVIDIA observations.
Neither analysis failure nor removal resolves a hazard or changes readiness quantities.

The following v1 descriptions are preserved as historical reference and are not active contracts.

> **Version note:** This is a legacy v1 reference; some described features remain unimplemented.
> [PRD v3](PRD.md) governs the target workflows, calculations, contracts and build order.
> Where these documents conflict, PRD v3 wins. Update this reference as each workflow is implemented.

Base URL: `${VITE_API_BASE_URL}` (API Gateway HTTP API). All bodies are JSON. Dates are
`YYYY-MM-DD` in Asia/Kolkata. Weights are kg (numbers). Distances are km and times are minutes.

## Auth model (hackathon-grade, see SECURITY.md)
- **Generator endpoints** require the generator's `token` (query param or body field).
- **Plant endpoints** require the header `X-Admin-Token: <ADMIN_TOKEN>`.

## Error format (all endpoints)
```json
{ "error": { "code": "INVALID_INPUT", "message": "reportedKg must be between 0 and 5000" } }
```
| HTTP | code |
|---|---|
| 400 | `INVALID_INPUT` |
| 401 | `UNAUTHORIZED` (bad token or admin token) |
| 404 | `NOT_FOUND` |
| 409 | `PHOTO_MISSING` (S3 object not found) |
| 413 | `PHOTO_TOO_LARGE` |
| 502 | `UPSTREAM_FAILED` (only when no graceful fallback exists) |
| 500 | `INTERNAL` |

---

## GET /generators/{generatorId}?t={token}
Public profile for the generator page.
```json
200 { "generatorId": "hostel-3", "name": "Hostel 3 Mess", "type": "hostel_mess",
      "pickupWindow": { "start": "06:30", "end": "09:00" }, "defaultLang": "hi" }
```

## GET /generators  (admin)
```json
200 { "generators": [ { "generatorId": "hostel-3", "name": "Hostel 3 Mess", "type": "hostel_mess",
      "lat": 12.97, "lng": 77.59, "pickupWindow": {"start":"06:30","end":"09:00"},
      "priorAccept": 0.7, "priorContamPct": 2, "avgKgByWeekday": [120,130,125,128,140,90,80] } ] }
```

## POST /uploads
Request:
```json
{ "generatorId": "hostel-3", "token": "…", "contentType": "image/jpeg" }
```
Response: two presigned POSTs (5 minutes, `content-length-range` 1 KB–3.5 MB, JPEG/PNG only).
```json
200 { "uploads": [
  { "slot": "top",  "key": "submissions/hostel-3/2026-10-09/ab12-top.jpg",  "url": "https://…", "fields": { … } },
  { "slot": "tray", "key": "submissions/hostel-3/2026-10-09/ab12-tray.jpg", "url": "https://…", "fields": { … } }
] }
```
An unknown generator returns `404 NOT_FOUND`; an invalid generator token returns
`401 UNAUTHORIZED`.

## POST /submissions
Request:
```json
{ "generatorId": "hostel-3", "token": "…", "reportedKg": 125,
  "photoKeys": ["submissions/hostel-3/2026-10-09/ab12-top.jpg",
                "submissions/hostel-3/2026-10-09/ab12-tray.jpg"],
  "lang": "hi" }
```
Validation: `reportedKg` 0–5000; exactly 2 keys under `submissions/{generatorId}/`; `lang` ∈ `en|hi`
(`kn` is stretch).

Response:
```json
200 { "submissionId": "hostel-3#2026-10-09T18:42:10Z",
      "date": "2026-10-09",
      "verdict": "HOLD",
      "reason": "over_threshold",
      "instruction": "Remove the 3 plastic wrappers and photograph again.",
      "observations": { "items": [{"type":"plastic_wrapper","count":3,"confidence":0.91}],
                        "visibleContaminantPct": 8, "hazard": false,
                        "imageQuality": "ok", "confidence": 0.82,
                        "notes": "Several plastic wrappers are visible." },
      "modelId": "…", "screenedAt": "2026-10-09T18:42:10Z" }
```

## GET /submissions?date=YYYY-MM-DD  (admin)
Returns the latest submission per generator for the date, plus `photoUrls` (presigned GET, 5 minutes).
```json
200 { "date": "2026-10-09", "submissions": [ { "generatorId": "hostel-3", "verdict": "HOLD",
      "reason": "over_threshold", "reportedKg": 125, "visibleContaminantPct": 8,
      "instruction": "…", "photoUrls": ["https://…","https://…"], "screenedAt": "…" } ] }
```

## POST /plans  (admin)
Request (all optional except `date`; defaults come from config):
```json
{ "date": "2026-10-10", "targetKg": 1800, "truckCapacityKg": 2000 }
```
Response:
```json
200 {
  "planId": "2026-10-10#p-7f3a", "date": "2026-10-10", "simulated": true,
  "matrixSource": "location",
  "params": { "targetKg": 1800, "truckCapacityKg": 2000, "shiftStart": "06:00",
              "shiftEnd": "11:00", "serviceMin": 10, "maxRadiusKm": 15 },
  "plan": {
    "stops": [ { "seq": 1, "generatorId": "hotel-a", "arrive": "06:24", "depart": "06:34",
                 "forecastKg": 260, "usableKg": 240.5, "verdict": "ACCEPT", "cumLoadKg": 260 } ],
    "totalKm": 38.4, "totalMin": 212, "loadKg": 1910,
    "usableKg": 1742.1, "usableKgPerKm": 45.4, "wastedStops": 0,
    "geometry": null
  },
  "baseline": { "stops": [ … ], "totalKm": 41.0, "loadKg": 1980, "usableKg": 1490.3,
                "usableKgPerKm": 36.3, "wastedStops": 1 },
  "shortfall": { "kg": 57.9, "targetMet": false,
                 "reasons": [ { "code": "held", "kg": 115.0, "generatorIds": ["hostel-3"] } ] },
  "excluded": [ { "generatorId": "hostel-3", "code": "held" } ]
}
```
`geometry` is optional (stretch: route polyline). Without it, the frontend draws straight segments
between stops.

## GET /plans/{date}  (admin)
Returns the latest stored plan for the date (same shape as above) or 404.

## Stretch: POST /gate-logs  (admin)
```json
{ "date": "2026-10-10", "generatorId": "hotel-a", "outcome": "ACCEPTED|SORTED|REJECTED", "actualKg": 250 }
```


## Optional photo evidence — shipped 11 October 2026

Readiness saves before optional photo work. The active v3 endpoints below supersede legacy
paired-photo/verdict examples in this document. JSON uses camelCase and header authentication.

| Endpoint | Auth | Contract |
|---|---|---|
| POST /uploads | owning kitchen or admin | `{generatorId,contentType:image/jpeg|image/png}` -> one `{uploads:[{key,url,fields,transport:local|s3}]}` |
| POST /submissions/{id}/photo | owning kitchen or admin | `{photoKey:string|null,expectedPhotoRevision:0..}` plus Idempotency-Key -> `{submission,inputRevision}`; null detaches |
| POST /submissions/{id}/screen | owning kitchen or admin | `{expectedPhotoRevision}` plus Idempotency-Key -> `{submission,inputRevision}` |
| GET /submissions/{id}/evidence | owning kitchen or admin | `{url,transport}`; local authenticated data URL or short-lived private S3 GET URL |
| GET /generators/{id}/readiness?date=YYYY-MM-DD | owning kitchen or admin | `{submission:record|null,unresolvedHazard:record|null,collectionPlan:{state,stale}|null}` for refresh |

Encode the entire submission ID in paths. Photo revision defaults to 0 on older v3 records.
Exact scoped key/payload retries replay the saved response; changed payload, stale photo revision,
concurrent service-date edit or a newer readiness confirmation returns 409. Every attachment,
removal and analysis increments inputRevision atomically and leaves readiness/kg/window untouched.
Draft dispatch therefore becomes stale; dispatched snapshots never change.

PNG/JPEG source input is limited to 20 MB in the browser, resized to at most 1280 px and encoded
as JPEG. The upload/evidence server enforces configured byte bounds (default 1024–3500000),
image structure/content type and decoded/dimension bounds. A photo must exist before linking,
including in mock mode. Production attachment copies validated bytes to a new private unissued
key and saves SHA256 so a still-valid upload form cannot silently replace attached evidence.

Analysis returns only visible items, image quality, confidence, possible hazards and limitations;
no mass contamination percentage, safety decision, usable kg or chemistry/yield inference.
Malformed/provider failure retries once then persists NOT_CHECKED with analysis.state=FAILED.
Valid hazards outrank poor image and create a sticky date/kitchen hazard. Detach/replacement,
later failure, clean observations or another readiness record cannot resolve it; only the admin
human hazard-review endpoint can. Poor image/low confidence/non-hazard items produce ADVICE.
Mock analysis is explicitly labelled and uses only the configured fixture (auto maps to clean),
never filenames or a claim about the selected image.

Local `/local-photos/{key}` is a raw POST using the same owning-kitchen/admin header and issued
key/type, enabled only when the loopback runner injects a LocalPhotoStore. It is not a SAM route.
The runner binds 127.0.0.1, bounds streamed bytes and persists actual image files in a private
per-manifest directory. Same-key identical-byte retries are accepted; altered bytes are rejected.
Upload tickets expire after the configured five-minute default. Retrieval rejects expired photo
retention; local file cleanup is access-triggered, not a background sweeper. DynamoDB in the
runner remains disposable in-process Moto; byte files persist until retention cleanup/deletion.

## Supabase bearer authentication

With `AUTH_PROVIDER=supabase`, all operational routes require `Authorization: Bearer <session JWT>`. With account management enabled, roles and assignments come from the private Supabase account registry; otherwise they come from Auth-verified app_metadata. Invalid/missing login returns 401, incorrect role/scope returns 403, and upstream failures return 502. `GET /auth/session` returns `{ "account": { "id": "user-id", "role": "GENERATOR", "generatorId": "hotel-a" } }`; drivers use `planKey` instead. Upload/evidence responses may include `transport: "supabase"`; signed upload URLs accept a raw image PUT without application credentials. See [Supabase configuration](SUPABASE.md).

### Collection review additions

Readiness `collectionPlan` only describes a plan containing the requesting supplier on the requested collection date. `state` is DRAFT, DISPATCHED or CLOSED; `stale` identifies a draft whose input revision changed. Other suppliers, stops and driver credentials are not exposed.

Plan envelopes include `plantDistances`, a generator-ID map of outbound plant-to-site matrix distances in km (null where unavailable). These are the distances used for the maximum-distance exclusion, not total route distances or necessarily straight-line distances. The existing matrix source labels still distinguish estimates from road routing. Older saved plans may omit this additive field.

# FeedSure v3 shared implementation contract

Contract: **READY**, version `3.0`, 11 October 2026. This freezes interfaces, not implementation
completion. PRD v3 governs product policy. Session 1 owns HTTP/storage; Session 2 owns pure
calculations/matrix; Session 3 owns frontend. Examples are in `tests/contracts/`.

## Values and authentication

JSON uses camelCase. Quantities kg, distances km, durations min. Numbers must be finite, not
booleans; quantities bounded to 0–5000 kg unless capacity/target, bounded to 100000 kg. ISO
`collectionDate` is a service date in Asia/Kolkata; server `recordedAt` is UTC ISO with Z.
Windows `start`/`end` are same-day HH:MM, start < end; no overnight windows. Missing optional
fields are normalised to null or the explicit defaults below. Unknown fields are rejected on
mutations; errors are `{error:{code,message}}`, never raw provider errors or secrets.

Headers: `X-Admin-Token`, `X-Generator-Token`, `X-Driver-Token`. Generator tokens are scoped to
one generator, driver tokens to one dispatched plan; admin endpoints reject placeholder/missing
admin configuration. `Idempotency-Key` (1–128 safe ASCII chars) is required on dispatch, pickup
and gate writes. Bootstrap links may use `?t=`, but API endpoints require headers. UI removes
bootstrap tokens from history and uses Referrer-Policy no-referrer. CORS allows these headers.
The admin actor ID is `dispatcher`; phone confirmations additionally require `confirmedBy`
(a nonempty supervisor label) and `reason`. Never accept client-supplied actor identity.

All new durable records have `schemaVersion:3`, `simulated` from enrolled generator/plan
provenance (not MOCK_BEDROCK), actor and server time. `serviceMode` exposes independent
`database:aws|local`, `screening:not_used|aws|mock`, `matrix:location|fallback|fixture`.

Unique submission IDs are `generatorId#UTCtimestamp#randomhex`; the same exact string is `ts`
in storage. Plan keys are `YYYY-MM-DD#p-randomhex`, exposed as BOTH `planKey` and `planId` for
the public API, with storage `date` and short `planId` kept separate. Always encodeURIComponent
the full planKey in paths (`%23`), decoded once by the server. Every draft is a new plan ID,
version 1; dispatch changes version to 2. Drafts are never overwritten by replanning.

## HTTP surface

Successful bodies include `schemaVersion:3` where envelopes are used. No reads include hashes,
admin secrets or raw driver tokens. 400 INVALID_INPUT, 401 UNAUTHORIZED, 404 NOT_FOUND,
409 CONFLICT, 502 UPSTREAM_FAILED, and 503 DEPENDENCY_NOT_READY use the common error shape.

| Method / path | Auth | Request / response |
|---|---|---|
| GET /generators | admin | `{generators:[profile]}` |
| GET /generators/{generatorId} | generator | `{generator:profile}` |
| GET /operations?date=... | admin | authoritative planning snapshot described below |
| GET /submissions?date=... | admin | `{submissions:[latest readiness records],inputRevision}` |
| POST /submissions | generator or admin | readiness request -> `{submission:record,inputRevision}` |
| POST /submissions/{submissionId}/screen | same generator or admin | `{}` -> `{submission:record,inputRevision}`; optional P1 |
| POST /generators/{generatorId}/hazard-reviews | admin | `{collectionDate,action:ENTER|RESOLVE,reason}` -> `{hazard:record,inputRevision}` |
| POST /plans | admin | `{collectionDate,targetKg?,truckCapacityKg?,capacityBuffer?,shiftStart?,shiftEnd?,serviceMin?,maxRadiusKm?,mandatoryIds?:[]}` -> saved plan envelope |
| GET /plans/{date} | admin | `{plan:null}` if none; active dispatched trip for the date, otherwise latest draft as `{plan:envelope}` |
| GET /plans/{planKey}/details | admin | `{plan:envelope,execution:{pickups,gate,reconciliation},alerts}` |
| POST /plans/{planKey}/dispatch | admin | `{expectedVersion,expectedInputRevision}` -> dispatch example |
| GET /plans/{planKey}/driver | driver | `{plan:driver-safe envelope,pickups,gate,reconciliation,alerts}` |
| POST /pickups | driver | pickup request -> `{pickup:record,reconciliation}` |
| POST /gate-logs | admin | gate request -> `{gate:record,reconciliation}` |
| GET /generators/{generatorId}/receipts?month=YYYY-MM | generator | `{generatorId,records:[{pickup,planKey,collectionDate,gateStatus,gateRecorded,provisional}],schemaVersion:3}` |

Profile fields: generatorId, name, type, address (string), lat/lng, pickupWindow,
defaultLang, supportedMaterial (boolean; legacy enrolled food-waste suppliers default true),
simulated. Token hashes and legacy prior contamination fields are private.

Readiness request fields: generatorId, collectionDate, status READY|NOT_READY, confirmedKg,
weightSource SCALE|ESTIMATE, window `{start,end}`, lang en|hi (default en), reason (optional),
photoKeys (0–1 keys in submissions/{generatorId}/), confirmedBy (admin only).
NOT_READY normalises confirmedKg=0, weightSource=null, window=null, photoKeys=[] regardless of
omitted quantity/photo. READY requires positive kg, source and valid window. Record adds
submissionId, recordedAt, actor `{type:GENERATOR|ADMIN,id}`, confirmedBy, late boolean,
photoStatus NOT_CHECKED|ADVICE|REVIEW_HAZARD|NO_ISSUE_OBSERVED and inputRevision.
Late means after configurable 20:00 previous evening. Accepted edits append records.
Legacy v1 submissions remain historical and cannot imply a READY confirmation.

Operations snapshot: `{schemaVersion,collectionDate,inputRevision,generators,depot,defaults,
serviceMode,simulated}`. Each generator is profile plus readiness (latest v3 record or null),
readinessStatus READY|NOT_READY|UNCONFIRMED, unresolvedHazards (list of hazard records).
Defaults are the exact planner params below; depot is `{id:"plant",lat,lng}`. Revision advances
atomically for EVERY readiness edit and hazard enter/resolve, scoped by collection date.
No stale eventually-consistent index may define dispatch inputs.
The operations matrix mode is the configured provider (`fallback` in mock-location mode); a saved
plan records the actual matrix source, including a Location-service failure fallback.

## Session 2: pure interfaces (required exports)

`feedsure.planner.plan.build_plan(inputs: dict[str,Any]) -> dict[str,Any]`.
Input fields: collectionDate, inputRevision, generators (snapshot enriched profiles above),
history `{generatorId:[{date,kg,simulated,...}]}` strictly before collectionDate,
depot, matrix, params, simulated. Matrix fields: pointIds (plant first, generator IDs in exact
row order), km/min square directed matrices, source location|fallback|fixture. Unavailable legs
are null; not zero. Params: targetKg 1200, truckCapacityKg 2000, capacityBuffer .10,
readinessPrior .8, shiftStart "06:00", shiftEnd "11:00", serviceMin 10, maxRadiusKm 15,
mandatoryIds []. P0 volumeRatio=1, no photo-derived factor. Eligibility is READY, supported
material, no unresolved hazard. Only history before date; cold-start assumptions visible.

Return EXACT fields: collectionDate, inputRevision, status FEASIBLE|MANDATORY_CONFLICT,
params, plan, baseline, excluded, shortfall, mandatoryConflicts, matrixSource, simulated,
assumptions `{readinessPrior,volumeRatio:1,capacityBuffer}`. Empty inputs give FEASIBLE with
empty routes and target shortfall. mandatoryConflicts lists `{generatorId,reason}`; conflicts
do not throw a provider error. Malformed inputs raise ValueError (handler returns 400).

Route object: `{stops,startAt,returnAt,totals}`. Totals:
`{expectedCollectionKg,reservedLoadKg,totalKm,totalMin,serviceMin,waitingMin}`.
Each stop: generatorId, name, address, lat, lng, window, submissionId, confirmedKg,
weightSource, expectedCollectionKg, reservedLoadKg, mandatory (boolean), arrivalAt,
serviceStartAt, serviceEndAt (HH:MM, may include :SS for fractional travel), simulated.
Start/return include depot travel; totalMin includes waiting/service. Use confirmedKg*.8
expected and confirmedKg*1.1 reserved in P0. Same eligibility, mandatory commitments,
matrix/constraints/target stopping for baseline. Stop when optional target met. Stable ID ties.
Exclusions `{generatorId,reason}` with codes NOT_READY, UNCONFIRMED, HAZARD_REVIEW,
UNSUPPORTED_MATERIAL, OUT_OF_RADIUS, CAPACITY, WINDOW, SHIFT, MANDATORY_CONFLICT,
TARGET_REACHED, NOT_SELECTED_BY_HEURISTIC. Shortfall `{kg,reasons:[code]}` is exact target
gap; hypothetical causal losses are never summed as an exact explanation.

`feedsure.planner.reconcile.reconcile_trip(inputs:dict[str,Any]) -> dict[str,Any]`.
Input `{stops:[{generatorId,pickup:record|null}],gate:record|null,
absoluteToleranceKg:20,percentageTolerancePct:5}`. Only current pickup records, never audit
revisions. Return `{status,pickedKg,netGateKg,deltaKg,deltaPct,provisional,pendingStopIds,
gpsFlags:[{generatorId,status}]}`. Status precedence: PENDING_GATE, INCOMPLETE (null stop
outcome), UNMATCHED_INTAKE (P=0,G>0), NO_LOAD (P=G=0), REVIEW (absolute gap exceeds
max(20,P*.05)), WITHIN_TOLERANCE. Delta=G-P; percent null for P=0 or missing gate.
Provisional if any positive pickup ESTIMATE or gate ESTIMATE; GPS independent. PARTIAL is
a recorded outcome, not a pending stop. Bad quantities/enums/duplicate stops raise ValueError.
GPS status UNKNOWN|IN_RANGE|OUT_OF_RANGE; UNKNOWN is not a successful geofence check.

P1 optional `feedsure.planner.reliability.estimate_reliability(history, collection_date)` returns
`{pReady,volumeRatio,readinessSamples,volumeSamples,coldStart}` with PRD §7.1 exclusions;
not required by P0 callers. Matrix `build_matrix`/`ordered_points` retain existing signatures.

## Dispatch, access and mutation records

Saved plan envelope includes calculation return plus planKey/planId, version, state
DRAFT|DISPATCHED|CLOSED, createdAt, inputIds, immutable input snapshot `inputs`, serviceMode,
dispatchedAt (null in draft). plan.status is calculation status, state is trip lifecycle.
Reject dispatch with conflicts, empty route, stale version/revision, changed inputs/hazards,
or another DISPATCHED trip for the same collection date. Atomic transaction checks the date
input revision and active trip marker while changing plan state and writing dedup/audit.
Later edits produce alerts (current revision differs), never change dispatched stops.

Driver token issued deterministically with HMAC-SHA256 over planKey, issued version, expiry
using dedicated DRIVER_TOKEN_SECRET (NoEcho; no default usable production secret). Store only
hash/expiry; return token only to authenticated dispatcher in `driverAccess:{token,expiresAt}`.
Idempotent dispatch retries regenerate it using server-only fields, even across process restarts;
raw token MUST NOT be in dedup/audit responses. Secret rotation invalidates existing access.
Default lifetime 12h. New request after dispatch returns same version/access, no new trip.

Pickup fields: planKey, generatorId, outcome COLLECTED|PARTIAL|NOT_READY|SKIPPED, kg,
weightSource SCALE|ESTIMATE|null, reason string|null, remainingKg number|null,
remainingUnknown boolean, gps `{lat,lng,accuracyM,deviceAt}`|null, expectedRevision integer
(0 for first write), correctionReason required on correction. NOT_READY/SKIPPED kg=0,
source=null; both require reason. PARTIAL positive kg/source/reason and either positive remainingKg
or remainingUnknown=true, not both. Record adds revision, recordedAt, actor DRIVER assigned
planKey, gpsStatus, distanceM (null when absent/weak), gpsExpiresAt, schemaVersion, simulated.
If known latest trip load would exceed physical capacity, reject COLLECTED and require a valid
partial/return record that fits. GPS finite bounds, accuracy>=0; accuracy>100m => UNKNOWN;
distance >150m => OUT_OF_RANGE, no blocking. Default configurable GPS retention 30 days.

Gate fields: planKey, netKg (>=0), weightSource SCALE|ESTIMATE, reference|null,
expectedRevision, correctionReason on correction. Optional grossKg/tareKg both required,
finite >=0, gross>=tare, net must equal gross-tare. Record adds revision, recordedAt,
actor ADMIN, schemaVersion, simulated; reconciliation always recomputed on reads/corrections.
Gate while any stop pending is accepted and returns INCOMPLETE, not fabricated completion.

For dispatch/pickups/gate, same scoped key and canonical payload returns original saved mutation
response. Changed payload OR stale expectedRevision returns 409. Transaction writes current
record, no-TTL audit entry (`AUDIT#uniqueId`), bounded dedup entry (`DEDUP#key`, TTL 7d).
Deleting a dedup entry never deletes audit. Current record revision condition prevents retry
with expired key creating another pickup; corrections include previous values and reason.
Gate and pickup writes condition-check DISPATCHED plan state and token generation. Correcting
one stop serialises with other pickup updates through trip executionRevision/capacity checks.

## Tables, indexes and retention

Existing Generators generatorId; History generatorId/date; Submissions generatorId/ts,
byDate date/ts retained. v3 readiness records set date=collectionDate. Strong authoritative
head items live in new Operations table: collectionDate / recordKey. `META` holds
inputRevision, activePlanKey; `READY#id` holds current readiness; `HAZARD#id` holds current
hazard. All changes conditionally update META and head in same transaction as immutable history.
Hazard audit goes into MutationLog; resolving means only latest current flag is resolved.

Plans date/planId kept; matrix cache rows filtered from reads. Pickups planKey/generatorId,
GSI byGenerator generatorId/recordKey with `recordKey=collectionDate#shortPlanId#generatorId`.
Receipts query ONLY own partition; gate join is trip-level. GateLogs date/planId.
MutationLog scopeKey/idempotencyKey; TTL dedup only. New tables on-demand.
Plan snapshots and operational/audit history have no 30d TTL; only matrix/dedup cleanup uses TTL.
Precise GPS field removal needs retention sweeper; TTL cannot delete whole operational pickup.
Photos S3 expire 30d. Production GPS removal and retention governance must be disclosed if
not automated; do not claim TTL cleans fields. Legacy submissions require schemaVersion=3
before inclusion; no automatic whole-load purity or ready-status migration.

Local transport uses moto or configured local DynamoDB with the same domain handlers and
transactions, not canned responses. Missing Session 2 exports return 503 DEPENDENCY_NOT_READY
for affected calculations; never invoke legacy planner silently. Tests can inject a pure fixture
callback to exercise persistence only, explicitly labelled; not a runtime fallback.

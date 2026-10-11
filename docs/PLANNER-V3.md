# FeedSure v3 planner

This module implements the pure interfaces frozen in [READY contract v3.0](V3-CONTRACT.md).
Calculations have no clock,
database or AWS dependency. The matrix adapter is the only planner module that can call AWS, and
its client, database, clock and sleeper are injectable.

## Planning input and output

Call feedsure.planner.plan.build_plan(planner_input).

The input is the READY v3 operation snapshot: collectionDate, inputRevision, enriched generators,
prior-date history, depot, one directed matrix, params, and simulated. Malformed, non-finite,
mismatched or future-history inputs raise ValueError.

The result contains the exact contract fields: status, primary plan, fair baseline, one exclusion
per unserved generator, exact target gap, mandatory conflicts, matrix source, provenance and
assumptions. Empty supply is FEASIBLE with an explicit empty route, zero totals and a target gap;
it never emits NaN. MANDATORY_CONFLICT disables dispatch but still returns the useful route
calculation for the remaining eligible snapshot.

The exact envelope keys are collectionDate, inputRevision, status, params, plan, baseline,
excluded, shortfall, mandatoryConflicts, matrixSource, simulated and assumptions. Each route has
stops, startAt, returnAt and totals. Totals distinguish expectedCollectionKg, reservedLoadKg,
totalKm, totalMin, serviceMin and waitingMin. Stops retain coordinates, readiness submission ID,
weight source, service window, mandatory flag, provenance and arrival/service start/service end.
Times use same-day HH:MM, with :SS for fractional travel. The saved contract examples are tested
exactly; this document does not create additional public fields.

## Eligibility and quantities

A generator is eligible only when its latest schema-v3 confirmation is READY for the collection
date, confirmed kg is positive and finite, material is supported, and no hazard is unresolved.
History never promotes an unconfirmed generator into the route. The safety-first single-reason
precedence is:

1. HAZARD_REVIEW
2. UNSUPPORTED_MATERIAL
3. NOT_READY or UNCONFIRMED
4. OUT_OF_RADIUS
5. Route constraint or selection reasons

P0 uses disclosed assumptions rather than a trained model:

    baseKg               = confirmedKg * volumeRatio
    expectedCollectionKg = baseKg * readinessPrior
    reservedLoadKg       = max(confirmedKg, baseKg) * (1 + capacityBuffer)

Defaults are volume ratio 1.0, readiness prior 0.8, and capacity buffer 0.10. Truck capacity sums
reservedLoadKg; it never sums expected kg. Photo observations, legacy ACCEPT/INSPECT/HOLD verdicts
and visible-contaminant percentages do not affect these quantities. Calculations retain precision
internally and round only public presentation fields.

The caller supplies the exact params fields from common/config.py; pure planning never reads the
environment. A 2,000 kg confirmation reserves 2,200 kg with the default buffer and therefore cannot
fit a 2,000 kg truck. Target comparisons use unrounded quantities. Public numbers round to six
decimal places; evaluation kg/km is null at zero distance. Prior-date history is validated but does
not affect P0 quantities. The retained forecast_kg helper is legacy operator guidance, unused by
build_plan, and excludes same/future dates.

## Routing and baseline

Both algorithms use the same eligible candidates, mandatory commitments, quantities, directed
matrix, capacity, radius, windows, service time, shift return and target-stop rule.

- Every route starts and ends at matrix index 0 (plant).
- Radius uses the outward directed leg km[plant][generator].
- A stop is feasible only when service finishes by its window end.
- Total minutes include travel, waiting, service and depot return.
- Mandatory stops are inserted first. A failed mandatory insertion is reported as a conflict; it
  is a heuristic failure or concrete constraint reason, not proof of global infeasibility.
- Optional greedy insertion scores contribution to the remaining target divided by marginal
  directed km. The denominator is at least 0.1 km for co-located stops. Generator ID and insertion
  position break ties deterministically.
- Optional insertion stops at the target. Feasible deferred suppliers receive TARGET_REACHED or
  NOT_SELECTED_BY_HEURISTIC; constraint failures use CAPACITY, WINDOW, or SHIFT.
- Directed 2-opt keeps the served set and accepts only a full-route feasible distance reduction.
  It evaluates reversed directed edges rather than assuming symmetry.

The baseline inserts the same mandatory set, then appends the nearest feasible optional stop using
directed distance and stable ID ties. It stops under the same target policy. It is a comparator,
not an asserted optimum. Either algorithm may tie, fail, or trade distance against expected kg.

Mandatory-first means selection priority, not a promise to visit mandatory stops before every
optional stop. Later insertions and 2-opt can change order while preserving commitments. Both
algorithms share the mandatory insertion helper; only optional selection/order improvement differs.
The baseline deliberately has no optional insertion search or 2-opt. Neither heuristic performs
backtracking or reselects stops after 2-opt frees travel time. A sparse directed network may have a
feasible route requiring intermediate stops that mandatory-first insertion does not discover.

For an omitted eligible stop, every insertion position in the final primary route is checked.
If any fits, the reason is NOT_SELECTED_BY_HEURISTIC. Otherwise precedence is CAPACITY, WINDOW,
SHIFT; these are observed insertion constraints, not a proof against all possible routes.
Unavailable legs use NOT_SELECTED_BY_HEURISTIC because READY v3.0 has no UNREACHABLE enum;
mandatory unknown-cause failures use MANDATORY_CONFLICT. A target-satisfied route labels optional
omissions TARGET_REACHED without claiming those stops are individually feasible.

shortfall.kg is exactly max(0, targetKg - selected expectedCollectionKg). Its reason list is
context, not an allocation of hypothetical lost mass, and causes are not double-counted.

## Matrix reliability

matrix_cache_key hashes ordered IDs, exact coordinates, provider, region, travel mode, routing
options, road factor and fallback speed. Reordering or moving a point cannot reuse another matrix.
Dimensions, point mapping, diagonal values, finite non-negative legs and matching km/min
availability are validated.

An individual Amazon Location route error becomes a null directed leg. Structural/provider failure
triggers the labelled road-factor haversine fallback. Fallback data is never described as Location
data, and a route matrix is not exposed as road geometry or turn-by-turn navigation. Primary and
baseline consume the same single matrix snapshot.

Cached results preserve location/fallback source rather than inventing a cache source enum.
Location-failure fallback is not written to the Location cache, so a later call can recover.
Expired, mismapped, malformed or wrong-source cache entries are ignored; cache read/write failure
does not lose a provider result. Explicit MOCK_LOCATION creates a separately keyed fallback cache.
Cache TTL remains the existing two-day cleanup setting.

Provider response handling was checked against AWS's current
[CalculateRouteMatrix](https://docs.aws.amazon.com/location/latest/APIReference/API_CalculateRouteMatrix.html)
and [RouteMatrixEntry](https://docs.aws.amazon.com/location/latest/APIReference/API_RouteMatrixEntry.html)
references. Recognised entry error codes remain null km/min in that direction, even if other legs
succeed. Missing/invalid entry numbers, malformed rows or unknown error codes discard the provider
snapshot and use the labelled whole-matrix fallback. Depot/self diagonals are zero journeys.
Fallback assumes configured road factor and speed, cannot prove road accessibility, and was tested
with injected clients; no live AWS route request was made in this session.

## Reconciliation

Call feedsure.planner.reconcile.reconcile_trip(inputs). It sums only the current pickup record for
each assigned stop and compares it with net gate kg:

    P = sum(current resolved pickup kg)
    G = net gate kg
    deltaKg = G - P
    deltaPct = 100 * deltaKg / P, only when P > 0

Status precedence is PENDING_GATE, INCOMPLETE, UNMATCHED_INTAKE, NO_LOAD, then REVIEW or
WITHIN_TOLERANCE. Review requires a strict exceedance of
max(absoluteToleranceKg, P * percentageTolerancePct / 100); equality is within tolerance.
Defaults 20 kg and 5% are alert assumptions, not a physiological-loss model. Positive estimates
make the result provisional. GPS flags remain independent of weight agreement. Gains are retained
with their sign and no discrepancy is allocated to a kitchen.

Duplicate stop IDs, mismatched pickup membership, invalid enums, negative/non-finite/bool weights
and invalid PARTIAL remaining-load records raise ValueError. A PARTIAL is resolved, not pending.
If gross/tare are supplied, both must be finite and non-negative, gross >= tare, and net must
match their difference. The handler owns current-record selection, deduplication, corrections,
GPS classification and physical trip-capacity enforcement. Passing audit revisions as extra stops
is invalid; the pure function neither retrieves nor merges history.

## Reproducible evaluation

Run:

    python scripts/eval_routes.py --scenarios eval/route-scenarios --json-output eval/route-results.json --report-output eval/route-results.md

The CLI loads saved synthetic scenarios, expands them into the frozen planner input, calls the real
build_plan twice to enforce determinism, and writes machine-readable and Markdown results. Coverage
includes ready supply, cancellation, silence, mandatory service, capacity, overload, window
completion, return shift, unreachable directed travel, co-location, target gap, no feasible
optional stops, cold start and same-input baseline equality.

All three CLI path arguments are optional and default to the repository paths above. Fixtures are
fixed hand-authored scenarios (seed=null), not random draws. Expanded inputs, SHA256 input
fingerprints, full calculation schedules, baseline-specific exclusions/gap, totals and assumptions
are saved in [route-results.json](../eval/route-results.json). The evaluator also checks unchanged
inputs, constraint-consistent totals and mandatory fulfilment for both FEASIBLE routes.

Observed 11 October 2026: 18 scenarios; 16 expected-kg/distance ties, one PRIMARY_LOWER_KM and
one TRADE_OFF. Six primary routes are empty; one scenario has MANDATORY_CONFLICT. Primary misses
ten targets, baseline nine. The capacity trade-off is 176 kg / 2 km primary versus 240 kg / 2.2 km
baseline: primary misses target by 64 kg while baseline meets it. The directed-distance case is
240 kg for both at 6 km primary versus 10 km baseline. Ties include different valid route orders;
one-stop and frozen-contract cases also exercise full route equality. No fixtures were discarded.

Two actual CLI runs produced byte-identical JSON and Markdown reports. See
[route-results.md](../eval/route-results.md) for the complete table and definitions. A shorter route
with a different achieved quantity is reported as a trade-off rather than declared a win.

These fixtures are not field measurements, realised-weight replay, or evidence of environmental
savings. The evaluator does not substitute expected kg for ground truth.

Focused verification:

    ./.venv/Scripts/python.exe -m pytest tests/unit/test_planner.py tests/unit/test_planner_v3_invariants.py tests/unit/test_matrix.py tests/unit/test_reconcile.py -q

Actual result: 111 focused tests passed; the full backend suite passed 190 tests with one
Starlette/FastAPI dependency deprecation warning. Owned Ruff checks and format checks pass.
Executed Python was 3.13.9; Lambda's specified Python 3.12 runtime and AWS deployment were not
executed here. Frontend checks remain Session 3's responsibility.

## Deferred P1

History-derived readiness and volume reliability are deliberately deferred. P0 remains complete
with injected priors and explicit assumption fields. A future P1 implementation must follow the
contract exclusions for collector skips, late arrival, unresolved events, future history and
truck-limited partials before it can influence planning.

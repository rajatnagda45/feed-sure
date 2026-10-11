# Testing and evidence

Updated 11 October 2026. This document separates repeatable automated checks from earlier browser observations and pending repair integration.

## Separate plant owner interface

The isolated owner-role change passed `python -m pytest -q` (280 backend tests), `npm run test` (62 passed, 3 opt-in skipped) and `npm run build`. Ruff and `git diff --check` passed. Real local HTTP tests cover distinct credentials, rejected planner/dispatch/kitchen/driver access, dispatched-trip visibility, gate actor attribution, replay/conflicts, stale corrections, and shared admin/kitchen reconciliation. Frontend checks cover owner auth headers, isolated session storage and missing/corrected gate rendering.

The local owner demo starts on an isolated port pair. Browser tools could not connect to this host's loopback preview, so these checks do not establish an interactive browser walkthrough or deployed AWS behavior. `PlantOwnerToken` must be configured and the backend/frontend changes deployed together before cloud owner access works.

## Session C: verified independent checks

| Check | Actual result | Scope |
|---|---|---|
| `python -m pytest -q --durations=20 -o faulthandler_timeout=30 -p no:cacheprovider` | 225 passed, 21.94 s, Python 3.13.9 | Existing 192 tests plus 32 independent planner cases and one HTTP correction regression; before final map/photo integration |
| Focused real-handler correction test | 1 passed, 3.65 s | Dispatch, pickup, gate, correction, replay/conflict, frozen stops and own receipt |
| Focused planner/fairness regression | 32 passed, 0.18 s | Directed route arithmetic, shared eligibility/constraints and deterministic order independence |
| `npm run test` in `frontend/` | 22 passed, 3 opt-in skipped | Current unit/client logic; no new live browser claim |
| `npm run build` in `frontend/` | Passed | TypeScript + production bundle; existing >500 kB bundle advisory |
| `python scripts/eval_routes.py --json-output .tmp/repair-qa-route-results.json --report-output .tmp/repair-qa-route-results.md` | All 18 scenarios evaluated | Synthetic fixture matrices; no AWS calls |
| Focused Ruff checks | Passed | New Session C test files only |

The reported backend stall was investigated rather than treated as a product deadlock. In the
restricted Windows sandbox, Starlette TestClient startup blocked in asyncio's fallback socketpair
before an application request; the earlier faulthandler trace ended at `socket.accept` in
`_fallback_socketpair`. Outside that restriction, the suspected integration test completed in
3.65 seconds and the entire suite completed in 21.94 seconds. The slowest full-suite test took
2.23 seconds, so there was no test-level hang or 30-second faulthandler trigger. The rerun used
synthetic credentials and in-process Moto. No active demo was restarted or reseeded.

The independent planner tests check both routes against input arithmetic without importing the production scheduler: directed travel and depot return, service/waiting, eligibility, capacity reservation, deterministic output, generator-order independence and mandatory commitments. All 32 fixed seeds are retained; these are regression cases, not a new performance benchmark.

The independent HTTP test uses actual FastAPI/domain handlers, the production planner and reconciliation with in-process Moto. It seeds private disposable data, dispatches, records pickup and gate, corrects a pickup from 100 kg SCALE to 60 kg ESTIMATE, verifies exact retry/conflict responses, then reads driver and kitchen records. Picked kg remains 60, gap +40, REVIEW/provisional; frozen stops remain unchanged and another kitchen receives 401. It writes no demo-access manifest.

## Repeatable commands

From repository root:

```powershell
python -m pytest -q
python -m pytest -q --durations=20 -o faulthandler_timeout=30 -p no:cacheprovider
python -m pytest tests/unit/test_repair_qa_planner.py tests/integration/test_repair_qa.py -q
ruff check tests/unit/test_repair_qa_planner.py tests/integration/test_repair_qa.py
python scripts/eval_routes.py --json-output .tmp/repair-qa-route-results.json --report-output .tmp/repair-qa-route-results.md
```

From `frontend/`:

```powershell
npm run test
npm run build
```

The three tests in `frontend/integration/local-workflow.test.ts` are opt-in and were **not rerun in
the independent phase of Session C**. Do not enable them against the user's active demo or replace
its manifest. Final integration must use an isolated API/frontend port pair, a separate private
manifest, and a fresh disposable data set. See [DEPLOYMENT.md](DEPLOYMENT.md).

The opt-in harness now requires `FEEDSURE_LOCAL_ACCESS_FILE` and rejects the active manifest,
default API port and mismatched API URL. For a fresh isolated API on 8793, from `frontend/`:

```powershell
$env:FEEDSURE_LOCAL_INTEGRATION = "1"
$env:FEEDSURE_LOCAL_ACCESS_FILE = "../.tmp/repair-integration-access.json"
$env:VITE_API_BASE_URL = "http://localhost:8793"
npm run test -- integration/local-workflow.test.ts
Remove-Item Env:FEEDSURE_LOCAL_INTEGRATION, Env:FEEDSURE_LOCAL_ACCESS_FILE
```

These live commands remain pending the repair freeze. After the harness-only change, the default
suite passed 29 tests with 3 opt-in tests skipped; this is a moving-tree check, not final integration.
The prepared `scripts/verify_repair_integration.py` adds independent HTTP/photo-byte verification;
its unexecuted scenarios and required separate fixtures are recorded in the integration handoff.

## Evaluation and fairness

Primary and nearest-first use the same readiness inputs, hazard/material eligibility, mandatory insertion, matrix, capacity, windows, shift including return and target stopping. The primary applies feasibility-preserving 2-opt; the baseline selects nearest feasible optional stops. Both are heuristics.

Saved results remain: 18 scenarios, 16 ties, one equal-quantity distance improvement, one capacity trade-off; primary/baseline miss targets in 10/9 scenarios. In the trade-off, primary expects 176 kg with a 64 kg gap, while baseline expects 240 kg and meets target. A tie compares expected kg and distance only. Expected kg is not recorded collection; scenario matrices and quantities are synthetic. No realised-outcome replay, model-accuracy evaluation or field improvement is established.

## Earlier evidence and remaining gates

Earlier P0 integration notes reported a browser walkthrough of kitchen readiness/cancellation, stale dispatch, replanning, private driver access, partial/full pickups, refresh, gate intake and own-kitchen records. That was prior evidence; Session C's current HTTP tests do not repeat those browser interactions. The 11 October localhost audit observed a working draft with 5 stops, expected 720 kg, reserved 990 kg and a 480 kg target gap, with equal 7.5 km comparison routes.

Final map/photo checks remain pending until both repair owners declare READY and freeze editing. Required final evidence includes real selected-byte upload/retrieval, preview/resize/retry, scoped evidence access, persistent screening state and failure/hazard precedence, maps at desktop and phone width, and tile/WebGL failure fallback. Desktop file selection cannot prove a phone camera works. Moto/injected observations cannot prove Bedrock accuracy, S3 deployment or Amazon Location operation.

Physical-phone camera/GPS prompts, deployed AWS end-to-end, SAM build and the recorded submission video remain unverified in this QA session. Do not use the legacy two-photo ACCEPT/HOLD screening evaluation as v3 visible-item accuracy evidence.

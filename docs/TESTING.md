# Testing and evidence

Updated 11 October 2026. Final integration uses disposable synthetic records, real HTTP/domain handlers, Moto and private local photo bytes. Mock observations are configured fixtures unrelated to the selected image. See [browser evidence and limitations](INTEGRATION-VERIFICATION.md).

## Waste supplier terminology follow-up

The supplier naming change passed 280 backend tests, 62 frontend tests (3 opt-in skipped), the two focused role-access/landing tests, and the production build. Existing private `/g/:id` links and `/kitchen-access` remain valid; navigation now uses `/supplier-access`. API IDs, payload fields and permissions are unchanged. No new browser walkthrough was performed.

## Separate plant owner interface

Main includes a distinct owner desk at `/owner` and admin desk at `/admin`. This branch preserves those merged changes. The combined suites below were rerun after rebasing. Owner credentials, intake-only access, actor attribution and revisioned gate writes have automated coverage; actual owner login and gate correction were also exercised in the browser.

## Actual results

| Check | Result |
| --- | --- |
| `python -m pytest -q -o faulthandler_timeout=30 -p no:cacheprovider` | 280 passed in 29.67 s on the isolated PR snapshot |
| Frontend `npm.cmd run test` | 62 passed; 3 opt-in tests skipped |
| Opt-in client workflow below | 3 passed in 5.29 s on a fresh isolated API |
| `scripts/verify_repair_integration.py`, clean and malformed fixtures | Both PASS; clean repeated on the isolated PR snapshot |
| Independent `tests/integration/photo_live_smoke.py` | 13 checks passed, with exact PNG/JPEG retrieval |
| `npm.cmd run build` | Passed; existing MapLibre bundle-size advisory |

The restricted Windows environment stalled during asyncio fallback socketpair startup before application requests. Those runs were interrupted and are not passing results. The permitted environment completed the suites; one existing Starlette/httpx deprecation warning remains.

## Repeatable commands

From the repository root:

```powershell
python -m pytest -q -o faulthandler_timeout=30 -p no:cacheprovider
python scripts/eval_routes.py
```

From `frontend/`:

```powershell
npm ci
npm run test
npm run build
```

For live client tests, start a **fresh** isolated API from the repository root, using unused ports. Keep the active 8787/5173 demo and its manifest untouched:

```powershell
python scripts/local_demo.py --date 2026-10-12 --port 8793 --frontend-port 5193 --manifest .tmp/client-test-access.json --photo-dir .tmp/client-test-photos --photo-fixture clean
```

From `frontend/` in another shell:

```powershell
$env:FEEDSURE_LOCAL_INTEGRATION = '1'
$env:FEEDSURE_LOCAL_ACCESS_FILE = '../.tmp/client-test-access.json'
$env:VITE_API_BASE_URL = 'http://localhost:8793'
npm run test -- integration/local-workflow.test.ts
Remove-Item Env:FEEDSURE_LOCAL_INTEGRATION, Env:FEEDSURE_LOCAL_ACCESS_FILE
```

The client suite mutates records and dispatches a trip. Start another fresh process with a separate manifest for each independent smoke workflow; do not reuse the same date's active dispatched trip:

```powershell
python scripts/local_demo.py --date 2026-10-12 --port 8794 --frontend-port 5194 --manifest .tmp/clean-access.json --photo-dir .tmp/clean-photos --photo-fixture clean
python scripts/verify_repair_integration.py --manifest .tmp/clean-access.json --output .tmp/clean-result.json
```

The smoke command runs in another shell while the API is running. Repeat with another free port, manifest and photo directory and `--photo-fixture malformed`, adding `--expect-failed-analysis` to the verifier. Access files and photo bytes remain private and ignored.

## Browser verification

Actual browser checks covered scoped role entry, invalid external links, saved readiness and receipts after refresh, authenticated dispatcher photo evidence, OSM attribution and numbered saved stops, private driver-link copying, 100 kg pickup corrected to 90 kg without duplication, and updated kitchen records. At 390 px and 320 px the inspected pages had no horizontal page overflow. Refreshing records retained an unsaved 222 kg edit; saving persisted it while the dispatched stop remained frozen.

The independent photo walkthrough covered select/preview/cancel/replacement, invalid-byte rejection, upload/analysis/removal/reload and exact byte equality. Screenshots and limits are in [INTEGRATION-VERIFICATION.md](INTEGRATION-VERIFICATION.md). Desktop file selection does not prove physical camera behavior.

Map scene/lifecycle tests cover attribution, stop order, depot return, camera retention across polling, tile/WebGL failure fallback, cleanup and explicit retry. Actual OSM rendering was observed; forced tile/WebGL failure is not a browser claim.

## Evaluation and remaining evidence

Supabase account verification adds `tests/unit/test_supabase_accounts.py` (real handlers/Moto,
mocked Auth/PostgREST), frontend registration transport tests, and `tests/sql` for the shipped
Postgres registry migration/RPC with PGlite and fixture Auth schemas. Run `npm ci` and `npm test`
in `tests/sql`. These cover pending approval, privilege isolation, revision checks, last-Admin
protection, lifecycle revocation, and receipt handling. Hosted Auth/storage and multi-connection
race performance require separate live checks. See [ACCOUNTS.md](ACCOUNTS.md) for setup and recovery.

Primary and nearest-first use identical readiness, eligibility, mandatory stops, matrices and feasibility constraints. Published synthetic results remain 18 scenarios: 16 ties, one equal-quantity distance improvement and one trade-off where nearest-first collected more expected kg. Expected kg is not recorded collection. No field savings or screening accuracy are established.

Live AWS/S3/Bedrock/Amazon Location, SAM build/deployment, physical phone camera and GPS, production precise-location cleanup, licence selection and the recorded submission video remain separate tasks.

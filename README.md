# FeedSure CBG

Before the truck leaves, know which waste suppliers are ready. After it returns, know how much waste the plant received.

FeedSure is a single-truck collection prototype connecting a CBG plant with waste suppliers: hotels, hostels, PG owners, canteens and organisations generating bulk food waste. A supplier confirms a date, quantity and pickup window. The dispatcher reviews a feasible route and freezes it. The driver records pickups; the plant records net intake; suppliers see their own collection record and trip-level gate status.

## What works locally

Readiness saves without photos or AI. Planning checks full-load capacity reservations, pickup windows and depot return. Dispatch rejects changed inputs; later edits raise alerts while preserving driver stops. Scoped access, retry protection, revisioned corrections, partial pickups and gate reconciliation execute through real domain handlers with local Moto storage.

Separate interfaces share the same collection records: hotels, hostels, PGs, canteens and organisations enter through `/supplier-access` and use `/g/:id`, admins use `/admin`, CBG plant owners use `/owner`, and drivers use `/driver/:planKey`. `/plant` remains a compatible admin URL. The owner desk lists dispatched trips, recorded pickups and net-intake discrepancies, with revisioned gate corrections. Its distinct `PLANT_OWNER_TOKEN` grants intake access, not planning, dispatch or waste supplier editing.

Demo collection records, quantities and scenario matrices are **synthetic**. The local seed uses
OpenStreetMap venue names and coordinates around Harohalli as demo references; these businesses
are not verified enrolled suppliers. See [mapped venue sources and attribution](data/README.md).
Defaults of 0.8 readiness probability, 10% capacity buffer and a 1,200 kg target are prototype
assumptions. Expected collection, reserved truck load, recorded pickups and net received kg are
separate quantities.

Optional photo upload, retrieval, replacement, analysis and removal have been verified through real local handlers and an actual browser. Kitchens, dispatchers and drivers have distinct entry actions; dispatchers can review private photo evidence before recording a hazard decision. See [integration evidence](docs/INTEGRATION-VERIFICATION.md). AWS deployment, live Bedrock analysis and physical phone-camera operation remain unverified.

## Run and verify

Python 3.12+ and Node/npm are required. Install declared dependencies in a fresh checkout:

```powershell
python -m pip install -e ".[dev]"
python -m pytest -q
python scripts/eval_routes.py
Set-Location frontend
npm ci
npm run test
npm run build
```

For private waste supplier links and the disposable local API/frontend, follow [DEPLOYMENT.md](docs/DEPLOYMENT.md). Preserve any running demo and its private access manifest. Never publish tokens or `.tmp/` files.

QA on 11 October 2026: **280 backend tests**, **62 frontend tests**, all **3 opt-in live API-client tests**, clean and malformed-analysis HTTP workflows, and the production build passed. The final isolated backend run took 29.67 seconds. Actual browser checks covered role access, persisted photos, dispatcher evidence, driver corrections and narrow layouts. The 18 fixed route scenarios retain their published results: 16 ties, one shorter primary route at equal expected kg, and one trade-off where nearest-first collected more expected kg. No field savings or screening accuracy are claimed.

Three evidence levels are kept separate throughout the repository: pure fixture/unit results,
real HTTP handlers backed by disposable local Moto storage, and deployed AWS/browser-device evidence.
Local browser evidence is recorded separately from automated checks; neither establishes deployed AWS or physical-device behavior.

## AWS and boundaries

The source contains AWS SAM infrastructure and adapters for Lambda, API Gateway, DynamoDB, private S3, Bedrock and Amazon Location; Amplify hosting configuration is included. Local Moto and routing fallback do not establish live AWS use. SAM build/deployment was not performed in this QA session.

Photos can assist with visible items only; they cannot establish whole-load safety, chemistry, mass or gas yield. Hazards need human resolution. Gate records show received waste, not independently verified processing. GPS is optional evidence; precise-field retention still needs an operational removal job. Field benefit and user usability remain unvalidated.

## Documentation

- [API](docs/API.md), [database](docs/DATABASE.md), [security](docs/SECURITY.md)
- [Planner policy](docs/PLANNER-V3.md) and [synthetic evaluation](eval/route-results.md)
- [Tests and evidence](docs/TESTING.md), [local run/deployment](docs/DEPLOYMENT.md)
- [2 minute 45 second demo script](docs/DEMO-SCRIPT.md), [submission draft and evidence checklist](docs/SUBMISSION.md)

## AI tools used

OpenAI Codex was used for implementation, review, tests and documentation. Confirm any additional AI tools used by the team before submission. Runtime Bedrock is a separate optional service; this local QA does not establish a live model call.

## Credits and licence

React, React Router, Vite, TypeScript, MapLibre GL JS, boto3, FastAPI, uvicorn, pytest, Moto and Vitest are external dependencies; retain their respective licences. A project licence file is currently missing; the owner should select and add it before publication.

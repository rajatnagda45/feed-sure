# FeedSure CBG

Before the truck leaves, know which kitchens are ready. After it returns, know how much waste the plant received.

FeedSure is a single-truck collection prototype for a CBG plant and enrolled food-waste kitchens. A kitchen confirms a date, quantity and pickup window. The dispatcher reviews a feasible route and freezes it. The driver records pickups; the plant records net intake; kitchens see their own collection record and trip-level gate status.

## What works locally

Readiness saves without photos or AI. Planning checks full-load capacity reservations, pickup windows and depot return. Dispatch rejects changed inputs; later edits raise alerts while preserving driver stops. Scoped access, retry protection, revisioned corrections, partial pickups and gate reconciliation execute through real domain handlers with local Moto storage.

All demo kitchens, quantities and scenario matrices are **synthetic**. Defaults of 0.8 readiness probability, 10% capacity buffer and a 1,200 kg target are prototype assumptions. Expected collection, reserved truck load, recorded pickups and net received kg are separate quantities.

The optional photo and map repairs are undergoing independent integration verification; their current release status is in [TESTING.md](docs/TESTING.md). AWS deployment, live Bedrock analysis and physical phone-camera operation have not been established by this QA run.

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

For private kitchen links and the disposable local API/frontend, follow [DEPLOYMENT.md](docs/DEPLOYMENT.md). Preserve any running demo and its private access manifest. Never publish tokens or `.tmp/` files.

QA on 11 October 2026: **225 backend tests passed in 21.94 seconds** on Python 3.13.9; the independent real-handler correction test passed in 3.65 seconds and the 32 directed planner cases passed in 0.18 seconds. Frontend/map/photo results are provisional until the two repair handoffs freeze and the final integration run completes. The 18 fixed route scenarios reproduced the saved reports: 16 ties, one shorter primary route at equal expected kg, and one trade-off where nearest-first collected more expected kg. No field savings or screening accuracy are claimed.

Three evidence levels are kept separate throughout the repository: pure fixture/unit results,
real HTTP handlers backed by disposable local Moto storage, and deployed AWS/browser-device evidence.
Only the first two have been established by Session C so far; a responsive or mock screen alone is
not treated as an integrated workflow.

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

# Local run and deployment

Updated 11 October 2026. Local P0 works through real HTTP/domain handlers with Moto. Cloud deployment and SAM build remain unverified in this repair QA session. This document replaces legacy reset/deploy instructions.

## Fresh disposable local demo

Use Python 3.12+ and Node/npm. From the repository root, install the development dependencies:

```powershell
python -m pip install -e ".[dev]"
python scripts/local_demo.py --help
```

In a **fresh checkout with no existing demo to preserve**, start the API:

```powershell
python scripts/local_demo.py --date 2026-10-12 --port 8787 --frontend-port 5173
```

In another shell from `frontend/`:

```powershell
$env:VITE_API_BASE_URL = "http://localhost:8787"
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173/admin` for dispatch (`/plant` remains compatible) and `http://localhost:5173/owner` for CBG intake. Privately read `adminToken`, `plantOwnerToken` and kitchen links from `.tmp/local-demo-access.json`, and choose 12 October 2026. The runner generates distinct staff credentials. The owner sees a trip after admin dispatch and can record net received weight; driver pickups and kitchen receipts share its gate status. These credentials are disposable secrets. Bootstrap links are scoped; the dispatched trip issues separate driver access. Keep access files out of recordings and Git.

For deployment, configure a distinct secret with SAM parameter `PlantOwnerToken` (NoEcho), which supplies backend `PLANT_OWNER_TOKEN`. It defaults to disabled access. The ordinary local shim reads `PLANT_OWNER_TOKEN` from its process environment. Never use the admin token as the owner token or put either in frontend build variables. Redeploy the SAM API/Lambda changes and publish the rebuilt frontend together to enable `/intake` and its CORS header.

The runner binds loopback, seeds ten fictional kitchens and executes real handlers, transactions, planner and reconciliation with in-process Moto. Routing uses labelled fallback estimates. Photos use private local byte storage and explicit mock screening fixtures unrelated to the image. Operational data and credentials are recreated when the runner starts; database state disappears on shutdown. Photo bytes persist under the selected private photo directory. Browser upload, retrieval, replacement and removal are verified locally; this mode does not establish live AWS use.

## Preserve an existing demo

Do not stop or reseed the active API/frontend on 8787/5173. Use an unused port pair, a separate manifest and a separate photo directory:

```powershell
python scripts/local_demo.py --date 2026-10-12 --port 8793 --frontend-port 5193 --manifest .tmp/repair-integration-access.json --photo-dir .tmp/repair-integration-photos --photo-fixture clean
```

From `frontend/`, set `VITE_API_BASE_URL=http://localhost:8793` and start Vite with port 5193 and `--strictPort`. Do not open the default demo access file for this run. These isolated startup options and live photo workflows have been exercised. Follow [TESTING.md](TESTING.md) for fresh-fixture client and HTTP checks.

Use matching API base URL, frontend port and allowed origin. Always use Vite `--strictPort`; do not silently fall onto another origin. Set `FEEDSURE_LOCAL_ACCESS_FILE` to the separate manifest when enabling the opt-in tests. Never copy or overwrite current demo credentials for tests. The home page explains each role: kitchen and driver links remain private, and the dispatcher enters the credential from this runtime manifest. Share neither the manifest nor access links publicly.

## Optional NVIDIA image analysis

The v3 photo screen can use NVIDIA's hosted
[Nemotron Nano 12B v2 VL](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-nano-12b-v2-vl).
The adapter follows NVIDIA's [chat completions API](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-nano-12b-v2-vl-infer)
and uses the existing visible-item observation prompt and validation. It adds no Python dependencies.
The key stays on the backend; photos are sent to NVIDIA when the user requests analysis.

For the ordinary local shim or Lambda, set `PHOTO_ANALYSIS_PROVIDER=nvidia`,
`NVIDIA_API_KEY` to your private key, and `MOCK_BEDROCK=false`. The defaults are
`NVIDIA_MODEL_ID=nvidia/nemotron-nano-12b-v2-vl`,
`NVIDIA_API_URL=https://integrate.api.nvidia.com/v1/chat/completions`,
`NVIDIA_MAX_TOKENS=600`, and `NVIDIA_TIMEOUT_SECONDS=5`.
Keep the timeout at five seconds or less to leave room for one retry inside the Lambda budget.
`MOCK_BEDROCK=true` still overrides both providers with fixtures.
Missing keys, failed requests or invalid observations leave the photo `NOT_CHECKED` and
readiness saved. Existing unresolved hazards still require human resolution.

To use NVIDIA with a **new disposable Moto demo**, first set `NVIDIA_API_KEY` in the server
process environment, then run the command below with unused ports and a separate manifest:

```powershell
python scripts/local_demo.py --photo-provider nvidia --port 8795 --frontend-port 5195 --manifest .tmp/nvidia-demo-access.json --photo-dir .tmp/nvidia-demo-photos
```

Use `VITE_API_BASE_URL=http://localhost:8795` and frontend port 5195 with `--strictPort`.
The usual photo upload and **Analyze photo** control invoke NVIDIA. This option makes real
NVIDIA requests; the collection data and AWS storage remain synthetic/local.
The runner's default `--photo-provider mock` remains offline.

SAM exposes matching parameters `PhotoAnalysisProvider`, `NvidiaApiKey` (NoEcho),
`NvidiaModelId`, `NvidiaApiUrl`, `NvidiaMaxTokens` and `NvidiaTimeoutSeconds`.
Supply the private key through secure deployment configuration, never a checked-in file,
frontend variable, access manifest or recording. Mocked HTTP tests verify request bytes,
persisted observations and timeout handling; no live NVIDIA model call has been verified.

## Cloud preparation: not a deployment claim

`backend/template.yaml` is the source of truth for resources and routes. Production uses Lambda/API Gateway, DynamoDB and private S3, with Bedrock visible-item assistance and Amazon Location routing/map adapters. The frontend has Amplify build configuration. Review the final [API](API.md), [security](SECURITY.md) and environment examples before any authorised deployment.

A later deployment needs an AWS account/region, enabled image-capable Bedrock model, private random admin and driver secrets, a unique photo bucket, exact allowed frontend origin and appropriately scoped map access. Verify actual service availability and current provider setup at that time. Do not put secrets in Git or `VITE_` variables; frontend configuration is public.

Run `sam validate` and `sam build` when SAM CLI is installed. A build or template inspection proves neither deployed endpoints nor actual AWS requests. After an independently authorised deployment, verify the public URL through readiness, photo, draft, dispatch, pickup, gate and kitchen record; retain redacted evidence of actual service calls and their failure modes. No cloud resources, credentials, publications or teardown operations are part of this repair assignment.

## Recording mode

Follow [DEMO-SCRIPT.md](DEMO-SCRIPT.md). Keep synthetic-data labels visible and read actual route results. Identify the basemap provider separately from route-matrix source; straight connections are schematic. Use a phone for camera proof, or explicitly label desktop image selection. Live AWS proof, a signed-out repository/video check and final submission are separate remaining tasks in [SUBMISSION.md](SUBMISSION.md).

## Optional Supabase setup

Follow [SUPABASE.md](SUPABASE.md) for the private bucket migration, user assignments, paired frontend/server variables and SAM provider parameters. This preserves the existing AWS domain backend. Supabase credentials and live service verification are deployment prerequisites.

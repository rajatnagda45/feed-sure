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

Open `http://localhost:5173/plant`, privately read the dispatcher token and kitchen links from `.tmp/local-demo-access.json`, and choose 12 October 2026. These credentials are disposable secrets. Bootstrap links are scoped; the dispatched trip issues separate driver access. Keep access files out of recordings and Git.

The runner binds loopback, seeds ten fictional kitchens and executes real handlers, transactions, planner and reconciliation with in-process Moto. Routing uses labelled fallback estimates. The in-progress photo repair adds local byte storage and explicit mock screening fixtures. Operational data and credentials are recreated when the runner starts; database state disappears on shutdown. Photo bytes are files under the selected private photo directory. This mode does not establish live AWS use. Photo/map runtime checks remain pending the final owner handoffs.

## Preserve an existing demo

Do not stop or reseed the active API/frontend on 8787/5173. A separate port alone is insufficient: the earlier runner always wrote the default access manifest. The photo repair now exposes `--manifest`, `--photo-dir` and `--photo-fixture`. After the repair owners freeze editing, use an unused port pair and a separate private path:

```powershell
python scripts/local_demo.py --date 2026-10-12 --port 8793 --frontend-port 5193 --manifest .tmp/repair-integration-access.json --photo-dir .tmp/repair-integration-photos --photo-fixture clean
```

From `frontend/`, set `VITE_API_BASE_URL=http://localhost:8793` and start Vite with port 5193 and `--strictPort`. Do not open the default demo access file for this run. This command has been checked against the runner's argument definitions; final live startup/photo verification is pending. Independent in-process HTTP regression remains available in [TESTING.md](TESTING.md) and writes no access manifest.

Use matching API base URL, frontend port and allowed origin. Always use Vite `--strictPort`; do not silently fall onto another origin. Do not set `FEEDSURE_LOCAL_INTEGRATION=1` until the opt-in client tests support the same private manifest. No current demo credentials should be copied or overwritten for tests.

## Cloud preparation: not a deployment claim

`backend/template.yaml` is the source of truth for resources and routes. Production uses Lambda/API Gateway, DynamoDB and private S3, with Bedrock visible-item assistance and Amazon Location routing/map adapters. The frontend has Amplify build configuration. Review the final [API](API.md), [security](SECURITY.md) and environment examples before any authorised deployment.

A later deployment needs an AWS account/region, enabled image-capable Bedrock model, private random admin and driver secrets, a unique photo bucket, exact allowed frontend origin and appropriately scoped map access. Verify actual service availability and current provider setup at that time. Do not put secrets in Git or `VITE_` variables; frontend configuration is public.

Run `sam validate` and `sam build` when SAM CLI is installed. A build or template inspection proves neither deployed endpoints nor actual AWS requests. After an independently authorised deployment, verify the public URL through readiness, photo, draft, dispatch, pickup, gate and kitchen record; retain redacted evidence of actual service calls and their failure modes. No cloud resources, credentials, publications or teardown operations are part of this repair assignment.

## Recording mode

Follow [DEMO-SCRIPT.md](DEMO-SCRIPT.md). Keep synthetic-data labels visible and read actual route results. Identify the basemap provider separately from route-matrix source; straight connections are schematic. Use a phone for camera proof, or explicitly label desktop image selection. Live AWS proof, a signed-out repository/video check and final submission are separate remaining tasks in [SUBMISSION.md](SUBMISSION.md).

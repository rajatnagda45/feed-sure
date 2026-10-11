# DEPLOYMENT — FeedSure CBG

## Current v3 run path

Cloud deployment has not been performed in this implementation session. SAM CLI was unavailable;
route/CORS consistency was tested by parsing the template, not by a SAM build or AWS deployment.

Install backend dev dependencies with `python -m pip install -e ".[dev]"`. For a local demo, start
`docker compose up -d`, then set these environment variables in the same PowerShell window:

```powershell
$env:AWS_ENDPOINT_URL = "http://localhost:5000"
$env:AWS_ACCESS_KEY_ID = "testing"
$env:AWS_SECRET_ACCESS_KEY = "testing"
$env:AWS_DEFAULT_REGION = "ap-south-1"
$env:MOCK_LOCATION = "true"
$env:ADMIN_TOKEN = "<your private random dispatcher token>"
$env:DRIVER_TOKEN_SECRET = "<your private random secret of at least 32 characters>"
python scripts/seed_data.py --local --v3-date 2026-10-12
python -m uvicorn dev_server:app --app-dir backend --port 8787
```

The local seed creates ten fictional kitchens, including cancellations, unconfirmed suppliers and
capacity/window conflicts. It preserves existing profiles and tokens; private links are appended
to ignored `seed_links.local.txt`. Do not use `--reset` with v3. Choose the service date you will
demo; existing seeded records are retained on rerun.

In a separate frontend shell, set `VITE_API_BASE_URL=http://localhost:8787`, then run `npm ci` and
`npm run dev` from `frontend/`. Use your private dispatcher token at `/plant`; kitchen links come
from the local links file and the dispatched trip supplies driver access. Mock mode replaces AWS
transport/routing, while real domain handlers, planner and persistence transactions still execute.

The SAM template now has OperationsFunction and UploadsFunction, eight DynamoDB tables, and a
private photo bucket. A future authorised deploy requires real AdminToken/DriverTokenSecret,
AllowedOrigin and a globally unique bucket name. Do not commit secrets or local SAM config.

The following early deployment instructions describe v1 and are preserved only for reference.

> **Version note:** This is a legacy v1 reference; some described features remain unimplemented.
> [PRD v3](PRD.md) governs the target workflows, calculations, contracts and build order.
> Where these documents conflict, PRD v3 wins. Update this reference as each workflow is implemented.

Default region: **ap-south-1 (Mumbai)**. On day 1, confirm that Bedrock (with the chosen model) and
Amazon Location v2 are available there. If one is not, set `BEDROCK_REGION` or `LOCATION_REGION`
separately; every client reads its own region from config.

## 1. Prerequisites
- An AWS account (new accounts get up to $200 in credits); an IAM user or SSO profile with admin for the hackathon
- AWS CLI v2, AWS SAM CLI, Python 3.12, Node 20+, Git
- Docker (optional, only for `docker-compose` local mode or `sam build --use-container`)

## 2. One-time AWS setup (day 1, first hour)
1. **Bedrock model access:** Bedrock console → Model catalog → enable an **image-capable** model
   (for example a current Claude model). Note the model ID or the **inference profile ID** (cross-region
   profiles are prefixed, e.g. `apac.` / `us.`). Put it in `BEDROCK_MODEL_ID`. Test it once in the
   console playground with a photo.
2. **Amazon Location API key** (for map tiles in the browser): Location console → API keys → create
   a key allowing **Maps** actions only, with referrers `https://*.amplifyapp.com/*` and
   `http://localhost:5173/*`, and an expiry after the judging period. Put it in `VITE_LOCATION_API_KEY`.
   Map style URL:
   `https://maps.geo.${REGION}.amazonaws.com/v2/styles/Standard/descriptor?key=${KEY}`
3. Route matrix: no key needed. The `plans` Lambda role gets `geo-routes:CalculateRouteMatrix` in SAM.
4. Set a **billing alarm** at $10 (CloudWatch → Billing).

## 3. Backend (SAM)
`backend/template.yaml` defines:
- `PhotosBucket` (private, encrypted, CORS, 30-day lifecycle)
- Tables `Generators`, `History`, `Submissions` (+ GSI `byDate`), `Plans` (TTL `ttl`)
- 4 functions (Python 3.12, arm64, 512 MB, 29 s timeout): `GeneratorsFn`, `UploadsFn`,
  `SubmissionsFn`, `PlansFn`
- An HTTP API with CORS and throttling, and routes as in API.md
- Parameters: `Stage`, `AdminToken` (NoEcho), `BedrockModelId`, `AllowedOrigin`
- Outputs: `ApiUrl`, `PhotosBucketName`, table names

```bash
cd backend
sam build                       # use --use-container if a local Python mismatch causes errors
sam deploy --guided             # first time: stack feedsure-dev, region ap-south-1, save to samconfig.toml
sam deploy                      # afterwards
sam logs -n SubmissionsFn --stack-name feedsure-dev --tail
```
After the first deploy, copy `ApiUrl` into the frontend env and set `AllowedOrigin` to the Amplify
URL once you have it, then redeploy.

## 4. Seed data
1. Fill `data/pilot_zone.json` with the real plant's name and coordinates.
2. Run:
```bash
python scripts/seed_data.py --stage dev --reset --demo 2026-10-10
```
3. Copy the printed `suggested TARGET_KG` into the SAM parameter or env, and keep
   `seed_links.local.txt` (generator links) private.

## 5. Frontend (Amplify Hosting)
1. Push the repo to GitHub (public, as the rules require).
2. Amplify console → Host web app → GitHub → this repo, branch `main`. The monorepo app root is `frontend`.
3. Build settings (`amplify.yml` at the repo root):
```yaml
version: 1
applications:
  - appRoot: frontend
    frontend:
      phases:
        preBuild: { commands: [ "npm ci" ] }
        build:    { commands: [ "npm run build" ] }
      artifacts: { baseDirectory: dist, files: [ "**/*" ] }
      cache: { paths: [ "node_modules/**/*" ] }
```
4. Environment variables: `VITE_API_BASE_URL`, `VITE_AWS_REGION`, `VITE_LOCATION_API_KEY`.
5. Rewrites (SPA): source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`
   → target `/index.html`, type `200 (Rewrite)`.
6. Put the Amplify URL into `AllowedOrigin` (SAM) and the Location key referrers.

## 6. Local development
**Recommended:** run the frontend locally against the deployed dev API:
`cd frontend && npm run dev` with `VITE_API_BASE_URL` set to `ApiUrl`.

**Fully offline (optional):**
```bash
docker compose up -d                      # moto server on :5000 (S3 + DynamoDB)
export $(grep -v '^#' .env | xargs)       # with AWS_ENDPOINT_URL=http://localhost:5000, MOCK_BEDROCK=true, MOCK_LOCATION=true
python scripts/seed_data.py --local --reset --demo 2026-10-10
cd backend && uvicorn dev_server:app --reload --port 8787
cd frontend && VITE_API_BASE_URL=http://localhost:8787 npm run dev
```
`dev_server.py` is a thin FastAPI shim that converts requests into API Gateway v2 events and calls
the same handler functions. It is a dev dependency only and is never deployed.

## 7. Demo-day checklist
- [ ] Re-seed with `--reset --demo <date>` and confirm the baseline plan meets the target
- [ ] Open the generator link for hostel-3 on a real phone over mobile data
- [ ] Dashboard is logged in with the admin token; polling is on
- [ ] Bedrock latency is fine (warm the Lambda with one test submission first)
- [ ] The AWS console tabs are open: Bedrock, Lambda, DynamoDB, Location

## 8. Teardown (after judging)
```bash
aws s3 rm s3://<PhotosBucketName> --recursive
cd backend && sam delete --stack-name feedsure-dev
```
Delete the Location API key and the Amplify app. Keep the repo public.

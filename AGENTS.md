# AGENTS.md — FeedSure CBG

Read this file first, then `docs/PRD.md`. These two files override anything else.

## 1. What we are building (one sentence)

A mess worker photographs today's wet waste → AI returns **Accept / Inspect / Hold** with a fix →
tomorrow's truck route for a compressed-biogas (CBG) plant is re-planned on **expected usable kg** →
the plant sees whether it will hit its intake target, and if not, by how much and why.

That loop is the whole product. If a task does not serve this loop, do not do it.

## 2. Context you must respect

- This is a **day hackathon build** (WeMakeDevs Environmental Hacks, Waste and Energy track,
  ). Judges only see a **≤3 minute video**, a public repo and a short writeup.
- **"One feature that runs beats five that almost do."** Working > complete > polished.
- **AWS must be used and visible**: Bedrock, Lambda, API Gateway, S3, DynamoDB,
  Amazon Location Service, Amplify Hosting, AWS SAM.
- **All code is written during the event.** Commit small and often with clear messages; the git
  history must match the event dates. Never paste in code from older projects.
- **Generator volumes are simulated.** Every screen and the README must say so where numbers appear.
- Keep a running list of AI tools used in `README.md` → "AI tools used" (required by the rules).

## 3. Tech stack (do not change without asking the human)

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router, MapLibre GL, plain CSS (no UI kit) |
| Backend | Python 3.12 AWS Lambda functions, **stdlib + boto3 only** (no native deps) |
| IaC | AWS SAM (`backend/template.yaml`) |
| API | API Gateway HTTP API |
| AI | Amazon Bedrock **Converse API**, image-capable model from `BEDROCK_MODEL_ID` |
| Data | DynamoDB (on-demand), S3 (private bucket) |
| Maps/routing | Amazon Location Service v2 (`geo-routes` route matrix, `geo-maps` tiles via API key) |
| Hosting | Amplify Hosting (frontend), SAM stack (backend) |
| Tests | pytest + moto (backend), vitest (frontend logic only) |

Why stdlib-only Lambdas: no native wheels → `sam build` never breaks on Windows/Mac.
Validate JSON with small hand-written validators (see `docs/ARCHITECTURE.md` §5), not pydantic.

## 4. Repository layout (create exactly this)

```
feedsure-cbg/
├── AGENTS.md  README.md  .env.example  docker-compose.yml  pyproject.toml  .gitignore
├── docs/                      PRD, ARCHITECTURE, API, DATABASE, UI, SECURITY, TESTING, DEPLOYMENT
├── backend/
│   ├── template.yaml          SAM template (all AWS resources)
│   ├── dev_server.py          local-only FastAPI shim that calls the same handlers
│   └── src/
│       ├── requirements.txt   boto3 only
│       └── feedsure/
│           ├── handlers/      generators.py uploads.py submissions.py plans.py
│           ├── screening/     prompt.py bedrock_client.py validate.py decision.py
│           ├── planner/       forecast.py usable.py matrix.py greedy.py two_opt.py
│           │                  baseline.py shortfall.py plan.py
│           └── common/        config.py db.py http.py ids.py errors.py
├── frontend/                  package.json vite.config.ts index.html src/
├── scripts/                   seed_data.py  eval_screening.py
├── data/                      pilot_zone.json
├── eval/                      labels.csv  images/
└── tests/                     unit/ integration/ fixtures/
```

**Pure logic** (`screening/decision.py`, `screening/validate.py`, everything in `planner/` except
`matrix.py`) must have **no AWS calls** so it is unit-testable without mocks.

## 5. Build order (milestones) — finish each before starting the next

| # | Milestone | Done when |
|---|---|---|
| M0 | Skeleton | Repo layout exists, `sam build` passes, frontend `npm run dev` shows routes `/`, `/g/:id`, `/plant` |
| M1 | Data | `scripts/seed_data.py` fills DynamoDB with 10 generators + 14 days history from `data/pilot_zone.json` |
| M2 | Upload | Generator page uploads 2 resized photos to S3 via presigned POST |
| M3 | Screening | `POST /submissions` returns a verdict from Bedrock; verdict screen renders it; `MOCK_BEDROCK=true` works offline |
| M4 | Planner | `POST /plans` returns plan + baseline + shortfall from pure functions; unit tests green |
| M5 | Dashboard | `/plant` shows submissions, map with route, KPIs, comparison, re-plan controls |
| M6 | Deploy | Backend on AWS via SAM, frontend on Amplify, end-to-end works on the public URL |
| M7 | Eval + polish | `scripts/eval_screening.py` prints false-accept rate on `eval/`; README filled |

Stretch (only after M7, only if the human asks): language toggle beyond EN/HI, plant-gate logging,
EventBridge nightly plan, generator trust score.

## 6. Commands

```bash
# backend
pip install -e ".[dev]"                 # from repo root
pytest                                  # all backend tests
ruff check . && ruff format .
cd backend && sam build && sam deploy   # deploy (first time: sam deploy --guided)
uvicorn dev_server:app --reload --port 8787   # local API (from backend/)

# frontend
cd frontend && npm install && npm run dev
npm run test && npm run build

# data + eval
python scripts/seed_data.py --stage dev
python scripts/eval_screening.py --images eval/images --labels eval/labels.csv
```

## 7. Coding rules

- Type hints on all Python functions; docstrings on public functions in `planner/` and `screening/`.
- All config comes from `feedsure/common/config.py`, which reads env vars with defaults from `.env.example`.
  **No hard-coded thresholds, model IDs, regions, table or bucket names.**
- Handlers are thin: parse → validate → call pure logic → persist → respond. Use `common/http.py`
  helpers for JSON responses and errors (format in `docs/API.md`).
- Every external call (Bedrock, Location, S3, DynamoDB) is wrapped so failures degrade gracefully:
  - Bedrock fails or returns invalid JSON → retry once → verdict `INSPECT`, `reason: "screening_failed"`.
  - Location route matrix fails → haversine × 1.3 road factor, `matrix_source: "fallback"` in the plan.
- Deterministic planner: same inputs → same output (stable sort keys, no randomness).
- Frontend: TypeScript strict, one `api.ts` client, no global state library. Mobile-first.
- Never log image bytes, tokens or full presigned URLs.

## 8. Definition of done for any task

1. Code + tests for any logic you added (see `docs/TESTING.md`).
2. `pytest` and `npm run build` pass.
3. Docs updated if you changed an API, table or env var.
4. A short commit message: `feat(planner): add 2-opt improvement`.

## 9. Do NOT

- Add login/auth providers, payments, multiple plants, multiple trucks, IoT, blockchain, carbon credits.
- Claim the model measures chemistry, moisture or methane yield. It flags **visible** contaminants only.
- Let the LLM decide the verdict. The model returns observations; `decision.py` decides.
- Commit `.env`, AWS keys, API keys or real people's photos with faces.
- Introduce new dependencies without stating why in the commit message.
- Rename the product or invent statistics. Use only figures already in `docs/PRD.md`.

## 10. When to stop and ask the human

- A required value is missing (plant coordinates in `data/pilot_zone.json`, model ID, region).
- A service is unavailable in the chosen region.
- Any change to scope, stack, API contracts or table keys.
- Anything that would take more than ~2 hours and is not on the milestone list.

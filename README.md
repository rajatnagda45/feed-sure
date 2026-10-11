# FeedSure CBG

## Hackathon implementation: v3

Kitchens confirm tomorrow's food-waste quantity and pickup window. The dispatcher reviews a
feasible route and freezes it; the driver records actual pickups; the plant records net gate
intake. Kitchens can read their own pickup records and the linked trip's reconciliation state.

Implemented backend: header-based access scopes, durable readiness without photos, human hazard
review, immutable plan snapshots, conditional dispatch, expiring driver access, atomic pickup/gate
corrections and retry protection. The React frontend contains kitchen, dispatcher and driver views.
The browser walkthrough and cloud deployment have not yet been verified by the backend owner.

The planner enforces reserved capacity, service windows and depot return. It compares with a
nearest-first baseline under the same constraints. Defaults are a 1,200 kg target, 0.8 readiness
prior and 10% capacity buffer. Synthetic scenarios are evaluation fixtures, not field savings.

- [API contract](docs/V3-CONTRACT.md) and executable examples in `tests/contracts/`
- [Local run and deployment](docs/DEPLOYMENT.md)
- [Planner and evaluation](docs/PLANNER-V3.md), results in `eval/route-results.md`
- [Security and remaining hardening](docs/SECURITY.md)

P1 photo screening is deferred: the optional screen endpoint returns 503 and never blocks
readiness. Precise GPS retention requires an operational removal job. No photo-derived purity,
methane yield, screening accuracy or deployed performance is claimed.

Coding tools used: OpenAI Codex, PowerShell, Python, pytest/moto, Ruff and Git. The AWS SAM
template targets Python 3.12; local backend checks used Python 3.13. SAM CLI was unavailable.

## Preserved early concept notes

The text below is historical planning material, superseded by the shipped API contract above.
Its earlier statistics, feature descriptions and TODOs are not submission evidence. Private
working documents referenced below are retained locally and excluded from this Git update.

> **Implementation target: PRD v3 (10 Oct 2026).** Kitchens confirm readiness; a dispatcher plans
> and freezes a feasible route; drivers record pickups; the plant reconciles net gate intake.
> Photos are optional assistance. See [PRD v3](docs/PRD.md), especially §12, and the
> [hackathon review](docs/HACKATHON-REVIEW.md) for scope, evidence and implementation gaps.
> Existing code largely follows v1: the plant dashboard is still a placeholder, and driver/gate
> workflows are not implemented. The sections below describe the legacy concept, not v3 completion.
> Earlier research statistics below need re-verification before use in a pitch.
> [PRD v1](docs/PRD-v1.md) and [PRD v2](docs/PRD-v2.md) are preserved for reference.

**A phone-based pre-pickup quality check and route planner for compressed-biogas (CBG) plants.**

Hostel messes, hotels and canteens photograph their wet waste before pickup. Amazon Bedrock flags
visible contamination (plastic, foil, cutlery, glass) and gives the kitchen an exact fix. The plant's
planner then builds tomorrow's collection route on **expected usable kilograms**, not raw weight or
distance alone, and states plainly when the intake target cannot be met, by how much, and why.

> Built for WeMakeDevs **Environmental Hacks** (Bharat Builds Tour), Waste and Energy track, Oct 8–11 2026.

## The problem

India had about 1,900 registered CBG/Bio-CNG projects in August 2026, but only about 217 were
commissioned (GOBARdhan portal, via PIB, 6 Aug 2026). Plants that do run are reported to average
about 35% utilisation (IEA, India Bioenergy Market Report, Jan 2026), and unreliable, poorly
segregated feedstock is a leading cited reason. Trucks get sent to contaminated loads, and kitchens
never learn what was wrong.

## Who it is for

- **Plant logistics manager**: decides which pickups go on tomorrow's route.
- **Mess or kitchen worker** at a bulk waste generator: takes two photos and fixes what is flagged.

## How it works

1. The worker opens their generator link, enters approximate kg and takes two guided photos.
2. Bedrock (vision) lists visible contaminants; our rules engine returns **Accept / Inspect / Hold**
   with one plain instruction.
3. The planner estimates usable kg per generator and builds a single-truck route that respects
   capacity, pickup windows and shift time.
4. The dashboard compares the result against a nearest-first baseline and shows any shortfall.

## AWS services

Amazon Bedrock · AWS Lambda · Amazon API Gateway · Amazon S3 · Amazon DynamoDB ·
Amazon Location Service · AWS Amplify Hosting · AWS SAM

## Quick start

See `docs/DEPLOYMENT.md`. In short:

```bash
pip install -e ".[dev]" && pytest
cd backend && sam build && sam deploy --guided
python scripts/seed_data.py --stage dev
cd frontend && npm install && npm run dev
```

## Screening accuracy

_TODO after M7:_ "On N labelled test photos: X false accepts, Y caught contaminated loads."

## Limits (read before judging)

- Generator volumes and history are **simulated**. Plant coordinates are approximate and must be
  verified before the demo; thresholds are assumptions unless stated otherwise.
- Photo screening sees only **visible** contamination. It is a triage aid, not a lab test, and does
  not estimate moisture or methane yield.



## Team

_TODO_

## Licence

MIT

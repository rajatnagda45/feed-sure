# FeedSure CBG

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

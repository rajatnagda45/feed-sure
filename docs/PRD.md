# PRD — FeedSure CBG

## 1. Problem

CBG plants that process urban food waste depend on a steady supply of **clean** wet waste. Today:

- Trucks are sent to generators whose waste turns out to be contaminated or too small to justify the trip.
- Plants cannot tell the day before whether tomorrow's collections will meet their intake target.
- Kitchens get no specific feedback on what made their waste unusable, so nothing improves.

Evidence (verify figures on submission day; quote them with dates):
- About 217 of about 1,908 registered CBG/Bio-CNG plants commissioned (PIB/GOBARdhan, 6 Aug 2026).
- Average plant utilisation about 35% (IEA India Bioenergy Market Report, Jan 2026); 20–60% range (PNGRB, Aug 2025).
- Bulk waste generators (≥100 kg/day) must process wet waste or use authorised processors under the
  Solid Waste Management Rules 2026 (in force 1 Apr 2026).

Do **not** claim contamination is the main reason plants are unbuilt. Claim: unreliable, poorly
segregated feedstock is a leading reason **operating** plants run below capacity.

## 2. Users

| Persona | Context | Job to be done |
|---|---|---|
| **Ravi, plant logistics lead** (primary) | Desktop, evening before collection | "Tell me which pickups to put on tomorrow's route so we get enough usable feedstock without wasted trips." |
| **Meena, hostel mess supervisor** (secondary) | Cheap Android phone, wet hands, kitchen light, may prefer Hindi | "Tell me quickly if my bin is OK, and exactly what to remove if it isn't." |

## 3. Scope

### In scope (MVP, must appear in the demo video)

| ID | Requirement |
|---|---|
| F1 | Each generator has a unique link `/g/{generatorId}?t={token}`. No login. |
| F2 | Generator enters approximate weight (kg) and takes **two** guided photos: top of bin, and a sample spread on a tray. |
| F3 | Photos are resized on the phone (≤1280 px long edge, JPEG) and uploaded directly to S3. |
| F4 | Backend sends both photos to Bedrock and receives structured observations (items, visible contaminant %, hazard, confidence). |
| F5 | Rules engine (not the model) returns **ACCEPT / INSPECT / HOLD** plus one instruction in the chosen language (EN or HI). |
| F6 | Generator can resubmit; the latest submission of the day counts. |
| F7 | Planner computes expected usable kg per generator (formula in ARCHITECTURE §6). |
| F8 | Planner builds one truck route from the plant and back, respecting truck capacity, pickup windows, shift end and max radius. |
| F9 | Planner returns a **shortfall** (kg and reasons) when the target cannot be met. |
| F10 | Planner also returns a **nearest-first baseline** scored with the same formula. |
| F11 | Dashboard shows today's submissions, the route on a map, KPIs, the comparison, and controls for target kg and truck capacity. |
| F12 | Distances come from Amazon Location route matrix, with a haversine fallback. |
| F13 | Every number derived from simulated data is labelled "Simulated". |
| F14 | An evaluation script reports false-accept rate on a labelled photo set. |

### Stretch (only if MVP is done)

S1 Kannada instructions · S2 plant-gate log (accepted / sorted / rejected, actual kg) · S3 generator
trust score from gate results · S4 EventBridge nightly auto-plan.

### Non-goals

Login/accounts, payments or pricing, multiple plants or trucks, IoT/smart bins, carbon credits,
lab-quality or methane-yield prediction, a marketplace.

## 4. Key definitions

- **Generator**: a bulk wet-waste producer (hostel mess, hotel, canteen, market).
- **Submission**: one photo check (2 photos + kg) by a generator on a date.
- **Verdict**: ACCEPT, INSPECT or HOLD, decided by `decision.py`.
- **Unscreened**: a generator with no submission today; uses historical priors.
- **Usable kg**: expected kg the plant can actually process after rejection risk and contamination.
- **Shortfall**: target kg − planned usable kg, when positive.

## 5. Demo scenario (the video must show this, in this order)

1. Dashboard: tomorrow's plan meets the target only narrowly. All numbers are labelled Simulated.
2. Phone: Hostel 3 submits a bin with plastic wrappers → **HOLD**, "Remove 3 plastic wrappers…".
3. Dashboard: Re-plan → Hostel 3 drops out → **shortfall banner** with kg and reason.
4. Phone: Hostel 3 removes the wrappers and resubmits → **ACCEPT**.
5. Dashboard: Re-plan → target met; comparison vs nearest-first shows more usable kg per km and fewer wasted stops.
6. AWS console: Bedrock, Lambda, DynamoDB, Location (5–10 seconds).
7. Accuracy line from the eval script, and the limits statement.

## 6. Success metrics (shown on the dashboard)

- Expected usable kg vs target, and shortfall kg
- Total route km and **usable kg per km** (headline metric)
- Wasted stops (planned stops whose verdict is HOLD), compared with the baseline
- Screening false-accept rate (from the eval, shown in the README and video)

## 7. Defaults (all configurable via env)

| Setting | Default |
|---|---|
| Contamination HOLD threshold | 5 % visible |
| INSPECT band | 1–5 % visible, or confidence < 0.6 |
| Acceptance probability | ACCEPT 0.95 · INSPECT 0.6 · HOLD 0 · UNSCREENED = generator prior (default 0.7) |
| Truck capacity | 2,000 kg |
| Daily intake target | `TARGET_KG` from the seed script's suggestion (about 1,700 kg); see DATABASE §6 |
| Shift | 06:00–11:00, 10 min service per stop |
| Max radius | 15 km from plant |

## 8. Open questions for the human

- Real plant name and coordinates for `data/pilot_zone.json`.
- Has a real operator confirmed the threshold or truck capacity? If not, label them as assumptions.

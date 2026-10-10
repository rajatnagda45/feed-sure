# RESEARCH — FeedSure CBG validation report

Background evidence for the PRD and pitch. **Agents: use this for facts and simulation numbers only.
Do not invent figures that are not in this file or in PRD.md.** Figures are dated; re-verify the plant
counts on the GOBARdhan portal on submission day.

**Bottom line:** The problem is real and well documented. India's CBG plants are under-used mainly
because feedstock supply is unreliable, and the 2026 rules have pushed bulk generators into paid,
traceable wet-waste disposal. That makes a phone-based quality gate plus next-day route planner a
credible, narrow and differentiated idea. Four fixes before submitting: use corrected statistics,
drop the "Mr. Fusion" name, scope the pilot honestly as one collection route (not "feeding a plant"),
and name a real user such as a bulk-generator wet-waste processor.

## TL;DR
- **Numbers to use:** About 211–217 CBG plants are operating out of about 1,860–1,908 registered on the
  GOBARdhan portal (mid-2026). The 132–133 figure counts only SATAT-commissioned plants. The IEA
  (Jan 2026) puts average utilisation at about 35%, and PNGRB (Aug 2025) gives a 20–60% range. The
  sources cite feedstock supply as the leading cause. Segregation quality is a documented factor, but
  nobody has quantified it nationally.
- **The gap is open:** Food-waste-to-CBG operators (Carbon Masters/Hasiru Dala, NobleExchange),
  aggregators (Ecowrap) and biomass marketplaces (BiofuelCircle) exist. Contamination cameras also
  exist, but they are mounted on trucks or MRF conveyors, mostly in Europe and North America. I found
  no Indian product that screens wet waste at the source *before* the truck is dispatched and feeds
  that result into CBG route planning.
- **Build:** Bedrock vision for a conservative Accept/Inspect/Hold call, a greedy prize-collecting
  heuristic in Lambda, Amazon Location route matrices, and gate data to close the loop. Pitch it as
  "one dependable route for an existing plant", tied to EBWGR traceability under the SWM Rules 2026.

## (a) Verified facts and corrected statistics

**Plant counts. The sources disagree because they count different things:**

| Source (date) | Registered | Operating | Under construction | Not started | What it counts |
|---|---|---|---|---|---|
| MoPNG / Minister Puri (5–6 Jan 2026) | — | 132 (920 TPD) | — | — | SATAT-commissioned |
| Puri at India Energy Week (30 Jan 2026) | — | 133 (926 TPD) | 83 | — | SATAT-commissioned |
| PNGRB "CBG Integration" paper (26 Aug 2025) | ~1,150 | ~160 | ~244 | ~744 | All registered CBG |
| PNGRB demand-supply report (Oct 2025) | — | 145–163 | 594 UC + not started | — | Mixed |
| IEA India Bioenergy Market Report (29 Jan 2026) | — | ~170 (2025) | almost 300 | — | All CBG |
| Down To Earth / CSE (16 Jul 2026) | 1,862 | 211 | 336 | 1,315 | GOBARdhan portal |
| PIB backgrounder (6 Aug 2026) | 1,908 | 217 (0.4 MMSCMD) | 339 | — | GOBARdhan portal |

**How to say it:** "As of August 2026, only about 217 of roughly 1,900 registered CBG projects were
commissioned. That is about 11%. The SATAT-only count was 133 in January 2026." The two figures don't
conflict: SATAT counts only plants with oil-company offtake agreements, while the GOBARdhan portal
counts every CBG/Bio-CNG plant.

**Utilisation:**
- IEA (Jan 2026): average about 35%. Raising it to about 44% would meet the 2030 blending targets
  *without new plants*. This is the strongest single pitch line.
- PNGRB (Aug 2025): many operating plants run at 20–60% of capacity.

**Why plants underperform (what the sources support):**
- PNGRB: inconsistent feedstock availability, seasonal biomass variation, and technical challenges.
- CSE (UP report, 2026 National Blueprint): upstream feedstock sourcing, plus inconsistent OMC
  offtake, weak bank appraisal capacity, and too few skilled operators.
- CEEW: most plants receive poorly segregated waste, can't process mixed feedstock, and so pay extra
  for segregation.
- Parliamentary committee (2022, via PRS): too many approvals; recommended favouring MSW and press mud.
- **Not supported:** no source quantifies what share of the national gap comes from contamination
  alone. Frame the problem as "feedstock *reliability and quality* for urban wet-waste CBG plants."

**Policy anchors (2026):**
- **SWM Rules 2026** (notified 28 Jan, in force 1 Apr 2026):
  - Four-stream segregation at source becomes mandatory.
  - A bulk waste generator is anyone with ≥20,000 m² floor area, ≥40,000 L/day water use, or ≥100 kg/day waste.
  - Under **EBWGR**, a generator must process wet waste on site or buy certificates for off-site processing.
  - A central online reporting portal is created, with environmental compensation (fines) for violations.
  - Bulk generators produce about 30% of solid waste.
- **GOBARdhan National Circular Bioenergy Scheme** (Cabinet, 6 Aug 2026):
  - Outlay of ₹23,731 crore, FY27–FY36. It absorbs SATAT.
  - Administered CBG price of ₹2,110/MMBTU (about ₹105/kg), guaranteed to Mar 2036.
  - Capital support up to ₹2 crore per TPD of capacity.
  - CGD blending obligation of 3% in FY27, 4% in FY28 and 5% from FY29.
  - Launched with a unified portal on 1 Oct 2026.
- **Pitch logic:** policy has largely removed offtake and price risk, so feedstock reliability is the
  main remaining variable, and that is the layer FeedSure addresses.

## (b) Simulation numbers

| Parameter | Value | Confidence |
|---|---|---|
| Biogas yield, food waste | 120–140 m³/t wet; 0.51–0.53 Nm³/kg VS at 84–85% CH₄ (IOCL) | Medium–high |
| Biogas → CBG | ~0.39 kg CBG per m³ raw biogas | Medium |
| CBG per t of clean food waste | ~45–55 kg | Derived |
| CBG per t of municipal wet waste (real plants) | ~27–33 kg (Indore 550 TPD → ~15 TPD) | High for Indore |
| Feedstock for a 10 TPD CBG plant | ~200 TPD (clean food waste) to ~330–370 TPD (municipal) | Derived; the 200–300 TPD claim is roughly right |
| Gate contamination threshold | No Indian standard found. Benchmarks: Indore "<1% impurities"; UK EA ≤5% w/w plastic | **Ask the operator** |
| Bulk generator threshold | ≥100 kg/day | SWM Rules 2026 |
| Hotel | 1–2 kg food waste per occupied room per day, ±30% | Low (small studies) |
| Hostel mess | 0.1–0.16 kg per student per day | Low (IIT audit) |
| Vegetable market | 2–12 TPD for a mid-size mandi | Low |
| Bengaluru wet-waste fee | ₹12/kg cap (+GST), paid by bulk generators to empanelled vendors | Medium |
| Transport radius | Not found; use 10–15 km and treat cost per tonne-km as a parameter | **Ask the operator** |

**Scale reality check:** 8–12 bulk generators produce 1–3 TPD, which is one truckload. Present the
pilot as optimising *one route* of a plant's bulk-generator collection. For comparison, a 30–50 TPD
plant runs roughly 15–25 such routes.

## (c) Competitor and prior-art landscape

| Player | What it does | Photo/AI gate | Routing | How FeedSure differs |
|---|---|---|---|---|
| Carbon Masters + Hasiru Dala (Bengaluru) | Collects wet waste from bulk generators; Harohalli CBG plant (30→50 TPD) | None found | Not public | **Ideal named user**, not a competitor |
| NobleExchange (Pune/Bengaluru) | Food waste to CBG; hotel and municipal contracts | None found | Not public | Potential user |
| Ecowrap (Jaipur) | ~1,550 bulk generators, IoT fill sensors, "AI sorting" (self-described) | Vague claim | Sensor-triggered | No pre-dispatch quality check tied to plant intake |
| EFIL | Self-described "AI orchestrator" routing food waste to biogas | Unclear | Claimed | Closest concept; early and unverified. Watch closely |
| BiofuelCircle | Agri-residue marketplace; raised ₹35 crore (Jul 2026) | No vision | Logistics SaaS | Agri biomass, not urban wet waste |
| BioTradX | Biomass trading app | No | No | Marketplace only |
| Recykal | Dry-waste marketplace / PRO | Dry-waste recognition | Logistics | Dry waste only |
| c-trace c-detect (Germany) | Truck camera + RFID checks each biowaste bin | Yes, at the truck | Fleet software | Needs hardware; detects *after* dispatch |
| Prairie Robotics, McNeilus/Lixo | Truck-mounted AI cameras (vendor-claimed accuracy) | Yes, at the truck | No | Hardware, curbside recycling |
| Greyparrot (UK) | MRF conveyor vision | Yes, at the facility | No | Dry waste, after collection |
| Winnow (UK) | Camera + scale to prevent kitchen waste | Yes, in the kitchen | No | Prevention, not feedstock logistics |

Hackathon prior art (CIRCL0, ReHarvest, SmartSort, EcoTrace) was not verified. Check Devpost/GitHub
and acknowledge any close matches in the writeup.

**Defensible differentiation (no product found combines all five):**
1. Quality is checked at the source, before a truck-km is spent.
2. It uses only a phone; no hardware.
3. The verdict changes tomorrow's route (usable kg = kg × acceptance probability).
4. Gate results recalibrate the forecast and the thresholds.
5. Its records double as EBWGR compliance evidence.

## (d) Technical feasibility notes
- **Vision:** Published systems use top-down views (for example ContamiNet, about 30k images); vendor
  accuracy claims are self-reported. No benchmark of vision LLMs on organic waste was found. Surface
  photos miss buried items, so use two photos (top view and tray), map low confidence to Inspect, and
  report precision/recall on 30–50 hand-labelled photos.
- **Routing:** ≤12 stops with one truck and time windows is a small prize-collecting VRP. Greedy
  insertion plus 2-opt is enough; OR-Tools in a Lambda container is optional.
- **Amazon Location:**
  - The route matrix bills per origin × destination cell.
  - Unbounded requests are capped at 100 cells, so a 13×13 matrix needs a routing-boundary geometry.
  - The default quota is about 5 requests per second.
  - Optimize Waypoints handles up to 50 stops (20 with time constraints).
  - Demo costs are negligible within the free tier and credits.

## (e) Risks and mitigations

| Risk | Mitigation |
|---|---|
| Generators photograph a clean top layer | Tray photo, random gate audits, trust score from rejections |
| False negatives contaminate digesters | Conservative thresholds; plant pre-treatment still required; position as triage |
| Volume too small to matter | Route-level framing; show truck-km saved and rejects avoided |
| Who pays? Generators already pay ₹12/kg | Value goes to the collector or plant (fewer wasted trips) and to generators (EBWGR evidence) |
| Statistics challenged | Use the dated table and say which count is which |
| Name/IP conflict | Rename (below) |

## (f) Recommendations
1. **Rename.** "Mr. Fusion" is the Back to the Future device. There was also a US trademark filing by
   Mr. Fusion LLC (serial 90064820, abandoned), and Carbon 12 filed **"MR.FUSION" for waste-powered
   generators in July 2024** (serial 98669031). Use **FeedSure CBG**.
2. **Name a real user:** "logistics lead at a 30–50 TPD bulk-generator CBG plant", for example
   Hasiru Dala/Carbon Masters, NobleExchange, or a local municipal Bio-CNG operator.
3. **One diagram:** photo verdict → usable kg → optimiser (contamination × distance × capacity ×
   windows × target) → gate actuals → recalibration. Show the "no feasible plan, short by X kg" screen.
4. **Lead with the IEA line:** raising utilisation from 35% to 44% meets 2030 targets without new plants.
5. **Questions for a plant operator:**
   - What is your current reject rate, and what are the top contaminants?
   - Do you have a written gate rejection threshold?
   - How many trips a week are wasted on rejected loads?
   - What is your truck capacity and cost per km?
   - What is your daily intake target?
   - Would you trust a photo pre-check, and what would make you ignore it?

## Caveats
- PIB "GOBARdhan: Fuelling Clean Energy and Rural Growth" (6 Aug 2026) gives 1,908 registered;
  Down To Earth (Jul 2026) gives 211/336/1,315. A PNGRB CBG Cell presentation gives 207 functional
  plants in Apr 2026, of which 17 were pipeline-connected.
- Utilisation figures are averages or ranges, not audited plant-level data.
- Generation rates come from small or old studies.
- No Indian contamination threshold or economic wet-waste radius was verified. Treat both as
  operator-supplied parameters.
- EFIL, Ecowrap and vendor accuracy claims are self-reported.
- EBWGR certificate mechanics may still be evolving.

## Key sources
- PIB, SWM Rules 2026: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2219676&reg=3&lang=1
- Down To Earth, CBG status (Jul 2026): https://www.downtoearth.org.in/energy/chhattisgarhs-new-biogas-policy-picks-up-where-others-left-off
- PNGRB, CBG integration (Aug 2025): https://pngrb.gov.in/pdf/CBG/20250826_CBG.pdf
- PNGRB, demand-supply outlook (Oct 2025): https://pngrb.gov.in/pdf/CaseStudies/20251003_CSAUTH_CBG.pdf
- IEA India Bioenergy report (via WBA): https://www.worldbiogasassociation.org/new-iea-india-bioenergy-market-report/
- PRS, SATAT review: https://prsindia.org/policy/report-summaries/review-of-implementation-of-cbg-satat
- CSE, UP CBG symposium: https://www.cseindia.org/uttar-pradesh-leads-the-nation-in-compressed-biogas-potential-but-challenges-persist-say-experts-at-cse-upneda-joint-symposium-12244
- SATAT 132 plants: https://www.energetica-india.net/news/india-commissions-132-cbg-plants-under-satat-output-hits-920-tonnes-per-day
- GOBARdhan scheme (Aug 2026): https://visionias.in/current-affairs/news-today/2026-08-07/environment/cabinet-approves-gobardhan-galvanizing-organic-bio-agro-resources-dhan-scheme-a-national-circular-bioenergy-scheme
- SWM Rules four-stream explainer: https://earth5r.org/swm-rules-2026-india-four-stream-waste-segregation/
- Indore CBG plant: https://www.energetica-india.net/news/everenviros-cbg-plant-in-indore-reaches-milestone
- Bengaluru BSWML vendors: https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fbengaluru%2Fbswml-delists-90-vendors-after-scrutiny-apartments-left-with-little-leverage-3674056
- Bengaluru bulk-generator charges: https://docupro.in/blog/bulk-waste-generator-charges-property-tax-in-bangalore-202627-what-apartment-owners-are-getting-wrong
- Carbon Lites Harohalli: https://www.carbonlites.com/projects.html
- NobleExchange: https://nobleexchangesolutions.com/about-us/about-noble-exchange-environment-solutions-nex/
- Ecowrap: https://inc42.com/startups/how-jaipurs-ecowrap-is-using-ai-to-make-waste-segregation-sustainable/
- EFIL: https://www.efil.in/
- BiofuelCircle: https://inc42.com/buzz/biofuelcircle-raises-%E2%82%B935-cr-to-expand-its-biomass-supply-chain-ecosystem/
- c-trace c-detect: https://www.c-trace.de/en-INT/products/artificial-intelligence/c-detect
- Greyparrot: https://www.greyparrot.ai/solutions/mrf
- ContamiNet: https://arxiv.org/pdf/1911.04583
- Amazon Location route matrix: https://docs.aws.amazon.com/location/latest/APIReference/API_CalculateRouteMatrix.html
- Amazon Location route pricing: https://docs.aws.amazon.com/location/latest/developerguide/routes-pricing.html
- Mr. Fusion trademark: https://alter.com/trademarks/mr-fusion-90064820
- Carbon 12 trademarks: https://trademarks.justia.com/owners/carbon-12-5972823

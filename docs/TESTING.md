# TESTING — FeedSure CBG

Test what can break the demo: the decision rules, the planner's feasibility, and the handler wiring.
Don't chase coverage numbers.

## 1. Layout
```
tests/
├── unit/
│   ├── test_validate.py        model JSON parsing and normalisation
│   ├── test_decision.py        verdict rule table, one test per row
│   ├── test_forecast.py
│   ├── test_usable.py
│   ├── test_greedy.py          feasibility invariants
│   ├── test_two_opt.py
│   ├── test_baseline.py
│   ├── test_shortfall.py
│   └── test_plan_golden.py     fixed inputs → exact expected output
├── integration/
│   ├── test_handlers_submissions.py   moto S3 + DynamoDB, MOCK_BEDROCK
│   ├── test_handlers_plans.py         moto DynamoDB, MOCK_LOCATION
│   └── test_auth.py                   401 paths
└── fixtures/
    ├── bedrock_clean.json  bedrock_plastic.json  bedrock_glass.json
    ├── bedrock_dark.json   bedrock_garbage.txt   (invalid output)
    ├── generators_10.json  history_10x14.json
    └── matrix_11.json      (km + min, plant + 10)
```

## 2. Must-have unit tests

**validate.py**
- Valid JSON wrapped in prose or code fences → parsed.
- Unknown item type → `other_non_food`; % = 140 → clamped to 100; confidence = −1 → 0.
- Missing key or non-JSON → raises `ScreeningInvalid`.

**decision.py** (one test per rule row in ARCHITECTURE §5.2, plus precedence)
- hazard plus 0 % → HOLD (`hazard`)
- 6 % → HOLD; exactly 5 % → INSPECT (the threshold is strictly greater-than)
- 0 % with confidence 0.5 → INSPECT (`low_confidence`)
- `image_quality = "blurry"` with hazard → INSPECT (`retake_photo`), because rule 1 wins
- 0 % with confidence 0.9 → ACCEPT

**Planner invariants** (`test_greedy.py`, `test_two_opt.py`, property-style over 20 random seeded instances)
- Load never exceeds capacity.
- Every arrival falls within the stop's pickup window (waiting allowed).
- The return to the depot is before shift end.
- HOLD and out-of-radius generators never appear in the route.
- 2-opt never increases km and never breaks feasibility.
- The output is deterministic: two runs give identical results.

**shortfall.py**
- Target met → `kg = 0`, `targetMet = true`, `reasons = []`.
- A HOLD on a 130 kg generator → a `held` reason with that ID and its lost usable kg.
- A capacity-limited case → a `capacity` reason.

**test_plan_golden.py**: use the fixtures and fixed params, then assert the exact stop order, total km
(±0.01) and usable kg. Update the golden file only on purpose.

## 3. Integration tests (moto, no real AWS)
- `POST /uploads` → two presigned POSTs with the right key prefix and conditions.
- `POST /submissions` with `MOCK_BEDROCK=true` → a packaged observation fixture is used without S3
  or Bedrock reads, the item is stored, and a verdict is returned.
- `POST /submissions` with a photo key from another generator → 400.
- `POST /plans` with `MOCK_LOCATION=true` → valid shape, `matrixSource="fallback"`, plan stored.
- Missing or invalid tokens → 401 on every protected route.

## 4. Frontend
- vitest: `i18n` keys match between `en` and `hi`; the shortfall sentence builder; the image-resize
  helper's output dimensions (pure function).
- Manual smoke test on a real Android phone before recording: the camera opens, the upload works over
  mobile data, and the verdict renders in Hindi.

## 5. Screening evaluation (`scripts/eval_screening.py`)
- Data: `eval/images/*.jpg` (30–50 staged photos of real food scraps; some clean, some with wrappers,
  foil, cutlery, glass) and `eval/labels.csv` with columns
  `file_top,file_tray,expected,notes` where `expected` ∈ `ACCEPT|HOLD`.
- Run the real Bedrock screener + `decision.py`. Treat INSPECT as "not accepted".
- Report a confusion table and:
  - **False-accept rate** = contaminated samples verdicted ACCEPT ÷ contaminated samples. This is
    the most important number.
  - **Catch rate** = contaminated samples verdicted HOLD or INSPECT ÷ contaminated samples.
  - **Clean pass rate** = clean samples verdicted ACCEPT ÷ clean samples.
- Write `eval/results.md`, then copy the headline line into README and the video.
- Tune `HOLD_THRESHOLD_PCT` and `MIN_CONFIDENCE` only on half the set, and report on the other half.

## 6. Commands
```bash
pytest -q                       # everything
pytest tests/unit -q            # fast loop
cd frontend && npm run test
python scripts/eval_screening.py --images eval/images --labels eval/labels.csv
```

## 7. Pre-recording checklist
- [ ] All tests green on `main`
- [ ] End-to-end on the deployed URL: phone submit → dashboard shows it within 10 s → re-plan changes the route
- [ ] The HOLD → shortfall → ACCEPT → target-met sequence works three times in a row

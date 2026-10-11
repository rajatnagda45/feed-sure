# FeedSure v3 route evaluation

Synthetic deterministic fixtures; no AWS calls and no claimed field savings.
Scenario count: 18; seed: none (fixed hand-authored scenarios).
Observed comparison counts: {"PRIMARY_LOWER_KM": 1, "TIE": 16, "TRADE_OFF": 1}.
Mandatory-conflict scenarios: 1.
Empty primary routes: 6; unmet targets primary/baseline: 10 / 9.

Run:

`python scripts/eval_routes.py --scenarios eval/route-scenarios --json-output eval/route-results.json --report-output eval/route-results.md`

Metrics: expected kg uses the disclosed P0 readiness assumption; reserved kg is
the capacity quantity; km is directed matrix travel including return; minutes include
travel, waiting and service. Comparisons use identical inputs. Expected kg is not
substituted for realised collection ground truth.

| Scenario | Status | Primary order | Baseline order | Expected kg P/B | km P/B | Gap kg P/B | Result |
|---|---|---|---|---:|---:|---:|---|
| all-ready-baseline-equality | FEASIBLE | b → a | a → b | 240 / 240 | 8 / 8 | 0 / 0 | TIE |
| cancellation | FEASIBLE | b | b | 160 / 160 | 6 / 6 | 0 / 0 | TIE |
| no-confirmed-kitchens | FEASIBLE | (empty) | (empty) | 0 / 0 | 0 / 0 | 200 / 200 | TIE |
| mandatory-small-supplier | FEASIBLE | large → small | small → large | 256 / 256 | 12 / 12 | 0 / 0 | TIE |
| near-capacity | FEASIBLE | b → a | a → b | 1440 / 1440 | 4 / 4 | 160 / 160 | TIE |
| mandatory-overload | MANDATORY_CONFLICT | (empty) | (empty) | 0 / 0 | 0 / 0 | 100 / 100 | TIE |
| tight-service-window | FEASIBLE | (empty) | (empty) | 0 / 0 | 0 / 0 | 80 / 80 | TIE |
| return-shift-conflict | FEASIBLE | (empty) | (empty) | 0 / 0 | 0 / 0 | 80 / 80 | TIE |
| unreachable-directed-edge | FEASIBLE | (empty) | (empty) | 0 / 0 | 0 / 0 | 80 / 80 | TIE |
| co-located-stops | FEASIBLE | a | a | 80 / 80 | 0 / 0 | 0 / 0 | TIE |
| unmet-target | FEASIBLE | a | a | 80 / 80 | 4 / 4 | 120 / 120 | TIE |
| no-feasible-optional-stops | FEASIBLE | (empty) | (empty) | 0 / 0 | 0 / 0 | 100 / 100 | TIE |
| new-supplier | FEASIBLE | new-a | new-a | 120 / 120 | 4 / 4 | 0 / 0 | TIE |
| primary-distance-improvement | FEASIBLE | c → b → a | a → b → c | 240 / 240 | 6 / 10 | 0 / 0 | PRIMARY_LOWER_KM |
| primary-capacity-tradeoff | FEASIBLE | a | b → c | 176 / 240 | 2 / 2.2 | 64 / 0 | TRADE_OFF |
| hazard-and-material-eligibility | FEASIBLE | ready | ready | 40 / 40 | 6 / 6 | 60 / 60 | TIE |
| waiting-and-window-boundary | FEASIBLE | a | a | 80 / 80 | 2 / 2 | 0 / 0 | TIE |
| mandatory-after-target | FEASIBLE | small | small | 16 / 16 | 2 / 2 | 0 / 0 | TIE |

Observed ties and losses are retained in the table; no scenario is discarded for
making the primary heuristic look worse. A TRADE_OFF means achieved expected kg differs,
so a distance-only winner would be misleading.
In primary-capacity-tradeoff the primary's 176 kg misses target by 64 kg;
nearest-first reaches 240 kg on a 0.2 km longer route.
In primary-distance-improvement both expect 240 kg, with primary 6 km versus
baseline 10 km. These are fixture outputs.

Assumptions: readiness prior 0.8, volume ratio 1.0, capacity buffer 0.10 unless
the saved scenario overrides capacity/target/time controls. Matrix source is fixture.
No information-value replay or P1 reliability model is included.
Full inputs, input SHA256, primary/baseline schedules, reservations, gap and
each route's exclusions are saved in route-results.json. A TIE compares expected
kg and km, and can still have different stop orders or service minutes.

# FeedSure recording script — target 2:45

Use only a stable, verified build. This is a recording plan, not evidence that a video exists. Keep 15 seconds below the three-minute limit. Current local verification uses synthetic data and Moto; optional map/photo repairs await final integration.

## Prepare off camera

Use an isolated disposable demo with its own manifest and ports; follow [DEPLOYMENT.md](DEPLOYMENT.md). Do not reuse the user's active state. Choose 12 October 2026 consistently. Keep tokens, access files, full URLs and browser history outside the recording. Save readiness and prepare the draft with the actual UI; privately open waste supplier, admin/dispatcher, driver and plant owner tabs. Use `/supplier-access`, `/admin` and `/owner` for the public role entry points.

Use the seed's realistic shortfall; do not tune the target to manufacture a planner win. The audited default draft had five stops, expected 720 kg, reserved 990 kg and a 480 kg gap at a 1,200 kg target. Re-read the current output; those values are reference evidence, not scripted assertions.

For a complete gate story, pre-record all but one pickup on a dispatched trip. Tell viewers that these are earlier synthetic records; record the final stop on camera, refresh, then record net gate kg. Use measured/estimated labels truthfully: a fictitious SCALE entry represents a simulated measurement, not a physical weighing. If the sum of synthetic pickups is P, use gate P−10 for a small discrepancy when P≥10; do not imply the tolerance proves safety or processing. Test the sequence once before filming and restart only your disposable process if you need fresh state.

## Screen and narration

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Landing / waste supplier | “FeedSure helps a waste supplier and collector coordinate food-waste pickup for a CBG plant. These are fictional waste suppliers and simulated quantities.” |
| 0:15–0:40 | Waste supplier date, kg/source/window; save readiness | “The waste supplier confirms what is ready and when. Saving works without photos or AI. No response stays unconfirmed.” |
| 0:40–1:00 | Optional selected-image preview and actual analysis state, **only after verified repair** | “A photo can support a visible-item check. This run uses [actual shown mode]. It cannot measure kilograms or certify the load. Hazards require a human decision.” If verification is pending, use these seconds to show NOT_READY and the unconfirmed queue instead. |
| 1:00–1:30 | Actual route map/list, totals, exclusions and baseline | “Expected collection is separate from reserved truck capacity. Windows and depot return constrain the route. The target gap stays visible. Nearest-first uses the same inputs; this scenario may tie.” Read the displayed numbers and provider/fallback labels. |
| 1:30–1:55 | Frozen dispatched version; final driver pickup; refresh | “Dispatch freezes the stop list. Earlier synthetic pickups are already recorded; this is the final one. The saved record survives refresh and retries do not double-count it.” |
| 1:55–2:15 | Net gate input, delta/status and waste supplier record | “The plant records net received waste. The difference compares recorded pickup and intake, with provisional estimates visible. The waste supplier sees its own record and trip status. Intake is not proof of processing.” |
| 2:15–2:35 | Genuine runtime evidence or local service-mode labels | “This recording uses real handlers with local Moto storage and fallback routing. The repository includes AWS adapters and SAM infrastructure; deployed AWS operation is [state only what is independently verified].” If live AWS evidence exists, show the actual request/resource result and disclose remaining mocks. A template screenshot is infrastructure evidence only. |
| 2:35–2:45 | Saved scenario report / closing screen | “Across 18 synthetic scenarios: 16 ties, one shorter equal-quantity route, and one trade-off where nearest-first collects more. Next, validate collection outcomes with a real collector and waste suppliers.” |

Do not record a failed feature and narrate it as working. Keep the driver parked. Phone-width layout or desktop file selection is not physical camera/GPS proof. If a workflow remains incomplete, use the working subset and name the missing step explicitly.

## Go/no-go rehearsal

Do not start recording until one uninterrupted disposable run has proven all claims that will be
narrated. Confirm that readiness survives refresh without a photo, the reviewed plan dispatches at
the current input revision, retrying a pickup does not duplicate kg, the gate result reaches the
waste supplier record, and the ordered list remains usable when map tiles are unavailable. If showing a
photo, retrieve the actual selected bytes through authorised access, show the persisted analysis
state after refresh, and exercise at least one analysis failure. Say “mock model” whenever that is
the configured mode; filenames are not evidence of visible contents.

Before capture, record the API port, frontend port, manifest path, service-mode labels and current
test/build results in private production notes. Check that no token, presigned URL, local path or
manifest is visible in the frame. A map attribution/provider label must match the tiles actually
shown; a fallback matrix is not Amazon Location proof.

## Before submitting

Export and time the actual video; upload public/unlisted to YouTube only when the user authorises publication. Check the final link signed out. Complete the remaining evidence checklist in [SUBMISSION.md](SUBMISSION.md). Event/rule links were checked on 11 October 2026: [event](https://www.wemakedevs.org/aws/env), [rules](https://www.wemakedevs.org/aws/rules).

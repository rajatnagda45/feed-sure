# Collection review fixes and validation

Validated 12 October 2026 against main `c62b5f9` in an isolated checkout. All operational tests used synthetic data and disposable local Moto storage. Existing hosted users and collection records were not edited.

## Reported issues and changes

| Issue | Diagnosis and correction |
| --- | --- |
| Cannot select collection sites | A dispatched trip intentionally freezes its stops. The screen now explains this next to the disabled controls. Before dispatch, **Required pickup** forces feasibility checking; other eligible sites remain candidates. Today/Tomorrow controls make switching planning dates straightforward. |
| READY beside UNCONFIRMED | Current readiness was displayed beside exclusions from an older plan. Current exclusions and historical plan exclusions now have separate explanations; stale map reasons are not presented as current. Re-plan a draft after changed inputs. |
| OUT_OF_RADIUS | The limit applies to the outbound plant-to-site routing matrix distance. Display saved distance, limit, matrix source, plant and pickup coordinates, and a concrete recovery instruction. Approximate PIN locations still need operational review; no plant coordinate or distance limit is silently changed. |
| Unrelated photo appears valid | A saved photo is explicitly unverified. Saving now automatically requests a visible-item check with a disclosure; unrelated-image results explain how to replace the image. Optional analysis failure never erases readiness. |
| NVIDIA integration | Use `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, its documented thinking-disable flag, 1024 response tokens, and a ten-second per-attempt timeout. Keys remain backend-only. |
| Correction reason unclear | Explain the audit purpose and give examples such as a corrected scale entry. Existing revision checks and attribution remain enforced. |
| Supplier progress misleading | Derive stages from the selected date's actual plan/receipts rather than other dates in the month. A stale draft does not count as planned. Zero pickup does not count as collected. Label trip intake explicitly and remove future-tense pickup instructions after recorded collection. |
| Account navigation covers content | Place account navigation in normal document flow so it cannot obscure forms. |

## Verification performed

- Backend: **364 passed**, one existing Starlette/httpx deprecation warning.
- Frontend: **123 passed**, three existing opt-in live tests skipped.
- Production build: passed. One parallel build attempt failed with a Rust memory allocation error; a sequential retry with `RAYON_NUM_THREADS=2` passed. Existing large MapLibre/Three.js chunk warnings remain.
- Ruff and Git whitespace checks passed.
- Route evaluation: 18 fixed scenarios; JSON and Markdown match the committed reports byte-for-byte. 16 ties, one shorter primary route, one capacity trade-off. Synthetic evaluation makes no field-savings claim.
- Mock-model real HTTP loop: readiness, invalid upload recovery, exact stored photo bytes, cross-supplier denial, analysis, stale dispatch rejection, re-plan, dispatch, pickup 100 kg, gate 95 kg, supplier receipt and frozen route passed.
- Live NVIDIA real HTTP loop: unrelated synthetic image classified `not_waste`; readiness remained READY. Required stop outside distance limit rejected; valid limit accepted. Stale dispatch rejected, later cancellation preserved dispatched stops, partial pickup 40 kg with unavailable GPS saved, duplicate retry did not add weight, missing gate remained pending, zero intake and attributed correction to 38 kg reconciled to -2 kg, supplier receipt refreshed.
- Browser loop at local ports 5231/8831: save 80 kg readiness, select required pickup, build and dispatch, record driver pickup 80 kg without GPS, record owner intake 78 kg, refresh supplier receipt and date-specific progress. Photo upload automatically completed mock analysis with its explicit mock label. [Intake evidence](evidence/collection-review/intake.png).

## Live model findings

The replaced NVIDIA key successfully authenticated. A synthetic pattern returned `not_waste` in 1.73 seconds. The repository's public food-scraps reference photo returned a valid observation in 5.73 seconds with the ten-second timeout. It flagged nearby kitchen tools as a possible hazard; this is not proof that those tools are in the waste. Human review remains required, and these two examples do not establish accuracy. The previous five-second timeout failed on the reference image.

## Reproduce the live HTTP test

Install the declared dev dependencies. Load `NVIDIA_API_KEY` privately into the server environment, then start a NEW disposable API on an unused port:

```powershell
python scripts/local_demo.py --photo-provider nvidia --port 8832 --frontend-port 5232 --date 2026-10-14 --routing-provider fallback --manifest .tmp/collection-nvidia-access.json
python scripts/verify_collection_review.py --manifest .tmp/collection-nvidia-access.json --output .tmp/live-collection-result.json
```

The verifier mutates this demo's synthetic records; restart the disposable API before rerunning it. Never use its manifest against production. Tokens, private keys, manifests and raw private payloads are excluded from Git. The mock verifier is `scripts/verify_repair_integration.py`.

## Deployment and remaining limits

No deployment, merge or hosted migration was performed. These changes require deployment of both frontend and backend before the public Amplify URL changes. Configure `PHOTO_ANALYSIS_PROVIDER=nvidia`, `MOCK_BEDROCK=false`, a private working key, and the model/token/timeout values in [DEPLOYMENT.md](DEPLOYMENT.md). Existing SAM parameter overrides must be updated explicitly; defaults alone do not switch an existing stack. No new database migration is needed.

Local routing used labelled fallback estimates. This run does not verify hosted AWS IAM, production road-routing availability, live Supabase login, or real GPS capture. Existing auth tests ran, but the browser collection test used scoped local tokens. Dispatched routes remain frozen; selecting another date creates a separate planning workflow. Photos remain optional assistance, and a gate record is not a processing certificate.

## Human verification follow-up

Dispatcher supplier actions now provide **Mark human verified — resolve hazard**. Review the saved photo, check with the supplier or on site, tick the explicit confirmation, and enter the verification reason. The action removes the planning hold and displays the saved reviewer, timestamp and reason after refresh. Keep the hold when the issue remains; replace unrelated images. Drafts require re-planning, and dispatched routes stay frozen.

Automated coverage checks that both the checkbox and reason are required, the specific flag ID is submitted, attribution is shown, unauthorised suppliers cannot resolve holds, empty reasons are rejected, changed flag IDs are rejected, and the resolved review persists in the operations snapshot. No migration is required.

## Independent open-PR integration review

PRs #17 and #18 merge into main `c62b5f9` and into each other without conflicts.
Combined checks passed: 369 backend tests, 131 frontend tests (three existing opt-in
skips), 28 SQL migration checks, Ruff, and the production build. An independent live
NVIDIA run of `verify_collection_review.py` passed all six synthetic HTTP scenarios,
including unrelated-image detection and preservation of readiness.

The review found one additional progress bug: saving or screening a photo changes
planning inputs but left a draft's Planned stage highlighted until refresh. Photo
updates now immediately mark the local draft stale. Two component regression checks
verify the draft becomes pending while a dispatched trip retains its recorded state.
No hosted users or data were changed. Live model examples do not establish accuracy.

## Manual-testing follow-up

Intermittent screening failures now return safe diagnostics and the attempt count instead
of swallowing the cause. Credential/configuration failures do not perform a futile second
request. Transient failures still retry once. The provider timeout is 12 seconds per attempt
and observation notes are kept concise. A live synthetic-image comparison rejected the
optional `response_format=json_object` flag but passed without it; that flag is not used.
Failures never imply successful photo validation or erase readiness.

Dispatchers can open Review saved photo, explicitly check the exact photo and actual waste,
enter a reason, and confirm or reject the waste-photo check. Reviews retain actor, UTC time
and image hash, are audited/idempotent and reject stale revisions. Unrelated images cannot
be marked verified; outstanding hazards must be resolved separately. Replacing/removing
a photo or re-screening invalidates the old review. Suppliers see the saved human review.

Availability instructions now specify the selected date, supplier READY or attributable
phone confirmation, and re-planning. Distance-limit warnings explain that confirmation alone
does not overcome an out-of-radius location. Routing fallback distinguishes configured
estimates from missing road results. The owner empty state explains draft/dispatch/pickup/
net-intake steps and date selection. No locations or service limits are silently changed.

Final follow-up validation: 379 backend tests and 133 frontend tests passed; three existing
opt-in frontend skips remain. Production build, Ruff and whitespace checks passed. The
live NVIDIA verifier passed all six collection scenarios. A fresh synthetic photo rejection
through the human-review HTTP endpoint preserved READY/80 kg, recorded reviewer/time and
replayed idempotently. No hosted records were changed.

Phone-confirmation usability follow-up: required fields are labelled and validated, failed
saves appear next to the form, duplicate clicks are blocked during saving, and the supplier
row immediately uses the server-saved readiness before the full snapshot refresh. A component
regression test checks incomplete saves and UNCONFIRMED-to-READY with 69.1 kg. The operations
header now stays in normal flow. All 134 frontend tests and the production build pass.

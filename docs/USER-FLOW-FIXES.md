# User-flow fixes — 11 October 2026

Working branch: `fix/user-flow-audit`, based on `74b002f`. The earlier `USER-FLOW-AUDIT-2026-10-11.txt` records the pre-change
findings; this document records the implementation. The original shared checkout
and its pending README media edits were not changed.

## Email login without SMTP

Email/password authentication remains in Supabase. The default frontend setting
is `VITE_AUTH_EMAIL_MODE=admin`: registrations await Admin approval, users can check
their status or sign out, and forgotten passwords are handled by an Admin after
identity review. No confirmation/resend/recovery email action is offered in this mode.

An operator must turn **Confirm email OFF** under Supabase Authentication >
Sign In / Providers > Email. The frontend flag cannot change that hosted setting.
Email addresses are login identifiers, not verified inbox ownership in this mode.
Existing unconfirmed accounts may need operator intervention. See [account setup](ACCOUNTS.md)
for migration order, activation and optional SMTP setup later.

The workflow migration was applied through the Supabase SQL editor to the project
matching the existing FeedSure configuration. The transaction returned success.
A follow-up query verified the migration function exists, browser roles cannot
execute the privileged account RPC, and the backend service role can. The migration
can safely replay after manual dashboard application without resetting account rows.
After explicit user confirmation, **Confirm email was turned OFF and saved** on
11 October 2026. Email authentication and new signups remain enabled; anonymous
sign-ins remain disabled. Admin approval remains enforced by the account registry.

Three synthetic test accounts (Admin, supplier, driver) were created and **retained
at the user's request**. Existing accounts were not edited or deleted. Credentials
and dashboard screenshots stay in ignored local files and are excluded from GitHub.
Account profiles persist in Supabase. Collection data is in the running disposable
Moto API; a private local export preserves the test collection result, but this does
not migrate collection storage to Supabase.

## Changes against the audit

### Follow-up: create the login before confirming the location

Registration no longer waits for address lookup, GPS permission or map confirmation. The address
can be left blank. Signup success links to My profile, and pending users can sign in and edit their
details while awaiting review. My profile saves organisation, contact, address, generator type and
confirmed pickup coordinates (or plant capacity) to the Supabase account registry. Login email remains
an identity field handled by the Admin. Password and deletion controls retain reauthentication.

`20261011170000_profile_completion.sql` adds a service-only own-profile action with session validation,
revision checks and a strict editable-field allowlist. It preserves approval, role and assignments.
Pending address changes invalidate an older pin; active address changes require a confirmed pin.
Admin approval still rejects incomplete generator locations. Approved profile changes synchronize to
future operational snapshots; dispatched trips and existing receipts retain their original details.

Follow-up validation: 358 backend tests, 116 frontend tests (three existing opt-in tests skipped),
16 PostgreSQL WASM policy tests and the production build. Hosted migration application and browser
save/reload/location-confirmation checks are recorded separately from fixture tests. The updated local
API uses port 8816 with the existing frontend on 5213. The earlier API on 8815 remains running to preserve
its in-memory collection records; both previews use the same hosted account registry. The updated API
starts with a separate simulated collection dataset. The private retained collection export is unchanged.

| Findings | Implementation |
| --- | --- |
| 1 | PIN/address search, optional GPS, movable pickup pin, keyboard adjustments and explicit entrance confirmation; manual coordinate typing removed. PIN centres alone are not accepted as a confirmed entrance. |
| 2, 4, 7, 13 | Bounded API/SDK fetches, actionable connection/auth messages, retry controls, no-email pilot recovery; optional email mode has confirmation resend and recovery with cooldowns. Writes are not automatically retried by the application transport. |
| 3 | Existing road-routing implementation retained. Plan responses now include per-leg matrix distance/time, including return to plant; selecting a stop focuses the map without changing saved coordinates. |
| 5, 6, 8 | Pending-user sign-out/status, authenticated profile gate, cross-tab clearing, late-response guards and visible logout failures. |
| 9 | Enrollment and frontend language normalization prevent uppercase/unknown language values from breaking supplier screens. |
| 10, 11 | Admin-created driver accounts, dispatcher assignment, unassigned-driver screen, future-shift-aware expiry and explicit renewal that revokes prior token links. |
| 12 | Reviewed generator location/type and plant capacity editing; profile revisions synchronize to planning and reject stale dispatches. Dispatched trip snapshots stay intact. |
| 14, 15 | Single-plant limitations stated in registration; development banner warns that Moto collection records reset while hosted accounts remain. Persistent operational storage is still required beyond the disposable demo. |
| 16 | Role routes load lazily. The auth-enabled build emits a 191.24 KB entry chunk and a separate 216.26 KB Supabase chunk. Map/3D chunks remain large and are loaded separately. |

The new `20261011150000_user_flows.sql` migration adds trusted driver creation,
dispatcher-scoped assignment, reviewed profile updates and active-site synchronization.
Browser roles still cannot call the privileged registry RPC or grant themselves roles.

## Validation and limits

- Backend: all 355 tests passed in the final full run.
- Frontend: 111 passed, 3 existing opt-in live tests skipped. React lifecycle checks
  exercise pending logout, cross-tab logout, late responses and failed logout.
- SQL: 14 passed in PostgreSQL WASM with fixture Auth tables, including driver privilege,
  assignment revisions, reviewed profile validation and migration replay. This is not hosted Supabase validation.
- Auth-enabled production build passed using synthetic public configuration. Existing
  large map/3D chunk warnings and the backend Starlette/httpx warning remain.
- Ruff and Git whitespace checks passed. Route evaluation completed all 18 synthetic scenarios.
- Isolated real HTTP workflow passed: readiness without a photo, cancelled suppliers, invalid
  upload/retry and cross-supplier denial, persisted mock analysis, stale-dispatch rejection,
  replanning, dispatch, 100 kg pickup, 95 kg gate intake and refreshed kitchen records.
  This used token authentication, Moto and synthetic evidence; it does not establish a
  hosted Supabase account workflow.
- PIN provider handling is unit-tested. Public Nominatim is permitted only in the disposable
  Moto demo, with bounded requests, caching and one-process throttling. Hosted deployments
  need a configured geocoder and a production map configuration. See the
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).
- Live hosted Auth + registry with real local HTTP handlers passed signup without
  email delivery, pending access denial, approval/enrollment, location correction and stale
  dispatch rejection, driver creation/approval/assignment, duplicate pickup retry, gate intake,
  supplier receipts, logout revocation and fresh password login. The synthetic trip on
  13 October recorded 98 kg picked up and 95 kg gate intake. Test harness corrections were
  needed for the response envelope and mandatory stop selection; prior test trips were retained.
- Browser checks against the updated app passed real registration readiness, PIN-code lookup
  (562112), map pin movement/confirmation reset, supplier email/password login, collection
  record display, My account, sign-out clearing private data, and no-email recovery guidance.
- SMTP delivery, real GPS accuracy and production provider routing were not tested. Operational
  data uses Moto and routing uses explicitly labelled fallback estimates in this preview.
  No AWS or frontend hosting deployment is included.

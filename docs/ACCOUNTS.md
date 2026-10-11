# Registration and account management

ID/password login and registration run in the **loopback local demo**. `/auth/*` is absent from
SAM and returns 404 unless the demo runner injects the account service. Use synthetic details.
This is not hosted authentication or a multi-plant service.

## Screens and setup

Start `python scripts/local_demo.py` from the root, then `npm run dev` in `frontend`.
Private initial IDs/passwords are generated in `docs/LOGIN-CREDENTIALS.local.md`; both credential
files are gitignored. Login at `/login` with the matching section.

- `/register`: request generator, CBG operations or plant owner access. Supply organisation/plant
  name, contact and address. Generators supply coordinates/type; plant teams supply capacity in
  kg/day. Passwords require 12–256 characters. Every registration starts **PENDING**.
- `/accounts`: sign in as **Admin** to search/filter, approve, edit details, reset passwords,
  suspend/reactivate and delete accounts. `/accounts/new` also allows Admin account creation.
- `/account`: change your own password or delete your login after supplying the current password.
  Deletion also requires typing the login ID in the UI. Navigation includes server-side sign out.

Approval enrolls new generators in the disposable database with their own scoped access. They
start unconfirmed, with 06:00–09:00 pickup defaults, displayed in their desk. Demo records are
labelled simulated. Review service suitability and location before approval.

CBG plant registration stores submitted plant details for review. Approval grants access to the
**existing single pilot plant**; it does not provision another plant or create tenant isolation.
Admins must check that applicants belong to the pilot plant. CBG operations has dispatcher
privileges; only Admin accounts manage accounts. Owners use `/owner` for dispatched-trip intake
and net gate logging, without planning/dispatch or generator editing. Drivers retain trip links.

## Persistence and lifecycle

`.tmp/accounts.local.json` stores salted PBKDF2-SHA256 password hashes (310,000 iterations),
profiles, revisions and lifecycle state through atomic file replacement. New passwords and
session tokens are never persisted. The private bootstrap credential table does not update
after resetting a seeded password; its original password then becomes obsolete.

Registrations, approvals, resets, suspension and deletion survive restart. Approved registered
generators are restored into the fresh Moto database; operational records reset on process stop.
Sessions expire after eight hours and do not survive restart. Login returns a random per-account
session, not shared domain tokens. Every operational request, including photo upload, rechecks
session expiry, role and account state before the adapter translates to the domain credential.

Suspension, deletion, reset and reactivation revoke every affected session. Detail edits preserve
sessions. Logout revokes the current session. Mutations require `expectedRevision`; stale edits
return 409. Admins cannot suspend/delete themselves through the management desk; self-service
deletion cannot remove the last active Admin. At least one active Admin is always retained.

Deletion removes login access, password material and submitted contact/profile details, retaining
a tombstone with login ID/role/revision/generator linkage. Operational collection/intake records
remain. Account deletion does not cancel a dispatched stop. Legacy raw domain tokens/private
links are separate bootstrap access and are not revoked by account actions; do not issue them
when lifecycle enforcement is required. Operational audit actors still use shared domain role
IDs; this demo does not establish per-person operational attribution.

Account endpoints check loopback peer, configured browser origin and a 4 KB JSON limit. Login
has a per-ID five-attempt, one-minute pause. Responses use `no-store` and omit hashes and salts.

## Local HTTP contract

Authenticated account calls use `X-Account-Token`. Domain requests put the login session in the
appropriate `X-Generator-Token`, `X-Admin-Token` or `X-Plant-Token` header.

| Endpoint | Access | Request / response |
|---|---|---|
| POST `/auth/login` | Public local | `{loginId,password,role}` → `{loginId,role,path,token,storageKey,collectionDate}` |
| POST `/auth/register` | Public local | Registration fields → pending public account |
| GET `/auth/account` | Active session | Current public account |
| POST `/auth/account` | Active + current password | `{action,expectedRevision,currentPassword,password?}`; `password` or `delete` |
| POST `/auth/logout` | Active session | `{}` → `{ok:true}` |
| GET `/auth/accounts` | Admin session | `{accounts:[...]}` excluding tombstones |
| POST `/auth/accounts` | Admin session | Registration fields; permits Admin role |
| POST `/auth/accounts/{loginId}` | Admin session | `{action,expectedRevision,...}` → public account |

Common fields: `role,loginId,password,organisation,contact,address`. Internal roles:
`kitchen` (organic waste generator), `cbg`, `owner`, `admin`. Generator fields: `lat,lng,type`;
plant fields: `capacityKg`. Unknown fields are rejected. Admin actions: `activate,suspend,delete,
password,update`. Reset adds `password`; update adds `organisation,contact,address`. Role changes
and editing approved generator coordinates are unavailable in this version.

Owner domain additions: `GET /intake?date=YYYY-MM-DD` with `X-Plant-Token` returns dispatched
trips, recorded pickups, gate record and reconciliation. `POST /gate-logs` accepts owner access
as an alternative to Admin, retaining revision/idempotency rules. Configure a non-empty
`PLANT_OWNER_TOKEN` distinct from `ADMIN_TOKEN`. SAM adds an optional `PlantOwnerToken` parameter
and intake route; domain token access is separate from local login.

## Verification

Backend integration tests exercise actual HTTP/domain handlers with Moto: role isolation,
pending approval, generator enrollment, edits, revision conflicts, reset, revocation,
suspension/reactivation, deletion, last-Admin protection, logout, persistence, origins and invalid
payloads. Frontend tests check account-only auth headers and clearing all FeedSure credentials
on account switching while preserving unrelated tab data.

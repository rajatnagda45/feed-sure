# Supabase registration and account management

Supabase Auth handles email/password signup, confirmation, login, refresh and sign-out. Passwords
and hashes are never stored in local files or FeedSure's private Postgres account registry. AWS
DynamoDB retains collection, dispatch and intake data; the private Supabase image flow still works.

## Setup and local testing

1. Create a Supabase project. Enable email/password signup, email confirmation and a minimum
   password length of 12. Set Auth Site URL to `http://localhost:5197` for testing. Configure
   SMTP/rate limits and Supabase abuse controls for hosted use. Email confirmation and Admin
   approval are separate requirements.
2. Run `supabase/migrations/202610110001_private_photos.sql`, then
   `supabase/migrations/202610110002_accounts.sql` once in the SQL editor. The second migration
   imports existing **trusted app_metadata** assignments as active accounts; other users and
   public signups remain pending. Review imported Admin assignments first.
3. Create your first email/password user in Supabase Authentication. In the trusted SQL editor,
   replace the email below and bootstrap the first Admin:

   ```sql
   update public.feedsure_accounts
   set role = 'admin', status = 'ACTIVE', revision = revision + 1,
       revoked_at = clock_timestamp()
   where email = 'YOUR_ADMIN_EMAIL'
     and not exists (select 1 from public.feedsure_accounts where role = 'admin' and status = 'ACTIVE');
   ```

   Verify exactly one row changed and sign in afresh. If an Admin was imported, use it instead.
   Create and approve a second Admin in `/accounts/new` for access recovery.
4. Copy `config/supabase.env.example` to ignored root `.env` and fill your project values:

   ```dotenv
   AUTH_PROVIDER=supabase
   SUPABASE_ACCOUNT_MANAGEMENT=true
   PHOTO_STORAGE_PROVIDER=supabase
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_LEGACY_SERVICE_ROLE_JWT
   SUPABASE_PHOTOS_BUCKET=feedsure-photos
   ```

   The REST adapter needs the legacy service_role JWT, not a newer `sb_secret_` key. Never put
   the server key in a `VITE_` variable or commit `.env`. Frontend/backend must use the same project.
5. Install Python 3.12+ and Node/npm dependencies and start the local API:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   cd frontend
   npm ci
   cd ..
   .\scripts\start_supabase_demo.ps1 -Check
   .\scripts\start_supabase_demo.ps1
   ```

   In a second terminal:

   ```powershell
   cd frontend
   npm run dev -- --mode supabase --host localhost --port 5197 --strictPort
   ```

The launcher safely reads `.env`, starts the API on 8797 and writes only public settings to ignored
`frontend/.env.supabase.local`. `-Check` validates local fields; it does not contact Supabase.
The runner mocks AWS DynamoDB, routing and analysis. Auth, account persistence and private image
storage use your **real Supabase project**. Use test users and synthetic details. Supabase profiles
survive restart; Moto operational data resets. Approved registered generators are restored into
Moto on their first authenticated request. Imported generator IDs must already exist in DynamoDB;
the demo seeds `demo-kitchen-01` through `demo-kitchen-10`.

For SAM, set `AuthProvider=supabase`, `SupabaseAccountManagement=true` and the existing Supabase
URL/key/bucket and AWS parameters. Account routes are wired in SAM and the local shim. Inject the
server key through deployment secrets. Once account management is enabled, its registry is
authoritative: Auth metadata changes do not update existing roles or assignments. Do not disable
it after relying on its revocation controls.

## Screens and permissions

- `/register`: generators, CBG operations and plant owners request access. Generators supply
  pickup coordinates/type; plant teams supply capacity. The Auth insert trigger captures pending
  details. Browser metadata cannot grant Admin access or approve a registration.
- `/login`: sign in with email after confirmation and approval. Pending users receive an approval
  message. The SDK persists and refreshes sessions and handles sign-out.
- `/accounts`: only active **Admin accounts** create, approve, edit contact details, reset,
  suspend/reactivate and delete accounts. `/accounts/new` can create another Admin. Admin-created
  users have confirmed email status; share their temporary password privately. Creation is pending.
- `/account`: view your profile, change password or delete your login with current-password
  verification. No separate local ID/password registry or account session token is used.

CBG operations has dispatcher permissions but cannot manage accounts. Owners have the existing
intake desk and gate logging, without planning/dispatch. Plant approval grants access to the
**single pilot plant**, not independent plants or tenant isolation. Only approve its actual team.
Drivers retain explicit trip scope/expiry; update `plan_key` in the trusted registry after dispatch.
Generator approval enrolls its immutable `registered-<user UUID>` scope in DynamoDB with 06:00-09:00
pickup defaults. Review location and collection suitability first. Account contact edits do not
change existing operational coordinates, pickup addresses or historical evidence.

## Lifecycle, retention and failures

Every protected request verifies the bearer through Auth, then checks the private registry and
JWT `session_id` against `auth.sessions`. Decode the session ID only after Auth verifies the exact
token; editable user metadata never authorizes operations. Pending accounts cannot operate;
suspension/deletion deny access. Reset/reactivation rejects sessions created before the revocation
cutoff, including refreshed JWTs for old sessions. Sign-out removes the Auth session. Supabase
session settings apply; the local eight-hour timer has been removed. See
[Supabase session semantics](https://supabase.com/docs/guides/auth/sessions).

`expectedRevision` and a serialized Postgres transaction protect mutations; stale writes return
409. The last active Admin cannot be suspended/deleted; Admins cannot suspend themselves. Legacy
headers cannot bypass `AUTH_PROVIDER=supabase`. The registry enables RLS with no browser policies
or grants; only the backend service role may execute its RPC. SQL editor/service credentials are
privileged operator access. Do not add broad browser grants or public photo policies.

Password resets reserve a revision and private one-time receipt, deny access while Auth changes
the password, then revoke affected sessions again on completion. Concurrent changes cannot
interrupt that operation. Auth and Postgres are separate services: an Auth error/timeout can leave
the password unchanged or changed; the response reports failure, previous sessions stay revoked,
and the Admin must refresh and retry. A process crash or failed completion can leave the receipt
blocking access. A trusted operator must verify/reset the password in Auth and recover via SQL:

```sql
update public.feedsure_accounts set password_ticket = null,
  revoked_at = clock_timestamp(), revision = revision + 1
where id = 'AFFECTED_USER_UUID' and password_ticket is not null;
```

Deletion first writes a tombstone and scrubs submitted profile/contact fields, then deletes the
Auth user. If Auth deletion fails, the tombstone still denies access; finish deletion in the Auth
dashboard. Generator/collection/intake records and private photo evidence remain. Previously
issued signed URLs remain usable until their provider expiry; account actions cannot recall
those capabilities or cancel a dispatched stop. Operational records may still contain site data.

Responses omit passwords/receipts, use no-store and bounded REST transport. The account list is
bounded by the REST response limit and intended for the pilot, not an unbounded directory.

## HTTP contract and verification

FeedSure account calls use `Authorization: Bearer <Supabase JWT>` and the common 16 KB JSON limit.
Signup/login/refresh/sign-out use the official JS SDK rather than local `/auth/login` endpoints.

| Endpoint | Access | Contract |
|---|---|---|
| GET `/auth/session` | Active | Verified role, `accountRole`, generator/trip scope |
| GET `/auth/account` | Signed-in pending/active | Own reviewed profile |
| POST `/auth/account` | Active + current password | `action,expectedRevision,currentPassword,password?`; password/delete |
| GET `/auth/accounts` | Active Admin | `{accounts:[...]}` excluding deleted tombstones |
| POST `/auth/accounts` | Active Admin | `email,password,role,organisation,contact,address`; generator `lat,lng,type`, plant `capacityKg` |
| POST `/auth/accounts/{accountId}` | Active Admin | UUID target; `action,expectedRevision`; activate/suspend/delete/update/password |

Run `python -m pytest -q`; in `frontend`, run `npm test` and `npm run build`. SQL checks:

```powershell
cd tests/sql
npm ci
npm test
```

The SQL suite executes the shipped migration/RPC in PostgreSQL WASM (PGlite), with fixture Auth
schemas. HTTP tests run real handlers and Moto with external Auth/PostgREST responses mocked.
Neither establishes hosted Auth/Storage deployment or multi-connection race performance.
For live testing: register a generator, confirm email, approve as Admin, sign in afresh, save
readiness and a JPEG/PNG, then refresh to retrieve it. Suspend/reactivate/reset and retry the old
session. Verify CBG operators and owners cannot manage accounts and failure recovery works.

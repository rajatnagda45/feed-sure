# Supabase login and image saving

Supabase is an optional provider for email/password login and private photo storage.
The collection domain remains in AWS DynamoDB, and optional analysis remains in Bedrock.
The default token/S3 installation and local demo still work without Supabase.

For a Windows test using live Supabase and disposable local collection data, follow
[the local testing guide](SUPABASE-LOCAL-TEST.md).

## Configure an installation

1. Create a Supabase project. Run
   `supabase/migrations/202610110001_private_photos.sql` in the project's SQL editor.
   If changing the bucket name or upload limit, update the migration and server settings
   together. This bucket must remain private. Review existing `storage.objects` policies;
   no broad browser insert/update/read policy should grant access to this bucket.
2. Create users with email/password through Supabase Auth's administrator dashboard
   or Admin API. Assign **app_metadata**, not user_metadata, using the Admin API
   `updateUserById` or a trusted server. There is deliberately no public account enrollment
   or role picker. A login without an operator-assigned role is denied.
3. Set server environment variables:

   ```dotenv
   AUTH_PROVIDER=supabase
   PHOTO_STORAGE_PROVIDER=supabase
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
   SUPABASE_PHOTOS_BUCKET=feedsure-photos
   SUPABASE_TIMEOUT_SECONDS=5
   ```

4. Set these public frontend variables in `frontend/.env.local` and the hosting
   build environment, then restart Vite or rebuild:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   VITE_API_BASE_URL=https://YOUR_FEEDSURE_API
   ```

   Never put the service role key in a `VITE_` variable. Frontend and backend must
   use the same Supabase project. A partially configured frontend shows a setup error.
   Server environment files are not loaded automatically: export values in the process
   environment before launching the local API.

5. For SAM, pass `AuthProvider`, `PhotoStorageProvider`, `SupabaseUrl`,
   `SupabasePublishableKey`, `SupabaseServiceRoleKey` and `SupabasePhotosBucket`
   parameters. The service role parameter has `NoEcho`. Inject its value through
   your deployment secret manager; keep credentials out of source and command logs.
   Existing AWS tables, routing settings and `DRIVER_TOKEN_SECRET` are still needed.

## Account assignments

| User | Administrator-controlled app_metadata | Destination |
|---|---|---|
| Dispatcher | `{"feedsure_role":"ADMIN"}` | `/admin` |
| Plant owner | `{"feedsure_role":"PLANT_OWNER"}` | `/owner` |
| Waste supplier | `{"feedsure_role":"GENERATOR","generator_id":"hotel-a"}` | `/g/hotel-a` |
| Driver | `{"feedsure_role":"DRIVER","plan_key":"2026-10-12#p-trip"}` | assigned trip |

Supplier IDs must already exist in DynamoDB. Assign the driver's actual dispatched
plan key after dispatch and update it for the next trip. Driver access ends at the
existing trip expiry and never grants access to another plan. Admin accounts cannot
use the plant owner's intake listing, and plant owners cannot plan or dispatch.
Readiness, hazard and gate audit actors record the authenticated Supabase user ID.

`/login` signs in with email/password and opens the server-verified account's
dashboard. The official JS SDK persists and refreshes the session. Each API call
sends the current bearer token; the backend calls `/auth/v1/user` with a bounded
timeout and uses the returned `app_metadata`. Browser metadata and decoded, unsigned
JWT claims never authorize a request. `GET /auth/session` returns only the account
ID, role and assignment, with the existing no-store API response headers.

When `AUTH_PROVIDER=supabase`, legacy access tokens cannot bypass login. Leaving
the provider as `tokens` preserves private links; explicit bearer requests still
require Supabase verification and cannot fall back to a supplied legacy credential.

## Save and retrieve an image

Sign in as a supplier, save readiness, choose/take a JPEG or PNG, then select
**Upload and save photo**. Readiness remains saved if uploading or analysis fails.
The API authorizes the supplier, creates an opaque key and issues a signed PUT URL.
The browser sends only the image and its MIME type to this URL. Supabase signed
uploads expire after two hours; the bucket enforces MIME type and maximum byte size.
The backend validates image structure, dimensions and size before attachment, then
saves a separate immutable copy under a key never issued for browser upload.
Retries reuse the existing photo revision/idempotency contract. Refreshing the page
retrieves the saved evidence with a temporary signed read URL. Analysis and human
hazard resolution continue through the existing AWS workflow.

Choose the storage provider before creating cloud photo records. Changing providers
does not migrate old image keys; copy existing objects to the new provider before
switching. Photo removal unlinks evidence while preserving unresolved hazards and
audits. Supabase objects (including abandoned uploads) need an operational retention
cleanup through the Storage API. The S3 lifecycle rule does not apply to Supabase;
no automatic Supabase deletion job is included. Do not delete `storage.objects`
rows directly, because that does not remove stored bytes.

## Validation

Backend tests exercise real HTTP handlers and Moto DynamoDB, with only external
Supabase HTTP responses mocked: verified login, role/supplier scope, legacy bypass
rejection, private image persistence, immutable copy, invalid bytes and retries.
Frontend tests cover account destinations, bearer refresh/error behavior and signed
image uploads without credential forwarding. The frontend production build is checked.
Live Supabase login/storage requires project configuration and was not exercised
without project credentials; these tests do not claim deployed service verification.

Reference: [password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword),
[server user verification](https://supabase.com/docs/reference/javascript/auth-getuser),
[signed uploads](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl),
[private Storage access](https://supabase.com/docs/guides/storage/security/access-control).

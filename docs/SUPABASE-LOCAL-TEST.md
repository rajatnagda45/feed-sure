# Test Supabase login and image saving locally

Work from `I:\Project\feed\supabase-pr`, the checkout for PR #7. This uses live
Supabase Auth/Storage, disposable Moto collection data, and mocked Bedrock/routing.
You do not need AWS credentials or Docker. Your Supabase project must already exist.

## 1. Install requirements

In PowerShell from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Push-Location frontend
npm ci
Pop-Location
```

Python 3.12+ and Node/npm are required. `requirements.txt` installs the dependencies
declared in `pyproject.toml`. The frontend already includes the official Supabase SDK.
There is no additional Supabase Python package to install.

## 2. Fill the backend .env file

The local `.env` file was created with placeholders. In another checkout, first copy
`config/supabase.env.example` to the repository root as `.env`. Replace these three values:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Get the project URL and keys from the Supabase project connection/API settings.
Use a publishable key (or legacy anon key) for the public key. For the current server
adapter, use the legacy **service_role JWT** for `SUPABASE_SERVICE_ROLE_KEY`;
it sends this value as a bearer, so do not substitute an `sb_secret_...` key.
Only the public URL/key are copied into `frontend/.env.supabase.local` by the launch script.
Keep passwords and the server key out of chat, recordings and Git.

The `.env` must also contain `AUTH_PROVIDER=supabase` and
`PHOTO_STORAGE_PROVIDER=supabase`; the prepared file already sets both.

## 3. Prepare Supabase storage and test accounts

1. Open the project's SQL editor and run
   `supabase/migrations/202610110001_private_photos.sql`. Check that the
   `feedsure-photos` bucket is private, with JPEG/PNG types and a 3,500,000-byte limit.
2. In **Authentication → Users**, create test accounts for a supplier, dispatcher
   and plant owner with your own email/password combinations. Confirm the test users
   before password login, or finish their email-confirmation flow.
3. Open `supabase/demo-account-roles.sql`, replace the three email placeholders with
   those account emails, and run it in the SQL editor. This assigns trusted
   `app_metadata`; adding the same fields to user-editable metadata does not work.
   The supplier is assigned to `demo-kitchen-01`, which exists in the local seed data.
4. Sign out and sign in again after changing assignments.

Reference: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
and [administrator-controlled app_metadata](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## 4. Start the local API and frontend

First PowerShell terminal, from the repository root:

```powershell
.\scripts\start_supabase_demo.ps1 -Check
.\scripts\start_supabase_demo.ps1
```

The script validates configuration without printing keys, exports the server values,
syncs the public frontend environment, and starts the API on **8797**. It uses an
isolated access manifest so existing demos on 8787/5173 are untouched. `-Check` validates
fields only; it does not establish live Supabase connectivity.

Second terminal:

```powershell
Set-Location I:\Project\feed\supabase-pr\frontend
npm run dev -- --mode supabase --host localhost --port 5197 --strictPort
```

Open [the login screen](http://localhost:5197/login). Use `localhost` consistently;
the API allows the exact `http://localhost:5197` origin. Restart Vite after editing
frontend settings. The demo service date is tomorrow in India and appears in the
API startup message and private `.tmp/supabase-demo-access.json` manifest.

## 5. Check the workflow

1. Sign in as the supplier. The app should open `/g/demo-kitchen-01`. Save a readiness
   confirmation for the demo date, select or take a JPEG/PNG, and select
   **Upload and save photo**. Refresh: the saved evidence should still appear.
2. Inspect `feedsure-photos` in Supabase Storage. An uploaded staging object and a
   separate frozen evidence object are expected. No public URL is needed.
3. Sign out and sign in as the dispatcher. Check the same demo date, review the
   confirmation/photo, build a route and dispatch it.
4. Sign in as the plant owner. Check that date: the dispatched trip appears in
   intake, while planning/dispatch access is denied.
5. To test driver login, create a driver user and assign `feedsure_role: DRIVER`
   and `plan_key` equal to the actual dispatched plan key in `app_metadata`.
   Its login opens only that trip and obeys the trip expiry.

The local collection database is discarded when the API stops; cloud photo bytes
persist. After testing, remove disposable images through the Supabase Storage UI/API
and delete unused test accounts. Mocked photo analysis never evaluates the selected
image. These steps test Supabase login/storage, not deployed AWS or real field collection.

## Troubleshooting

| Symptom | Check |
|---|---|
| Environment validation fails | Fill the three placeholders in root `.env` |
| Invalid login credentials | Password, email confirmation and correct project |
| Account access not assigned | Run role SQL for the exact user email; sign in again |
| Photo request fails | Private bucket migration and backend service_role JWT |
| API request blocked by CORS | Open localhost:5197 and use the default launch ports |
| Port unavailable | Set `-ApiPort` / `-FrontendPort`, then start Vite on the printed port |

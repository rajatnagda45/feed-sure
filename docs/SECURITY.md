# SECURITY — FeedSure CBG

## Shipped v3 controls and limits

Admin, plant owner, generator and driver credentials travel in separate headers. Blank/placeholder admin
configuration fails closed. Driver access is scoped to one dispatched trip, expires after 12 hours
by default, and requires a dedicated `DRIVER_TOKEN_SECRET` of at least 32 characters. Storage keeps
only the token hash/expiry; authenticated dispatch retries regenerate access using server HMAC
fields without storing raw tokens in dedup responses or audit entries. Secret rotation invalidates
existing driver access. Authenticated dispatch calls can retrieve the existing private driver
link after a dashboard refresh without issuing another trip or extending token expiry. There
is no shipped expired-token renewal, trip-close or same-day second-trip workflow.

Revision conditions, scoped idempotency keys and transactions protect dispatch, capacity, pickup
corrections and gate intake. Positive pickup checks the current hazard flag atomically. Kitchen
receipts query only their own index partition. API errors omit provider details, and reads omit
credential hashes. Bodies are bounded to 16 KB and numeric inputs must be finite.

The owner desk uses a separate sessionStorage key and sends only `X-Plant-Token`. `PLANT_OWNER_TOKEN` must be nonempty, nonplaceholder and different from `ADMIN_TOKEN`; unset owner access is disabled. It permits dispatched-trip intake reads and gate writes only. The API checks permissions independently of the UI and attributes owner gate records explicitly. Admin gate API compatibility is retained. Owner summaries omit readiness snapshots, driver secrets and precise GPS. This prototype still uses one shared credential per staff role, not individual staff identities.

SAM exposes the four auth headers plus Idempotency-Key in CORS. The optional photo implementation
adds scoped S3 GetObject/PutObject and configured Bedrock model/profile invocation to the operational
function. Optional uploads are private JPEG/PNG presigned POSTs, 1,024–3,500,000 bytes and
five-minute expiry by default. S3 lifecycle retention defaults to 30 days.

Selecting `PHOTO_ANALYSIS_PROVIDER=nvidia` sends validated photo bytes to the configured
HTTPS NVIDIA API only on an explicit screen request. `NVIDIA_API_KEY` is backend-only,
excluded from config repr, and supplied to SAM through a NoEcho parameter. Never store
it in frontend variables, manifests or Git. NVIDIA failures use the same bounded retry,
redacted response and unresolved-hazard rules as Bedrock.

Photo issue, attachment, analysis, current-readiness and evidence routes authenticate the owning
kitchen or dispatcher. A scoped prefix alone never authorizes another kitchen. Local binary
uploads require explicit store injection, loopback peer, issued key, header authentication,
type/structure/dimension checks and bounded streaming. That route is absent from SAM. Actual bytes
are stored under a gitignored private local directory; it is not a public static directory.
Browser validation checks signatures and decodes/resizes to JPEG. Server PNG checks include CRC,
bounded inflate and scanline structure; JPEG checks are structural and bounded, not a complete
entropy decoder. Production snapshots prevent replacement through a still-valid signed POST.

Evidence GET is authenticated and no-store; cloud GET URLs are bearer credentials until their
short expiry and must not be logged/shared. The local client never forwards kitchen tokens to S3
or arbitrary upload-response addresses. Strict model observations reject verdicts, mass percentages
and unknown schema fields. Image instructions are untrusted, retry is bounded, and failed analysis
or evidence removal cannot clear an unresolved hazard. Mock fixtures are explicitly labelled and
never selected from filenames. Local expired-file cleanup is lazy; no local sweeper is claimed.

Production hardening remains: managed identity/token revocation, dedicated actor accounts, abuse
monitoring, retention governance and a job to remove precise GPS fields after 30 days. Whole-record
TTL must not delete operational evidence. Browser sessionStorage credentials remain susceptible to
XSS; bootstrap links need private sharing and removal from browser history.

The following v1 screening policies are historical; they do not describe the active P0 endpoints.

> **Version note:** This is a legacy v1 reference; some described features remain unimplemented.
> [PRD v3](PRD.md) governs the target workflows, calculations, contracts and build order.
> Where these documents conflict, PRD v3 wins. Update this reference as each workflow is implemented.

This is a hackathon demo, but it is deployed on a public URL with a public repo. These rules are mandatory.

## 1. Secrets
- Never commit `.env`, AWS credentials, the Location API key or `ADMIN_TOKEN`. `.gitignore` covers
  `.env*` except `.env.example`.
- Backend secrets (`ADMIN_TOKEN`) are passed as a SAM parameter with `NoEcho: true` and become a
  Lambda env var. Do not print them in logs or outputs.
- The frontend Location API key is public by nature. Restrict it to **maps actions only** and to
  allowed referrers (the Amplify domain and `http://localhost:5173`), and give it an expiry date.

## 2. Access control
- Generator endpoints: token per generator. Store only `sha256(token)`; compare with
  `hmac.compare_digest`. Tokens are 32+ random URL-safe characters from `secrets.token_urlsafe`.
- Plant endpoints: `X-Admin-Token` header checked with `hmac.compare_digest`. Missing or wrong → 401.
- Generators can only upload to and submit keys under `submissions/{theirGeneratorId}/`.
  Reject any `photoKeys` outside that prefix.

## 3. S3
- Bucket: Block Public Access on, SSE-S3 encryption, `enforceSSL` bucket policy.
- Uploads use **presigned POST** with `content-length-range` (1 KB–3.5 MB), `Content-Type` limited to
  `image/jpeg|image/png`, and a fixed key. Expiry is 5 minutes.
- Reads for the dashboard use presigned GET with a 5-minute expiry.
- CORS: allow only the Amplify domain and localhost, with methods POST/GET only.
- Lifecycle rule: delete `submissions/` objects after 30 days.

## 4. API Gateway and Lambda
- HTTP API CORS: the same allowed origins, headers `content-type, x-admin-token`.
- Throttling: a default route limit of 20 requests/s, burst 40.
- Least-privilege IAM per function (SAM policy templates):
  - `uploads`: `s3:PutObject` on `submissions/*` (for presigning) and read on Generators.
  - `submissions`: `s3:GetObject` on `submissions/*`, `bedrock:InvokeModel`/`Converse` on the
    configured model or inference profile only, and CRUD on Submissions plus read on Generators.
  - `plans`: read on Generators, History and Submissions; CRUD on Plans; `geo-routes:CalculateRouteMatrix`.
  - `generators`: read on Generators.
- Validate every input (types, ranges, lengths) before using it. Reject bodies over 16 KB.

## 5. LLM-specific
- The images are **untrusted input**. The system prompt tells the model to ignore text inside images.
- The model never decides the verdict; `decision.py` applies fixed rules to validated fields.
- Validate model output strictly (ARCHITECTURE §5.1). Unknown fields are dropped, and the
  `instruction` is capped at 200 characters and rendered as **plain text** (never as HTML).
- Log only a truncated `rawModelText` (≤ 2 KB), never image bytes.

## 6. Privacy
- The generator page tells users: "Photograph only the waste. Don't include people."
- Collect no personal data: generator names are businesses or hostels, not individuals.
- Photos in `eval/images/` must not show faces or ID cards.

## 7. Before submitting
- [ ] `git log -p | grep -iE "AKIA|secret|token="` shows nothing sensitive
- [ ] The Location API key is restricted to referrers and maps actions
- [ ] A wrong admin token returns 401; a wrong generator token returns 401
- [ ] An upload larger than 3.5 MB is rejected


## Active v3 photo security (supersedes legacy guidance above)

Kitchen/admin header authentication applies to issuing, linking, analyzing and retrieving a
photo; driver tokens confer no photo access. Keys must match the owning kitchen's issued-key
shape. Cross-kitchen reads/writes are 401. Private S3 presigned forms constrain exact key/type,
size and expiry. Attached production bytes are copied to a new unissued private key and hashed;
retrieval/analysis reject altered evidence. Evidence GET requires authentication and returns only
a short-lived URL (production) or authenticated data URL (local), with no-store/no-referrer.
Never log photos, raw model output, tokens or signed URLs. Local upload URLs are validated before
forwarding a token and can only address the configured API origin. Local binary upload is absent
from SAM, disabled without explicit private-store injection, and loopback-only in the runner.

V3 model output uses an exact observation schema; extra verdict/instruction/percentage fields,
unknown types, non-finite/range violations and malformed output fail safely. Notes render as
plain text. Hazards require human resolution and survive failed/clean later calls or detachment.
Mock mode labels fixture results and never infers from filenames. Production IAM retains a private
bucket and TLS; model invocation scopes to configured foundation model/profile, including global
inference profile destinations. Actual regional permissions and model access need AWS verification.

Photos and precise GPS can contain personal data; the earlier no-personal-data claim is obsolete.
UI asks users to photograph waste only, avoiding faces/IDs. Local byte files require private folder
permissions and idle-file cleanup; access-triggered expiry does not establish a background sweeper.
S3 has 30-day object lifecycle; operational audit records are retained separately.

## Optional Supabase provider

Supabase mode denies legacy token bypasses and verifies the current user with Auth before checking administrator-controlled role and supplier/trip assignments. User-editable metadata cannot grant access. Service role credentials stay on the backend; the browser receives only single-object upload/read capabilities. Photo attachment validates bytes and freezes a private copy. Use the dedicated private bucket with no broad browser CRUD policies and configure Storage API retention cleanup. See [Supabase security/setup](SUPABASE.md).

## Browser camera capture

Opening the camera explicitly requests video-only permission and optional high-accuracy GPS.
The UI explains that supplier ID, device UTC capture time, coordinates and accuracy become a
visible image footer and are stored with the photo only after upload. Denied, unavailable,
invalid or older-than-30-second fixes are tagged as unknown. Existing uploaded images are
not given current GPS. These device assertions do not verify presence, collection or safety.
No coordinate, image or permission data is logged. Camera tracks and GPS watches stop on
close, capture completion, component removal, hidden page or camera disconnection. Late camera
permission grants after cancellation are immediately released. The tagged JPEG uses the same
private photo access and retention as other evidence; tags are not separate operational fields.

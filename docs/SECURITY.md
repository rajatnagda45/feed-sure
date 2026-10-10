# SECURITY — FeedSure CBG

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

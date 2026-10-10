# tests/

Backend tests (pytest). The full plan is in `docs/TESTING.md`.

- `unit/`: pure logic (screening validation and decision, planner). No AWS, no mocks.
- `integration/`: Lambda handlers with moto (S3, DynamoDB), `MOCK_BEDROCK=true`, `MOCK_LOCATION=true`.
- `fixtures/`: Bedrock outputs, generators, history and the distance matrix.

Run: `pytest -q` from the repo root.

Frontend tests live in `frontend/src/**/*.test.ts` (vitest).

# Task 4 report — D1 operational schema and repositories

Status: complete

Date: 2026-08-14

Scope completed:

- Added Drizzle D1 tables for `telemetrySnapshots`, `telemetryAggregates`, `riskAssessments`, and `maintenanceActions` in `website/db/schema.ts`.
- Added repository modules:
  - `website/lib/telemetry/repository.ts`
  - `website/lib/risk/repository.ts`
  - `website/lib/maintenance/repository.ts`
- Added checked-in migration SQL at `website/db/migrations/0000_engine_overheat_poc.sql`.
- Added repository tests at `website/tests/repositories.test.mjs`.
- Did not implement API routes or UI.

Requirement alignment:

- Used the exact repository interfaces from the brief.
- Kept D1-specific SQL inside the repository files.
- Added in-memory repository implementations so tests do not depend on a live D1 binding.
- Used a stable risk deduplication key composed of `siteId`, `assetId`, and `reasonKey`.
- Stored timestamps as ISO strings.
- Stored measurements in real/integer columns.
- Stored evidence arrays and other list fields as JSON text.
- Stored `actualOverheat` as the label values `CONFIRMED`, `NOT_CONFIRMED`, and `UNKNOWN` in persistence helpers.
- Added payload-hash-based deduplication columns for telemetry snapshot and aggregate persistence.

TDD evidence:

1. Wrote `website/tests/repositories.test.mjs` first.
2. Verified red with:

   `node --test tests/repositories.test.mjs --test-name-pattern="repository"`

   Result: failed because the repository modules did not exist.

3. Implemented minimal schema/repository code.
4. Verified green with the same focused repository test command.

Implementation notes:

- `createInMemoryTelemetryRepository()` maintains deduplicated snapshots/aggregates and returns recent snapshots ordered by `observedAt DESC`.
- `createInMemoryRiskRepository({ siteId })` binds site context at construction time so `openOrUpdateAssessment(assessment)` can preserve the exact interface from the brief while still generating the required dedup key.
- `createInMemoryMaintenanceRepository({ now })` supports deterministic test timestamps.
- D1 repository variants use raw SQL statements against a minimal D1-like interface so the code stays independent of a runtime binding during tests.

Migration generation and inspection:

- Ran `npm run db:generate` from `website/`.
- First attempt inside the sandbox failed with:

  `uv_os_get_passwd returned ENOMEM`

- Retried outside the sandbox and generation succeeded:

  - Generated file: `website/drizzle/0000_aromatic_prowler.sql`
  - Generated snapshot/meta files updated under `website/drizzle/meta/`

- Inspected the generated SQL and confirmed it contains:

  - the four required operational tables
  - the required indexes on `asset_id + observed_at`, `site_id + status`, and `risk_assessment_id`
  - deduplication indexes on payload hash and risk dedup key
  - no raw one-second payload table

- Copied the generated SQL into the required checked-in migration:

  `website/db/migrations/0000_engine_overheat_poc.sql`

Verification run:

- Focused repository red:

  `node --test tests/repositories.test.mjs --test-name-pattern="repository"`

  Result: 3 failing tests, expected missing-module failure.

- Focused repository green:

  `node --test tests/repositories.test.mjs --test-name-pattern="repository"`

  Result: 3/3 passing.

- Build verification:

  `npm run build`

  Result: success.

- Existing project test command:

  `npm test`

  Result: success.

Self-review:

- Ran `git diff --check` on the Task 4 target paths.
- Reviewed the generated migration SQL for table/index drift.
- Confirmed scope stayed inside schema, repositories, migration, and repository tests only.

Noted concerns:

1. `website/package.json` still hardcodes the project test script to two older test files, so the new repository test is not included in `npm test`. I left that unchanged because the brief scoped this task to D1 schema/repositories only.
2. `RiskAssessment` does not include `siteId`, so the repository binds `siteId` at construction time to satisfy the exact method signature and the dedup-key requirement simultaneously.
3. `TelemetrySnapshot` does not expose a raw payload hash, so the telemetry repositories derive a stable content hash for deduplication from the normalized snapshot/aggregate payloads.

---

## Fix round 1 — review findings addressed

Date: 2026-08-14

Status: complete

Findings addressed:

1. Preserved upstream raw telemetry payload hashes when available.
2. Added deterministic fake-D1 tests for telemetry, risk, and maintenance repository paths.
3. Made the normalized-snapshot storage interpretation explicit in code comments and this report.
4. Kept scope limited to contracts, repositories, repository tests, and report updates only.

Changes made:

- Extended `TelemetrySnapshot` minimally with optional `payloadHash`.
- Updated `normalizeRawTelemetry()` to carry `RawTelemetry.payloadHash` into the normalized operational snapshot.
- Updated telemetry repository deduplication to:
  - use the upstream `payloadHash` when it exists
  - use a normalized-content hash only as an explicit fallback when it does not
- Kept `telemetrySnapshots` as normalized operational records for recent telemetry access; raw one-second payload bodies remain outside D1 operational tables.
- Added deterministic fake-D1 coverage for:
  - telemetry insert/upsert and JSON array round-trip
  - risk upsert and evidence JSON round-trip
  - maintenance create/complete and `actualOverheat` label conversion
- Added migration integrity assertions for the four tables, required indexes, and maintenance foreign key.

Fix-round TDD evidence:

1. Expanded `website/tests/repositories.test.mjs` first with:
   - upstream payload-hash preservation/dedup assertions
   - fake-D1 repository path assertions
   - migration integrity assertions
2. Verified red with:

   `node --test tests/repositories.test.mjs --test-name-pattern="repository"`

   Result: 2 failing tests
   - normalized snapshots were dropping `payloadHash`
   - D1 telemetry dedup still used normalized-content hashes instead of upstream hashes

3. Implemented the minimal contract/normalizer/repository changes.
4. Verified green with the same repository command.

Fix-round verification:

- Repository and fake-D1 suite:

  `node --test tests/repositories.test.mjs --test-name-pattern="repository"`

  Result: 8/8 passing.

- Existing project test command:

  `npm test`

  Result: success.

- Build verification:

  `npm run build`

  Result: success.

Updated concerns:

1. `website/package.json` still does not include the repository suite in `npm test`, so the new fake-D1/repository assertions are verified by the focused repository command rather than the project default test script.
2. `telemetrySnapshots` remains intentionally limited to normalized operational snapshots plus payload-hash dedup metadata; raw one-second payload storage is still out of scope for D1 in this task.
3. DB-level check constraints are still deferred; the focused review requested they could remain Minor unless naturally covered by tests, and this fix round kept that scope unchanged.

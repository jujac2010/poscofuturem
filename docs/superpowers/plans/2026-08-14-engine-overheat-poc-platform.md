# Engine Overheat PoC Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-site, five-forklift PoC that collects normalized telemetry, detects high-confidence engine-overheat risk, and records maintenance outcomes for future 48-hour prediction modeling.

**Architecture:** Preserve the current client-side digital-twin demo while adding focused domain modules for telemetry contracts, quality checks, baselines, risk assessment, persistence, and maintenance actions. Use adapter interfaces so simulator/file replay work before the field protocol is known; use D1/Drizzle for operational aggregates and event history, with raw payloads retained as replayable files or gateway batches.

**Tech Stack:** React 19, TypeScript 5.9, Vinext/Vite, Cloudflare D1 with Drizzle ORM, Node `node:test`, existing CSS and client dashboard.

## Global Constraints

- Scope is one site and five identical-model forklifts.
- Initial target is engine-overheat early warning; do not claim validated ML prediction or a calibrated failure probability without confirmed failure labels.
- Initial warning copy must say “향후 48시간 내 과열 위험 관찰 구간” rather than a proven 48-hour failure probability.
- Initial inputs are simulator and CSV/JSON replay; actual CAN, MQTT, OPC-UA, or REST adapters are added only after the field protocol is selected.
- A single sensor fluctuation must not create a maintenance alert.
- Missing, stale, invalid, or low-confidence data must not escalate a risk assessment to a maintenance alert.
- Operational storage keeps 10-second/1-minute aggregates, features, risk assessments, and maintenance actions; raw payloads remain replayable outside the operational tables.
- Existing DUMMY ECU dashboard behavior and current tests must continue to pass.
- Do not implement multi-site management, vehicle control, mobile apps, external notifications, or multiple failure types in this plan.

---

## File Map

Create focused modules under `website/lib/telemetry/` for contracts, adapters, quality, aggregation, and repositories; under `website/lib/risk/` for baseline and overheat assessment; and under `website/lib/maintenance/` for action contracts and persistence. Keep `website/lib/diagnostics/evaluator.ts` as the legacy demonstration evaluator until the new overheat evaluator is proven. Add Drizzle tables in `website/db/schema.ts`, API routes under `website/app/api/`, and extract new operator UI components from `website/app/page.tsx` rather than growing the page further.

## Task 1: Define telemetry and risk domain contracts

**Files:**
- Create: `website/lib/telemetry/contracts.ts`
- Create: `website/lib/risk/contracts.ts`
- Create: `website/lib/maintenance/contracts.ts`
- Test: `website/tests/domain-contracts.test.mjs`

**Interfaces:**
- Produces `RawTelemetry`, `TelemetrySnapshot`, `DataQuality`, `TelemetryAggregate`, `MaintenanceAction`, `CreateMaintenanceAction`, `MaintenanceOutcome`, `RiskLevel`, and `SourceHealth` types used by every later task. `BaselineProfile` and `RiskAssessment` are defined with the evaluator in Task 3 because their fields depend on the scoring design.

- [ ] **Step 1: Write the failing contract test**

Add a Node test that imports the compiled TypeScript modules through the existing test/build path and verifies that a complete snapshot can be passed to a repository-shaped function without losing `assetId`, `observedAt`, `receivedAt`, `sourceType`, and `qualityStatus`.

```js
test("telemetry contract preserves measurement and quality metadata", async () => {
  const { createTelemetrySnapshot } = await import("../lib/telemetry/contracts.ts");
  const snapshot = createTelemetrySnapshot({
    assetId: "P-01",
    observedAt: "2026-08-14T00:00:00.000Z",
    receivedAt: "2026-08-14T00:00:01.000Z",
    engineCoolantTemperature: 82,
    engineOilTemperature: 79,
    engineRpm: 1400,
    loadRate: 0.55,
    engineHours: 4218,
    ambientTemperature: 31,
    latitude: 35.1,
    longitude: 129.1,
    speed: 4,
    sourceType: "FILE_REPLAY",
  });
  assert.equal(snapshot.assetId, "P-01");
  assert.equal(snapshot.qualityStatus, "VALID");
  assert.equal(snapshot.receivedAt, "2026-08-14T00:00:01.000Z");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --test-name-pattern="telemetry contract preserves"` from `website/`.

Expected: FAIL because the telemetry contract module and factory do not exist.

- [ ] **Step 3: Implement the contracts**

Define these exact types and constructors:

```ts
export type SourceType = "SIMULATOR" | "FILE_REPLAY" | "CAN" | "MQTT" | "OPC_UA" | "REST";
export type QualityStatus = "VALID" | "PARTIAL" | "STALE" | "INVALID";
export type RiskLevel = "NORMAL" | "OBSERVE" | "CAUTION" | "MAINTENANCE_ALERT" | "DATA_ISSUE";

export type SourceHealth = {
  sourceType: SourceType;
  status: "CONNECTED" | "DISCONNECTED" | "STALE" | "ERROR";
  lastObservedAt: string | null;
  lastReceivedAt: string | null;
  message: string | null;
};

export type DataQuality = {
  assetId: string;
  observedAt: string;
  receivedAt: string;
  status: QualityStatus;
  missingFields: string[];
  invalidFields: string[];
  delayMs: number | null;
  message: string;
};

export type RawTelemetry = {
  assetId: string;
  observedAt: string;
  values: Record<string, number | null>;
  sourceType: SourceType;
  payloadHash?: string;
};

export type TelemetrySnapshot = {
  assetId: string;
  observedAt: string;
  receivedAt: string;
  engineCoolantTemperature: number | null;
  engineOilTemperature: number | null;
  engineRpm: number | null;
  loadRate: number | null;
  engineHours: number | null;
  ambientTemperature: number | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  sourceType: SourceType;
  qualityStatus: QualityStatus;
  missingFields: string[];
  invalidFields: string[];
};

export type TelemetryAggregate = {
  assetId: string;
  windowStart: string;
  windowSeconds: 10 | 60;
  sampleCount: number;
  coolantTemperatureAvg: number | null;
  coolantTemperatureMax: number | null;
  oilTemperatureAvg: number | null;
  oilTemperatureMax: number | null;
  loadRateAvg: number | null;
  engineRpmAvg: number | null;
  qualityStatus: QualityStatus;
};

export type CreateMaintenanceAction = {
  siteId: string;
  assetId: string;
  riskAssessmentId: string;
  assignee: string;
  note: string;
};

export type MaintenanceOutcome = {
  status: "ACKNOWLEDGED" | "IN_PROGRESS" | "COMPLETED";
  inspectionNote: string;
  actionTaken: string;
  partsReplaced: string[];
  canReturnToService: boolean;
  actualOverheat: boolean | null;
};

export type MaintenanceAction = CreateMaintenanceAction & MaintenanceOutcome & {
  id: string;
  createdAt: string;
  completedAt: string | null;
};

export function createTelemetrySnapshot(input: Omit<TelemetrySnapshot, "qualityStatus" | "missingFields" | "invalidFields">): TelemetrySnapshot;
```

Set `qualityStatus` to `VALID` only when all thermal fields are present and finite; do not fabricate missing values.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --test-name-pattern="telemetry contract preserves"`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/lib/telemetry/contracts.ts website/lib/risk/contracts.ts website/lib/maintenance/contracts.ts website/tests/domain-contracts.test.mjs
git commit -m "feat: define forklift telemetry and risk contracts"
```

## Task 2: Add simulator/file adapters and quality validation

**Files:**
- Create: `website/lib/telemetry/adapters.ts`
- Create: `website/lib/telemetry/quality.ts`
- Create: `website/lib/telemetry/file-replay.ts`
- Modify: `website/lib/ecu/types.ts`
- Modify: `website/lib/ecu/factory.ts`
- Test: `website/tests/telemetry-adapters.test.mjs`

**Interfaces:**
- Consumes `RawTelemetry` and `TelemetrySnapshot` from Task 1.
- Produces `EcuAdapter`, `SourceHealth`, `normalizeRawTelemetry()`, and `FileReplayAdapter`.

- [ ] **Step 1: Write failing adapter and quality tests**

Cover the required behavior explicitly:

```js
test("quality marks missing thermal fields as partial and never invents values", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const result = normalizeRawTelemetry({
    assetId: "P-01", observedAt: "2026-08-14T00:00:00.000Z",
    values: { engineCoolantTemperature: 82 }, sourceType: "FILE_REPLAY",
  }, "2026-08-14T00:00:01.000Z");
  assert.equal(result.engineCoolantTemperature, 82);
  assert.equal(result.engineOilTemperature, null);
  assert.equal(result.qualityStatus, "PARTIAL");
  assert.deepEqual(result.missingFields, ["engineOilTemperature"]);
});

test("file replay reports stale source health after the last record", async () => {
  const { FileReplayAdapter } = await import("../lib/telemetry/file-replay.ts");
  const adapter = new FileReplayAdapter([{ assetId: "P-01", observedAt: "2026-08-14T00:00:00.000Z", values: {}, sourceType: "FILE_REPLAY" }]);
  await adapter.connect();
  await adapter.readBatch();
  const health = await adapter.health("2026-08-14T00:02:00.000Z");
  assert.equal(health.status, "STALE");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- --test-name-pattern="quality marks|file replay reports"`.

Expected: FAIL because the adapter and quality functions do not exist.

- [ ] **Step 3: Implement normalization and quality rules**

Implement `normalizeRawTelemetry(raw, receivedAt)` with these rules:

- Convert `loadRate` percentages to a 0–1 fraction only when the source declares a percentage unit.
- Mark non-finite values and values outside configured physical ranges in `invalidFields`.
- Mark a snapshot `STALE` when `receivedAt - observedAt > 60_000ms`.
- Mark `PARTIAL` when any required thermal field is missing but the record is otherwise usable.
- Return `INVALID` when both required thermal fields are invalid or timestamps are unparsable.

- [ ] **Step 4: Implement adapter interfaces**

Define:

```ts
export interface EcuAdapter {
  connect(): Promise<void>;
  readBatch(): Promise<RawTelemetry[]>;
  health(referenceTime?: string): Promise<SourceHealth>;
  close(): Promise<void>;
}
```

`FileReplayAdapter` receives an array in its constructor, returns records in order, and returns `STALE` after the last record is older than 60 seconds. Keep the existing `EcuDataSource.read(forkliftId)` path working for the current visual demo; do not replace it in this task.

- [ ] **Step 5: Run focused tests and the existing ECU tests**

Run: `npm test -- --test-name-pattern="quality marks|file replay reports|ECU"`.

Expected: PASS with no regression in `tests/ecu-source.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add website/lib/telemetry website/lib/ecu/types.ts website/lib/ecu/factory.ts website/tests/telemetry-adapters.test.mjs
git commit -m "feat: add replayable telemetry adapters and quality checks"
```

## Task 3: Add baseline profiles and high-confidence overheat assessment

**Files:**
- Create: `website/lib/risk/baseline.ts`
- Create: `website/lib/risk/overheat-evaluator.ts`
- Test: `website/tests/overheat-evaluator.test.mjs`
- Modify: `website/lib/diagnostics/evaluator.ts` only to re-export shared risk labels if needed; do not change legacy thresholds in this task

**Interfaces:**
- Consumes `TelemetrySnapshot`, `DataQuality`, and recent snapshots from Tasks 1–2.
- Produces `BaselineProfile`, `buildBaselineProfile()`, and `evaluateOverheatRisk()`.

- [ ] **Step 1: Write failing evaluator tests**

The tests must demonstrate the precision-first policy:

```js
test("single temperature spike remains OBSERVE", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");
  const result = evaluateOverheatRisk({
    current: validSnapshot({ coolant: 96, oil: 79, load: 0.5 }),
    history: [validSnapshot({ coolant: 82, oil: 78, load: 0.5 })],
    peerSnapshots: [], baseline: baselineFor(82), now: "2026-08-14T00:01:00.000Z",
  });
  assert.equal(result.level, "OBSERVE");
  assert.equal(result.shouldNotifyMaintenance, false);
});

test("sustained multi-signal rise creates a maintenance alert", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");
  const result = evaluateOverheatRisk({
    current: validSnapshot({ coolant: 103, oil: 101, load: 0.9 }),
    history: sustainedRisingHistory(),
    peerSnapshots: [validSnapshot({ coolant: 82, oil: 78, load: 0.4 })],
    baseline: baselineFor(82), now: "2026-08-14T00:10:00.000Z",
  });
  assert.equal(result.level, "MAINTENANCE_ALERT");
  assert.equal(result.shouldNotifyMaintenance, true);
  assert.ok(result.evidence.length >= 3);
});

test("stale data becomes DATA_ISSUE and cannot escalate", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");
  const result = evaluateOverheatRisk({ current: staleSnapshot(), history: [], peerSnapshots: [], baseline: baselineFor(82), now: "2026-08-14T00:10:00.000Z" });
  assert.equal(result.level, "DATA_ISSUE");
  assert.equal(result.shouldNotifyMaintenance, false);
});
```

- [ ] **Step 2: Run the evaluator tests and verify they fail**

Run: `npm test -- --test-name-pattern="single temperature spike|sustained multi-signal|stale data"`.

Expected: FAIL because no baseline or overheat evaluator exists.

- [ ] **Step 3: Implement baseline construction**

Define:

```ts
export type BaselineProfile = {
  assetId: string;
  sampleCount: number;
  coolant: { median: number; upperBound: number; riseRatePerMinute: number };
  oil: { median: number; upperBound: number; riseRatePerMinute: number };
  peerMedian: { coolant: number | null; oil: number | null };
  version: string;
  activeFrom: string;
};

export function buildBaselineProfile(assetId: string, samples: TelemetrySnapshot[], peerSamples: TelemetrySnapshot[], activeFrom: string): BaselineProfile;
```

Use only `VALID` samples and exclude samples associated with a risk level at or above `CAUTION`. Require at least 20 valid samples; below that threshold return a low-confidence profile that can support `OBSERVE` but never `MAINTENANCE_ALERT`.

- [ ] **Step 4: Implement the overheat evaluator**

Define:

```ts
export type OverheatEvaluationInput = {
  current: TelemetrySnapshot;
  history: TelemetrySnapshot[];
  peerSnapshots: TelemetrySnapshot[];
  baseline: BaselineProfile;
  now: string;
};

export function evaluateOverheatRisk(input: OverheatEvaluationInput): RiskAssessment;
```

Define the returned assessment contract before implementing the evaluator:

```ts
export type RiskAssessment = {
  assetId: string;
  level: RiskLevel;
  score: number;
  confidence: number;
  evidence: string[];
  observedWindow: "48h";
  shouldNotifyMaintenance: boolean;
  reasonKey: string;
  assessedAt: string;
};
```

Count evidence for absolute temperature, rise rate, persistence, load/RPM correlation, and peer deviation. Produce `OBSERVE` for a single signal, `CAUTION` for two persistent signals, and `MAINTENANCE_ALERT` only when at least three independent signals are present and quality is valid. Include `observedWindow: "48h"`, evidence strings, numeric score, confidence, and `shouldNotifyMaintenance` in the returned assessment.

- [ ] **Step 5: Run focused and legacy diagnostic tests**

Run: `npm test -- --test-name-pattern="single temperature spike|sustained multi-signal|stale data|diagnostic"`.

Expected: PASS; legacy battery/vibration demonstration tests remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add website/lib/risk website/tests/overheat-evaluator.test.mjs
git commit -m "feat: add precision-first engine overheat risk evaluator"
```

## Task 4: Add D1 operational schema and repositories

**Files:**
- Modify: `website/db/schema.ts`
- Create: `website/lib/telemetry/repository.ts`
- Create: `website/lib/risk/repository.ts`
- Create: `website/lib/maintenance/repository.ts`
- Create: `website/db/migrations/0000_engine_overheat_poc.sql` using the repository's migration generator output
- Test: `website/tests/repositories.test.mjs`

**Interfaces:**
- Consumes domain types and risk assessments from Tasks 1–3.
- Produces repository interfaces usable by API routes and tests:

```ts
export interface TelemetryRepository {
  insertSnapshot(snapshot: TelemetrySnapshot): Promise<void>;
  insertAggregate(input: TelemetryAggregate): Promise<void>;
  listRecent(assetId: string, limit: number): Promise<TelemetrySnapshot[]>;
}

export interface RiskRepository {
  openOrUpdateAssessment(assessment: RiskAssessment): Promise<RiskAssessmentRecord>;
  listOpen(siteId: string): Promise<RiskAssessmentRecord[]>;
}

export interface MaintenanceRepository {
  createAction(input: CreateMaintenanceAction): Promise<MaintenanceAction>;
  completeAction(id: string, outcome: MaintenanceOutcome): Promise<MaintenanceAction>;
}

export type RiskAssessmentRecord = RiskAssessment & {
  id: string;
  siteId: string;
  status: "OPEN" | "ACKNOWLEDGED" | "COMPLETED" | "DISMISSED";
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 1: Write failing repository tests against an in-memory implementation**

Test insertion order, recent-record limiting, one open alert per `assetId` and reason key, and action completion with `actualOverheat` stored as a label. The tests must not require a live D1 binding.

- [ ] **Step 2: Run repository tests and verify they fail**

Run: `npm test -- --test-name-pattern="repository"`.

Expected: FAIL because schema and repositories do not exist.

- [ ] **Step 3: Add Drizzle tables**

Add tables for `telemetrySnapshots`, `telemetryAggregates`, `riskAssessments`, and `maintenanceActions`. Index `assetId + observedAt`, `siteId + status`, and `riskAssessmentId`. Store timestamps as ISO strings, numeric measurements as real/integer columns, evidence as JSON text, and raw payload hashes for deduplication.

- [ ] **Step 4: Implement repository interfaces with D1 and in-memory variants**

Keep D1-specific calls inside repository files. Provide an in-memory implementation for unit tests and local replay. The open/update operation must use a stable deduplication key composed of `siteId`, `assetId`, and the active risk reason.

- [ ] **Step 5: Generate and inspect the migration**

Run: `npm run db:generate` from `website/`.

Expected: a migration containing the four operational tables and their indexes. Inspect the generated SQL and ensure no raw one-second payload table is created in D1.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- --test-name-pattern="repository"`.

Expected: PASS.

```bash
git add website/db/schema.ts website/db/migrations website/lib/telemetry/repository.ts website/lib/risk/repository.ts website/lib/maintenance/repository.ts website/tests/repositories.test.mjs
git commit -m "feat: persist telemetry risks and maintenance actions"
```

## Task 5: Add ingestion, risk, and maintenance API routes

**Files:**
- Create: `website/app/api/telemetry/route.ts`
- Create: `website/app/api/risks/route.ts`
- Create: `website/app/api/maintenance/route.ts`
- Create: `website/lib/telemetry/ingest.ts`
- Test: `website/tests/api-workflow.test.mjs`

**Interfaces:**
- Consumes adapters, quality normalization, evaluator, and repositories from Tasks 1–4.
- Produces JSON endpoints:

```text
POST /api/telemetry
  body: { records: RawTelemetry[] }
  response: { accepted: number; rejected: number; qualityIssues: DataQuality[] }

GET /api/risks?siteId=site-01&status=open
  response: { assessments: RiskAssessmentRecord[] }

POST /api/maintenance
  body: CreateMaintenanceAction
  response: MaintenanceAction

PATCH /api/maintenance/:id
  body: MaintenanceOutcome
  response: MaintenanceAction
```

- [ ] **Step 1: Write failing end-to-end workflow tests**

Submit one valid normal record, then a multi-signal overheat sequence, assert that only the latter creates or updates an open maintenance assessment, and complete the action with `actualOverheat: true`. Also submit a stale record and assert it becomes `DATA_ISSUE` without a maintenance alert.

- [ ] **Step 2: Run workflow tests and verify they fail**

Run: `npm test -- --test-name-pattern="workflow"`.

Expected: FAIL because the routes and ingestion service do not exist.

- [ ] **Step 3: Implement the ingestion service**

Implement `ingestTelemetry(records, dependencies)` to normalize each record, persist valid snapshots/aggregates, calculate risk from recent history and baseline, and call `openOrUpdateAssessment()` only when `shouldNotifyMaintenance` is true. Return accepted/rejected counts and quality issues without throwing for a bad individual record.

- [ ] **Step 4: Implement the API routes**

Validate JSON shape, reject unknown or missing `assetId`, use the configured repository factory, and return 400 for malformed requests, 503 for unavailable persistence, and 200/201 for successful operations. Do not expose raw payloads in list responses; include only normalized measurements, quality, evidence, and action state.

- [ ] **Step 5: Run workflow and build tests**

Run: `npm test` and `npm run lint` from `website/`.

Expected: PASS with no regression in rendered HTML tests.

- [ ] **Step 6: Commit**

```bash
git add website/app/api website/lib/telemetry/ingest.ts website/tests/api-workflow.test.mjs
git commit -m "feat: expose telemetry risk and maintenance workflows"
```

## Task 6: Add the maintenance-focused operator UI

**Files:**
- Create: `website/app/maintenance-queue.tsx`
- Create: `website/app/forklift-detail.tsx`
- Create: `website/app/data-quality-panel.tsx`
- Modify: `website/app/page.tsx`
- Modify: `website/app/globals.css`
- Test: `website/tests/maintenance-ui.test.mjs`
- Test: `website/tests/rendered-html.test.mjs` if selectors or text expectations change

**Interfaces:**
- Consumes `RiskAssessmentRecord`, `TelemetrySnapshot`, `DataQuality`, and `MaintenanceAction` JSON shapes from Task 5.
- Produces a dashboard flow in which the existing twin scene remains visible while a maintenance queue, evidence panel, and action form are available.

- [ ] **Step 1: Write failing rendered UI tests**

Assert the HTML contains the exact operational copy:

```js
assert.match(html, /정비 경보/);
assert.match(html, /향후 48시간 내 과열 위험 관찰 구간/);
assert.match(html, /경보 근거/);
assert.match(html, /점검 결과 기록/);
assert.match(html, /데이터 수신 상태/);
```

Add an interaction test for selecting an alert, opening the forklift detail, submitting an action, and rendering the completed action state.

- [ ] **Step 2: Run the UI tests and verify they fail**

Run: `npm test -- --test-name-pattern="maintenance|48시간|점검 결과"`.

Expected: FAIL because the new queue and action flow do not exist.

- [ ] **Step 3: Extract focused components**

Create components with these props:

```ts
type MaintenanceQueueProps = {
  assessments: RiskAssessmentRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

type ForkliftDetailProps = {
  snapshot: TelemetrySnapshot | null;
  assessment: RiskAssessmentRecord | null;
  onSubmitAction: (input: CreateMaintenanceAction) => Promise<void>;
};

type DataQualityPanelProps = { health: SourceHealth[]; issues: DataQuality[] };
```

Keep the existing digital-twin scene, live movement, Twin AI panel, and legacy diagnostic modal working. The new panel must show textual evidence beside status colors and must not rely on color alone.

- [ ] **Step 4: Implement action recording states**

Support `OPEN`, `ACKNOWLEDGED`, `IN_PROGRESS`, and `COMPLETED` in the UI. Disable duplicate submission while a request is pending, show API errors inline, and keep the selected alert visible after a successful action.

- [ ] **Step 5: Run UI, render, build, and lint checks**

Run: `npm test`, `npm run lint`, and `npm run build` from `website/`.

Expected: PASS; existing dashboard and Twin AI render tests remain green.

- [ ] **Step 6: Commit**

```bash
git add website/app/page.tsx website/app/maintenance-queue.tsx website/app/forklift-detail.tsx website/app/data-quality-panel.tsx website/app/globals.css website/tests/maintenance-ui.test.mjs website/tests/rendered-html.test.mjs
git commit -m "feat: add maintenance-focused overheat operations UI"
```

## Task 7: Add replay fixtures, observability, and PoC acceptance report

**Files:**
- Create: `website/tests/fixtures/normal-10s.json`
- Create: `website/tests/fixtures/sustained-overheat-10s.json`
- Create: `website/tests/fixtures/stale-data.json`
- Create: `website/lib/telemetry/metrics.ts`
- Create: `docs/superpowers/reports/2026-08-14-engine-overheat-poc-validation.md`
- Test: `website/tests/replay-validation.test.mjs`

**Interfaces:**
- Consumes the complete pipeline from Tasks 1–6.
- Produces replay metrics and a written validation report distinguishing system validation from real-world predictive performance.

- [ ] **Step 1: Add deterministic replay fixtures**

Create fixtures for 5 assets with timestamps at 10-second intervals. The normal fixture must contain at least 20 valid samples per asset. The sustained-overheat fixture must include rising coolant temperature, rising oil temperature, high load, and peer deviation for one asset. The stale fixture must contain an observed time more than 60 seconds older than its received time.

- [ ] **Step 2: Write failing replay acceptance tests**

Assert that normal replay produces no maintenance alerts, sustained replay produces one deduplicated open alert for the target asset, stale replay produces a data issue, and completed maintenance actions are counted as labels.

- [ ] **Step 3: Implement metrics**

Implement `summarizeReplay()` returning `{ totalRecords, validRecords, qualityIssueCount, maintenanceAlertCount, duplicateAlertCount, labeledOutcomes }`. Do not name these predictive precision or recall unless a confirmed ground-truth event exists.

- [ ] **Step 4: Run the full validation suite**

Run: `npm test`, `npm run lint`, and `npm run build`.

Expected: PASS. Run the replay test separately and save its output in the validation report.

- [ ] **Step 5: Write the acceptance report**

Document environment, fixture counts, data completeness, alert deduplication, stale handling, UI workflow, known limitations, and the explicit statement that replay validation does not prove field prediction performance.

- [ ] **Step 6: Commit**

```bash
git add website/tests/fixtures website/lib/telemetry/metrics.ts website/tests/replay-validation.test.mjs docs/superpowers/reports/2026-08-14-engine-overheat-poc-validation.md
git commit -m "test: validate engine overheat poc replay workflow"
```

## Final Verification Checklist

- [ ] `npm test` passes from `website/`.
- [ ] `npm run lint` passes from `website/`.
- [ ] `npm run build` passes from `website/`.
- [ ] Existing DUMMY ECU, digital-twin movement, Twin AI, and legacy diagnostic tests pass.
- [ ] One sensor spike remains `OBSERVE` and does not create a maintenance alert.
- [ ] Sustained multi-signal replay creates one deduplicated maintenance alert with at least three evidence items.
- [ ] Stale or invalid data creates `DATA_ISSUE` and never escalates to maintenance alert.
- [ ] A maintenance action can be acknowledged, completed, and stored as a future model label.
- [ ] The UI displays evidence text, data quality, the 48-hour observation-window wording, and action status.
- [ ] The validation report clearly separates pipeline correctness from real field predictive performance.

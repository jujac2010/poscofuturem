# Engine Overheat PoC Replay Validation

Date: 2026-08-14

## Environment

- Workspace: `C:\Users\POSCOFUTUREM\Documents\ChatGPT\노란사과`
- App surface under test: `website/`
- Shell: PowerShell
- Node.js: `v24.18.1`
- Package scripts exercised: `node --test tests/replay-validation.test.mjs`, `npm test`, `npm run build`, `npx eslint lib/telemetry/metrics.ts tests/replay-validation.test.mjs`, `npm run lint`

## Fixtures and counts

- `website/tests/fixtures/normal-10s.json`
  - 5 assets (`FL-01`..`FL-05`)
  - 20 valid 10-second samples per asset
  - 100 replay records total
- `website/tests/fixtures/sustained-overheat-10s.json`
  - 5 assets
  - 24 10-second samples per asset
  - 120 replay records total
  - `FL-01` carries the sustained hot sequence in the final 4 samples with rising coolant, rising oil, and high load while peer assets remain near baseline
- `website/tests/fixtures/stale-data.json`
  - 1 replay record
  - observed-to-received delay: 75 seconds

## Data completeness

- Normal replay summary:
  - `totalRecords: 100`
  - `validRecords: 100`
  - `qualityIssueCount: 0`
  - `maintenanceAlertCount: 0`
- Sustained replay summary:
  - `totalRecords: 120`
  - `validRecords: 120`
  - `qualityIssueCount: 0`
  - `maintenanceAlertCount: 1`
- Stale replay summary:
  - `totalRecords: 1`
  - `validRecords: 0`
  - `qualityIssueCount: 1`
  - `maintenanceAlertCount: 0`

## Deduplication

The sustained replay produces two maintenance-alert open/update events for the same replayed incident, but only one open risk assessment remains after repository deduplication:

- unique open alert count: `1`
- duplicate alert count: `1`
- target asset: `FL-01`

This confirms the Task 5 repository deduplication key still collapses repeat maintenance-alert updates onto the existing open assessment instead of creating duplicate incidents.

## Stale handling

The stale replay fixture is rejected as a `STALE` quality issue because `receivedAt - observedAt = 75s`, which is above the 60-second cutoff. The replay does not open or update a maintenance alert, so stale or delayed data still cannot escalate operationally.

## Maintenance label capture

The sustained replay test completes the maintenance workflow with `actualOverheat: true`. `summarizeReplay()` reports:

- `labeledOutcomes.total: 1`
- `labeledOutcomes.confirmed: 1`
- `labeledOutcomes.notConfirmed: 0`

This confirms completed maintenance outcomes are counted as labels without renaming them to predictive metrics such as precision or recall.

## UI workflow

Task 7 does not modify the Task 6 UI. The replay validation reuses the same maintenance-action workflow contract that the UI already depends on:

1. replayed telemetry opens one maintenance alert
2. the operator selects the alert in the existing maintenance queue/detail flow
3. the operator records the maintenance action
4. completion stores the `actualOverheat` label for later supervised-model work

The replay suite validates the backend workflow that supports that UI path while leaving the Task 6 visual behavior unchanged.

## Focused replay test result

Focused replay validation passed on 2026-08-14:

```text
3 tests, 3 passed, 0 failed
```

Command used:

```text
node --test tests/replay-validation.test.mjs
```

## Full verification

- Focused replay test: PASS
- Targeted lint (`metrics.ts` + `replay-validation.test.mjs`): PASS
- `npm test`: PASS, 51/51 tests
- `npm run build`: PASS
- `npm run lint`: FAIL due pre-existing unrelated repository issues outside Task 7 scope

Repo-wide lint still reports 21 existing problems in:

- `website/app/page.tsx`
- `website/app/twin-ai-components.tsx`
- `website/lib/ecu/real-source.ts`
- `website/lib/maintenance/repository.ts`
- `website/lib/telemetry/repository.ts`

The new Task 7 files lint clean in isolation.

## Limitations

- This replay validation proves pipeline behavior against deterministic fixtures; it does not prove field performance.
- The fixtures are synthetic and replay controlled timestamps, so they do not establish real sensor noise, operator response latency, or site network behavior.
- The sustained fixture includes a peer-deviant target asset, but the replay acceptance path here is still primarily validating ingestion, deduplication, stale suppression, and label capture. Peer-deviation scoring itself remains separately covered by the Task 3 evaluator tests.
- No predictive precision, recall, failure probability, or 48-hour real-world calibration claim is made here because the replay does not include independently confirmed field ground truth beyond the manually recorded maintenance label.

## Explicit conclusion

Replay validation on 2026-08-14 shows that the engine-overheat PoC can ingest deterministic replay data, suppress stale data, deduplicate repeated maintenance-alert updates, and count completed maintenance outcomes as labels.

Replay validation does **not** prove field predictive performance, real-world calibration, or production readiness for 48-hour engine-overheat prediction.

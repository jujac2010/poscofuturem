import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DEFAULT_SITE_ID = "site-01";

function addSeconds(isoString, seconds) {
  return new Date(Date.parse(isoString) + (seconds * 1_000)).toISOString();
}

async function loadReplayFixture(name) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

function expandReplayFixture(fixture, fixtureName) {
  const entries = fixture.assets.flatMap((asset) =>
    asset.samples.map(([offset, coolant, oil, rpm, load, engineHours, speed]) => {
      const observedAt = addSeconds(asset.startObservedAt, offset * fixture.intervalSeconds);
      const receivedAt = addSeconds(observedAt, asset.receivedLagSeconds ?? 1);

      return {
        assetId: asset.assetId,
        observedAt,
        receivedAt,
        record: {
          assetId: asset.assetId,
          observedAt,
          sourceType: "FILE_REPLAY",
          payloadHash: `${fixtureName}-${asset.assetId.toLowerCase()}-${String(offset).padStart(3, "0")}`,
          values: {
            engineCoolantTemperature: coolant,
            engineOilTemperature: oil,
            engineRpm: rpm,
            loadRate: load,
            engineHours,
            ambientTemperature: asset.ambientTemperature,
            latitude: asset.latitude,
            longitude: asset.longitude,
            speed,
          },
        },
      };
    })
  );

  entries.sort((left, right) => (
    left.observedAt.localeCompare(right.observedAt)
      || left.assetId.localeCompare(right.assetId)
  ));

  return {
    siteId: fixture.siteId ?? DEFAULT_SITE_ID,
    assetIds: fixture.assets.map((asset) => asset.assetId),
    targetAssetId: fixture.targetAssetId ?? null,
    records: entries.map((entry) => entry.record),
    receivedAtSchedule: entries.map((entry) => entry.receivedAt),
  };
}

async function createReplayHarness(fixtureName) {
  const fixture = expandReplayFixture(await loadReplayFixture(fixtureName), fixtureName.replace(".json", ""));
  const { createInMemoryTelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const { createInMemoryRiskRepository, createInMemoryRiskStore } = await import("../lib/risk/repository.ts");
  const { createInMemoryMaintenanceRepository } = await import("../lib/maintenance/repository.ts");
  const {
    ingestTelemetry,
    listOpenAssessments,
    createMaintenanceAction,
    completeMaintenanceAction,
  } = await import("../lib/telemetry/ingest.ts");
  const { summarizeReplay } = await import("../lib/telemetry/metrics.ts");

  const riskStore = createInMemoryRiskStore();
  const baseRiskRepository = createInMemoryRiskRepository({ siteId: fixture.siteId }, riskStore);
  const alertEvents = [];
  const riskRepository = {
    async openOrUpdateAssessment(assessment) {
      const record = await baseRiskRepository.openOrUpdateAssessment(assessment);
      alertEvents.push(record);
      return record;
    },
    async listOpen(siteId) {
      return baseRiskRepository.listOpen(siteId);
    },
  };

  const clockValues = [...fixture.receivedAtSchedule];
  const now = () => clockValues.shift() ?? fixture.receivedAtSchedule.at(-1) ?? "2026-08-14T00:00:00.000Z";

  const dependencies = {
    siteId: fixture.siteId,
    assetIds: fixture.assetIds,
    telemetryRepository: createInMemoryTelemetryRepository(),
    riskRepository,
    maintenanceRepository: createInMemoryMaintenanceRepository({ now }),
    now,
  };

  const ingestResult = await ingestTelemetry(fixture.records, dependencies);
  const openAssessments = await listOpenAssessments(fixture.siteId, dependencies);

  return {
    fixture,
    dependencies,
    ingestResult,
    openAssessments,
    alertEvents,
    summarize(maintenanceActions = []) {
      return summarizeReplay({
        records: fixture.records,
        ingestResults: [ingestResult],
        alertEvents,
        maintenanceActions,
      });
    },
    createMaintenanceAction,
    completeMaintenanceAction,
  };
}

test("replay validation keeps the normal 10-second fixture alert-free", async () => {
  const harness = await createReplayHarness("normal-10s.json");
  const summary = harness.summarize();

  assert.equal(harness.fixture.assetIds.length, 5);
  assert.equal(harness.fixture.records.length, 100);
  assert.deepEqual(harness.ingestResult.qualityIssues, []);
  assert.equal(harness.openAssessments.length, 0);
  assert.deepEqual(summary, {
    totalRecords: 100,
    validRecords: 100,
    qualityIssueCount: 0,
    maintenanceAlertCount: 0,
    duplicateAlertCount: 0,
    labeledOutcomes: {
      total: 0,
      confirmed: 0,
      notConfirmed: 0,
    },
  });
});

test("replay validation deduplicates the sustained alert and counts the completed maintenance label", async () => {
  const harness = await createReplayHarness("sustained-overheat-10s.json");
  const createdAction = await harness.createMaintenanceAction({
    siteId: harness.dependencies.siteId,
    assetId: harness.fixture.targetAssetId,
    riskAssessmentId: harness.openAssessments[0].id,
    assignee: "tech.park",
    note: "Replay inspection for sustained overheat evidence.",
  }, harness.dependencies);
  const completedAction = await harness.completeMaintenanceAction(createdAction.id, {
    status: "COMPLETED",
    inspectionNote: "Replay teardown confirms cooling restriction.",
    actionTaken: "Cleared line and replaced thermostat.",
    partsReplaced: ["thermostat"],
    canReturnToService: true,
    actualOverheat: true,
  }, harness.dependencies);
  const summary = harness.summarize([createdAction, completedAction]);

  assert.equal(harness.fixture.assetIds.length, 5);
  assert.equal(harness.fixture.records.length, 120);
  assert.equal(harness.ingestResult.accepted, 120);
  assert.equal(harness.openAssessments.length, 1);
  assert.equal(harness.openAssessments[0].assetId, harness.fixture.targetAssetId);
  assert.equal(harness.openAssessments[0].level, "MAINTENANCE_ALERT");
  assert.ok(harness.openAssessments[0].evidence.length >= 3);
  assert.equal(harness.alertEvents.length, 2);
  assert.equal(new Set(harness.alertEvents.map((event) => event.id)).size, 1);
  assert.equal(completedAction.actualOverheat, true);
  assert.deepEqual(summary, {
    totalRecords: 120,
    validRecords: 120,
    qualityIssueCount: 0,
    maintenanceAlertCount: 1,
    duplicateAlertCount: 1,
    labeledOutcomes: {
      total: 1,
      confirmed: 1,
      notConfirmed: 0,
    },
  });
});

test("replay validation reports stale data quality issues without maintenance escalation", async () => {
  const harness = await createReplayHarness("stale-data.json");
  const summary = harness.summarize();

  assert.equal(harness.ingestResult.accepted, 0);
  assert.equal(harness.ingestResult.rejected, 1);
  assert.equal(harness.ingestResult.qualityIssues.length, 1);
  assert.equal(harness.ingestResult.qualityIssues[0].status, "STALE");
  assert.equal(harness.openAssessments.length, 0);
  assert.deepEqual(summary, {
    totalRecords: 1,
    validRecords: 0,
    qualityIssueCount: 1,
    maintenanceAlertCount: 0,
    duplicateAlertCount: 0,
    labeledOutcomes: {
      total: 0,
      confirmed: 0,
      notConfirmed: 0,
    },
  });
});

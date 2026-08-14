import assert from "node:assert/strict";
import test from "node:test";

import { createTelemetrySnapshot } from "../lib/telemetry/contracts.ts";

function snapshot({
  assetId = "FL-01",
  observedAt,
  receivedAt = observedAt,
  coolant = 82,
  oil = 78,
  rpm = 1500,
  load = 0.45,
  engineHours = 4200,
} = {}) {
  return createTelemetrySnapshot({
    assetId,
    observedAt,
    receivedAt,
    engineCoolantTemperature: coolant,
    engineOilTemperature: oil,
    engineRpm: rpm,
    loadRate: load,
    engineHours,
    ambientTemperature: 31,
    latitude: 35.1,
    longitude: 129.1,
    speed: 4,
    sourceType: "FILE_REPLAY",
  });
}

function assessment({
  assetId = "FL-01",
  level = "MAINTENANCE_ALERT",
  score = 88,
  confidence = 94,
  reasonKey = "PRECISION_MULTI_SIGNAL_ALERT",
  assessedAt = "2026-08-14T00:10:00.000Z",
  evidence = ["Persistent hot readings across three observations."],
  shouldNotifyMaintenance = true,
} = {}) {
  return {
    assetId,
    level,
    score,
    confidence,
    evidence,
    observedWindow: "48h",
    shouldNotifyMaintenance,
    reasonKey,
    assessedAt,
  };
}

test("repository telemetry keeps most recent snapshots first and respects limits", async () => {
  const { createInMemoryTelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const repository = createInMemoryTelemetryRepository();

  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:00:00.000Z",
    coolant: 80,
    oil: 76,
  }));
  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:02:00.000Z",
    coolant: 84,
    oil: 81,
  }));
  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:01:00.000Z",
    coolant: 82,
    oil: 79,
  }));
  await repository.insertAggregate({
    assetId: "FL-01",
    windowStart: "2026-08-14T00:00:00.000Z",
    windowSeconds: 60,
    sampleCount: 3,
    coolantTemperatureAvg: 82,
    coolantTemperatureMax: 84,
    oilTemperatureAvg: 78.7,
    oilTemperatureMax: 81,
    loadRateAvg: 0.5,
    engineRpmAvg: 1520,
    qualityStatus: "VALID",
  });

  const recent = await repository.listRecent("FL-01", 2);

  assert.equal(recent.length, 2);
  assert.deepEqual(
    recent.map((entry) => entry.observedAt),
    ["2026-08-14T00:02:00.000Z", "2026-08-14T00:01:00.000Z"],
  );
});

test("repository risk keeps one open assessment per site asset and reason", async () => {
  const { createInMemoryRiskRepository } = await import("../lib/risk/repository.ts");
  const repository = createInMemoryRiskRepository({ siteId: "site-01" });

  const first = await repository.openOrUpdateAssessment(assessment());
  const updated = await repository.openOrUpdateAssessment(assessment({
    score: 92,
    confidence: 97,
    assessedAt: "2026-08-14T00:12:00.000Z",
    evidence: ["Risk score increased while the reason stayed stable."],
  }));
  const otherReason = await repository.openOrUpdateAssessment(assessment({
    reasonKey: "PERSISTENT_MULTI_SIGNAL_CAUTION",
    level: "CAUTION",
    score: 68,
    confidence: 83,
    assessedAt: "2026-08-14T00:13:00.000Z",
    shouldNotifyMaintenance: false,
    evidence: ["Persistent heat remains below maintenance-alert threshold."],
  }));

  assert.equal(updated.id, first.id);
  assert.equal(updated.siteId, "site-01");
  assert.equal(updated.status, "OPEN");
  assert.equal(updated.score, 92);
  assert.equal(updated.updatedAt, "2026-08-14T00:12:00.000Z");
  assert.notEqual(otherReason.id, first.id);

  const open = await repository.listOpen("site-01");

  assert.equal(open.length, 2);
  assert.deepEqual(
    open.map((entry) => `${entry.assetId}:${entry.reasonKey}`),
    ["FL-01:PERSISTENT_MULTI_SIGNAL_CAUTION", "FL-01:PRECISION_MULTI_SIGNAL_ALERT"],
  );
});

test("repository maintenance completion round-trips actualOverheat labels", async () => {
  const {
    actualOverheatLabel,
    createInMemoryMaintenanceRepository,
  } = await import("../lib/maintenance/repository.ts");
  const timestamps = [
    "2026-08-14T00:20:00.000Z",
    "2026-08-14T00:31:00.000Z",
  ];
  const repository = createInMemoryMaintenanceRepository({
    now: () => timestamps.shift() ?? "2026-08-14T00:31:00.000Z",
  });

  const created = await repository.createAction({
    siteId: "site-01",
    assetId: "FL-01",
    riskAssessmentId: "risk-001",
    assignee: "tech.park",
    note: "Inspect cooling loop and fan clutch.",
  });

  assert.equal(created.completedAt, null);
  assert.equal(actualOverheatLabel(true), "CONFIRMED");
  assert.equal(actualOverheatLabel(false), "NOT_CONFIRMED");
  assert.equal(actualOverheatLabel(null), "UNKNOWN");

  const completed = await repository.completeAction(created.id, {
    status: "COMPLETED",
    inspectionNote: "Coolant line restriction found and cleared.",
    actionTaken: "Flushed line and replaced thermostat.",
    partsReplaced: ["thermostat"],
    canReturnToService: true,
    actualOverheat: true,
  });

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.actualOverheat, true);
  assert.equal(completed.createdAt, "2026-08-14T00:20:00.000Z");
  assert.equal(completed.completedAt, "2026-08-14T00:31:00.000Z");
});

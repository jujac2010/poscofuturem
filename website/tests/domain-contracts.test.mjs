import assert from "node:assert/strict";
import test from "node:test";

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

  function persistTelemetryRecord(record) {
    return {
      assetId: record.assetId,
      observedAt: record.observedAt,
      receivedAt: record.receivedAt,
      sourceType: record.sourceType,
      qualityStatus: record.qualityStatus,
    };
  }

  const persisted = persistTelemetryRecord(snapshot);
  assert.equal(persisted.assetId, "P-01");
  assert.equal(persisted.observedAt, "2026-08-14T00:00:00.000Z");
  assert.equal(persisted.sourceType, "FILE_REPLAY");
  assert.equal(persisted.qualityStatus, "VALID");
  assert.equal(persisted.receivedAt, "2026-08-14T00:00:01.000Z");
  assert.deepEqual(snapshot.missingFields, []);
  assert.deepEqual(snapshot.invalidFields, []);
});

test("telemetry contract keeps valid thermal snapshots valid when optional fields are missing", async () => {
  const { createTelemetrySnapshot } = await import("../lib/telemetry/contracts.ts");
  const snapshot = createTelemetrySnapshot({
    assetId: "P-02",
    observedAt: "2026-08-14T00:10:00.000Z",
    receivedAt: "2026-08-14T00:10:01.000Z",
    engineCoolantTemperature: 84,
    engineOilTemperature: 81,
    engineRpm: null,
    loadRate: null,
    engineHours: null,
    ambientTemperature: null,
    latitude: null,
    longitude: null,
    speed: null,
    sourceType: "SIMULATOR",
  });

  assert.equal(snapshot.qualityStatus, "VALID");
  assert.ok(snapshot.missingFields.includes("engineRpm"));
  assert.ok(snapshot.missingFields.includes("loadRate"));
  assert.ok(snapshot.missingFields.includes("engineHours"));
  assert.ok(snapshot.missingFields.includes("ambientTemperature"));
  assert.ok(snapshot.missingFields.includes("latitude"));
  assert.ok(snapshot.missingFields.includes("longitude"));
  assert.ok(snapshot.missingFields.includes("speed"));
});

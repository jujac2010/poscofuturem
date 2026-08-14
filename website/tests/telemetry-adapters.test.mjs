import assert from "node:assert/strict";
import test from "node:test";

test("quality marks missing thermal fields as partial and never invents values", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const result = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: { engineCoolantTemperature: 82 },
      sourceType: "FILE_REPLAY",
    },
    "2026-08-14T00:00:01.000Z",
  );

  assert.equal(result.engineCoolantTemperature, 82);
  assert.equal(result.engineOilTemperature, null);
  assert.equal(result.qualityStatus, "PARTIAL");
  assert.deepEqual(result.missingFields, ["engineOilTemperature"]);
});

test("quality marks stale snapshots after the exact 60 second threshold", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const result = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {
        engineCoolantTemperature: 82,
        engineOilTemperature: 79,
      },
      sourceType: "SIMULATOR",
    },
    "2026-08-14T00:01:00.001Z",
  );

  assert.equal(result.qualityStatus, "STALE");
  assert.equal(result.engineCoolantTemperature, 82);
  assert.equal(result.engineOilTemperature, 79);
});

test("quality converts percentage load rate values into fractions only when declared", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const percentResult = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {
        engineCoolantTemperature: 82,
        engineOilTemperature: 79,
        loadRate: 55,
      },
      units: { loadRate: "percent" },
      sourceType: "FILE_REPLAY",
    },
    "2026-08-14T00:00:01.000Z",
  );
  const fractionResult = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {
        engineCoolantTemperature: 82,
        engineOilTemperature: 79,
        loadRate: 0.55,
      },
      sourceType: "SIMULATOR",
    },
    "2026-08-14T00:00:01.000Z",
  );

  assert.equal(percentResult.loadRate, 0.55);
  assert.equal(fractionResult.loadRate, 0.55);
});

test("quality flags out of range and non-finite values as invalid", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const result = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {
        engineCoolantTemperature: Number.POSITIVE_INFINITY,
        engineOilTemperature: -10,
        engineRpm: 1400,
      },
      sourceType: "SIMULATOR",
    },
    "2026-08-14T00:00:01.000Z",
  );

  assert.equal(result.qualityStatus, "INVALID");
  assert.deepEqual(result.invalidFields.sort(), [
    "engineCoolantTemperature",
    "engineOilTemperature",
  ]);
  assert.equal(result.engineRpm, 1400);
});

test("quality accepts conservative default minimum and maximum boundary values", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const { TELEMETRY_PHYSICAL_RANGES } = await import("../lib/telemetry/quality-ranges.ts");
  const result = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {
        engineCoolantTemperature: TELEMETRY_PHYSICAL_RANGES.engineCoolantTemperature.min,
        engineOilTemperature: TELEMETRY_PHYSICAL_RANGES.engineOilTemperature.max,
        engineRpm: TELEMETRY_PHYSICAL_RANGES.engineRpm.max,
        loadRate: TELEMETRY_PHYSICAL_RANGES.loadRate.min,
        engineHours: TELEMETRY_PHYSICAL_RANGES.engineHours.max,
        ambientTemperature: TELEMETRY_PHYSICAL_RANGES.ambientTemperature.min,
        latitude: TELEMETRY_PHYSICAL_RANGES.latitude.max,
        longitude: TELEMETRY_PHYSICAL_RANGES.longitude.min,
        speed: TELEMETRY_PHYSICAL_RANGES.speed.max,
      },
      sourceType: "SIMULATOR",
    },
    "2026-08-14T00:00:01.000Z",
  );

  assert.equal(result.qualityStatus, "VALID");
  assert.deepEqual(result.invalidFields, []);
});

test("quality rejects conservative default out of range values", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const { TELEMETRY_PHYSICAL_RANGES } = await import("../lib/telemetry/quality-ranges.ts");
  const result = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {
        engineCoolantTemperature: TELEMETRY_PHYSICAL_RANGES.engineCoolantTemperature.min - 1,
        engineOilTemperature: TELEMETRY_PHYSICAL_RANGES.engineOilTemperature.max + 1,
        engineRpm: 1400,
      },
      sourceType: "SIMULATOR",
    },
    "2026-08-14T00:00:01.000Z",
  );

  assert.equal(result.qualityStatus, "INVALID");
  assert.deepEqual(result.invalidFields.sort(), [
    "engineCoolantTemperature",
    "engineOilTemperature",
  ]);
});

test("quality returns invalid when timestamps are unparsable", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const result = normalizeRawTelemetry(
    {
      assetId: "P-01",
      observedAt: "not-a-date",
      values: {
        engineCoolantTemperature: 82,
        engineOilTemperature: 79,
      },
      sourceType: "FILE_REPLAY",
    },
    "2026-08-14T00:00:01.000Z",
  );

  assert.equal(result.qualityStatus, "INVALID");
  assert.ok(result.invalidFields.includes("observedAt"));
});

test("file replay reports stale source health after the last record", async () => {
  const { FileReplayAdapter } = await import("../lib/telemetry/file-replay.ts");
  const adapter = new FileReplayAdapter([
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {},
      sourceType: "FILE_REPLAY",
    },
  ]);

  await adapter.connect();
  await adapter.readBatch();
  const health = await adapter.health("2026-08-14T00:02:00.000Z");

  assert.equal(health.status, "STALE");
});

test("file replay health uses shared contract fields before any record is read", async () => {
  const { FileReplayAdapter } = await import("../lib/telemetry/file-replay.ts");
  const adapter = new FileReplayAdapter([
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: {},
      sourceType: "FILE_REPLAY",
    },
  ]);

  await adapter.connect();
  const health = await adapter.health("2026-08-14T00:00:10.000Z");

  assert.equal(health.status, "CONNECTED");
  assert.equal(health.lastObservedAt, null);
  assert.equal(health.lastReceivedAt, null);
  assert.equal(health.message, "Connected; no telemetry read yet.");
  assert.equal("lagMs" in health, false);
});

test("file replay health reports disconnected after close using shared contract", async () => {
  const { FileReplayAdapter } = await import("../lib/telemetry/file-replay.ts");
  const adapter = new FileReplayAdapter([]);

  await adapter.connect();
  await adapter.close();
  const health = await adapter.health("2026-08-14T00:00:10.000Z");

  assert.equal(health.status, "DISCONNECTED");
  assert.equal(health.lastObservedAt, null);
  assert.equal(health.lastReceivedAt, null);
  assert.equal(health.message, "Telemetry source is disconnected.");
});

test("file replay emits records in constructor order before exhaustion", async () => {
  const { FileReplayAdapter } = await import("../lib/telemetry/file-replay.ts");
  const adapter = new FileReplayAdapter([
    {
      assetId: "P-01",
      observedAt: "2026-08-14T00:00:00.000Z",
      values: { engineCoolantTemperature: 82 },
      sourceType: "FILE_REPLAY",
    },
    {
      assetId: "P-02",
      observedAt: "2026-08-14T00:00:30.000Z",
      values: { engineCoolantTemperature: 84 },
      sourceType: "FILE_REPLAY",
    },
  ]);

  await adapter.connect();

  const first = await adapter.readBatch();
  const second = await adapter.readBatch();
  const third = await adapter.readBatch();

  assert.equal(first[0]?.assetId, "P-01");
  assert.equal(second[0]?.assetId, "P-02");
  assert.deepEqual(third, []);
});

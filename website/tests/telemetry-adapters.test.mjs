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

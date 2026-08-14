import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRawTelemetry } from "../lib/telemetry/quality.ts";

function rawSnapshot({
  assetId = "P-01",
  observedAt,
  receivedAt = observedAt,
  coolant = 82,
  oil = 78,
  rpm = 1500,
  load = 0.45,
  ambient = 30,
  speed = 4,
} = {}) {
  return normalizeRawTelemetry({
    assetId,
    observedAt,
    sourceType: "FILE_REPLAY",
    values: {
      engineCoolantTemperature: coolant,
      engineOilTemperature: oil,
      engineRpm: rpm,
      loadRate: load,
      engineHours: 4218,
      ambientTemperature: ambient,
      latitude: 35.1,
      longitude: 129.1,
      speed,
    },
  }, receivedAt);
}

function validSnapshot({
  assetId = "P-01",
  observedAt = "2026-08-14T00:00:00.000Z",
  receivedAt = observedAt,
  coolant = 82,
  oil = 78,
  rpm = 1500,
  load = 0.45,
} = {}) {
  return rawSnapshot({ assetId, observedAt, receivedAt, coolant, oil, rpm, load });
}

function staleSnapshot() {
  return rawSnapshot({
    observedAt: "2026-08-14T00:08:00.000Z",
    receivedAt: "2026-08-14T00:10:01.000Z",
    coolant: 104,
    oil: 101,
    rpm: 2280,
    load: 0.92,
  });
}

function baselineFor(coolantMedian, overrides = {}) {
  return {
    assetId: "P-01",
    sampleCount: 24,
    coolant: { median: coolantMedian, upperBound: coolantMedian + 6, riseRatePerMinute: 2.5 },
    oil: { median: coolantMedian - 4, upperBound: coolantMedian + 2, riseRatePerMinute: 2.1 },
    peerMedian: { coolant: 82, oil: 78 },
    version: "baseline-v1",
    activeFrom: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function sustainedRisingHistory() {
  return [
    validSnapshot({ observedAt: "2026-08-14T00:07:00.000Z", coolant: 90, oil: 86, rpm: 2050, load: 0.84 }),
    validSnapshot({ observedAt: "2026-08-14T00:08:00.000Z", coolant: 95, oil: 91, rpm: 2140, load: 0.87 }),
    validSnapshot({ observedAt: "2026-08-14T00:09:00.000Z", coolant: 99, oil: 96, rpm: 2240, load: 0.9 }),
  ];
}

test("single temperature spike remains OBSERVE", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");
  const result = evaluateOverheatRisk({
    current: validSnapshot({ observedAt: "2026-08-14T00:01:00.000Z", coolant: 96, oil: 79, load: 0.5 }),
    history: [validSnapshot({ observedAt: "2026-08-14T00:00:00.000Z", coolant: 82, oil: 78, load: 0.5 })],
    peerSnapshots: [],
    baseline: baselineFor(82),
    now: "2026-08-14T00:01:00.000Z",
  });

  assert.equal(result.level, "OBSERVE");
  assert.equal(result.shouldNotifyMaintenance, false);
});

test("sustained multi-signal rise creates a maintenance alert", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");
  const result = evaluateOverheatRisk({
    current: validSnapshot({ observedAt: "2026-08-14T00:10:00.000Z", coolant: 103, oil: 101, rpm: 2310, load: 0.9 }),
    history: sustainedRisingHistory(),
    peerSnapshots: [validSnapshot({ assetId: "P-02", observedAt: "2026-08-14T00:10:00.000Z", coolant: 82, oil: 78, rpm: 1480, load: 0.4 })],
    baseline: baselineFor(82),
    now: "2026-08-14T00:10:00.000Z",
  });

  assert.equal(result.level, "MAINTENANCE_ALERT");
  assert.equal(result.shouldNotifyMaintenance, true);
  assert.ok(result.evidence.length >= 3);
});

test("stale data becomes DATA_ISSUE and cannot escalate", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");
  const result = evaluateOverheatRisk({
    current: staleSnapshot(),
    history: [],
    peerSnapshots: [],
    baseline: baselineFor(82),
    now: "2026-08-14T00:10:00.000Z",
  });

  assert.equal(result.level, "DATA_ISSUE");
  assert.equal(result.shouldNotifyMaintenance, false);
});

test("intermittent heat without a trailing streak stays below CAUTION", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");

  const result = evaluateOverheatRisk({
    current: validSnapshot({ observedAt: "2026-08-14T00:10:00.000Z", coolant: 100, oil: 99, rpm: 2260, load: 0.88 }),
    history: [
      validSnapshot({ observedAt: "2026-08-14T00:07:00.000Z", coolant: 95, oil: 92, rpm: 2100, load: 0.84 }),
      validSnapshot({ observedAt: "2026-08-14T00:08:00.000Z", coolant: 84, oil: 79, rpm: 1520, load: 0.45 }),
      validSnapshot({ observedAt: "2026-08-14T00:09:00.000Z", coolant: 98, oil: 96, rpm: 2210, load: 0.87 }),
    ],
    peerSnapshots: [validSnapshot({ assetId: "P-02", observedAt: "2026-08-14T00:10:00.000Z", coolant: 82, oil: 78, rpm: 1460, load: 0.38 })],
    baseline: baselineFor(82),
    now: "2026-08-14T00:10:00.000Z",
  });

  assert.notEqual(result.level, "CAUTION");
  assert.notEqual(result.level, "MAINTENANCE_ALERT");
  assert.equal(result.shouldNotifyMaintenance, false);
});

test("baseline builder excludes elevated and non-valid samples from the profile", async () => {
  const { buildBaselineProfile } = await import("../lib/risk/baseline.ts");

  const normalSamples = Array.from({ length: 20 }, (_, index) => validSnapshot({
    observedAt: `2026-08-13T00:${String(index).padStart(2, "0")}:00.000Z`,
    coolant: 80 + (index % 3),
    oil: 76 + (index % 3),
    rpm: 1450 + index,
    load: 0.42 + ((index % 4) * 0.02),
  }));
  const partialSample = {
    ...validSnapshot({ observedAt: "2026-08-13T00:30:00.000Z", coolant: 81, oil: 77 }),
    qualityStatus: "PARTIAL",
    missingFields: ["loadRate"],
  };
  const elevatedSample = validSnapshot({ observedAt: "2026-08-13T00:31:00.000Z", coolant: 99, oil: 97, load: 0.9, rpm: 2250 });
  const peerSamples = [
    validSnapshot({ assetId: "P-02", observedAt: "2026-08-13T00:00:00.000Z", coolant: 83, oil: 79 }),
    validSnapshot({ assetId: "P-03", observedAt: "2026-08-13T00:01:00.000Z", coolant: 81, oil: 77 }),
  ];

  const baseline = buildBaselineProfile("P-01", [...normalSamples, partialSample, elevatedSample], peerSamples, "2026-08-14T00:00:00.000Z");

  assert.equal(baseline.sampleCount, 20);
  assert.equal(baseline.coolant.median, 81);
  assert.equal(baseline.oil.median, 77);
  assert.equal(baseline.peerMedian.coolant, 82);
  assert.equal(baseline.peerMedian.oil, 78);
});

test("baseline builder excludes explicitly cautioned samples even below fallback heat thresholds", async () => {
  const { buildBaselineProfile } = await import("../lib/risk/baseline.ts");

  const coolNormalSamples = Array.from({ length: 19 }, (_, index) => validSnapshot({
    observedAt: `2026-08-13T01:${String(index).padStart(2, "0")}:00.000Z`,
    coolant: 80,
    oil: 76,
    rpm: 1450,
    load: 0.4,
  }));
  const labeledCautionSample = validSnapshot({
    observedAt: "2026-08-13T01:30:00.000Z",
    coolant: 83,
    oil: 79,
    rpm: 1500,
    load: 0.45,
  });

  const baseline = buildBaselineProfile(
    "P-01",
    [...coolNormalSamples, labeledCautionSample],
    [],
    "2026-08-14T00:00:00.000Z",
    [{ assetId: "P-01", observedAt: "2026-08-13T01:30:00.000Z", level: "CAUTION" }],
  );

  assert.equal(baseline.sampleCount, 19);
  assert.equal(baseline.coolant.median, 80);
  assert.equal(baseline.oil.median, 76);
});

test("low-confidence baselines cannot escalate to maintenance alert", async () => {
  const { evaluateOverheatRisk } = await import("../lib/risk/overheat-evaluator.ts");

  const result = evaluateOverheatRisk({
    current: validSnapshot({ observedAt: "2026-08-14T00:10:00.000Z", coolant: 103, oil: 101, rpm: 2310, load: 0.9 }),
    history: sustainedRisingHistory(),
    peerSnapshots: [validSnapshot({ assetId: "P-02", observedAt: "2026-08-14T00:10:00.000Z", coolant: 82, oil: 78, rpm: 1480, load: 0.4 })],
    baseline: baselineFor(82, { sampleCount: 12 }),
    now: "2026-08-14T00:10:00.000Z",
  });

  assert.equal(result.level, "OBSERVE");
  assert.equal(result.shouldNotifyMaintenance, false);
});

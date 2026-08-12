import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDiagnostic } from "../lib/diagnostics/evaluator.ts";

const snapshot = (overrides = {}) => ({
  forkliftId: "P-01호",
  timestamp: "2026-08-12T06:00:00.000Z",
  battery: 86,
  coolantTemperature: 72,
  engineOilTemperature: 68,
  vibrationRms: 1.8,
  mode: "DUMMY",
  connected: true,
  ...overrides,
});

test("normal learned profile produces a normal recommendation", () => {
  const report = evaluateDiagnostic(snapshot());
  assert.equal(report.level, "정상");
  assert.equal(report.score, 0);
  assert.match(report.recommendation, /정기 점검/);
});

test("combined thermal and vibration inputs escalate to urgent", () => {
  const report = evaluateDiagnostic(snapshot({ battery: 18, coolantTemperature: 104, engineOilTemperature: 109, vibrationRms: 7.2 }));
  assert.equal(report.level, "긴급");
  assert.ok(report.score >= 70);
  assert.match(report.findings.join(" "), /복합 위험/);
  assert.match(report.recommendation, /운행을 중지/);
});

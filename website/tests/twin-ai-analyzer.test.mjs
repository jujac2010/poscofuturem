import test from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, analyzeIncident, buildFleetReport, summarizeDrivingRecords } from "../lib/twin-ai/analyzer.ts";

const forklifts = [
  { id: "P-01호", zone: "원료 야드", task: "원료 이송", status: "정상" },
  { id: "P-04호", zone: "정비구역", task: "긴급 점검 대기", status: "점검" },
];
const snapshots = {};
const diagnostics = {
  "P-01호": { level: "정상", score: 0, confidence: 95, findings: ["정상 프로필"], recommendation: "정기 점검", priority: "정기 점검", summary: "센서값 안정", evaluatedAt: "2026-08-13T00:00:00.000Z" },
  "P-04호": { level: "긴급", score: 100, confidence: 99, findings: ["냉각수 온도 104°C", "진동 RMS 7.2 mm/s"], recommendation: "운행 중지 후 점검", priority: "즉시 조치", summary: "복합 이상 감지", evaluatedAt: "2026-08-13T00:00:00.000Z" },
};
const records = [["10:00:02", "P-04호", "정비구역", "점검", "점검", "10 m"], ["09:59:02", "P-01호", "원료 야드", "이송", "정상", "42 m"]];
const events = [{ time: "10:00:02", label: "P-04호", text: "이상 감지", tone: "critical" }];
const context = { forklifts, snapshots, diagnostics, records, events };

test("finds the highest-risk forklift from live diagnostics", () => {
  const result = buildFleetReport(forklifts, snapshots, records, events, diagnostics);
  assert.equal(result.highestRiskForklift, "P-04호");
  assert.equal(result.highestRiskScore, 100);
});

test("answers the highest-risk natural-language question", () => {
  const result = answerQuestion("현재 가장 위험한 장비는?", context);
  assert.match(result.answer, /P-04호/);
});

test("creates an incident cause analysis and record summary", () => {
  const incident = analyzeIncident(forklifts[1], diagnostics["P-04호"]);
  assert.match(incident.answer, /온도|진동/);
  assert.ok(incident.actions.length > 0);
  assert.match(summarizeDrivingRecords(records, forklifts, events).answer, /2건/);
});

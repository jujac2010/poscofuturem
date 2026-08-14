import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyMaintenanceAction, maintenanceDisplayStatus, maintenanceStatusView } from "../lib/maintenance/ui-state.ts";

const appRoot = new URL("../app/", import.meta.url);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function source(name) {
  return readFile(new URL(name, appRoot), "utf8");
}

test("maintenance UI is split into queue, detail, and data quality components", async () => {
  const [queue, detail, quality] = await Promise.all([
    source("maintenance-queue.tsx"),
    source("forklift-detail.tsx"),
    source("data-quality-panel.tsx"),
  ]);

  assert.match(queue, /MaintenanceQueueProps/);
  assert.match(queue, /onSelect/);
  assert.match(detail, /ForkliftDetailProps/);
  assert.match(detail, /onSubmitAction/);
  assert.match(quality, /DataQualityPanelProps/);
  assert.match(quality, /SourceHealth/);
});

test("maintenance UI exposes textual evidence and every action state", async () => {
  const sourceText = await Promise.all([
    source("maintenance-queue.tsx"),
    source("forklift-detail.tsx"),
    source("data-quality-panel.tsx"),
    source("page.tsx"),
  ]).then((parts) => parts.join("\n"));

  for (const copy of ["정비 경보", "향후 48시간 내 과열 위험 관찰 구간", "경보 근거", "점검 결과 기록", "데이터 수신 상태"]) {
    assert.match(sourceText, new RegExp(copy));
  }
  for (const status of ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "COMPLETED"]) {
    assert.match(sourceText, new RegExp(status));
  }
  assert.match(sourceText, /pending/);
  assert.match(sourceText, /role="alert"/);
  assert.match(sourceText, /setSelectedAlertId/);
});

test("maintenance action flow posts once, reports errors inline, and retains the alert", async () => {
  const detail = await source("forklift-detail.tsx");
  const page = await source("page.tsx");

  assert.match(detail, /fetch\([\s\S]*\/api\/maintenance/);
  assert.match(detail, /disabled=\{pending\}/);
  assert.match(detail, /setError/);
  assert.match(page, /selectedAlertId/);
  assert.match(page, /setSelectedAlertId\(id\)/);
  assert.match(page, /onSubmitAction/);
});

test("rendered queue and detail share the mapped status after an action outcome", async () => {
  const assessment = {
    id: "risk-1",
    siteId: "site-01",
    assetId: "FL-04",
    level: "MAINTENANCE_ALERT",
    score: 86,
    confidence: 82,
    evidence: ["sustained heat"],
    observedWindow: "48h",
    shouldNotifyMaintenance: true,
    reasonKey: "sustained_multi_signal_overheat",
    assessedAt: "2026-08-14T00:10:00.000Z",
    status: "OPEN",
    createdAt: "2026-08-14T00:10:00.000Z",
    updatedAt: "2026-08-14T00:10:00.000Z",
  };
  const updated = applyMaintenanceAction([assessment], { riskAssessmentId: assessment.id }, "IN_PROGRESS");
  const visibleQueueStatus = maintenanceDisplayStatus(updated[0]);
  const visibleDetailStatus = maintenanceDisplayStatus(updated[0]);

  assert.equal(updated[0].status, "ACKNOWLEDGED");
  assert.equal(updated[0].maintenanceStatus, "IN_PROGRESS");
  assert.equal(visibleQueueStatus, "IN_PROGRESS");
  assert.equal(visibleDetailStatus, "IN_PROGRESS");
});

test("all maintenance action outcomes map to contract-safe risk state and visible status", () => {
  const assessment = {
    id: "risk-statuses",
    siteId: "site-01",
    assetId: "FL-04",
    level: "MAINTENANCE_ALERT",
    score: 86,
    confidence: 82,
    evidence: ["sustained heat"],
    observedWindow: "48h",
    shouldNotifyMaintenance: true,
    reasonKey: "sustained_multi_signal_overheat",
    assessedAt: "2026-08-14T00:10:00.000Z",
    status: "OPEN",
    createdAt: "2026-08-14T00:10:00.000Z",
    updatedAt: "2026-08-14T00:10:00.000Z",
  };
  const expectedRiskStatus = { ACKNOWLEDGED: "ACKNOWLEDGED", IN_PROGRESS: "ACKNOWLEDGED", COMPLETED: "COMPLETED" };

  for (const actionStatus of Object.keys(expectedRiskStatus)) {
    const updated = applyMaintenanceAction([assessment], { riskAssessmentId: assessment.id }, actionStatus);
    const rendered = maintenanceStatusView(updated[0]);
    assert.equal(updated[0].status, expectedRiskStatus[actionStatus]);
    assert.equal(updated[0].maintenanceStatus, actionStatus);
    assert.equal(rendered.label, actionStatus);
    assert.equal(rendered.className, `action-status action-${actionStatus}`);
  }
});

test("built dashboard renders the selected queue and detail status together", async () => {
  workerUrl.searchParams.set("maintenance-ui", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  const html = await response.text();
  assert.match(html, /maintenance-queue panel[\s\S]*action-status action-OPEN/);
  assert.match(html, /forklift-detail panel[\s\S]*action-status action-OPEN/);
});

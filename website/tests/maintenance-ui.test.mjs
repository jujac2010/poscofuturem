import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../app/", import.meta.url);

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

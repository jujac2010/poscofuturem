import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

test("renders Twin AI analysis controls", async () => {
  workerUrl.searchParams.set("twin-ai-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  const html = await response.text();
  assert.match(html, /Twin AI 분석 결과/);
  assert.match(html, /현재 가장 위험한 장비는\?/);
  assert.match(html, /운행기록 요약/);
  assert.match(html, /전체 분석결과 생성/);
  assert.match(html, /정비 권고/);
});

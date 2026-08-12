import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function render() {
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the forklift digital twin dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /포스코퓨처엠 지게차 디지털 트윈 및 실시간 시뮬레이션/);
  for (const forklift of ["P-01호", "P-02호", "P-03호", "P-04호", "P-05호"]) {
    assert.match(html, new RegExp(forklift));
  }
  assert.match(html, /실시간 이동 시뮬레이션/);
  assert.match(html, /data-moving="true"/);
  assert.match(html, /Twin AI/);
  assert.match(html, /랜덤 이상상황/);
  assert.doesNotMatch(html, /시뮬레이션 타이머/);
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /실시간 시뮬레이션/);
  assert.match(html, /랜덤 이상상황/);
  assert.match(html, /최근 센서 추이/);
  assert.doesNotMatch(html, /두산|Doosan/i);
});

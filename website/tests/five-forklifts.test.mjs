import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("운행 대상은 P-01호부터 P-05호까지 정확히 5대다", () => {
  const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const id of ["P-01호", "P-02호", "P-03호", "P-04호", "P-05호"]) assert.match(source, new RegExp(id));
  assert.doesNotMatch(source, /FL-0[1-9]|P-06호/);
  assert.match(source, /5대 운행/);
});

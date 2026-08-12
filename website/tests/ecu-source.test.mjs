import assert from "node:assert/strict";
import test from "node:test";

test("DUMMY source returns stable, bounded ECU snapshots", async () => {
  const { DummyEcuSource } = await import("../lib/ecu/dummy-source.ts");
  const source = new DummyEcuSource();
  const first = await source.read("P-01호");
  const second = await source.read("P-01호");
  assert.equal(first.mode, "DUMMY");
  assert.equal(first.connected, true);
  assert.ok(Math.abs(second.coolantTemperature - first.coolantTemperature) < 8);
  assert.ok(second.vibrationRms >= 0.8 && second.vibrationRms <= 4.5);
  assert.match(first.timestamp, /T/);
});

test("REAL source exposes an explicit integration stub", async () => {
  const { RealEcuSource } = await import("../lib/ecu/real-source.ts");
  await assert.rejects(() => new RealEcuSource().read("P-01호"), /REAL_ECU_NOT_CONNECTED/);
});

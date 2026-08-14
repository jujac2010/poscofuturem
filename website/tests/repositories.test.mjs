import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createTelemetrySnapshot } from "../lib/telemetry/contracts.ts";

function snapshot({
  assetId = "FL-01",
  observedAt,
  receivedAt = observedAt,
  coolant = 82,
  oil = 78,
  rpm = 1500,
  load = 0.45,
  engineHours = 4200,
  payloadHash,
} = {}) {
  return createTelemetrySnapshot({
    assetId,
    observedAt,
    receivedAt,
    engineCoolantTemperature: coolant,
    engineOilTemperature: oil,
    engineRpm: rpm,
    loadRate: load,
    engineHours,
    ambientTemperature: 31,
    latitude: 35.1,
    longitude: 129.1,
    speed: 4,
    sourceType: "FILE_REPLAY",
    payloadHash,
  });
}

function assessment({
  assetId = "FL-01",
  level = "MAINTENANCE_ALERT",
  score = 88,
  confidence = 94,
  reasonKey = "PRECISION_MULTI_SIGNAL_ALERT",
  assessedAt = "2026-08-14T00:10:00.000Z",
  evidence = ["Persistent hot readings across three observations."],
  shouldNotifyMaintenance = true,
} = {}) {
  return {
    assetId,
    level,
    score,
    confidence,
    evidence,
    observedWindow: "48h",
    shouldNotifyMaintenance,
    reasonKey,
    assessedAt,
  };
}

class FakeD1Statement {
  constructor(database, query) {
    this.database = database;
    this.query = query;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    return this.database.run(this.query, this.values);
  }

  async first() {
    return this.database.first(this.query, this.values);
  }

  async all() {
    return { results: await this.database.all(this.query, this.values) };
  }
}

class FakeD1Database {
  constructor() {
    this.prepared = [];
    this.tables = {
      telemetrySnapshots: new Map(),
      telemetryAggregates: new Map(),
      riskAssessments: new Map(),
      maintenanceActions: new Map(),
    };
  }

  prepare(query) {
    this.prepared.push(query);
    return new FakeD1Statement(this, query);
  }

  async run(query, values) {
    if (query.includes("insert into telemetrySnapshots")) {
      const row = {
        id: values[0],
        payload_hash: values[1],
        asset_id: values[2],
        observed_at: values[3],
        received_at: values[4],
        engine_coolant_temperature: values[5],
        engine_oil_temperature: values[6],
        engine_rpm: values[7],
        load_rate: values[8],
        engine_hours: values[9],
        ambient_temperature: values[10],
        latitude: values[11],
        longitude: values[12],
        speed: values[13],
        source_type: values[14],
        quality_status: values[15],
        missing_fields_json: values[16],
        invalid_fields_json: values[17],
      };
      this.tables.telemetrySnapshots.set(row.payload_hash, row);
      return { success: true };
    }

    if (query.includes("insert into telemetryAggregates")) {
      const row = {
        id: values[0],
        payload_hash: values[1],
        asset_id: values[2],
        window_start: values[3],
        window_seconds: values[4],
        sample_count: values[5],
        coolant_temperature_avg: values[6],
        coolant_temperature_max: values[7],
        oil_temperature_avg: values[8],
        oil_temperature_max: values[9],
        load_rate_avg: values[10],
        engine_rpm_avg: values[11],
        quality_status: values[12],
      };
      this.tables.telemetryAggregates.set(row.payload_hash, row);
      return { success: true };
    }

    if (query.includes("insert into riskAssessments")) {
      const existing = this.tables.riskAssessments.get(values[1]);
      const row = existing
        ? {
          ...existing,
          level: values[4],
          score: values[5],
          confidence: values[6],
          evidence_json: values[7],
          observed_window: values[8],
          should_notify_maintenance: values[9],
          reason_key: values[10],
          assessed_at: values[11],
          status: "OPEN",
          updated_at: values[14],
        }
        : {
          id: values[0],
          dedup_key: values[1],
          site_id: values[2],
          asset_id: values[3],
          level: values[4],
          score: values[5],
          confidence: values[6],
          evidence_json: values[7],
          observed_window: values[8],
          should_notify_maintenance: values[9],
          reason_key: values[10],
          assessed_at: values[11],
          status: values[12],
          created_at: values[13],
          updated_at: values[14],
        };
      this.tables.riskAssessments.set(row.dedup_key, row);
      return { success: true };
    }

    if (query.includes("insert into maintenanceActions")) {
      const row = {
        id: values[0],
        site_id: values[1],
        asset_id: values[2],
        risk_assessment_id: values[3],
        assignee: values[4],
        note: values[5],
        status: values[6],
        inspection_note: values[7],
        action_taken: values[8],
        parts_replaced_json: values[9],
        can_return_to_service: values[10],
        actual_overheat_label: values[11],
        created_at: values[12],
        completed_at: values[13],
      };
      this.tables.maintenanceActions.set(row.id, row);
      return { success: true };
    }

    if (query.includes("update maintenanceActions")) {
      const row = this.tables.maintenanceActions.get(values[7]);
      if (!row) {
        throw new Error(`Unknown maintenance action ${values[7]}`);
      }

      this.tables.maintenanceActions.set(values[7], {
        ...row,
        status: values[0],
        inspection_note: values[1],
        action_taken: values[2],
        parts_replaced_json: values[3],
        can_return_to_service: values[4],
        actual_overheat_label: values[5],
        completed_at: values[6],
      });
      return { success: true };
    }

    throw new Error(`Unsupported run query: ${query}`);
  }

  async first(query, values) {
    if (query.includes("from riskAssessments") && query.includes("where dedup_key = ?")) {
      return this.tables.riskAssessments.get(values[0]) ?? null;
    }

    if (query.includes("from maintenanceActions") && query.includes("where id = ?")) {
      return this.tables.maintenanceActions.get(values[0]) ?? null;
    }

    throw new Error(`Unsupported first query: ${query}`);
  }

  async all(query, values) {
    if (query.includes("from telemetrySnapshots")) {
      const [assetId, limit] = values;
      return [...this.tables.telemetrySnapshots.values()]
        .filter((row) => row.asset_id === assetId)
        .sort((left, right) => right.observed_at.localeCompare(left.observed_at))
        .slice(0, limit);
    }

    if (query.includes("from riskAssessments")) {
      const [siteId] = values;
      return [...this.tables.riskAssessments.values()]
        .filter((row) => row.site_id === siteId && row.status === "OPEN")
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    }

    throw new Error(`Unsupported all query: ${query}`);
  }
}

test("repository telemetry keeps most recent snapshots first and respects limits", async () => {
  const { createInMemoryTelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const repository = createInMemoryTelemetryRepository();

  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:00:00.000Z",
    coolant: 80,
    oil: 76,
  }));
  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:02:00.000Z",
    coolant: 84,
    oil: 81,
  }));
  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:01:00.000Z",
    coolant: 82,
    oil: 79,
  }));
  await repository.insertAggregate({
    assetId: "FL-01",
    windowStart: "2026-08-14T00:00:00.000Z",
    windowSeconds: 60,
    sampleCount: 3,
    coolantTemperatureAvg: 82,
    coolantTemperatureMax: 84,
    oilTemperatureAvg: 78.7,
    oilTemperatureMax: 81,
    loadRateAvg: 0.5,
    engineRpmAvg: 1520,
    qualityStatus: "VALID",
  });

  const recent = await repository.listRecent("FL-01", 2);

  assert.equal(recent.length, 2);
  assert.deepEqual(
    recent.map((entry) => entry.observedAt),
    ["2026-08-14T00:02:00.000Z", "2026-08-14T00:01:00.000Z"],
  );
});

test("repository telemetry preserves upstream payload hashes for normalized snapshots", async () => {
  const { normalizeRawTelemetry } = await import("../lib/telemetry/quality.ts");
  const { createInMemoryTelemetryRepository, createInMemoryTelemetryStore } = await import("../lib/telemetry/repository.ts");
  const store = createInMemoryTelemetryStore();
  const repository = createInMemoryTelemetryRepository(store);

  const first = normalizeRawTelemetry({
    assetId: "FL-01",
    observedAt: "2026-08-14T00:00:00.000Z",
    sourceType: "MQTT",
    payloadHash: "raw-hash-001",
    values: {
      engineCoolantTemperature: 81,
      engineOilTemperature: 77,
      engineRpm: 1490,
      loadRate: 0.44,
      engineHours: 4200,
      ambientTemperature: 30,
      latitude: 35.1,
      longitude: 129.1,
      speed: 4,
    },
  }, "2026-08-14T00:00:01.000Z");
  const second = normalizeRawTelemetry({
    assetId: "FL-01",
    observedAt: "2026-08-14T00:00:02.000Z",
    sourceType: "MQTT",
    payloadHash: "raw-hash-001",
    values: {
      engineCoolantTemperature: 92,
      engineOilTemperature: 88,
      engineRpm: 1800,
      loadRate: 0.72,
      engineHours: 4201,
      ambientTemperature: 31,
      latitude: 35.2,
      longitude: 129.2,
      speed: 5,
    },
  }, "2026-08-14T00:00:03.000Z");

  assert.equal(first.payloadHash, "raw-hash-001");

  await repository.insertSnapshot(first);
  await repository.insertSnapshot(second);

  assert.equal(store.snapshots.length, 1);
  assert.equal(store.snapshots[0].payloadHash, "raw-hash-001");
  assert.equal(store.snapshots[0].observedAt, "2026-08-14T00:00:02.000Z");
});

test("repository risk keeps one open assessment per site asset and reason", async () => {
  const { createInMemoryRiskRepository } = await import("../lib/risk/repository.ts");
  const repository = createInMemoryRiskRepository({ siteId: "site-01" });

  const first = await repository.openOrUpdateAssessment(assessment());
  const updated = await repository.openOrUpdateAssessment(assessment({
    score: 92,
    confidence: 97,
    assessedAt: "2026-08-14T00:12:00.000Z",
    evidence: ["Risk score increased while the reason stayed stable."],
  }));
  const otherReason = await repository.openOrUpdateAssessment(assessment({
    reasonKey: "PERSISTENT_MULTI_SIGNAL_CAUTION",
    level: "CAUTION",
    score: 68,
    confidence: 83,
    assessedAt: "2026-08-14T00:13:00.000Z",
    shouldNotifyMaintenance: false,
    evidence: ["Persistent heat remains below maintenance-alert threshold."],
  }));

  assert.equal(updated.id, first.id);
  assert.equal(updated.siteId, "site-01");
  assert.equal(updated.status, "OPEN");
  assert.equal(updated.score, 92);
  assert.equal(updated.updatedAt, "2026-08-14T00:12:00.000Z");
  assert.notEqual(otherReason.id, first.id);

  const open = await repository.listOpen("site-01");

  assert.equal(open.length, 2);
  assert.deepEqual(
    open.map((entry) => `${entry.assetId}:${entry.reasonKey}`),
    ["FL-01:PERSISTENT_MULTI_SIGNAL_CAUTION", "FL-01:PRECISION_MULTI_SIGNAL_ALERT"],
  );
});

test("repository maintenance completion round-trips actualOverheat labels", async () => {
  const {
    actualOverheatLabel,
    createInMemoryMaintenanceRepository,
  } = await import("../lib/maintenance/repository.ts");
  const timestamps = [
    "2026-08-14T00:20:00.000Z",
    "2026-08-14T00:31:00.000Z",
  ];
  const repository = createInMemoryMaintenanceRepository({
    now: () => timestamps.shift() ?? "2026-08-14T00:31:00.000Z",
  });

  const created = await repository.createAction({
    siteId: "site-01",
    assetId: "FL-01",
    riskAssessmentId: "risk-001",
    assignee: "tech.park",
    note: "Inspect cooling loop and fan clutch.",
  });

  assert.equal(created.completedAt, null);
  assert.equal(actualOverheatLabel(true), "CONFIRMED");
  assert.equal(actualOverheatLabel(false), "NOT_CONFIRMED");
  assert.equal(actualOverheatLabel(null), "UNKNOWN");

  const completed = await repository.completeAction(created.id, {
    status: "COMPLETED",
    inspectionNote: "Coolant line restriction found and cleared.",
    actionTaken: "Flushed line and replaced thermostat.",
    partsReplaced: ["thermostat"],
    canReturnToService: true,
    actualOverheat: true,
  });

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.actualOverheat, true);
  assert.equal(completed.createdAt, "2026-08-14T00:20:00.000Z");
  assert.equal(completed.completedAt, "2026-08-14T00:31:00.000Z");
});

test("repository D1 telemetry path upserts by upstream hash and round-trips JSON fields", async () => {
  const { createD1TelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const database = new FakeD1Database();
  const repository = createD1TelemetryRepository(database);

  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:00:00.000Z",
    receivedAt: "2026-08-14T00:00:02.000Z",
    coolant: 84,
    oil: 80,
    rpm: null,
    load: null,
    payloadHash: "raw-hash-telemetry",
  }));
  await repository.insertSnapshot(snapshot({
    observedAt: "2026-08-14T00:01:00.000Z",
    receivedAt: "2026-08-14T00:01:01.000Z",
    coolant: 85,
    oil: 81,
    rpm: null,
    load: null,
    payloadHash: "raw-hash-telemetry",
  }));

  const listed = await repository.listRecent("FL-01", 5);

  assert.equal(database.tables.telemetrySnapshots.size, 1);
  assert.equal(database.tables.telemetrySnapshots.get("raw-hash-telemetry").observed_at, "2026-08-14T00:01:00.000Z");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].payloadHash, "raw-hash-telemetry");
  assert.ok(listed[0].missingFields.includes("engineRpm"));
  assert.ok(listed[0].missingFields.includes("loadRate"));
  assert.deepEqual(listed[0].invalidFields, []);
});

test("repository D1 risk path upserts open assessments and round-trips evidence arrays", async () => {
  const { createD1RiskRepository } = await import("../lib/risk/repository.ts");
  const database = new FakeD1Database();
  const repository = createD1RiskRepository(database, { siteId: "site-01" });

  const first = await repository.openOrUpdateAssessment(assessment({
    evidence: ["Persistent hot readings.", "Peer deviation is elevated."],
  }));
  const updated = await repository.openOrUpdateAssessment(assessment({
    score: 96,
    confidence: 98,
    assessedAt: "2026-08-14T00:15:00.000Z",
    evidence: ["Persistent hot readings.", "Peer deviation is elevated.", "Thermal rise matches heavy load."],
  }));

  const open = await repository.listOpen("site-01");

  assert.equal(updated.id, first.id);
  assert.equal(open.length, 1);
  assert.deepEqual(open[0].evidence, [
    "Persistent hot readings.",
    "Peer deviation is elevated.",
    "Thermal rise matches heavy load.",
  ]);
});

test("repository D1 maintenance path converts actualOverheat labels and arrays", async () => {
  const { createD1MaintenanceRepository } = await import("../lib/maintenance/repository.ts");
  const database = new FakeD1Database();
  const timestamps = [
    "2026-08-14T00:20:00.000Z",
    "2026-08-14T00:28:00.000Z",
  ];
  const repository = createD1MaintenanceRepository(database, {
    now: () => timestamps.shift() ?? "2026-08-14T00:28:00.000Z",
  });

  const created = await repository.createAction({
    siteId: "site-01",
    assetId: "FL-01",
    riskAssessmentId: "risk-001",
    assignee: "tech.park",
    note: "Inspect radiator and fan.",
  });
  const completed = await repository.completeAction(created.id, {
    status: "COMPLETED",
    inspectionNote: "Confirmed overheat after blocked coolant line inspection.",
    actionTaken: "Cleared coolant line and replaced hose.",
    partsReplaced: ["coolant hose"],
    canReturnToService: true,
    actualOverheat: true,
  });

  assert.equal(database.tables.maintenanceActions.get(created.id).actual_overheat_label, "CONFIRMED");
  assert.deepEqual(completed.partsReplaced, ["coolant hose"]);
  assert.equal(completed.actualOverheat, true);
  assert.equal(completed.completedAt, "2026-08-14T00:28:00.000Z");
});

test("repository migration integrity keeps only the operational tables and required indexes", async () => {
  const migrationSql = await fs.readFile(new URL("../db/migrations/0000_engine_overheat_poc.sql", import.meta.url), "utf8");

  assert.match(migrationSql, /CREATE TABLE `telemetrySnapshots`/);
  assert.match(migrationSql, /CREATE TABLE `telemetryAggregates`/);
  assert.match(migrationSql, /CREATE TABLE `riskAssessments`/);
  assert.match(migrationSql, /CREATE TABLE `maintenanceActions`/);
  assert.match(migrationSql, /CREATE INDEX `telemetrySnapshots_asset_observed_idx`/);
  assert.match(migrationSql, /CREATE INDEX `riskAssessments_site_status_idx`/);
  assert.match(migrationSql, /CREATE INDEX `maintenanceActions_risk_assessment_idx`/);
  assert.match(migrationSql, /FOREIGN KEY \(`risk_assessment_id`\) REFERENCES `riskAssessments`\(`id`\)/);
  assert.doesNotMatch(migrationSql, /rawPayload/i);
});

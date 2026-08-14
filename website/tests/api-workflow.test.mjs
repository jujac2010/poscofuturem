import assert from "node:assert/strict";
import test from "node:test";

function makeSyntheticAlertBaseline(assetId) {
  return {
    assetId,
    sampleCount: 24,
    coolant: { median: 82, upperBound: 88, riseRatePerMinute: 2.5 },
    oil: { median: 78, upperBound: 84, riseRatePerMinute: 2.1 },
    peerMedian: { coolant: 82, oil: 78 },
    version: "baseline-v1",
    activeFrom: "2026-08-01T00:00:00.000Z",
  };
}

function makeTelemetryRecord({
  assetId = "FL-01",
  observedAt,
  coolant = 82,
  oil = 78,
  rpm = 1500,
  load = 0.45,
  payloadHash,
} = {}) {
  return {
    assetId,
    observedAt,
    sourceType: "FILE_REPLAY",
    payloadHash,
    values: {
      engineCoolantTemperature: coolant,
      engineOilTemperature: oil,
      engineRpm: rpm,
      loadRate: load,
      engineHours: 4200,
      ambientTemperature: 31,
      latitude: 35.1,
      longitude: 129.1,
      speed: 4,
    },
  };
}

function jsonRequest(url, body, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("workflow telemetry ingestion opens one deduplicated maintenance alert and completes the action", async (t) => {
  const { createInMemoryTelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const { createInMemoryRiskRepository, createInMemoryRiskStore } = await import("../lib/risk/repository.ts");
  const { createInMemoryMaintenanceRepository } = await import("../lib/maintenance/repository.ts");
  const { setWorkflowDependenciesForTests } = await import("../lib/telemetry/ingest.ts");
  const { POST: postTelemetry } = await import("../app/api/telemetry/route.ts");
  const { GET: getRisks } = await import("../app/api/risks/route.ts");
  const { POST: postMaintenance } = await import("../app/api/maintenance/route.ts");
  const { PATCH: patchMaintenance } = await import("../app/api/maintenance/[id]/route.ts");

  const riskStore = createInMemoryRiskStore();
  const nowValues = [
    "2026-08-14T00:00:01.000Z",
    "2026-08-14T00:08:01.000Z",
    "2026-08-14T00:09:01.000Z",
    "2026-08-14T00:10:01.000Z",
    "2026-08-14T00:11:01.000Z",
    "2026-08-14T00:12:00.000Z",
    "2026-08-14T00:20:10.000Z",
  ];
  const now = () => nowValues.shift() ?? "2026-08-14T00:20:10.000Z";

  setWorkflowDependenciesForTests({
    siteId: "site-01",
    assetIds: ["FL-01", "FL-02", "FL-03", "FL-04", "FL-05"],
    telemetryRepository: createInMemoryTelemetryRepository(),
    riskRepository: createInMemoryRiskRepository({ siteId: "site-01" }, riskStore),
    maintenanceRepository: createInMemoryMaintenanceRepository({ now }),
    now,
    buildBaseline: (assetId) => makeSyntheticAlertBaseline(assetId),
  });
  t.after(() => setWorkflowDependenciesForTests(null));

  const normalResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:00:00.000Z",
        payloadHash: "normal-001",
      }),
    ],
  }));

  assert.equal(normalResponse.status, 200);
  assert.deepEqual(await normalResponse.json(), {
    accepted: 1,
    rejected: 0,
    qualityIssues: [],
  });

  const emptyRiskResponse = await getRisks(new Request("http://localhost/api/risks?siteId=site-01&status=open"));
  const emptyRiskBody = await emptyRiskResponse.json();
  assert.equal(emptyRiskResponse.status, 200);
  assert.equal(emptyRiskBody.assessments.length, 0);

  const alertResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:08:00.000Z",
        coolant: 94,
        oil: 92,
        rpm: 2050,
        load: 0.84,
        payloadHash: "hot-001",
      }),
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:09:00.000Z",
        coolant: 99,
        oil: 97,
        rpm: 2180,
        load: 0.88,
        payloadHash: "hot-002",
      }),
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:10:00.000Z",
        coolant: 104,
        oil: 102,
        rpm: 2310,
        load: 0.92,
        payloadHash: "hot-003",
      }),
    ],
  }));

  assert.equal(alertResponse.status, 200);
  assert.deepEqual(await alertResponse.json(), {
    accepted: 3,
    rejected: 0,
    qualityIssues: [],
  });

  const firstOpenResponse = await getRisks(new Request("http://localhost/api/risks?siteId=site-01&status=open"));
  const firstOpenBody = await firstOpenResponse.json();
  assert.equal(firstOpenResponse.status, 200);
  assert.equal(firstOpenBody.assessments.length, 1);
  assert.equal(firstOpenBody.assessments[0].level, "MAINTENANCE_ALERT");
  assert.equal(firstOpenBody.assessments[0].status, "OPEN");
  assert.ok(firstOpenBody.assessments[0].evidence.length >= 3);

  const updateResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:11:00.000Z",
        coolant: 106,
        oil: 103,
        rpm: 2360,
        load: 0.94,
        payloadHash: "hot-004",
      }),
    ],
  }));

  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), {
    accepted: 1,
    rejected: 0,
    qualityIssues: [],
  });

  const updatedOpenResponse = await getRisks(new Request("http://localhost/api/risks?siteId=site-01&status=open"));
  const updatedOpenBody = await updatedOpenResponse.json();
  assert.equal(updatedOpenBody.assessments.length, 1);
  assert.equal(updatedOpenBody.assessments[0].id, firstOpenBody.assessments[0].id);
  assert.equal(updatedOpenBody.assessments[0].updatedAt, "2026-08-14T00:11:01.000Z");

  const actionResponse = await postMaintenance(jsonRequest("http://localhost/api/maintenance", {
    siteId: "site-01",
    assetId: "FL-01",
    riskAssessmentId: updatedOpenBody.assessments[0].id,
    assignee: "tech.park",
    note: "Inspect radiator, thermostat, and coolant path.",
  }));

  assert.equal(actionResponse.status, 201);
  const action = await actionResponse.json();
  assert.equal(action.status, "ACKNOWLEDGED");
  assert.equal(action.actualOverheat, null);

  const completionResponse = await patchMaintenance(
    jsonRequest("http://localhost/api/maintenance/" + action.id, {
      status: "COMPLETED",
      inspectionNote: "Blocked coolant line confirmed during teardown.",
      actionTaken: "Cleared line and replaced thermostat.",
      partsReplaced: ["thermostat"],
      canReturnToService: true,
      actualOverheat: true,
    }, "PATCH"),
    { params: Promise.resolve({ id: action.id }) },
  );

  assert.equal(completionResponse.status, 200);
  const completed = await completionResponse.json();
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.actualOverheat, true);
  assert.equal(completed.canReturnToService, true);
  assert.ok(completed.completedAt);

  const staleResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:18:00.000Z",
        coolant: 108,
        oil: 105,
        rpm: 2380,
        load: 0.95,
        payloadHash: "stale-001",
      }),
    ],
  }));

  assert.equal(staleResponse.status, 200);
  const staleBody = await staleResponse.json();
  assert.equal(staleBody.accepted, 0);
  assert.equal(staleBody.rejected, 1);
  assert.equal(staleBody.qualityIssues.length, 1);
  assert.equal(staleBody.qualityIssues[0].status, "STALE");
  assert.match(staleBody.qualityIssues[0].message, /risk escalation is suppressed/i);

  const finalRiskResponse = await getRisks(new Request("http://localhost/api/risks?siteId=site-01&status=open"));
  const finalRiskBody = await finalRiskResponse.json();
  assert.equal(finalRiskBody.assessments.length, 1);
  assert.equal(finalRiskBody.assessments[0].id, firstOpenBody.assessments[0].id);
});

test("workflow ingestion does not escalate to maintenance alert without actual baseline history", async (t) => {
  const { createInMemoryTelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const { createInMemoryRiskRepository, createInMemoryRiskStore } = await import("../lib/risk/repository.ts");
  const { createInMemoryMaintenanceRepository } = await import("../lib/maintenance/repository.ts");
  const { setWorkflowDependenciesForTests } = await import("../lib/telemetry/ingest.ts");
  const { POST: postTelemetry } = await import("../app/api/telemetry/route.ts");
  const { GET: getRisks } = await import("../app/api/risks/route.ts");

  const riskStore = createInMemoryRiskStore();

  setWorkflowDependenciesForTests({
    siteId: "site-01",
    assetIds: ["FL-01", "FL-02", "FL-03", "FL-04", "FL-05"],
    telemetryRepository: createInMemoryTelemetryRepository(),
    riskRepository: createInMemoryRiskRepository({ siteId: "site-01" }, riskStore),
    maintenanceRepository: createInMemoryMaintenanceRepository({
      now: () => "2026-08-14T00:00:00.000Z",
    }),
    now: (() => {
      const values = [
        "2026-08-14T00:08:01.000Z",
        "2026-08-14T00:09:01.000Z",
        "2026-08-14T00:10:01.000Z",
      ];
      return () => values.shift() ?? "2026-08-14T00:10:01.000Z";
    })(),
  });
  t.after(() => setWorkflowDependenciesForTests(null));

  const hotSequenceResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:08:00.000Z",
        coolant: 94,
        oil: 92,
        rpm: 2050,
        load: 0.84,
        payloadHash: "history-hot-001",
      }),
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:09:00.000Z",
        coolant: 99,
        oil: 97,
        rpm: 2180,
        load: 0.88,
        payloadHash: "history-hot-002",
      }),
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:10:00.000Z",
        coolant: 104,
        oil: 102,
        rpm: 2310,
        load: 0.92,
        payloadHash: "history-hot-003",
      }),
    ],
  }));

  assert.equal(hotSequenceResponse.status, 200);
  assert.deepEqual(await hotSequenceResponse.json(), {
    accepted: 3,
    rejected: 0,
    qualityIssues: [],
  });

  const riskResponse = await getRisks(new Request("http://localhost/api/risks?siteId=site-01&status=open"));
  const riskBody = await riskResponse.json();
  assert.equal(riskResponse.status, 200);
  assert.equal(riskBody.assessments.length, 0);
  assert.equal(riskStore.assessments.length, 0);
});

test("workflow routes validate malformed requests and map persistence failures to safe responses", async (t) => {
  const { createInMemoryTelemetryRepository } = await import("../lib/telemetry/repository.ts");
  const { createInMemoryRiskRepository } = await import("../lib/risk/repository.ts");
  const { createInMemoryMaintenanceRepository } = await import("../lib/maintenance/repository.ts");
  const { setWorkflowDependenciesForTests } = await import("../lib/telemetry/ingest.ts");
  const { POST: postTelemetry } = await import("../app/api/telemetry/route.ts");
  const { GET: getRisks } = await import("../app/api/risks/route.ts");
  const { POST: postMaintenance } = await import("../app/api/maintenance/route.ts");
  const { PATCH: patchMaintenance } = await import("../app/api/maintenance/[id]/route.ts");

  setWorkflowDependenciesForTests({
    siteId: "site-01",
    assetIds: ["FL-01", "FL-02", "FL-03", "FL-04", "FL-05"],
    telemetryRepository: createInMemoryTelemetryRepository(),
    riskRepository: createInMemoryRiskRepository({ siteId: "site-01" }),
    maintenanceRepository: createInMemoryMaintenanceRepository({
      now: () => "2026-08-14T00:00:00.000Z",
    }),
    now: () => "2026-08-14T00:00:00.000Z",
  });
  t.after(() => setWorkflowDependenciesForTests(null));

  const unknownAssetResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        assetId: "FL-99",
        observedAt: "2026-08-14T00:00:00.000Z",
      }),
    ],
  }));
  assert.equal(unknownAssetResponse.status, 400);

  const missingSiteResponse = await getRisks(new Request("http://localhost/api/risks?status=open"));
  assert.equal(missingSiteResponse.status, 400);

  const maintenanceUnknownAssetResponse = await postMaintenance(jsonRequest("http://localhost/api/maintenance", {
    siteId: "site-01",
    assetId: "FL-99",
    riskAssessmentId: "risk-001",
    assignee: "tech.park",
    note: "Inspect thermal system.",
  }));
  assert.equal(maintenanceUnknownAssetResponse.status, 400);

  const missingActionResponse = await patchMaintenance(
    jsonRequest("http://localhost/api/maintenance/missing-action", {
      status: "COMPLETED",
      inspectionNote: "No action exists for this id.",
      actionTaken: "None.",
      partsReplaced: [],
      canReturnToService: false,
      actualOverheat: null,
    }, "PATCH"),
    { params: Promise.resolve({ id: "missing-action" }) },
  );
  assert.equal(missingActionResponse.status, 404);

  setWorkflowDependenciesForTests(null);
  const unavailableResponse = await getRisks(new Request("http://localhost/api/risks?siteId=site-01&status=open"));
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), { error: "Persistence temporarily unavailable." });

  setWorkflowDependenciesForTests({
    siteId: "site-01",
    assetIds: ["FL-01", "FL-02", "FL-03", "FL-04", "FL-05"],
    telemetryRepository: {
      async insertSnapshot() {
        throw new Error("db password leaked");
      },
      async insertAggregate() {},
      async listRecent() {
        return [];
      },
    },
    riskRepository: createInMemoryRiskRepository({ siteId: "site-01" }),
    maintenanceRepository: createInMemoryMaintenanceRepository({
      now: () => "2026-08-14T00:00:00.000Z",
    }),
    now: () => "2026-08-14T00:00:01.000Z",
  });

  const hiddenFailureResponse = await postTelemetry(jsonRequest("http://localhost/api/telemetry", {
    records: [
      makeTelemetryRecord({
        observedAt: "2026-08-14T00:00:00.000Z",
        payloadHash: "hidden-failure-001",
      }),
    ],
  }));
  assert.equal(hiddenFailureResponse.status, 503);
  assert.deepEqual(await hiddenFailureResponse.json(), { error: "Persistence temporarily unavailable." });
});

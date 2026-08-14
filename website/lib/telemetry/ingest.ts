import { buildBaselineProfile, type BaselineProfile } from "../risk/baseline.ts";
import { evaluateOverheatRisk } from "../risk/overheat-evaluator.ts";
import type { MaintenanceAction, MaintenanceOutcome, CreateMaintenanceAction } from "../maintenance/contracts.ts";
import type { MaintenanceRepository } from "../maintenance/repository.ts";
import type { RiskAssessmentRecord, RiskRepository } from "../risk/repository.ts";
import { createTelemetrySnapshot, type DataQuality, type RawTelemetry, type TelemetryAggregate, type TelemetrySnapshot } from "./contracts.ts";
import type { TelemetryRepository } from "./repository.ts";
import { normalizeRawTelemetry } from "./quality.ts";
import { parseTimestamp } from "./adapters.ts";

export const DEFAULT_SITE_ID = "site-01";
export const DEFAULT_ASSET_IDS = ["FL-01", "FL-02", "FL-03", "FL-04", "FL-05"] as const;

const VALID_SOURCE_TYPES = new Set(["SIMULATOR", "FILE_REPLAY", "CAN", "MQTT", "OPC_UA", "REST"]);
const VALID_MAINTENANCE_STATUSES = new Set(["ACKNOWLEDGED", "IN_PROGRESS", "COMPLETED"]);
const HISTORY_LIMIT = 60;
const DEFAULT_NOW = () => new Date().toISOString();

export class PersistenceUnavailableError extends Error {
  constructor(message = "Operational persistence is unavailable.") {
    super(message);
    this.name = "PersistenceUnavailableError";
  }
}

export type WorkflowDependencies = {
  siteId: string;
  assetIds: readonly string[];
  telemetryRepository: TelemetryRepository;
  riskRepository: RiskRepository;
  maintenanceRepository: MaintenanceRepository;
  now?: () => string;
  buildBaseline?: (assetId: string, history: TelemetrySnapshot[], now: string, assetIds: readonly string[]) => BaselineProfile;
};

export type IngestTelemetryResult = {
  accepted: number;
  rejected: number;
  qualityIssues: DataQuality[];
};

let workflowDependenciesOverride: WorkflowDependencies | null = null;

function nowFrom(dependencies: WorkflowDependencies) {
  return dependencies.now ?? DEFAULT_NOW;
}

function createSeedSnapshot(assetId: string, observedAt: string, index: number): TelemetrySnapshot {
  const offset = (index % 3) - 1;
  return createTelemetrySnapshot({
    assetId,
    observedAt,
    receivedAt: observedAt,
    engineCoolantTemperature: 82 + offset,
    engineOilTemperature: 78 + offset,
    engineRpm: 1480 + (index * 10),
    loadRate: 0.42 + ((index % 4) * 0.03),
    engineHours: 4200 + (index * 0.1),
    ambientTemperature: 31,
    latitude: 35.1,
    longitude: 129.1,
    speed: 4,
    sourceType: "SIMULATOR",
  });
}

function buildSeededBaseline(
  assetId: string,
  history: TelemetrySnapshot[],
  now: string,
  assetIds: readonly string[],
): BaselineProfile {
  const referenceMs = parseTimestamp(now) ?? Date.now();
  const seededSamples = Array.from({ length: 24 }, (_, index) => {
    const observedAt = new Date(referenceMs - ((24 - index) * 60 * 60 * 1000)).toISOString();
    return createSeedSnapshot(assetId, observedAt, index);
  });
  const peerSamples = assetIds
    .filter((candidate) => candidate !== assetId)
    .flatMap((candidate, assetOffset) =>
      Array.from({ length: 6 }, (_, index) => {
        const observedAt = new Date(referenceMs - ((6 - index) * 60 * 60 * 1000)).toISOString();
        return createTelemetrySnapshot({
          ...createSeedSnapshot(candidate, observedAt, index + assetOffset),
          assetId: candidate,
        });
      })
    );
  const allSamples = [...seededSamples, ...history];
  const activeFrom = seededSamples[0]?.observedAt ?? now;

  return buildBaselineProfile(assetId, allSamples, peerSamples, activeFrom);
}

function aggregateFromSnapshots(
  assetId: string,
  snapshots: TelemetrySnapshot[],
  current: TelemetrySnapshot,
  windowSeconds: 10 | 60,
): TelemetryAggregate {
  const currentMs = parseTimestamp(current.observedAt) ?? 0;
  const inWindow = snapshots.filter((snapshot) => {
    const observedMs = parseTimestamp(snapshot.observedAt);
    return observedMs !== null && observedMs >= currentMs - (windowSeconds * 1_000) && observedMs <= currentMs;
  });
  const validSnapshots = inWindow.filter((snapshot) => snapshot.qualityStatus === "VALID");

  const average = (values: Array<number | null>) => {
    const numeric = values.filter((value): value is number => value !== null);
    if (numeric.length === 0) {
      return null;
    }

    return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
  };

  const maximum = (values: Array<number | null>) => {
    const numeric = values.filter((value): value is number => value !== null);
    if (numeric.length === 0) {
      return null;
    }

    return Math.max(...numeric);
  };

  return {
    assetId,
    windowStart: inWindow[0]?.observedAt ?? current.observedAt,
    windowSeconds,
    sampleCount: validSnapshots.length,
    coolantTemperatureAvg: average(validSnapshots.map((snapshot) => snapshot.engineCoolantTemperature)),
    coolantTemperatureMax: maximum(validSnapshots.map((snapshot) => snapshot.engineCoolantTemperature)),
    oilTemperatureAvg: average(validSnapshots.map((snapshot) => snapshot.engineOilTemperature)),
    oilTemperatureMax: maximum(validSnapshots.map((snapshot) => snapshot.engineOilTemperature)),
    loadRateAvg: average(validSnapshots.map((snapshot) => snapshot.loadRate)),
    engineRpmAvg: average(validSnapshots.map((snapshot) => snapshot.engineRpm)),
    qualityStatus: validSnapshots.length === inWindow.length ? "VALID" : current.qualityStatus,
  };
}

function qualityMessage(snapshot: TelemetrySnapshot, delayMs: number | null) {
  if (snapshot.qualityStatus === "STALE") {
    return `Telemetry is stale${delayMs === null ? "" : ` by ${delayMs}ms`}; risk escalation is suppressed until the feed is current.`;
  }

  if (snapshot.qualityStatus === "PARTIAL") {
    return "Telemetry is missing required thermal inputs; risk escalation is suppressed until the feed is complete.";
  }

  return "Telemetry contains invalid values or timestamps; risk escalation is suppressed until the feed is valid.";
}

function toQualityIssue(snapshot: TelemetrySnapshot): DataQuality {
  const observedMs = parseTimestamp(snapshot.observedAt);
  const receivedMs = parseTimestamp(snapshot.receivedAt);
  const delayMs = observedMs !== null && receivedMs !== null ? Math.max(0, receivedMs - observedMs) : null;

  return {
    assetId: snapshot.assetId,
    observedAt: snapshot.observedAt,
    receivedAt: snapshot.receivedAt,
    status: snapshot.qualityStatus,
    missingFields: snapshot.missingFields,
    invalidFields: snapshot.invalidFields,
    delayMs,
    message: qualityMessage(snapshot, delayMs),
  };
}

function normalizeTelemetryRecord(record: RawTelemetry, receivedAt: string) {
  return normalizeRawTelemetry(record, receivedAt);
}

export function isKnownAssetId(assetId: string, dependencies: WorkflowDependencies) {
  return dependencies.assetIds.includes(assetId);
}

export function isPersistenceUnavailableError(error: unknown): error is PersistenceUnavailableError {
  return error instanceof PersistenceUnavailableError;
}

export function setWorkflowDependenciesForTests(dependencies: WorkflowDependencies | null) {
  workflowDependenciesOverride = dependencies;
}

export async function resolveWorkflowDependencies(): Promise<WorkflowDependencies> {
  if (workflowDependenciesOverride) {
    return workflowDependenciesOverride;
  }

  try {
    const [{ getDb }, telemetryRepositoryModule, riskRepositoryModule, maintenanceRepositoryModule] = await Promise.all([
      import("../../db/index.ts"),
      import("./repository.ts"),
      import("../risk/repository.ts"),
      import("../maintenance/repository.ts"),
    ]);
    const database = getDb();

    return {
      siteId: DEFAULT_SITE_ID,
      assetIds: DEFAULT_ASSET_IDS,
      telemetryRepository: telemetryRepositoryModule.createD1TelemetryRepository(database),
      riskRepository: riskRepositoryModule.createD1RiskRepository(database, { siteId: DEFAULT_SITE_ID }),
      maintenanceRepository: maintenanceRepositoryModule.createD1MaintenanceRepository(database),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operational persistence is unavailable.";
    throw new PersistenceUnavailableError(message);
  }
}

export async function listOpenAssessments(siteId: string, dependencies: WorkflowDependencies): Promise<RiskAssessmentRecord[]> {
  return dependencies.riskRepository.listOpen(siteId);
}

export async function createMaintenanceAction(
  input: CreateMaintenanceAction,
  dependencies: WorkflowDependencies,
): Promise<MaintenanceAction> {
  return dependencies.maintenanceRepository.createAction(input);
}

export async function completeMaintenanceAction(
  id: string,
  outcome: MaintenanceOutcome,
  dependencies: WorkflowDependencies,
): Promise<MaintenanceAction> {
  return dependencies.maintenanceRepository.completeAction(id, outcome);
}

export async function ingestTelemetry(
  records: RawTelemetry[],
  dependencies: WorkflowDependencies,
): Promise<IngestTelemetryResult> {
  let accepted = 0;
  let rejected = 0;
  const qualityIssues: DataQuality[] = [];
  const readNow = nowFrom(dependencies);

  for (const record of records) {
    const receivedAt = readNow();
    const snapshot = normalizeTelemetryRecord(record, receivedAt);

    if (snapshot.qualityStatus === "VALID") {
      await dependencies.telemetryRepository.insertSnapshot(snapshot);
      accepted += 1;

      const recentSnapshots = await dependencies.telemetryRepository.listRecent(snapshot.assetId, HISTORY_LIMIT);
      const orderedSnapshots = [...recentSnapshots].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
      const history = orderedSnapshots.filter((candidate) =>
        candidate.observedAt !== snapshot.observedAt || candidate.payloadHash !== snapshot.payloadHash
      );

      await dependencies.telemetryRepository.insertAggregate(
        aggregateFromSnapshots(snapshot.assetId, orderedSnapshots, snapshot, 10),
      );
      await dependencies.telemetryRepository.insertAggregate(
        aggregateFromSnapshots(snapshot.assetId, orderedSnapshots, snapshot, 60),
      );

      const baseline = (dependencies.buildBaseline ?? buildSeededBaseline)(
        snapshot.assetId,
        history,
        receivedAt,
        dependencies.assetIds,
      );
      const assessment = evaluateOverheatRisk({
        current: snapshot,
        history,
        peerSnapshots: [],
        baseline,
        now: receivedAt,
      });

      if (assessment.shouldNotifyMaintenance) {
        await dependencies.riskRepository.openOrUpdateAssessment(assessment);
      }

      continue;
    }

    rejected += 1;
    qualityIssues.push(toQualityIssue(snapshot));
  }

  return { accepted, rejected, qualityIssues };
}

export function isTelemetryRequestRecord(value: unknown): value is RawTelemetry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<RawTelemetry>;
  return (
    typeof candidate.assetId === "string"
    && typeof candidate.observedAt === "string"
    && typeof candidate.sourceType === "string"
    && VALID_SOURCE_TYPES.has(candidate.sourceType)
    && typeof candidate.values === "object"
    && candidate.values !== null
    && !Array.isArray(candidate.values)
  );
}

export function isCreateMaintenanceAction(value: unknown): value is CreateMaintenanceAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CreateMaintenanceAction>;
  return (
    typeof candidate.siteId === "string"
    && typeof candidate.assetId === "string"
    && typeof candidate.riskAssessmentId === "string"
    && typeof candidate.assignee === "string"
    && typeof candidate.note === "string"
  );
}

export function isMaintenanceOutcome(value: unknown): value is MaintenanceOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<MaintenanceOutcome>;
  return (
    typeof candidate.status === "string"
    && VALID_MAINTENANCE_STATUSES.has(candidate.status)
    && typeof candidate.inspectionNote === "string"
    && typeof candidate.actionTaken === "string"
    && Array.isArray(candidate.partsReplaced)
    && candidate.partsReplaced.every((entry) => typeof entry === "string")
    && typeof candidate.canReturnToService === "boolean"
    && (typeof candidate.actualOverheat === "boolean" || candidate.actualOverheat === null)
  );
}

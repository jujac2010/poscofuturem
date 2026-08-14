import type { RiskLevel } from "./contracts.ts";
import type { BaselineProfile } from "./baseline.ts";
import type { TelemetrySnapshot } from "../telemetry/contracts.ts";
import { parseTimestamp } from "../telemetry/adapters.ts";

export type RiskAssessment = {
  assetId: string;
  level: RiskLevel;
  score: number;
  confidence: number;
  evidence: string[];
  observedWindow: "48h";
  shouldNotifyMaintenance: boolean;
  reasonKey: string;
  assessedAt: string;
};

export type OverheatEvaluationInput = {
  current: TelemetrySnapshot;
  history: TelemetrySnapshot[];
  peerSnapshots: TelemetrySnapshot[];
  baseline: BaselineProfile;
  now: string;
};

const MAINTENANCE_READY_SAMPLE_COUNT = 20;

type EvidenceSignal = {
  key: "absolute_temperature" | "rise_rate" | "persistence" | "load_rpm_correlation" | "peer_deviation";
  message: string;
  weight: number;
};

function validSnapshots(snapshots: TelemetrySnapshot[], assetId?: string) {
  return snapshots
    .filter((snapshot) => snapshot.qualityStatus === "VALID" && (!assetId || snapshot.assetId === assetId))
    .sort((left, right) => {
      const leftMs = parseTimestamp(left.observedAt) ?? Number.NEGATIVE_INFINITY;
      const rightMs = parseTimestamp(right.observedAt) ?? Number.NEGATIVE_INFINITY;
      return leftMs - rightMs;
    });
}

function assessDataIssue(current: TelemetrySnapshot, now: string): RiskAssessment {
  return {
    assetId: current.assetId,
    level: "DATA_ISSUE",
    score: 0,
    confidence: 100,
    evidence: [`Telemetry quality is ${current.qualityStatus}; overheat escalation is suppressed until the feed is valid.`],
    observedWindow: "48h",
    shouldNotifyMaintenance: false,
    reasonKey: "DATA_QUALITY_INVALID",
    assessedAt: now,
  };
}

function lastObservedHotSequence(
  history: TelemetrySnapshot[],
  current: TelemetrySnapshot,
  baseline: BaselineProfile,
) {
  const ordered = [...history, current];
  const trailing: TelemetrySnapshot[] = [];

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const snapshot = ordered[index];
    const isHot = snapshot.engineCoolantTemperature !== null
      && snapshot.engineOilTemperature !== null
      && (
        snapshot.engineCoolantTemperature >= baseline.coolant.upperBound
        || snapshot.engineOilTemperature >= baseline.oil.upperBound
      );

    if (!isHot) {
      break;
    }

    trailing.unshift(snapshot);
  }

  return trailing;
}

function averageRatePerMinute(
  sequence: TelemetrySnapshot[],
  field: "engineCoolantTemperature" | "engineOilTemperature",
) {
  if (sequence.length < 3) {
    return null;
  }

  const start = sequence[0];
  const end = sequence[sequence.length - 1];
  const startValue = start[field];
  const endValue = end[field];
  const startMs = parseTimestamp(start.observedAt);
  const endMs = parseTimestamp(end.observedAt);

  if (startValue === null || endValue === null || startMs === null || endMs === null || endMs <= startMs) {
    return null;
  }

  return (endValue - startValue) / ((endMs - startMs) / 60_000);
}

function peerMedian(
  peers: TelemetrySnapshot[],
  baseline: BaselineProfile,
  field: "engineCoolantTemperature" | "engineOilTemperature",
): number | null {
  const values = validSnapshots(peers)
    .map((snapshot) => snapshot[field])
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return field === "engineCoolantTemperature" ? baseline.peerMedian.coolant : baseline.peerMedian.oil;
  }

  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }

  return (values[middle - 1] + values[middle]) / 2;
}

function collectEvidence(input: OverheatEvaluationInput): EvidenceSignal[] {
  const { current, history, peerSnapshots, baseline } = input;
  const evidence: EvidenceSignal[] = [];
  const currentCoolant = current.engineCoolantTemperature as number;
  const currentOil = current.engineOilTemperature as number;
  const currentLoad = current.loadRate ?? 0;
  const currentRpm = current.engineRpm ?? 0;
  const validHistory = validSnapshots(history, current.assetId);
  const hotSequence = lastObservedHotSequence(validHistory, current, baseline);

  const coolantGap = currentCoolant - baseline.coolant.upperBound;
  const oilGap = currentOil - baseline.oil.upperBound;
  if (coolantGap >= 4 || oilGap >= 4) {
    evidence.push({
      key: "absolute_temperature",
      message: `Absolute temperature is elevated (coolant ${currentCoolant}°C vs ${baseline.coolant.upperBound}°C, oil ${currentOil}°C vs ${baseline.oil.upperBound}°C upper bounds).`,
      weight: 28,
    });
  }

  const coolantRate = averageRatePerMinute([...validHistory, current], "engineCoolantTemperature");
  const oilRate = averageRatePerMinute([...validHistory, current], "engineOilTemperature");
  const coolantRateThreshold = Math.max(3.5, baseline.coolant.riseRatePerMinute * 1.6);
  const oilRateThreshold = Math.max(3.5, baseline.oil.riseRatePerMinute * 1.6);
  const rateHot = hotSequence.length >= 3
    && (
      (coolantRate !== null && coolantRate >= coolantRateThreshold)
      || (oilRate !== null && oilRate >= oilRateThreshold)
    );

  if (rateHot) {
    evidence.push({
      key: "rise_rate",
      message: `Temperature rise rate is abnormal (coolant ${Number((coolantRate ?? 0).toFixed(1))}°C/min, oil ${Number((oilRate ?? 0).toFixed(1))}°C/min).`,
      weight: 22,
    });
  }

  const persistentHot = hotSequence.length >= 3;
  if (persistentHot) {
    evidence.push({
      key: "persistence",
      message: `Hot readings persisted across ${hotSequence.length} consecutive observations.`,
      weight: 20,
    });
  }

  if ((currentLoad >= 0.8 || currentRpm >= 2_000) && persistentHot && (coolantGap >= 0 || oilGap >= 0)) {
    evidence.push({
      key: "load_rpm_correlation",
      message: `Thermal rise aligns with heavy operation (load ${Math.round(currentLoad * 100)}%, rpm ${Math.round(currentRpm)}).`,
      weight: 14,
    });
  }

  const coolantPeerMedian = peerMedian(peerSnapshots, baseline, "engineCoolantTemperature");
  const oilPeerMedian = peerMedian(peerSnapshots, baseline, "engineOilTemperature");
  if (
    persistentHot
    && (
      (coolantPeerMedian !== null && currentCoolant - coolantPeerMedian >= 10)
      || (oilPeerMedian !== null && currentOil - oilPeerMedian >= 10)
    )
  ) {
    evidence.push({
      key: "peer_deviation",
      message: `This asset is materially hotter than peers (coolant ${coolantPeerMedian ?? "n/a"}°C median, oil ${oilPeerMedian ?? "n/a"}°C median).`,
      weight: 16,
    });
  }

  return evidence;
}

function levelForEvidence(evidence: EvidenceSignal[], baseline: BaselineProfile): { level: RiskLevel; reasonKey: string } {
  const evidenceCount = evidence.length;
  const hasPersistence = evidence.some((signal) => signal.key === "persistence");

  if (evidenceCount === 0) {
    return { level: "NORMAL", reasonKey: "NO_OVERHEAT_SIGNALS" };
  }

  if (baseline.sampleCount < MAINTENANCE_READY_SAMPLE_COUNT) {
    if (evidenceCount >= 2 && hasPersistence) {
      return { level: "CAUTION", reasonKey: "LOW_CONFIDENCE_BASELINE" };
    }

    return { level: "OBSERVE", reasonKey: "LOW_CONFIDENCE_OBSERVE" };
  }

  if (evidenceCount >= 3 && hasPersistence) {
    return { level: "MAINTENANCE_ALERT", reasonKey: "PRECISION_MULTI_SIGNAL_ALERT" };
  }

  if (evidenceCount >= 2 && hasPersistence) {
    return { level: "CAUTION", reasonKey: "PERSISTENT_MULTI_SIGNAL_CAUTION" };
  }

  return { level: "OBSERVE", reasonKey: "SINGLE_SIGNAL_OBSERVE" };
}

export function evaluateOverheatRisk(input: OverheatEvaluationInput): RiskAssessment {
  if (input.current.qualityStatus !== "VALID") {
    return assessDataIssue(input.current, input.now);
  }

  const evidence = collectEvidence(input);
  const { level, reasonKey } = levelForEvidence(evidence, input.baseline);
  const score = Math.min(100, evidence.reduce((total, signal) => total + signal.weight, 0));
  const confidenceBase = input.baseline.sampleCount >= MAINTENANCE_READY_SAMPLE_COUNT ? 72 : 54;
  const confidence = Math.min(
    99,
    confidenceBase
      + (evidence.length * 6)
      + (evidence.some((signal) => signal.key === "persistence") ? 5 : 0),
  );

  return {
    assetId: input.current.assetId,
    level,
    score,
    confidence,
    evidence: evidence.map((signal) => signal.message),
    observedWindow: "48h",
    shouldNotifyMaintenance: level === "MAINTENANCE_ALERT",
    reasonKey,
    assessedAt: input.now,
  };
}

import type { TelemetrySnapshot } from "../telemetry/contracts.ts";
import { parseTimestamp } from "../telemetry/adapters.ts";

export type BaselineProfile = {
  assetId: string;
  sampleCount: number;
  coolant: { median: number; upperBound: number; riseRatePerMinute: number };
  oil: { median: number; upperBound: number; riseRatePerMinute: number };
  peerMedian: { coolant: number | null; oil: number | null };
  version: string;
  activeFrom: string;
};

const BASELINE_VERSION = "baseline-v1";
const MIN_BASELINE_SAMPLE_COUNT = 20;

function sortNumbers(values: number[]) {
  return [...values].sort((left, right) => left - right);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = sortNumbers(values);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = sortNumbers(values);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * p)));
  return sorted[index];
}

function computeRiseRatePerMinute(
  snapshots: TelemetrySnapshot[],
  field: "engineCoolantTemperature" | "engineOilTemperature",
): number {
  const sorted = [...snapshots].sort((left, right) => {
    const leftMs = parseTimestamp(left.observedAt) ?? Number.NEGATIVE_INFINITY;
    const rightMs = parseTimestamp(right.observedAt) ?? Number.NEGATIVE_INFINITY;
    return leftMs - rightMs;
  });
  const positiveRates: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const previousValue = previous[field];
    const currentValue = current[field];
    const previousMs = parseTimestamp(previous.observedAt);
    const currentMs = parseTimestamp(current.observedAt);

    if (
      previousValue === null
      || currentValue === null
      || previousMs === null
      || currentMs === null
      || currentMs <= previousMs
    ) {
      continue;
    }

    const deltaMinutes = (currentMs - previousMs) / 60_000;
    if (deltaMinutes <= 0) {
      continue;
    }

    const rate = (currentValue - previousValue) / deltaMinutes;
    if (rate > 0) {
      positiveRates.push(rate);
    }
  }

  if (positiveRates.length === 0) {
    return 0.5;
  }

  return Number(percentile(positiveRates, 0.75).toFixed(2));
}

function isValidThermalSnapshot(snapshot: TelemetrySnapshot): boolean {
  return (
    snapshot.qualityStatus === "VALID"
    && snapshot.engineCoolantTemperature !== null
    && snapshot.engineOilTemperature !== null
  );
}

function isCautionOrHigherCandidate(snapshot: TelemetrySnapshot): boolean {
  const coolant = snapshot.engineCoolantTemperature;
  const oil = snapshot.engineOilTemperature;
  const load = snapshot.loadRate ?? 0;
  const rpm = snapshot.engineRpm ?? 0;

  if (coolant === null || oil === null) {
    return true;
  }

  const thermalHigh = coolant >= 100 || oil >= 102;
  const sustainedHotBand = coolant >= 95 && oil >= 95;
  const highLoadHotPair = (coolant >= 94 || oil >= 96) && load >= 0.8 && rpm >= 2_000;

  return thermalHigh || sustainedHotBand || highLoadHotPair;
}

function eligibleBaselineSamples(samples: TelemetrySnapshot[], assetId?: string) {
  return samples.filter((snapshot) => (
    (!assetId || snapshot.assetId === assetId)
    && isValidThermalSnapshot(snapshot)
    && !isCautionOrHigherCandidate(snapshot)
  ));
}

export function buildBaselineProfile(
  assetId: string,
  samples: TelemetrySnapshot[],
  peerSamples: TelemetrySnapshot[],
  activeFrom: string,
): BaselineProfile {
  const baselineSamples = eligibleBaselineSamples(samples, assetId);
  const coolantValues = baselineSamples.map((snapshot) => snapshot.engineCoolantTemperature as number);
  const oilValues = baselineSamples.map((snapshot) => snapshot.engineOilTemperature as number);
  const peerEligible = eligibleBaselineSamples(peerSamples).filter((snapshot) => snapshot.assetId !== assetId);
  const peerCoolantValues = peerEligible.map((snapshot) => snapshot.engineCoolantTemperature as number);
  const peerOilValues = peerEligible.map((snapshot) => snapshot.engineOilTemperature as number);

  const coolantMedian = Number(median(coolantValues).toFixed(2));
  const oilMedian = Number(median(oilValues).toFixed(2));
  const coolantUpperBound = baselineSamples.length >= MIN_BASELINE_SAMPLE_COUNT
    ? Number(Math.max(coolantMedian + 5, percentile(coolantValues, 0.9)).toFixed(2))
    : Number((coolantMedian + 7).toFixed(2));
  const oilUpperBound = baselineSamples.length >= MIN_BASELINE_SAMPLE_COUNT
    ? Number(Math.max(oilMedian + 5, percentile(oilValues, 0.9)).toFixed(2))
    : Number((oilMedian + 7).toFixed(2));

  return {
    assetId,
    sampleCount: baselineSamples.length,
    coolant: {
      median: coolantMedian,
      upperBound: coolantUpperBound,
      riseRatePerMinute: computeRiseRatePerMinute(baselineSamples, "engineCoolantTemperature"),
    },
    oil: {
      median: oilMedian,
      upperBound: oilUpperBound,
      riseRatePerMinute: computeRiseRatePerMinute(baselineSamples, "engineOilTemperature"),
    },
    peerMedian: {
      coolant: peerCoolantValues.length ? Number(median(peerCoolantValues).toFixed(2)) : null,
      oil: peerOilValues.length ? Number(median(peerOilValues).toFixed(2)) : null,
    },
    version: BASELINE_VERSION,
    activeFrom,
  };
}

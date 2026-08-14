import type { RawTelemetry, TelemetrySnapshot } from "./contracts.ts";
import { TELEMETRY_STALE_THRESHOLD_MS, parseTimestamp } from "./adapters.ts";
import { TELEMETRY_PHYSICAL_RANGES } from "./quality-ranges.ts";

const telemetryFields = [
  "engineCoolantTemperature",
  "engineOilTemperature",
  "engineRpm",
  "loadRate",
  "engineHours",
  "ambientTemperature",
  "latitude",
  "longitude",
  "speed",
] as const;

const requiredThermalFields = [
  "engineCoolantTemperature",
  "engineOilTemperature",
] as const;

function normalizeFieldValue(raw: RawTelemetry, field: (typeof telemetryFields)[number]): number | null {
  const value = raw.values[field];
  if (value === null || value === undefined) {
    return null;
  }

  if (field === "loadRate" && raw.units?.loadRate === "percent") {
    return value / 100;
  }

  return value;
}

function isFieldValid(field: (typeof telemetryFields)[number], value: number | null): value is number {
  if (value === null || !Number.isFinite(value)) {
    return false;
  }

  const range = TELEMETRY_PHYSICAL_RANGES[field];
  return value >= range.min && value <= range.max;
}

export function normalizeRawTelemetry(raw: RawTelemetry, receivedAt: string): TelemetrySnapshot {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  const normalized = Object.fromEntries(
    telemetryFields.map((field) => {
      const value = normalizeFieldValue(raw, field);

      if (value === null) {
        if (requiredThermalFields.includes(field as (typeof requiredThermalFields)[number])) {
          missingFields.push(field);
        }
        return [field, null];
      }

      if (!isFieldValid(field, value)) {
        invalidFields.push(field);
        return [field, null];
      }

      return [field, value];
    }),
  ) as Record<(typeof telemetryFields)[number], number | null>;

  const observedMs = parseTimestamp(raw.observedAt);
  const receivedMs = parseTimestamp(receivedAt);

  if (observedMs === null) {
    invalidFields.push("observedAt");
  }

  if (receivedMs === null) {
    invalidFields.push("receivedAt");
  }

  const usableThermalCount = requiredThermalFields.filter((field) => normalized[field] !== null).length;
  const hasThermalGap = requiredThermalFields.some((field) => normalized[field] === null);
  const hasAnyDataGap = missingFields.length > 0 || invalidFields.some((field) => field !== "observedAt" && field !== "receivedAt");

  let qualityStatus: TelemetrySnapshot["qualityStatus"] = "VALID";

  if (observedMs === null || receivedMs === null || usableThermalCount === 0) {
    qualityStatus = "INVALID";
  } else if (receivedMs - observedMs > TELEMETRY_STALE_THRESHOLD_MS) {
    qualityStatus = "STALE";
  } else if (hasThermalGap || hasAnyDataGap) {
    qualityStatus = "PARTIAL";
  }

  return {
    assetId: raw.assetId,
    observedAt: raw.observedAt,
    receivedAt,
    engineCoolantTemperature: normalized.engineCoolantTemperature,
    engineOilTemperature: normalized.engineOilTemperature,
    engineRpm: normalized.engineRpm,
    loadRate: normalized.loadRate,
    engineHours: normalized.engineHours,
    ambientTemperature: normalized.ambientTemperature,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    speed: normalized.speed,
    sourceType: raw.sourceType,
    qualityStatus,
    missingFields,
    invalidFields,
  };
}

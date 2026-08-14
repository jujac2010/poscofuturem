export type SourceType = "SIMULATOR" | "FILE_REPLAY" | "CAN" | "MQTT" | "OPC_UA" | "REST";

export type QualityStatus = "VALID" | "PARTIAL" | "STALE" | "INVALID";

export type DataQuality = {
  assetId: string;
  observedAt: string;
  receivedAt: string;
  status: QualityStatus;
  missingFields: string[];
  invalidFields: string[];
  delayMs: number | null;
  message: string;
};

export type RawTelemetry = {
  assetId: string;
  observedAt: string;
  values: Record<string, number | null>;
  units?: Partial<Record<string, "fraction" | "percent" | "celsius" | "rpm" | "hours" | "degrees" | "km/h">>;
  sourceType: SourceType;
  payloadHash?: string;
};

export type TelemetrySnapshot = {
  assetId: string;
  observedAt: string;
  receivedAt: string;
  payloadHash?: string;
  engineCoolantTemperature: number | null;
  engineOilTemperature: number | null;
  engineRpm: number | null;
  loadRate: number | null;
  engineHours: number | null;
  ambientTemperature: number | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  sourceType: SourceType;
  qualityStatus: QualityStatus;
  missingFields: string[];
  invalidFields: string[];
};

export type TelemetryAggregate = {
  assetId: string;
  windowStart: string;
  windowSeconds: 10 | 60;
  sampleCount: number;
  coolantTemperatureAvg: number | null;
  coolantTemperatureMax: number | null;
  oilTemperatureAvg: number | null;
  oilTemperatureMax: number | null;
  loadRateAvg: number | null;
  engineRpmAvg: number | null;
  qualityStatus: QualityStatus;
};

const telemetryValueFields = [
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

const thermalValueFields = [
  "engineCoolantTemperature",
  "engineOilTemperature",
] as const;

type TelemetryInput = Omit<TelemetrySnapshot, "qualityStatus" | "missingFields" | "invalidFields">;

const isFiniteNumber = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);

export function createTelemetrySnapshot(input: TelemetryInput): TelemetrySnapshot {
  const missingFields = telemetryValueFields.filter((field) => input[field] === null);
  const invalidFields = telemetryValueFields.filter((field) => {
    const value = input[field];
    return value !== null && !isFiniteNumber(value);
  });
  const thermalFieldsPresent = thermalValueFields.every((field) => {
    const value = input[field];
    return value !== null && isFiniteNumber(value);
  });

  const qualityStatus: QualityStatus =
    invalidFields.length > 0 ? "INVALID" : thermalFieldsPresent ? "VALID" : "PARTIAL";

  return {
    ...input,
    qualityStatus,
    missingFields,
    invalidFields,
  };
}

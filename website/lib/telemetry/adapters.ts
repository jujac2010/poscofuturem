import type { RawTelemetry, SourceType } from "./contracts";

export const TELEMETRY_STALE_THRESHOLD_MS = 60_000;

export type SourceHealthStatus = "IDLE" | "READY" | "STALE";

export type SourceHealth = {
  sourceType: SourceType;
  status: SourceHealthStatus;
  lastObservedAt: string | null;
  lagMs: number | null;
  message: string;
};

export interface EcuAdapter {
  connect(): Promise<void>;
  readBatch(): Promise<RawTelemetry[]>;
  health(referenceTime?: string): Promise<SourceHealth>;
  close(): Promise<void>;
}

export function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createSourceHealth(
  sourceType: SourceType,
  lastObservedAt: string | null,
  referenceTime?: string,
): SourceHealth {
  if (lastObservedAt === null) {
    return {
      sourceType,
      status: "IDLE",
      lastObservedAt: null,
      lagMs: null,
      message: "No telemetry has been read yet.",
    };
  }

  const observedMs = parseTimestamp(lastObservedAt);
  const referenceMs = referenceTime ? parseTimestamp(referenceTime) : Date.now();

  if (observedMs === null || referenceMs === null) {
    return {
      sourceType,
      status: "STALE",
      lastObservedAt,
      lagMs: null,
      message: "Telemetry source timestamps are invalid.",
    };
  }

  const lagMs = Math.max(0, referenceMs - observedMs);
  const stale = lagMs > TELEMETRY_STALE_THRESHOLD_MS;

  return {
    sourceType,
    status: stale ? "STALE" : "READY",
    lastObservedAt,
    lagMs,
    message: stale ? "Telemetry source is stale." : "Telemetry source is healthy.",
  };
}

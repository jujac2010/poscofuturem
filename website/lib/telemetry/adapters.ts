import type { SourceHealth } from "../risk/contracts.ts";
import type { RawTelemetry, SourceType } from "./contracts.ts";

export const TELEMETRY_STALE_THRESHOLD_MS = 60_000;

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
  connected: boolean,
  sourceType: SourceType,
  lastObservedAt: string | null,
  lastReceivedAt: string | null,
  referenceTime?: string,
): SourceHealth {
  if (!connected) {
    return {
      sourceType,
      status: "DISCONNECTED",
      lastObservedAt,
      lastReceivedAt,
      message: "Telemetry source is disconnected.",
    };
  }

  if (lastObservedAt === null) {
    return {
      sourceType,
      status: "CONNECTED",
      lastObservedAt: null,
      lastReceivedAt: null,
      message: "Connected; no telemetry read yet.",
    };
  }

  const observedMs = parseTimestamp(lastObservedAt);
  const effectiveReceivedAt = lastReceivedAt ?? referenceTime ?? null;
  const referenceMs = referenceTime ? parseTimestamp(referenceTime) : Date.now();
  const receivedMs = effectiveReceivedAt ? parseTimestamp(effectiveReceivedAt) : null;

  if (observedMs === null || referenceMs === null || receivedMs === null) {
    return {
      sourceType,
      status: "ERROR",
      lastObservedAt,
      lastReceivedAt,
      message: "Telemetry source timestamps are invalid.",
    };
  }

  const lagMs = Math.max(0, referenceMs - observedMs);
  const stale = lagMs > TELEMETRY_STALE_THRESHOLD_MS;

  return {
    sourceType,
    status: stale ? "STALE" : "CONNECTED",
    lastObservedAt,
    lastReceivedAt: effectiveReceivedAt,
    message: stale ? "Telemetry source is stale." : null,
  };
}

export type RiskLevel = "NORMAL" | "OBSERVE" | "CAUTION" | "MAINTENANCE_ALERT" | "DATA_ISSUE";

export type SourceHealth = {
  sourceType: import("../telemetry/contracts.ts").SourceType;
  status: "CONNECTED" | "DISCONNECTED" | "STALE" | "ERROR";
  lastObservedAt: string | null;
  lastReceivedAt: string | null;
  message: string | null;
};

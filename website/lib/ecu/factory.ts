import { getRunMode } from "./config";
import { DummyEcuSource } from "./dummy-source";
import { RealEcuSource } from "./real-source";
import type { EcuDataSource } from "./types";
import { FileReplayAdapter } from "../telemetry/file-replay";
import type { RawTelemetry } from "../telemetry/contracts";
import type { EcuAdapter } from "./types";

export function createEcuDataSource(): EcuDataSource {
  return getRunMode() === "REAL" ? new RealEcuSource() : new DummyEcuSource();
}

export function createFileReplayEcuAdapter(records: RawTelemetry[]): EcuAdapter {
  return new FileReplayAdapter(records);
}

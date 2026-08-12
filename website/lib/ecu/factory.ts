import { getRunMode } from "./config";
import { DummyEcuSource } from "./dummy-source";
import { RealEcuSource } from "./real-source";
import type { EcuDataSource } from "./types";

export function createEcuDataSource(): EcuDataSource {
  return getRunMode() === "REAL" ? new RealEcuSource() : new DummyEcuSource();
}

export type RunMode = "DUMMY" | "REAL";

export type EcuSnapshot = {
  forkliftId: string;
  timestamp: string;
  battery: number;
  coolantTemperature: number;
  engineOilTemperature: number;
  vibrationRms: number;
  mode: RunMode;
  connected: boolean;
};

export interface EcuDataSource {
  read(forkliftId: string): Promise<EcuSnapshot>;
}

export type { EcuAdapter } from "../telemetry/adapters";
export type { SourceHealth } from "../risk/contracts.ts";

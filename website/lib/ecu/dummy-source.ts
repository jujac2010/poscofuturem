import type { EcuDataSource, EcuSnapshot } from "./types";

const baseValues: Record<string, Omit<EcuSnapshot, "forkliftId" | "timestamp" | "mode" | "connected">> = {
  "P-01호": { battery: 86, coolantTemperature: 72, engineOilTemperature: 68, vibrationRms: 1.8 },
  "P-02호": { battery: 72, coolantTemperature: 75, engineOilTemperature: 70, vibrationRms: 2.1 },
  "P-03호": { battery: 64, coolantTemperature: 78, engineOilTemperature: 74, vibrationRms: 2.6 },
  "P-04호": { battery: 48, coolantTemperature: 82, engineOilTemperature: 79, vibrationRms: 3.2 },
  "P-05호": { battery: 91, coolantTemperature: 68, engineOilTemperature: 64, vibrationRms: 1.2 },
};

export class DummyEcuSource implements EcuDataSource {
  private readonly state = new Map<string, EcuSnapshot>();

  async read(forkliftId: string): Promise<EcuSnapshot> {
    const previous = this.state.get(forkliftId) ?? {
      forkliftId,
      timestamp: new Date().toISOString(),
      ...(baseValues[forkliftId] ?? baseValues["P-01호"]),
      mode: "DUMMY" as const,
      connected: true,
    };
    const drift = Math.sin(Date.now() / 3100 + forkliftId.length) * 0.18;
    const next: EcuSnapshot = {
      ...previous,
      timestamp: new Date().toISOString(),
      battery: Math.max(20, previous.battery - 0.004),
      coolantTemperature: Math.max(55, Math.min(98, previous.coolantTemperature + drift * 0.12)),
      engineOilTemperature: Math.max(52, Math.min(102, previous.engineOilTemperature + drift * 0.14)),
      vibrationRms: Math.max(0.8, Math.min(4.5, previous.vibrationRms + drift * 0.025)),
    };
    this.state.set(forkliftId, next);
    return next;
  }
}

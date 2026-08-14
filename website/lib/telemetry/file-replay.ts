import type { RawTelemetry } from "./contracts.ts";
import { createSourceHealth } from "./adapters.ts";
import type { EcuAdapter, SourceHealth } from "./adapters.ts";

export class FileReplayAdapter implements EcuAdapter {
  private readonly records: RawTelemetry[];
  private cursor = 0;
  private connected = false;
  private lastObservedAt: string | null = null;

  constructor(records: RawTelemetry[]) {
    this.records = records;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async readBatch(): Promise<RawTelemetry[]> {
    if (!this.connected || this.cursor >= this.records.length) {
      return [];
    }

    const record = this.records[this.cursor];
    this.cursor += 1;
    this.lastObservedAt = record.observedAt;
    return [record];
  }

  async health(referenceTime?: string): Promise<SourceHealth> {
    const latestObservedAt = this.lastObservedAt ?? this.records.at(-1)?.observedAt ?? null;
    return createSourceHealth("FILE_REPLAY", latestObservedAt, referenceTime);
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}

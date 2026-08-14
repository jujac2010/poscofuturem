import type { TelemetryAggregate, TelemetrySnapshot } from "./contracts.ts";

export interface TelemetryRepository {
  insertSnapshot(snapshot: TelemetrySnapshot): Promise<void>;
  insertAggregate(input: TelemetryAggregate): Promise<void>;
  listRecent(assetId: string, limit: number): Promise<TelemetrySnapshot[]>;
}

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] } | T[]>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

type StoredTelemetrySnapshot = TelemetrySnapshot & {
  id: string;
  payloadHash: string;
};

type StoredTelemetryAggregate = TelemetryAggregate & {
  id: string;
  payloadHash: string;
};

export type InMemoryTelemetryStore = {
  snapshots: StoredTelemetrySnapshot[];
  aggregates: StoredTelemetryAggregate[];
};

type TelemetrySnapshotRow = {
  asset_id: string;
  observed_at: string;
  received_at: string;
  engine_coolant_temperature: number | null;
  engine_oil_temperature: number | null;
  engine_rpm: number | null;
  load_rate: number | null;
  engine_hours: number | null;
  ambient_temperature: number | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  source_type: TelemetrySnapshot["sourceType"];
  quality_status: TelemetrySnapshot["qualityStatus"];
  missing_fields_json: string;
  invalid_fields_json: string;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashString(input: string): string {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createHash(value: unknown) {
  return hashString(stableStringify(value));
}

function createSnapshotId(snapshot: TelemetrySnapshot) {
  return `telemetry_snapshot_${createHash(snapshot)}`;
}

function createAggregateId(aggregate: TelemetryAggregate) {
  return `telemetry_aggregate_${createHash(aggregate)}`;
}

function normalizeLimit(limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.floor(limit);
}

function compareObservedAtDesc(left: { observedAt: string }, right: { observedAt: string }) {
  return right.observedAt.localeCompare(left.observedAt);
}

function snapshotToStored(snapshot: TelemetrySnapshot): StoredTelemetrySnapshot {
  return {
    ...snapshot,
    id: createSnapshotId(snapshot),
    payloadHash: createHash(snapshot),
  };
}

function aggregateToStored(input: TelemetryAggregate): StoredTelemetryAggregate {
  return {
    ...input,
    id: createAggregateId(input),
    payloadHash: createHash(input),
  };
}

function snapshotRowToDomain(row: TelemetrySnapshotRow): TelemetrySnapshot {
  return {
    assetId: row.asset_id,
    observedAt: row.observed_at,
    receivedAt: row.received_at,
    engineCoolantTemperature: row.engine_coolant_temperature,
    engineOilTemperature: row.engine_oil_temperature,
    engineRpm: row.engine_rpm,
    loadRate: row.load_rate,
    engineHours: row.engine_hours,
    ambientTemperature: row.ambient_temperature,
    latitude: row.latitude,
    longitude: row.longitude,
    speed: row.speed,
    sourceType: row.source_type,
    qualityStatus: row.quality_status,
    missingFields: JSON.parse(row.missing_fields_json) as string[],
    invalidFields: JSON.parse(row.invalid_fields_json) as string[],
  };
}

async function allRows<T>(database: D1DatabaseLike, query: string, values: unknown[]) {
  const result = await database.prepare(query).bind(...values).all<T>();
  return Array.isArray(result) ? result : (result.results ?? []);
}

export function createInMemoryTelemetryStore(): InMemoryTelemetryStore {
  return {
    snapshots: [],
    aggregates: [],
  };
}

export function createInMemoryTelemetryRepository(
  store: InMemoryTelemetryStore = createInMemoryTelemetryStore(),
): TelemetryRepository {
  return {
    async insertSnapshot(snapshot) {
      const stored = snapshotToStored(snapshot);
      const existingIndex = store.snapshots.findIndex((entry) => entry.payloadHash === stored.payloadHash);
      if (existingIndex >= 0) {
        store.snapshots[existingIndex] = stored;
        return;
      }

      store.snapshots.push(stored);
    },

    async insertAggregate(input) {
      const stored = aggregateToStored(input);
      const existingIndex = store.aggregates.findIndex((entry) => entry.payloadHash === stored.payloadHash);
      if (existingIndex >= 0) {
        store.aggregates[existingIndex] = stored;
        return;
      }

      store.aggregates.push(stored);
    },

    async listRecent(assetId, limit) {
      return store.snapshots
        .filter((entry) => entry.assetId === assetId)
        .sort(compareObservedAtDesc)
        .slice(0, normalizeLimit(limit))
        .map(({ id: _id, payloadHash: _payloadHash, ...snapshot }) => snapshot);
    },
  };
}

export function createD1TelemetryRepository(database: D1DatabaseLike): TelemetryRepository {
  return {
    async insertSnapshot(snapshot) {
      const stored = snapshotToStored(snapshot);

      await database.prepare(
        `insert into telemetrySnapshots (
          id,
          payload_hash,
          asset_id,
          observed_at,
          received_at,
          engine_coolant_temperature,
          engine_oil_temperature,
          engine_rpm,
          load_rate,
          engine_hours,
          ambient_temperature,
          latitude,
          longitude,
          speed,
          source_type,
          quality_status,
          missing_fields_json,
          invalid_fields_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(payload_hash) do update set
          observed_at = excluded.observed_at,
          received_at = excluded.received_at,
          engine_coolant_temperature = excluded.engine_coolant_temperature,
          engine_oil_temperature = excluded.engine_oil_temperature,
          engine_rpm = excluded.engine_rpm,
          load_rate = excluded.load_rate,
          engine_hours = excluded.engine_hours,
          ambient_temperature = excluded.ambient_temperature,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          speed = excluded.speed,
          source_type = excluded.source_type,
          quality_status = excluded.quality_status,
          missing_fields_json = excluded.missing_fields_json,
          invalid_fields_json = excluded.invalid_fields_json`,
      ).bind(
        stored.id,
        stored.payloadHash,
        stored.assetId,
        stored.observedAt,
        stored.receivedAt,
        stored.engineCoolantTemperature,
        stored.engineOilTemperature,
        stored.engineRpm,
        stored.loadRate,
        stored.engineHours,
        stored.ambientTemperature,
        stored.latitude,
        stored.longitude,
        stored.speed,
        stored.sourceType,
        stored.qualityStatus,
        JSON.stringify(stored.missingFields),
        JSON.stringify(stored.invalidFields),
      ).run();
    },

    async insertAggregate(input) {
      const stored = aggregateToStored(input);

      await database.prepare(
        `insert into telemetryAggregates (
          id,
          payload_hash,
          asset_id,
          window_start,
          window_seconds,
          sample_count,
          coolant_temperature_avg,
          coolant_temperature_max,
          oil_temperature_avg,
          oil_temperature_max,
          load_rate_avg,
          engine_rpm_avg,
          quality_status
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(payload_hash) do update set
          asset_id = excluded.asset_id,
          window_start = excluded.window_start,
          window_seconds = excluded.window_seconds,
          sample_count = excluded.sample_count,
          coolant_temperature_avg = excluded.coolant_temperature_avg,
          coolant_temperature_max = excluded.coolant_temperature_max,
          oil_temperature_avg = excluded.oil_temperature_avg,
          oil_temperature_max = excluded.oil_temperature_max,
          load_rate_avg = excluded.load_rate_avg,
          engine_rpm_avg = excluded.engine_rpm_avg,
          quality_status = excluded.quality_status`,
      ).bind(
        stored.id,
        stored.payloadHash,
        stored.assetId,
        stored.windowStart,
        stored.windowSeconds,
        stored.sampleCount,
        stored.coolantTemperatureAvg,
        stored.coolantTemperatureMax,
        stored.oilTemperatureAvg,
        stored.oilTemperatureMax,
        stored.loadRateAvg,
        stored.engineRpmAvg,
        stored.qualityStatus,
      ).run();
    },

    async listRecent(assetId, limit) {
      const rows = await allRows<TelemetrySnapshotRow>(
        database,
        `select
          asset_id,
          observed_at,
          received_at,
          engine_coolant_temperature,
          engine_oil_temperature,
          engine_rpm,
          load_rate,
          engine_hours,
          ambient_temperature,
          latitude,
          longitude,
          speed,
          source_type,
          quality_status,
          missing_fields_json,
          invalid_fields_json
        from telemetrySnapshots
        where asset_id = ?
        order by observed_at desc
        limit ?`,
        [assetId, normalizeLimit(limit)],
      );

      return rows.map(snapshotRowToDomain);
    },
  };
}

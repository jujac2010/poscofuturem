import type { RiskAssessment } from "./overheat-evaluator.ts";

export interface RiskRepository {
  openOrUpdateAssessment(assessment: RiskAssessment): Promise<RiskAssessmentRecord>;
  listOpen(siteId: string): Promise<RiskAssessmentRecord[]>;
}

export type RiskAssessmentRecord = RiskAssessment & {
  id: string;
  siteId: string;
  status: "OPEN" | "ACKNOWLEDGED" | "COMPLETED" | "DISMISSED";
  createdAt: string;
  updatedAt: string;
};

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] } | T[]>;
};

type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

export type InMemoryRiskStore = {
  assessments: RiskAssessmentRecord[];
};

export type RiskRepositoryOptions = {
  siteId: string;
};

type RiskAssessmentRow = {
  id: string;
  site_id: string;
  asset_id: string;
  level: RiskAssessment["level"];
  score: number;
  confidence: number;
  evidence_json: string;
  observed_window: RiskAssessment["observedWindow"];
  should_notify_maintenance: number;
  reason_key: string;
  assessed_at: string;
  status: RiskAssessmentRecord["status"];
  created_at: string;
  updated_at: string;
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

export function riskDedupKey(siteId: string, assessment: RiskAssessment) {
  return `${siteId}::${assessment.assetId}::${assessment.reasonKey}`;
}

function createRiskId(siteId: string, assessment: RiskAssessment) {
  return `risk_${hashString(stableStringify(riskDedupKey(siteId, assessment)))}`;
}

function compareUpdatedAtDesc(left: { updatedAt: string }, right: { updatedAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function recordFromAssessment(siteId: string, assessment: RiskAssessment, existing?: RiskAssessmentRecord): RiskAssessmentRecord {
  return {
    ...assessment,
    id: existing?.id ?? createRiskId(siteId, assessment),
    siteId,
    status: "OPEN",
    createdAt: existing?.createdAt ?? assessment.assessedAt,
    updatedAt: assessment.assessedAt,
  };
}

function rowToRiskAssessmentRecord(row: RiskAssessmentRow): RiskAssessmentRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    assetId: row.asset_id,
    level: row.level,
    score: row.score,
    confidence: row.confidence,
    evidence: JSON.parse(row.evidence_json) as string[],
    observedWindow: row.observed_window,
    shouldNotifyMaintenance: row.should_notify_maintenance === 1,
    reasonKey: row.reason_key,
    assessedAt: row.assessed_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function allRows<T>(database: D1DatabaseLike, query: string, values: unknown[]) {
  const result = await database.prepare(query).bind(...values).all<T>();
  return Array.isArray(result) ? result : (result.results ?? []);
}

export function createInMemoryRiskStore(): InMemoryRiskStore {
  return {
    assessments: [],
  };
}

export function createInMemoryRiskRepository(
  options: RiskRepositoryOptions,
  store: InMemoryRiskStore = createInMemoryRiskStore(),
): RiskRepository {
  return {
    async openOrUpdateAssessment(assessment) {
      const dedupKey = riskDedupKey(options.siteId, assessment);
      const existing = store.assessments.find((entry) =>
        entry.siteId === options.siteId
          && entry.assetId === assessment.assetId
          && entry.reasonKey === assessment.reasonKey
          && entry.status === "OPEN"
          && riskDedupKey(entry.siteId, entry) === dedupKey
      );
      const record = recordFromAssessment(options.siteId, assessment, existing);

      if (existing) {
        const index = store.assessments.findIndex((entry) => entry.id === existing.id);
        store.assessments[index] = record;
      } else {
        store.assessments.push(record);
      }

      return record;
    },

    async listOpen(siteId) {
      return store.assessments
        .filter((entry) => entry.siteId === siteId && entry.status === "OPEN")
        .sort(compareUpdatedAtDesc);
    },
  };
}

export function createD1RiskRepository(database: D1DatabaseLike, options: RiskRepositoryOptions): RiskRepository {
  return {
    async openOrUpdateAssessment(assessment) {
      const dedupKey = riskDedupKey(options.siteId, assessment);
      const record = recordFromAssessment(options.siteId, assessment);

      await database.prepare(
        `insert into riskAssessments (
          id,
          dedup_key,
          site_id,
          asset_id,
          level,
          score,
          confidence,
          evidence_json,
          observed_window,
          should_notify_maintenance,
          reason_key,
          assessed_at,
          status,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(dedup_key) do update set
          level = excluded.level,
          score = excluded.score,
          confidence = excluded.confidence,
          evidence_json = excluded.evidence_json,
          observed_window = excluded.observed_window,
          should_notify_maintenance = excluded.should_notify_maintenance,
          reason_key = excluded.reason_key,
          assessed_at = excluded.assessed_at,
          status = 'OPEN',
          updated_at = excluded.updated_at`,
      ).bind(
        record.id,
        dedupKey,
        record.siteId,
        record.assetId,
        record.level,
        record.score,
        record.confidence,
        JSON.stringify(record.evidence),
        record.observedWindow,
        record.shouldNotifyMaintenance ? 1 : 0,
        record.reasonKey,
        record.assessedAt,
        record.status,
        record.createdAt,
        record.updatedAt,
      ).run();

      const persisted = await database.prepare(
        `select
          id,
          site_id,
          asset_id,
          level,
          score,
          confidence,
          evidence_json,
          observed_window,
          should_notify_maintenance,
          reason_key,
          assessed_at,
          status,
          created_at,
          updated_at
        from riskAssessments
        where dedup_key = ?`,
      ).bind(dedupKey).first<RiskAssessmentRow>();

      return rowToRiskAssessmentRecord(persisted ?? {
        id: record.id,
        site_id: record.siteId,
        asset_id: record.assetId,
        level: record.level,
        score: record.score,
        confidence: record.confidence,
        evidence_json: JSON.stringify(record.evidence),
        observed_window: record.observedWindow,
        should_notify_maintenance: record.shouldNotifyMaintenance ? 1 : 0,
        reason_key: record.reasonKey,
        assessed_at: record.assessedAt,
        status: record.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    },

    async listOpen(siteId) {
      const rows = await allRows<RiskAssessmentRow>(
        database,
        `select
          id,
          site_id,
          asset_id,
          level,
          score,
          confidence,
          evidence_json,
          observed_window,
          should_notify_maintenance,
          reason_key,
          assessed_at,
          status,
          created_at,
          updated_at
        from riskAssessments
        where site_id = ? and status = 'OPEN'
        order by updated_at desc`,
        [siteId],
      );

      return rows.map(rowToRiskAssessmentRecord);
    },
  };
}

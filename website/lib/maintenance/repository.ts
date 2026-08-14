import type { CreateMaintenanceAction, MaintenanceAction, MaintenanceOutcome } from "./contracts.ts";

export interface MaintenanceRepository {
  createAction(input: CreateMaintenanceAction): Promise<MaintenanceAction>;
  completeAction(id: string, outcome: MaintenanceOutcome): Promise<MaintenanceAction>;
}

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};

type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

type ActualOverheatLabel = "CONFIRMED" | "NOT_CONFIRMED" | "UNKNOWN";

type StoredMaintenanceAction = MaintenanceAction & {
  actualOverheatLabel: ActualOverheatLabel;
};

export type InMemoryMaintenanceStore = {
  actions: StoredMaintenanceAction[];
};

export type MaintenanceRepositoryOptions = {
  now?: () => string;
};

type MaintenanceActionRow = {
  id: string;
  site_id: string;
  asset_id: string;
  risk_assessment_id: string;
  assignee: string;
  note: string;
  status: MaintenanceAction["status"];
  inspection_note: string;
  action_taken: string;
  parts_replaced_json: string;
  can_return_to_service: number;
  actual_overheat_label: ActualOverheatLabel;
  created_at: string;
  completed_at: string | null;
};

function defaultNow() {
  return new Date().toISOString();
}

function createId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `maintenance_${randomId}`;
  }

  return `maintenance_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function actualOverheatLabel(value: boolean | null): ActualOverheatLabel {
  if (value === true) {
    return "CONFIRMED";
  }

  if (value === false) {
    return "NOT_CONFIRMED";
  }

  return "UNKNOWN";
}

function labelToActualOverheat(label: ActualOverheatLabel): boolean | null {
  if (label === "CONFIRMED") {
    return true;
  }

  if (label === "NOT_CONFIRMED") {
    return false;
  }

  return null;
}

function toStoredAction(action: MaintenanceAction): StoredMaintenanceAction {
  return {
    ...action,
    actualOverheatLabel: actualOverheatLabel(action.actualOverheat),
  };
}

function toDomainAction(action: StoredMaintenanceAction): MaintenanceAction {
  const { actualOverheatLabel: _label, ...domainAction } = action;
  return {
    ...domainAction,
    actualOverheat: labelToActualOverheat(action.actualOverheatLabel),
  };
}

function rowToMaintenanceAction(row: MaintenanceActionRow): MaintenanceAction {
  return {
    id: row.id,
    siteId: row.site_id,
    assetId: row.asset_id,
    riskAssessmentId: row.risk_assessment_id,
    assignee: row.assignee,
    note: row.note,
    status: row.status,
    inspectionNote: row.inspection_note,
    actionTaken: row.action_taken,
    partsReplaced: JSON.parse(row.parts_replaced_json) as string[],
    canReturnToService: row.can_return_to_service === 1,
    actualOverheat: labelToActualOverheat(row.actual_overheat_label),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function buildCreatedAction(input: CreateMaintenanceAction, now: string): MaintenanceAction {
  return {
    ...input,
    id: createId(),
    status: "ACKNOWLEDGED",
    inspectionNote: "",
    actionTaken: "",
    partsReplaced: [],
    canReturnToService: false,
    actualOverheat: null,
    createdAt: now,
    completedAt: null,
  };
}

export function createInMemoryMaintenanceStore(): InMemoryMaintenanceStore {
  return {
    actions: [],
  };
}

export function createInMemoryMaintenanceRepository(
  options: MaintenanceRepositoryOptions = {},
  store: InMemoryMaintenanceStore = createInMemoryMaintenanceStore(),
): MaintenanceRepository {
  const now = options.now ?? defaultNow;

  return {
    async createAction(input) {
      const action = toStoredAction(buildCreatedAction(input, now()));
      store.actions.push(action);
      return toDomainAction(action);
    },

    async completeAction(id, outcome) {
      const existing = store.actions.find((entry) => entry.id === id);
      if (!existing) {
        throw new Error(`Maintenance action not found: ${id}`);
      }

      const updated: StoredMaintenanceAction = {
        ...existing,
        ...outcome,
        actualOverheat: outcome.actualOverheat,
        actualOverheatLabel: actualOverheatLabel(outcome.actualOverheat),
        completedAt: outcome.status === "COMPLETED" ? now() : null,
      };
      const index = store.actions.findIndex((entry) => entry.id === id);
      store.actions[index] = updated;
      return toDomainAction(updated);
    },
  };
}

export function createD1MaintenanceRepository(
  database: D1DatabaseLike,
  options: MaintenanceRepositoryOptions = {},
): MaintenanceRepository {
  const now = options.now ?? defaultNow;

  return {
    async createAction(input) {
      const action = buildCreatedAction(input, now());
      const label = actualOverheatLabel(action.actualOverheat);

      await database.prepare(
        `insert into maintenanceActions (
          id,
          site_id,
          asset_id,
          risk_assessment_id,
          assignee,
          note,
          status,
          inspection_note,
          action_taken,
          parts_replaced_json,
          can_return_to_service,
          actual_overheat_label,
          created_at,
          completed_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        action.id,
        action.siteId,
        action.assetId,
        action.riskAssessmentId,
        action.assignee,
        action.note,
        action.status,
        action.inspectionNote,
        action.actionTaken,
        JSON.stringify(action.partsReplaced),
        action.canReturnToService ? 1 : 0,
        label,
        action.createdAt,
        action.completedAt,
      ).run();

      return action;
    },

    async completeAction(id, outcome) {
      const completedAt = outcome.status === "COMPLETED" ? now() : null;

      await database.prepare(
        `update maintenanceActions
        set status = ?,
            inspection_note = ?,
            action_taken = ?,
            parts_replaced_json = ?,
            can_return_to_service = ?,
            actual_overheat_label = ?,
            completed_at = ?
        where id = ?`,
      ).bind(
        outcome.status,
        outcome.inspectionNote,
        outcome.actionTaken,
        JSON.stringify(outcome.partsReplaced),
        outcome.canReturnToService ? 1 : 0,
        actualOverheatLabel(outcome.actualOverheat),
        completedAt,
        id,
      ).run();

      const persisted = await database.prepare(
        `select
          id,
          site_id,
          asset_id,
          risk_assessment_id,
          assignee,
          note,
          status,
          inspection_note,
          action_taken,
          parts_replaced_json,
          can_return_to_service,
          actual_overheat_label,
          created_at,
          completed_at
        from maintenanceActions
        where id = ?`,
      ).bind(id).first<MaintenanceActionRow>();

      if (!persisted) {
        throw new Error(`Maintenance action not found: ${id}`);
      }

      return rowToMaintenanceAction(persisted);
    },
  };
}

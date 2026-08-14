import type { MaintenanceAction } from "../maintenance/contracts.ts";
import type { RiskAssessmentRecord } from "../risk/repository.ts";
import type { RawTelemetry } from "./contracts.ts";
import type { IngestTelemetryResult } from "./ingest.ts";

export type ReplaySummaryInput = {
  records: ReadonlyArray<Pick<RawTelemetry, "assetId" | "observedAt">>;
  ingestResults: ReadonlyArray<Pick<IngestTelemetryResult, "accepted" | "qualityIssues">>;
  alertEvents?: ReadonlyArray<Pick<RiskAssessmentRecord, "id">>;
  maintenanceActions?: ReadonlyArray<Pick<MaintenanceAction, "status" | "actualOverheat">>;
};

export type ReplaySummary = {
  totalRecords: number;
  validRecords: number;
  qualityIssueCount: number;
  maintenanceAlertCount: number;
  duplicateAlertCount: number;
  labeledOutcomes: {
    total: number;
    confirmed: number;
    notConfirmed: number;
  };
};

export function summarizeReplay(input: ReplaySummaryInput): ReplaySummary {
  const alertEvents = input.alertEvents ?? [];
  const maintenanceActions = input.maintenanceActions ?? [];
  const uniqueAlertIds = new Set(alertEvents.map((event) => event.id));
  const labeledActions = maintenanceActions.filter((action) => (
    action.status === "COMPLETED" && action.actualOverheat !== null
  ));

  return {
    totalRecords: input.records.length,
    validRecords: input.ingestResults.reduce((total, result) => total + result.accepted, 0),
    qualityIssueCount: input.ingestResults.reduce((total, result) => total + result.qualityIssues.length, 0),
    maintenanceAlertCount: uniqueAlertIds.size,
    duplicateAlertCount: Math.max(0, alertEvents.length - uniqueAlertIds.size),
    labeledOutcomes: {
      total: labeledActions.length,
      confirmed: labeledActions.filter((action) => action.actualOverheat === true).length,
      notConfirmed: labeledActions.filter((action) => action.actualOverheat === false).length,
    },
  };
}

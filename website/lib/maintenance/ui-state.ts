import type { MaintenanceAction, CreateMaintenanceAction } from "./contracts.ts";
import type { RiskAssessmentRecord } from "../risk/repository.ts";

export type MaintenanceUiAssessment = RiskAssessmentRecord & {
  maintenanceStatus?: MaintenanceAction["status"];
};

export function riskStatusForAction(status: MaintenanceAction["status"]): RiskAssessmentRecord["status"] {
  return status === "COMPLETED" ? "COMPLETED" : "ACKNOWLEDGED";
}

export function applyMaintenanceAction(
  assessments: MaintenanceUiAssessment[],
  input: Pick<CreateMaintenanceAction, "riskAssessmentId">,
  actionStatus: MaintenanceAction["status"],
): MaintenanceUiAssessment[] {
  return assessments.map((assessment) => assessment.id === input.riskAssessmentId
    ? { ...assessment, status: riskStatusForAction(actionStatus), maintenanceStatus: actionStatus, updatedAt: new Date().toISOString() }
    : assessment);
}

export function maintenanceDisplayStatus(assessment: MaintenanceUiAssessment) {
  return assessment.maintenanceStatus ?? assessment.status;
}

export function maintenanceStatusView(assessment: MaintenanceUiAssessment) {
  const status = maintenanceDisplayStatus(assessment);
  return {
    label: status,
    className: `action-status action-${status}`,
  };
}

export type CreateMaintenanceAction = {
  siteId: string;
  assetId: string;
  riskAssessmentId: string;
  assignee: string;
  note: string;
};

export type MaintenanceOutcome = {
  status: "ACKNOWLEDGED" | "IN_PROGRESS" | "COMPLETED";
  inspectionNote: string;
  actionTaken: string;
  partsReplaced: string[];
  canReturnToService: boolean;
  actualOverheat: boolean | null;
};

export type MaintenanceAction = CreateMaintenanceAction & MaintenanceOutcome & {
  id: string;
  createdAt: string;
  completedAt: string | null;
};

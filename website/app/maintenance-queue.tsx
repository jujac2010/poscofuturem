import type { RiskAssessmentRecord } from "../lib/risk/repository";
import { applyMaintenanceAction, maintenanceStatusView, type MaintenanceUiAssessment } from "../lib/maintenance/ui-state";

export { applyMaintenanceAction };

export type MaintenanceQueueProps = {
  assessments: MaintenanceUiAssessment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const statusLabels: Record<RiskAssessmentRecord["status"] | "IN_PROGRESS", string> = {
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  DISMISSED: "DISMISSED",
};

export function MaintenanceQueue({ assessments, selectedId, onSelect }: MaintenanceQueueProps) {
  return <section className="maintenance-queue panel" aria-label="정비 경보">
    <div className="panel-header"><div><span className="section-kicker">MAINTENANCE QUEUE</span><h2>정비 경보</h2></div><span className="panel-meta">{assessments.length}건 대기</span></div>
    <p className="maintenance-window">향후 48시간 내 과열 위험 관찰 구간</p>
    <div className="maintenance-list">
      {assessments.length === 0 && <p className="empty-state">현재 열린 정비 경보가 없습니다.</p>}
      {assessments.map((assessment) => <button type="button" key={assessment.id} className={`maintenance-row ${selectedId === assessment.id ? "selected" : ""}`} onClick={() => onSelect(assessment.id)} aria-pressed={selectedId === assessment.id}>
        <span className="maintenance-row-main"><strong>{assessment.assetId}</strong><span>{assessment.level} · {assessment.reasonKey}</span></span>
        <span className={maintenanceStatusView(assessment).className}>{statusLabels[maintenanceStatusView(assessment).label]}</span>
        <span className="maintenance-row-score">{assessment.score}점</span>
      </button>)}
    </div>
  </section>;
}

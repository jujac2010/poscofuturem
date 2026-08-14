"use client";

import { useState } from "react";
import type { CreateMaintenanceAction, MaintenanceAction } from "../lib/maintenance/contracts";
import type { RiskAssessmentRecord } from "../lib/risk/repository";
import type { TelemetrySnapshot } from "../lib/telemetry/contracts";

export type ForkliftDetailProps = {
  snapshot: TelemetrySnapshot | null;
  assessment: RiskAssessmentRecord | null;
  onSubmitAction: (input: CreateMaintenanceAction) => Promise<void>;
};

type ActionStatus = MaintenanceAction["status"];

export function ForkliftDetail({ snapshot, assessment, onSubmitAction }: ForkliftDetailProps) {
  const [status, setStatus] = useState<ActionStatus>("ACKNOWLEDGED");
  const [assignee, setAssignee] = useState("현장 정비팀");
  const [note, setNote] = useState("과열 위험 관찰 구간 점검을 시작합니다.");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<ActionStatus | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assessment || pending) return;
    setPending(true);
    setError("");
    try {
      const input: CreateMaintenanceAction = { siteId: assessment.siteId, assetId: assessment.assetId, riskAssessmentId: assessment.id, assignee, note };
      const response = await fetch("/api/maintenance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "정비 조치 저장에 실패했습니다.");
      const action = await response.json() as MaintenanceAction;
      if (status !== action.status) {
        const update = await fetch(`/api/maintenance/${action.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, inspectionNote: note, actionTaken: status === "COMPLETED" ? "과열 위험 구간 점검 완료" : "점검 진행", partsReplaced: [], canReturnToService: status === "COMPLETED", actualOverheat: null }) });
        if (!update.ok) throw new Error((await update.json().catch(() => null))?.error ?? "정비 상태 저장에 실패했습니다.");
      }
      setSaved(status);
      await onSubmitAction(input);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "정비 조치 저장에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  if (!snapshot || !assessment) return <section className="forklift-detail panel" aria-label="지게차 정비 상세"><div className="panel-header"><h2>경보를 선택하세요</h2></div></section>;

  return <section className="forklift-detail panel" aria-label="지게차 정비 상세">
    <div className="panel-header"><div><span className="section-kicker">MAINTENANCE DETAIL</span><h2>{assessment.assetId}</h2></div><span className={`action-status action-${saved ?? assessment.status}`}>{saved ?? assessment.status}</span></div>
    <div className="evidence-panel"><h3>경보 근거</h3><p>{assessment.reasonKey}</p><ul>{assessment.evidence.map((item) => <li key={item}>{item}</li>)}</ul><small>관찰 구간: {assessment.observedWindow} · 신뢰도 {assessment.confidence}%</small></div>
    <div className="maintenance-metrics"><span>냉각수 <strong>{snapshot.engineCoolantTemperature ?? "-"}°C</strong></span><span>엔진오일 <strong>{snapshot.engineOilTemperature ?? "-"}°C</strong></span><span>부하율 <strong>{snapshot.loadRate === null ? "-" : `${Math.round(snapshot.loadRate * 100)}%`}</strong></span></div>
    <form className="action-form" onSubmit={submit}><h3>점검 결과 기록</h3><label>상태<select value={status} onChange={(event) => setStatus(event.target.value as ActionStatus)} disabled={pending}><option>ACKNOWLEDGED</option><option>IN_PROGRESS</option><option>COMPLETED</option></select></label><label>담당자<input value={assignee} onChange={(event) => setAssignee(event.target.value)} disabled={pending} /></label><label>조치 메모<textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={pending} /></label>{error && <p className="inline-error" role="alert">{error}</p>}{saved && <p className="inline-success" role="status">{saved} 상태로 저장했습니다.</p>}<button className="report-button" type="submit" disabled={pending}>{pending ? "저장 중…" : "정비 조치 저장"}</button></form>
  </section>;
}

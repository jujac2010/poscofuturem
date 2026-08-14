import type { DataQuality } from "../lib/telemetry/contracts";
import type { SourceHealth } from "../lib/risk/contracts";

export type DataQualityPanelProps = { health: SourceHealth[]; issues: DataQuality[] };

export function DataQualityPanel({ health, issues }: DataQualityPanelProps) {
  return <section className="data-quality-panel panel" aria-label="데이터 수신 상태">
    <div className="panel-header"><div><span className="section-kicker">DATA QUALITY</span><h2>데이터 수신 상태</h2></div><span className="panel-meta">{issues.length ? `${issues.length}건 확인 필요` : "정상 수신"}</span></div>
    <div className="quality-health">{health.map((item) => <div className="quality-row" key={item.sourceType}><span>{item.sourceType}</span><strong>{item.status}</strong><small>{item.message ?? "최근 데이터 정상 수신"}</small></div>)}</div>
    {issues.length > 0 && <div className="quality-issues"><h3>품질 이슈</h3>{issues.map((issue) => <div className="quality-issue" key={`${issue.assetId}-${issue.observedAt}`}><strong>{issue.assetId} · {issue.status}</strong><span>{issue.message}</span></div>)}</div>}
  </section>;
}

import type { EcuSnapshot } from "../ecu/types";
import type { DiagnosticReport } from "../diagnostics/evaluator";

export type TwinAiForklift = { id: string; zone: string; task: string; status: string };
export type TwinAiEvent = { time: string; label: string; text: string; tone: string };
export type TwinAiContext = {
  forklifts: TwinAiForklift[];
  snapshots: Record<string, EcuSnapshot>;
  diagnostics: Record<string, DiagnosticReport>;
  records: string[][];
  events: TwinAiEvent[];
};

export type TwinAiResult = {
  title: string;
  answer: string;
  evidence: string[];
  actions: string[];
  targetId?: string;
};

export type FleetReport = TwinAiResult & { highestRiskForklift: string; highestRiskScore: number };

const help = "질문 예시: 현재 가장 위험한 장비는? · P-03호 상태 분석 · 정비가 필요한 장비는? · 운행기록 요약";
const riskOrder: Record<string, number> = { 정상: 0, 주의: 1, 위험: 2, 긴급: 3 };

function diagnosticsSorted(context: TwinAiContext) {
  return context.forklifts
    .map((forklift) => ({ forklift, diagnostic: context.diagnostics[forklift.id] }))
    .filter((item) => item.diagnostic)
    .sort((a, b) => b.diagnostic.score - a.diagnostic.score || riskOrder[b.diagnostic.level] - riskOrder[a.diagnostic.level]);
}

function deviceSummary(forklift: TwinAiForklift, diagnostic: DiagnosticReport): TwinAiResult {
  return {
    title: `${forklift.id} 상태 분석`,
    answer: `${forklift.id}은(는) 현재 ${diagnostic.level} 상태이며 위험도 점수는 ${diagnostic.score}점입니다. ${diagnostic.summary}`,
    evidence: diagnostic.findings.slice(0, 4),
    actions: [diagnostic.recommendation, `현재 위치: ${forklift.zone} · 작업: ${forklift.task}`],
    targetId: forklift.id,
  };
}

export function buildFleetReport(forklifts: TwinAiForklift[], snapshots: Record<string, EcuSnapshot>, records: string[][], events: TwinAiEvent[], diagnostics: Record<string, DiagnosticReport>): FleetReport {
  const context: TwinAiContext = { forklifts, snapshots, diagnostics, records, events };
  const sorted = diagnosticsSorted(context);
  const top = sorted[0];
  const urgent = sorted.filter(({ diagnostic }) => diagnostic.level === "긴급" || diagnostic.level === "위험");
  const normal = sorted.filter(({ diagnostic }) => diagnostic.level === "정상").length;
  const summary = top
    ? `현재 가장 위험한 장비는 ${top.forklift.id}이며 ${top.diagnostic.score}점입니다. 전체 ${forklifts.length}대 중 정상 ${normal}대, 점검 우선 ${urgent.length}대입니다.`
    : "아직 실시간 진단 데이터가 수신되지 않았습니다.";
  return {
    title: "전체 운용 장비 분석",
    answer: summary,
    evidence: top ? [`최고 위험도: ${top.forklift.id} · ${top.diagnostic.level} · ${top.diagnostic.score}점`, ...top.diagnostic.findings.slice(0, 3)] : ["ECU 데이터 수신 대기"],
    actions: top ? [top.diagnostic.recommendation, `운행기록 ${records.length}건 · 이벤트 ${events.length}건을 함께 분석했습니다.`] : ["ECU 데이터 수신 후 다시 분석하십시오."],
    highestRiskForklift: top?.forklift.id ?? "-",
    highestRiskScore: top?.diagnostic.score ?? 0,
    targetId: top?.forklift.id,
  };
}

export function analyzeIncident(forklift: TwinAiForklift, diagnostic: DiagnosticReport): TwinAiResult {
  const joined = diagnostic.findings.join(" ");
  const cause = joined.includes("진동") && joined.includes("온도") ? "열 상승과 구동계 진동이 동시에 감지된 복합 이상" : joined.includes("진동") ? "구동계·베어링·타이어 계통의 진동 이상" : joined.includes("온도") ? "냉각 또는 엔진오일 계통의 온도 상승" : joined.includes("배터리") ? "배터리 잔량 부족" : "센서값의 복합적인 변화";
  return {
    title: `${forklift.id} 이상 원인 분석`,
    answer: `${forklift.id}의 이상 원인은 ${cause}으로 추정됩니다. 현재 ${diagnostic.level} 단계입니다.`,
    evidence: diagnostic.findings,
    actions: [diagnostic.recommendation, `정비 권고 위치: 정비구역 · 현재 위치: ${forklift.zone}`],
    targetId: forklift.id,
  };
}

export function summarizeDrivingRecords(records: string[][], forklifts: TwinAiForklift[], events: TwinAiEvent[]): TwinAiResult {
  const statusCounts = forklifts.reduce<Record<string, number>>((acc, forklift) => { acc[forklift.status] = (acc[forklift.status] ?? 0) + 1; return acc; }, {});
  const mostRecent = records[0]?.[1] ?? "기록 없음";
  return {
    title: "운행기록 AI 요약",
    answer: `총 ${records.length}건의 운행기록과 ${events.length}건의 이벤트를 분석했습니다. 최근 운행 장비는 ${mostRecent}입니다.`,
    evidence: [`정상 ${statusCounts.정상 ?? 0}대 · 주의 ${statusCounts.주의 ?? 0}대 · 점검 ${statusCounts.점검 ?? 0}대`, `운행기록 ${records.length}건`, `이벤트 로그 ${events.length}건`],
    actions: events.some((event) => event.tone === "critical") ? ["긴급 이벤트가 있어 점검 대상 장비를 우선 확인하십시오."] : ["현재 운행기록 흐름을 계속 관찰하십시오."],
  };
}

export function answerQuestion(question: string, context: TwinAiContext): TwinAiResult {
  const normalized = question.trim();
  if (!normalized) return { title: "질문을 입력해 주세요", answer: help, evidence: [], actions: [] };
  const device = context.forklifts.find((forklift) => normalized.toUpperCase().includes(forklift.id.toUpperCase()));
  if (device && context.diagnostics[device.id]) return deviceSummary(device, context.diagnostics[device.id]);
  if (normalized.includes("운행") || normalized.includes("기록") || normalized.includes("요약")) return summarizeDrivingRecords(context.records, context.forklifts, context.events);
  if (normalized.includes("전체") || normalized.includes("리포트") || normalized.includes("진단")) return buildFleetReport(context.forklifts, context.snapshots, context.records, context.events, context.diagnostics);
  if (normalized.includes("위험") || normalized.includes("점검") || normalized.includes("정비")) {
    const report = buildFleetReport(context.forklifts, context.snapshots, context.records, context.events, context.diagnostics);
    return { ...report, title: normalized.includes("위험") ? "최고 위험 장비 분석" : "정비 우선 장비 분석" };
  }
  return { title: "Twin AI 질문 안내", answer: help, evidence: ["현재 지원 질문: 위험도, 장비 상태, 정비, 운행기록, 전체 리포트"], actions: [] };
}

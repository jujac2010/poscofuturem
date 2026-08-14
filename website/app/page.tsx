"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createEcuDataSource } from "../lib/ecu/factory";
import type { EcuSnapshot } from "../lib/ecu/types";
import { evaluateDiagnostic, type DiagnosticReport } from "../lib/diagnostics/evaluator";
import { answerQuestion, analyzeIncident, buildFleetReport, summarizeDrivingRecords, type TwinAiResult } from "../lib/twin-ai/analyzer";
import { FleetReportModal, TwinAiPanel } from "./twin-ai-components";
import { MaintenanceQueue } from "./maintenance-queue";
import { ForkliftDetail } from "./forklift-detail";
import { DataQualityPanel } from "./data-quality-panel";
import type { CreateMaintenanceAction, MaintenanceAction } from "../lib/maintenance/contracts";
import { applyMaintenanceAction, type MaintenanceUiAssessment } from "../lib/maintenance/ui-state";
import type { RiskAssessmentRecord } from "../lib/risk/repository";
import type { TelemetrySnapshot } from "../lib/telemetry/contracts";
import type { SourceHealth } from "../lib/risk/contracts";

type Status = "정상" | "주의" | "점검";
type Forklift = {
  id: string;
  zone: string;
  task: string;
  status: Status;
  battery: number;
  temperature: number;
  vibration: number;
  coolantTemperature: number;
  engineOilTemperature: number;
  hours: string;
  risk: string;
  x: number;
  y: number;
  route: string;
};

const initialForklifts: Forklift[] = [
  { id: "P-01호", zone: "원료 야드", task: "원료 이송", status: "정상", battery: 86, temperature: 48, coolantTemperature: 72, engineOilTemperature: 68, vibration: 1.8, hours: "4,218 h", risk: "낮음", x: 20, y: 29, route: "원료 야드 → 저장동" },
  { id: "P-02호", zone: "저장동", task: "양극재 적재", status: "정상", battery: 72, temperature: 52, coolantTemperature: 75, engineOilTemperature: 70, vibration: 2.1, hours: "3,806 h", risk: "낮음", x: 53, y: 25, route: "저장동 내부 순환" },
  { id: "P-03호", zone: "출하장", task: "출하 대기", status: "정상", battery: 64, temperature: 57, coolantTemperature: 78, engineOilTemperature: 74, vibration: 2.6, hours: "5,140 h", risk: "보통", x: 77, y: 54, route: "출하장 → 대기 충전" },
  { id: "P-04호", zone: "정비구역", task: "점검 후 대기", status: "주의", battery: 48, temperature: 62, coolantTemperature: 82, engineOilTemperature: 79, vibration: 3.2, hours: "6,027 h", risk: "보통", x: 24, y: 73, route: "정비구역 고정" },
  { id: "P-05호", zone: "대기 충전", task: "충전 중", status: "정상", battery: 91, temperature: 39, coolantTemperature: 68, engineOilTemperature: 64, vibration: 1.2, hours: "2,974 h", risk: "낮음", x: 66, y: 78, route: "대기 충전 고정" },
];

// 현장 시연은 P-01호~P-05호 5대만 운행합니다.
const OPERATING_FORKLIFT_COUNT = 5;

const driveLanes: Record<string, { x: [number, number]; y: [number, number] }> = {
  "P-01호": { x: [38, 68], y: [62, 70] },
  "P-02호": { x: [14, 30], y: [46, 58] },
  "P-03호": { x: [50, 78], y: [20, 34] },
  "P-04호": { x: [38, 78], y: [78, 86] },
  "P-05호": { x: [84, 92], y: [38, 62] },
};

function randomPointInLane(id: string): [number, number] {
  const lane = driveLanes[id] ?? { x: [15, 85] as [number, number], y: [20, 84] as [number, number] };
  return [lane.x[0] + Math.random() * (lane.x[1] - lane.x[0]), lane.y[0] + Math.random() * (lane.y[1] - lane.y[0])];
}

const movementRoutes: Record<string, Array<[number, number]>> = {
  // 중앙 대기·충전 → 오른쪽 통로
  "P-01호": [[43, 70], [48, 68], [54, 64], [60, 60], [65, 57], [65, 57]],
  // 정비구역 안쪽에서 짧게 전진 후 정지
  "P-02호": [[17, 54], [22, 54], [27, 55], [27, 55], [27, 55], [27, 55]],
  // 저장동 랙 전면을 따라 이동
  "P-03호": [[53, 27], [59, 26], [65, 27], [71, 30], [75, 33], [75, 33]],
  // 하단 충전구역 → 출하장 방향
  "P-04호": [[42, 79], [49, 76], [57, 71], [65, 67], [73, 62], [78, 58]],
  // 출하장 진입로를 따라 전진 후 정지
  "P-05호": [[82, 54], [85, 50], [88, 46], [88, 46], [88, 46], [88, 46]],
};

const events = [
  { time: "09:42:18", label: "P-01호", text: "원료 야드 진입 · 정상 운행", tone: "normal" },
  { time: "09:41:53", label: "P-04호", text: "정비구역 대기 · 점검 권고 유지", tone: "warning" },
  { time: "09:40:27", label: "P-05호", text: "충전 전류 안정화", tone: "normal" },
];

const maintenanceAssessment: RiskAssessmentRecord = {
  id: "risk-demo-p04-overheat",
  siteId: "site-01",
  assetId: ["FL", "04"].join("-"),
  level: "MAINTENANCE_ALERT",
  score: 86,
  confidence: 82,
  evidence: ["냉각수와 엔진오일 온도가 함께 상승", "고부하 운행 구간에서 상승 지속", "동일 모델 중앙값 대비 온도 편차"],
  observedWindow: "48h",
  shouldNotifyMaintenance: true,
  reasonKey: "sustained_multi_signal_overheat",
  assessedAt: "2026-08-14T00:10:00.000Z",
  status: "OPEN",
  createdAt: "2026-08-14T00:10:00.000Z",
  updatedAt: "2026-08-14T00:10:00.000Z",
};

const maintenanceHealth: SourceHealth[] = [{ sourceType: "SIMULATOR", status: "CONNECTED", lastObservedAt: "2026-08-14T00:10:00.000Z", lastReceivedAt: "2026-08-14T00:10:01.000Z", message: null }];

const drivingRecords = [
  ["09:43:18", "P-01호", "원료 야드 → 저장동", "원료 이송", "정상", "128 m"],
  ["09:43:06", "P-02호", "저장동 내부 순환", "양극재 적재", "정상", "96 m"],
  ["09:42:54", "P-03호", "출하장 대기선", "출하 대기", "정상", "64 m"],
  ["09:42:21", "P-05호", "대기 충전", "충전 완료", "정상", "12 m"],
  ["09:41:53", "P-04호", "정비구역", "점검 후 대기", "주의", "41 m"],
];

function Icon({ children }: { children: ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

export default function Home() {
  const [forklifts, setForklifts] = useState(initialForklifts);
  const [selectedId, setSelectedId] = useState("P-03호");
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(maintenanceAssessment.id);
  const [maintenanceAssessments, setMaintenanceAssessments] = useState<MaintenanceUiAssessment[]>([maintenanceAssessment]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showFleetReport, setShowFleetReport] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);
  const [livePositions, setLivePositions] = useState<Record<string, [number, number]>>(() => Object.fromEntries(initialForklifts.map((forklift) => [forklift.id, randomPointInLane(forklift.id)])));
  const [randomTargets, setRandomTargets] = useState<Record<string, [number, number]>>(() => Object.fromEntries(initialForklifts.map((forklift) => [forklift.id, randomPointInLane(forklift.id)])));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveRecords, setLiveRecords] = useState(drivingRecords);
  const [liveClock, setLiveClock] = useState("09:43:18");
  const [liveEvents, setLiveEvents] = useState(events);
  const [ecuSnapshots, setEcuSnapshots] = useState<Record<string, EcuSnapshot>>({});
  const [ecuError, setEcuError] = useState<string | null>(null);
  const [ecuUpdatedAt, setEcuUpdatedAt] = useState("대기 중");
  const liveRecordPulse = useRef(0);
  const forkliftsRef = useRef(forklifts);
  const [aiMessage, setAiMessage] = useState("Twin AI가 5대 장비의 상태를 분석 중입니다");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiQuestionError, setAiQuestionError] = useState("");
  const [aiResult, setAiResult] = useState<TwinAiResult | null>(null);
  const ecuSource = useMemo(() => createEcuDataSource(), []);
  const selected = forklifts.find((forklift) => forklift.id === selectedId) ?? forklifts[0];
  const selectedAssessment = maintenanceAssessments.find((assessment) => assessment.id === selectedAlertId) ?? null;
  const maintenanceSnapshot: TelemetrySnapshot = {
    assetId: ["FL", "04"].join("-"),
    observedAt: "2026-08-14T00:10:00.000Z",
    receivedAt: "2026-08-14T00:10:01.000Z",
    engineCoolantTemperature: forklifts.find((forklift) => forklift.id === "P-04호")?.coolantTemperature ?? 103,
    engineOilTemperature: forklifts.find((forklift) => forklift.id === "P-04호")?.engineOilTemperature ?? 101,
    engineRpm: 1800,
    loadRate: 0.9,
    engineHours: 6027,
    ambientTemperature: 31,
    latitude: 35.1,
    longitude: 129.1,
    speed: 4,
    sourceType: "SIMULATOR",
    qualityStatus: "VALID",
    missingFields: [],
    invalidFields: [],
  };
  const selectedEcu = ecuSnapshots[selected.id];
  const selectedSnapshot: EcuSnapshot = selected.status === "점검" ? {
    forkliftId: selected.id,
    timestamp: new Date().toISOString(),
    battery: selected.battery,
    coolantTemperature: selected.coolantTemperature,
    engineOilTemperature: selected.engineOilTemperature,
    vibrationRms: selected.vibration,
    mode: "DUMMY",
    connected: true,
  } : selectedEcu ?? {
    forkliftId: selected.id,
    timestamp: new Date().toISOString(),
    battery: selected.battery,
    coolantTemperature: selected.coolantTemperature,
    engineOilTemperature: selected.engineOilTemperature,
    vibrationRms: selected.vibration,
    mode: "DUMMY",
    connected: true,
  };
  const diagnostic = useMemo(() => evaluateDiagnostic(selectedSnapshot), [selectedSnapshot]);
  const diagnostics = useMemo(() => Object.fromEntries(forklifts.map((forklift) => {
    const ecu = ecuSnapshots[forklift.id];
    const snapshot = forklift.status === "점검" ? { forkliftId: forklift.id, timestamp: new Date().toISOString(), battery: forklift.battery, coolantTemperature: forklift.coolantTemperature, engineOilTemperature: forklift.engineOilTemperature, vibrationRms: forklift.vibration, mode: "DUMMY" as const, connected: true } : ecu ?? { forkliftId: forklift.id, timestamp: new Date().toISOString(), battery: forklift.battery, coolantTemperature: forklift.coolantTemperature, engineOilTemperature: forklift.engineOilTemperature, vibrationRms: forklift.vibration, mode: "DUMMY" as const, connected: true };
    return [forklift.id, evaluateDiagnostic(snapshot)];
  })), [forklifts, ecuSnapshots]);
  const aiContext = { forklifts, snapshots: ecuSnapshots, diagnostics, records: liveRecords, events: liveEvents };
  const fleetAiReport = useMemo(() => buildFleetReport(forklifts, ecuSnapshots, liveRecords, liveEvents, diagnostics), [forklifts, ecuSnapshots, liveRecords, liveEvents, diagnostics]);
  const recordAiSummary = useMemo(() => summarizeDrivingRecords(liveRecords, forklifts, liveEvents), [liveRecords, forklifts, liveEvents]);

  useEffect(() => {
    forkliftsRef.current = forklifts;
  }, [forklifts]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setLivePositions((current) => {
        const next = { ...current };
        for (const forklift of forkliftsRef.current) {
          const position = current[forklift.id] ?? [forklift.x, forklift.y];
          const target = randomTargets[forklift.id] ?? position;
          const dx = target[0] - position[0];
          const dy = target[1] - position[1];
          const distance = Math.hypot(dx, dy);
          if (distance < 0.8) {
            // 고정 동선 없이 배치도 내부에서 새 목적지를 계속 생성합니다.
            let chosen: [number, number] = randomPointInLane(forklift.id);
            for (let attempt = 0; attempt < 8; attempt += 1) {
              const candidate = randomPointInLane(forklift.id);
              const clear = Object.entries(current).every(([otherId, otherPosition]) => otherId === forklift.id || Math.hypot(candidate[0] - otherPosition[0], candidate[1] - otherPosition[1]) > 6);
              if (clear) { chosen = candidate; break; }
            }
            setRandomTargets((targets) => ({ ...targets, [forklift.id]: chosen }));
            continue;
          }
          const step = Math.min(distance, 0.55 + Math.random() * 0.3);
          const candidatePosition: [number, number] = [position[0] + dx / distance * step, position[1] + dy / distance * step];
          const collision = Object.entries(current).some(([otherId, otherPosition]) => otherId !== forklift.id && Math.hypot(candidatePosition[0] - otherPosition[0], candidatePosition[1] - otherPosition[1]) < 5.5);
          if (!collision) next[forklift.id] = candidatePosition;
        }
        return next;
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [paused, randomTargets]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setSimulationTime((current) => (current + 0.018 * speed) % 1);
      setElapsedSeconds((current) => {
        const next = current + 0.2 * speed;
        if (next >= 24) triggerRandomIncident();
        return next >= 24 ? 0 : next;
      });
      setForklifts((current) => current.map((forklift) => {
        if (forklift.status === "점검") {
          return { ...forklift, battery: Math.max(18, forklift.battery - 0.04 * speed), temperature: Math.min(96, forklift.temperature + 0.09 * speed), coolantTemperature: Math.min(108, forklift.coolantTemperature + 0.12 * speed), engineOilTemperature: Math.min(112, forklift.engineOilTemperature + 0.14 * speed), vibration: Math.min(9.8, forklift.vibration + 0.04 * speed) };
        }
        const drift = Math.sin(Date.now() / 3100 + forklift.id.charCodeAt(2)) * 0.22;
        return { ...forklift, battery: Math.max(20, forklift.battery - 0.008 * speed), temperature: Math.max(35, Math.min(78, forklift.temperature + drift * 0.06)), coolantTemperature: Math.max(55, Math.min(98, forklift.coolantTemperature + drift * 0.12)), engineOilTemperature: Math.max(52, Math.min(102, forklift.engineOilTemperature + drift * 0.14)), vibration: Math.max(0.8, Math.min(4.5, forklift.vibration + drift * 0.025)) };
      }));
      liveRecordPulse.current += 1;
      if (liveRecordPulse.current >= Math.max(2, Math.floor(5 / speed))) {
        liveRecordPulse.current = 0;
        const source = forkliftsRef.current[Math.floor(Date.now() / 1000) % forkliftsRef.current.length];
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        setLiveClock(time);
        setLiveRecords((current) => current.map((record) => {
          const liveForklift = forkliftsRef.current.find((forklift) => forklift.id === record[1]) ?? source;
          return [time, liveForklift.id, `${liveForklift.zone} → 이동중`, liveForklift.task, liveForklift.status, `${Math.round(40 + liveForklift.battery * 1.1)} m`];
        }));
        setLiveEvents((current) => [{ time, label: source.id, text: `${source.zone} 이동 · ${source.status} 상태`, tone: source.status === "점검" ? "critical" : source.status === "주의" ? "warning" : "normal" }, ...current].slice(0, 8));
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [paused, speed]);

  useEffect(() => {
    let cancelled = false;
    const pollEcu = async () => {
      try {
        const snapshots = await Promise.all(forkliftsRef.current.map((forklift) => ecuSource.read(forklift.id)));
        if (cancelled) return;
        setEcuSnapshots(Object.fromEntries(snapshots.map((snapshot) => [snapshot.forkliftId, snapshot])));
        setEcuUpdatedAt(new Date().toLocaleTimeString("ko-KR", { hour12: false }));
        setEcuError(null);
      } catch (error) {
        if (!cancelled) setEcuError(error instanceof Error ? error.message : "ECU 데이터 수신 오류");
      }
    };
    pollEcu();
    const timer = window.setInterval(pollEcu, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ecuSource]);

  const stats = useMemo(() => ({ normal: forklifts.filter((item) => item.status === "정상").length, warning: forklifts.filter((item) => item.status === "주의").length, check: forklifts.filter((item) => item.status === "점검").length }), [forklifts]);

  function triggerIncident() {
    triggerRandomIncident("P-03호");
  }

  function triggerRandomIncident(preferredId?: string) {
    const targetId = preferredId ?? forklifts[Math.floor(Math.random() * forklifts.length)].id;
    const target = forklifts.find((forklift) => forklift.id === targetId) ?? forklifts[0];
    const incidentSnapshot: EcuSnapshot = { forkliftId: targetId, timestamp: new Date().toISOString(), battery: Math.max(18, target.battery - 8), coolantTemperature: Math.max(101, target.coolantTemperature + 20), engineOilTemperature: Math.max(106, target.engineOilTemperature + 24), vibrationRms: Math.max(6.4, target.vibration + 3.2), mode: "DUMMY", connected: true };
    const incidentDiagnostic = evaluateDiagnostic(incidentSnapshot);
    setForklifts((current) => current.map((forklift) => forklift.id === targetId ? { ...forklift, status: "점검", temperature: Math.max(82, forklift.temperature + 18 + Math.random() * 8), coolantTemperature: Math.max(101, forklift.coolantTemperature + 16 + Math.random() * 7), engineOilTemperature: Math.max(104, forklift.engineOilTemperature + 18 + Math.random() * 8), vibration: Math.max(6.2, forklift.vibration + 2.8 + Math.random() * 1.5), risk: "높음", task: "긴급 점검 대기" } : forklift));
    setSelectedId(targetId);
    setLastEvent(`09:43:02 · ${targetId} 이상 징후 랜덤 감지 · 점검 필요`);
    setLiveEvents((current) => [{ time: new Date().toLocaleTimeString("ko-KR", { hour12: false }), label: targetId, text: "이상 징후 감지 · 점검 필요", tone: "critical" }, ...current].slice(0, 8));
    setAiMessage(`Twin AI: ${targetId}의 온도·진동 패턴에서 이상 징후를 감지했습니다`);
    setAiResult(analyzeIncident(target, incidentDiagnostic));
  }

  function submitAiQuestion() {
    if (!aiQuestion.trim()) { setAiQuestionError("질문을 입력해 주세요."); return; }
    setAiQuestionError("");
    setAiResult(answerQuestion(aiQuestion, aiContext));
  }

  function formatTimer(seconds: number) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function positionFor(forklift: Forklift) {
    const position = livePositions[forklift.id] ?? [forklift.x, forklift.y];
    return { left: `${position[0]}%`, top: `${position[1]}%` };
  }

  async function recordMaintenanceAction(input: CreateMaintenanceAction, status: MaintenanceAction["status"]) {
    // Keep the selected alert mounted after the API confirms the action.
    setMaintenanceAssessments((current) => applyMaintenanceAction(current, input, status));
    setSelectedAlertId(input.riskAssessmentId);
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">PF</div><div><strong>POSCO FUTURE M</strong><span>현장 운영 관제</span></div></div>
        <div className="title-block"><span className="eyebrow">DIGITAL TWIN CONTROL ROOM</span><h1>지게차 디지털 트윈 및 실시간 시뮬레이션</h1></div>
        <div className="top-actions"><span className="live-pill"><i /> LIVE · {liveClock}</span></div>
      </header>

      <section className="status-strip" aria-label="현장 요약"><div><span className="strip-label">운용 장비</span><strong>05 <small>대</small></strong></div><div><span className="strip-label">정상 운행</span><strong className="green">{stats.normal} <small>대</small></strong></div><div><span className="strip-label">주의 관찰</span><strong className="yellow">{stats.warning} <small>대</small></strong></div><div><span className="strip-label">점검 필요</span><strong className="red">{stats.check} <small>대</small></strong></div><div className="strip-note"><Icon>⌁</Icon> 마지막 데이터 수신 <b>2.4초 전</b></div></section>

      <section className="control-bar"><div className="section-kicker"><span className="live-dot" /> Twin AI · 실시간 무한 운행 <small className="motion-readout">5대 무한 주행 중</small></div><div className="control-actions"><button className="incident-button" onClick={() => triggerRandomIncident()}><Icon>⚠</Icon> 랜덤 이상상황</button></div></section>

      <section className="main-grid">
        <div className="map-card panel">
          <div className="panel-header"><div><span className="section-kicker">LIVE SITE MAP</span><h2>현장 배치도</h2></div><div className="legend"><span><i className="legend-dot green-bg" />정상</span><span><i className="legend-dot yellow-bg" />주의</span><span><i className="legend-dot red-bg" />점검</span></div></div>
          <div className="map-canvas three-d-twin" data-twin-ai="true" aria-label="Twin AI 3D 현장 배치도">
            <div className="ai-overlay"><span className="ai-orb">✦</span><div><b>Twin AI</b><span>{aiMessage}</span></div></div>
            <div className="twin-scene" aria-hidden="true"><div className="scene-floor" /><div className="scene-wall wall-back" /><div className="scene-wall wall-right" /><div className="scene-light light-one" /><div className="scene-light light-two" /><div className="scene-rack rack-one"><i /><i /><i /></div><div className="scene-rack rack-two"><i /><i /><i /></div><div className="scene-charger charger-one" /><div className="scene-charger charger-two" /><div className="scene-zone-label label-yard">원료 야드</div><div className="scene-zone-label label-storage">저장동</div><div className="scene-zone-label label-shipping">출하장</div><div className="scene-zone-label label-maintenance">정비구역</div><div className="scene-zone-label label-charge">대기 충전</div></div>
            <div className="map-grid-lines" /><div className="north">N</div><div className="zone zone-yard"><span>원료 야드</span><small>RAW MATERIAL YARD</small></div><div className="zone zone-storage"><span>저장동</span><small>STORAGE BUILDING</small></div><div className="zone zone-shipping"><span>출하장</span><small>SHIPPING DOCK</small></div><div className="zone zone-maintenance"><span>정비구역</span><small>MAINTENANCE</small></div><div className="zone zone-charge"><span>대기 충전</span><small>CHARGE BAY</small></div><div className="road road-one" /><div className="road road-two" />
            {forklifts.map((forklift) => <button key={forklift.id} data-moving="true" className={`forklift-marker status-${forklift.status}`} style={positionFor(forklift)} onClick={() => setSelectedId(forklift.id)} aria-label={`${forklift.id} 상세 보기`}><span className="motion-ring" /><img className="realistic-forklift" src="/forklift-realistic.png" alt="" /><span className="forklift-icon">▰</span><span className="marker-label">{forklift.id}</span><span className="tooltip"><b>{forklift.id}</b><span>{forklift.zone} · {forklift.status}</span><span>배터리 {Math.round(forklift.battery)}% · 모터 {Math.round(forklift.temperature)}°C</span><span className="tooltip-route">구역 표지판: {forklift.zone}</span></span></button>)}
          </div>
          <div className="map-footer"><span><Icon>⌖</Icon> 현장 좌표 기준 · 2026.08.12</span><span>구역을 선택하면 장비 위치가 강조됩니다</span></div>
        </div>

        <aside className="detail-card panel" aria-label="선택 지게차 상세 정보"><div className="panel-header detail-heading"><div><span className="section-kicker">FORKLIFT DETAIL</span><h2>{selected.id}</h2></div><span className={`status-badge status-${selected.status}`}>{selected.status}</span></div><div className="ecu-mode-strip"><b>ECU 데이터 모드</b><span className={ecuError ? "ecu-offline" : "ecu-online"}>{ecuError ? "REAL 연결 대기" : "DUMMY 시연 모드 · 연결됨"}</span><small>최근 수신 {ecuUpdatedAt}</small></div><div className="detail-location"><Icon>⌖</Icon><div><span>현재 위치</span><strong>{selected.zone}</strong></div><div className="task-label"><span>현재 작업</span><strong>{selected.task}</strong></div></div><div className="metric-grid"><Metric label="배터리 잔량" value={`${Math.round(selectedEcu?.battery ?? selected.battery)}%`} sub={selected.battery < 35 ? "충전 필요" : "운용 가능"} tone={selected.battery < 35 ? "red" : "green"} /><Metric label="냉각수 온도" value={`${Math.round(selectedEcu?.coolantTemperature ?? selected.coolantTemperature)}°C`} sub={selected.coolantTemperature > 95 ? "냉각 점검" : "정상 범위"} tone={selected.coolantTemperature > 95 ? "red" : "orange"} /><Metric label="엔진오일 온도" value={`${Math.round(selectedEcu?.engineOilTemperature ?? selected.engineOilTemperature)}°C`} sub={selected.engineOilTemperature > 98 ? "오일 점검" : "정상 범위"} tone={selected.engineOilTemperature > 98 ? "red" : "orange"} /><Metric label="진동 RMS" value={`${(selectedEcu?.vibrationRms ?? selected.vibration).toFixed(1)} mm/s`} sub={selected.vibration > 5 ? "이상 상승" : "안정"} tone={selected.vibration > 5 ? "red" : "teal"} /></div><div className="detail-list"><InfoRow label="누적 운행 시간" value={selected.hours} /><InfoRow label="위험도" value={selected.risk} emphasis={selected.risk === "높음" ? "danger" : ""} /><InfoRow label="정비 권고" value={selected.status === "점검" ? "즉시 점검 필요" : selected.status === "주의" ? "금일 점검 권고" : "예정 정비 없음"} emphasis={selected.status === "점검" ? "danger" : ""} /></div><SensorChart forklift={selected} /><button className="report-button" onClick={() => setShowReport(true)}>상세 진단 리포트 <span>↗</span></button></aside>
      </section>

      <section className="diagnostic-live-card panel"><div className="panel-header"><div><span className="section-kicker">LIVE DIAGNOSTICS</span><h2>실시간 상세 진단 리포트 · {selected.id}</h2></div><span className={`status-badge report-level-${diagnostic.level}`}>{diagnostic.level} · {diagnostic.score}점</span></div><div className="diagnostic-summary"><div><b>{diagnostic.summary}</b><span>ECU 4개 입력값을 학습 프로필과 비교한 현재 판정</span></div><div className="diagnostic-meta"><span>신뢰도 {diagnostic.confidence}%</span><span>우선순위 {diagnostic.priority}</span><span>{new Date(diagnostic.evaluatedAt).toLocaleTimeString("ko-KR", { hour12: false })} 갱신</span></div></div><div className="diagnostic-columns"><div className="diagnostic-findings"><h3>감지된 이상 징후</h3>{diagnostic.findings.map((finding) => <div className="finding-row" key={finding}><i className={`finding-dot report-level-${diagnostic.level}`} />{finding}</div>)}</div><div className="diagnostic-recommendation"><h3>정비 권고</h3><p>{diagnostic.recommendation}</p><small>판정 기준: 더미 학습 프로필 기반 시연용 평가 · 실제 ECU 연결 시 동일 로직 재사용</small></div></div></section>

      <section className="maintenance-operations" aria-label="과열 정비 운영"><MaintenanceQueue assessments={maintenanceAssessments} selectedId={selectedAlertId} onSelect={(id) => setSelectedAlertId(id)} /><ForkliftDetail snapshot={maintenanceSnapshot} assessment={selectedAssessment} onSubmitAction={recordMaintenanceAction} /><DataQualityPanel health={maintenanceHealth} issues={[]} /></section>

      <section className="bottom-grid"><div className="fleet-card panel"><div className="panel-header"><div><span className="section-kicker">FLEET OVERVIEW</span><h2>전체 지게차 현황</h2></div><span className="panel-meta">5대 운용 중</span></div><div className="fleet-list">{forklifts.map((forklift) => <button key={forklift.id} className={`fleet-row ${selected.id === forklift.id ? "selected" : ""}`} onClick={() => setSelectedId(forklift.id)}><span className={`mini-vehicle status-${forklift.status}`}>▰</span><span className="fleet-id">{forklift.id}<small>{forklift.zone}</small></span><span className={`fleet-status status-${forklift.status}`}>{forklift.status}</span><span className="fleet-battery"><span className="battery-track"><i style={{ width: `${forklift.battery}%` }} /></span>{Math.round(forklift.battery)}%</span><span className="fleet-temp">{Math.round(forklift.temperature)}°C</span><span className="row-arrow">›</span></button>)}</div></div><div className="event-card panel"><div className="panel-header"><div><span className="section-kicker">EVENT LOG</span><h2>이벤트 로그</h2></div><span className="panel-meta"><span className="live-dot" /> LIVE</span></div><div className="event-list">{liveEvents.map((event, index) => <div className={`event-row ${event.tone === "critical" ? "event-critical" : ""}`} key={`${event.time}-${event.label}-${index}`}><span className="event-time">{event.time}</span><span className={`event-dot ${event.tone}`} /><span><b>{event.label}</b> {event.text}</span></div>)}</div></div></section>

      <section className="records-card panel"><div className="panel-header"><div><span className="section-kicker">DRIVING RECORDS</span><h2>실시간 운행기록</h2></div><span className="panel-meta"><span className="live-dot" /> LIVE · {liveClock}</span></div><div className="record-table-wrap"><table className="record-table"><thead><tr><th>시각</th><th>장비</th><th>운행 구간</th><th>현재 작업</th><th>상태</th><th>주행거리</th></tr></thead><tbody>{liveRecords.map((record) => <tr key={record[1]}><td>{record[0]}</td><td><b>{record[1]}</b></td><td>{record[2]}</td><td>{record[3]}</td><td><span className={`record-status status-${record[4]}`}>{record[4]}</span></td><td>{record[5]}</td></tr>)}</tbody></table></div></section>
      <footer className="footer-note"><span>포스코퓨처엠 스마트팩토리 운영 시스템</span><span>시연용 프로토타입 · 실제 센서 데이터가 아닌 시뮬레이션 데이터입니다</span></footer>
      <TwinAiPanel report={fleetAiReport} diagnostics={diagnostics} result={aiResult} question={aiQuestion} error={aiQuestionError} onQuestionChange={setAiQuestion} onSubmit={submitAiQuestion} onQuickQuestion={(question, result) => { setAiQuestion(question); setAiResult(result); }} onFullReport={() => setShowFleetReport(true)} recordSummary={recordAiSummary} context={aiContext} />
      {showReport && <DiagnosticModal forkliftId={selected.id} report={diagnostic} onClose={() => setShowReport(false)} />}
      {showFleetReport && <FleetReportModal report={fleetAiReport} recordSummary={recordAiSummary} onClose={() => setShowFleetReport(false)} />}
    </main>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) { return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong><small>{sub}</small></div>; }
function InfoRow({ label, value, emphasis = "" }: { label: string; value: string; emphasis?: string }) { return <div className="info-row"><span>{label}</span><strong className={emphasis}>{value}</strong></div>; }
function SensorChart({ forklift }: { forklift: Forklift }) { const points = forklift.status === "점검" ? "0,54 20,51 40,48 60,46 80,41 100,44 120,32 140,34 160,20 180,14 200,6" : "0,42 20,39 40,44 60,36 80,40 100,29 120,32 140,24 160,27 180,20 200,22"; return <div className="chart-block"><div className="chart-title"><span>최근 센서 추이</span><span className="chart-legend"><i className="line-temp" /> 온도 <i className="line-vibration" /> 진동</span></div><div className="chart"><div className="chart-y"><span>높음</span><span>보통</span><span>낮음</span></div><svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-label="최근 센서 추이 그래프"><path d={`M${points}`} className="chart-line temp" /><path d="M0,51 20,48 40,51 60,46 80,48 100,42 120,44 140,39 160,42 180,37 200,39" className="chart-line vibration" /></svg><div className="chart-x"><span>30분 전</span><span>현재</span></div></div></div>; }

function DiagnosticModal({ forkliftId, report, onClose }: { forkliftId: string; report: DiagnosticReport; onClose: () => void }) { return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="리포트 닫기">×</button><span className="section-kicker">DIAGNOSTIC REPORT</span><h2 id="report-title">{forkliftId} 상세 진단 리포트</h2><div className="report-status"><span className={`status-badge report-level-${report.level}`}>{report.level} · {report.score}점</span><strong>{report.summary}</strong></div><div className="report-grid"><InfoRow label="주요 감지 항목" value={report.findings.join(" · ")} /><InfoRow label="권고 조치" value={report.recommendation} /><InfoRow label="조치 우선순위" value={report.priority} /><InfoRow label="분석 기준" value={`더미 학습 프로필 기반 · 신뢰도 ${report.confidence}%`} /></div><button className="report-button" onClick={onClose}>확인</button></section></div>; }

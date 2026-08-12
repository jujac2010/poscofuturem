"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type Status = "정상" | "주의" | "점검";
type Forklift = {
  id: string;
  zone: string;
  task: string;
  status: Status;
  battery: number;
  temperature: number;
  vibration: number;
  load: number;
  hours: string;
  risk: string;
  x: number;
  y: number;
  route: string;
};

const initialForklifts: Forklift[] = [
  { id: "FORK-A", zone: "원료 야드", task: "원료 이송", status: "정상", battery: 86, temperature: 48, vibration: 1.8, load: 1.4, hours: "4,218 h", risk: "낮음", x: 20, y: 29, route: "원료 야드 → 저장동" },
  { id: "FORK-B", zone: "저장동", task: "양극재 적재", status: "정상", battery: 72, temperature: 52, vibration: 2.1, load: 1.8, hours: "3,806 h", risk: "낮음", x: 53, y: 25, route: "저장동 내부 순환" },
  { id: "FORK-C", zone: "출하장", task: "출하 대기", status: "정상", battery: 64, temperature: 57, vibration: 2.6, load: 1.1, hours: "5,140 h", risk: "보통", x: 77, y: 54, route: "출하장 → 대기 충전" },
  { id: "FORK-D", zone: "정비구역", task: "점검 후 대기", status: "주의", battery: 48, temperature: 62, vibration: 3.2, load: 0.4, hours: "6,027 h", risk: "보통", x: 24, y: 73, route: "정비구역 고정" },
  { id: "FORK-E", zone: "대기 충전", task: "충전 중", status: "정상", battery: 91, temperature: 39, vibration: 1.2, load: 0, hours: "2,974 h", risk: "낮음", x: 66, y: 78, route: "대기 충전 고정" },
];

const events = [
  { time: "09:42:18", label: "FORK-A", text: "원료 야드 진입 · 정상 운행", tone: "normal" },
  { time: "09:41:53", label: "FORK-D", text: "정비구역 대기 · 점검 권고 유지", tone: "warning" },
  { time: "09:40:27", label: "FORK-E", text: "충전 전류 안정화", tone: "normal" },
];

function Icon({ children }: { children: ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

export default function Home() {
  const [forklifts, setForklifts] = useState(initialForklifts);
  const [selectedId, setSelectedId] = useState("FORK-C");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const selected = forklifts.find((forklift) => forklift.id === selectedId) ?? forklifts[0];

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setForklifts((current) => current.map((forklift) => {
        if (forklift.status === "점검") {
          return { ...forklift, battery: Math.max(18, forklift.battery - 0.04 * speed), temperature: Math.min(96, forklift.temperature + 0.09 * speed), vibration: Math.min(9.8, forklift.vibration + 0.04 * speed) };
        }
        const drift = Math.sin(Date.now() / 3100 + forklift.id.charCodeAt(5)) * 0.22;
        return { ...forklift, battery: Math.max(20, forklift.battery - 0.008 * speed), temperature: Math.max(35, Math.min(78, forklift.temperature + drift * 0.06)), vibration: Math.max(0.8, Math.min(4.5, forklift.vibration + drift * 0.025)) };
      }));
    }, 1100);
    return () => window.clearInterval(timer);
  }, [paused, speed]);

  const stats = useMemo(() => ({ normal: forklifts.filter((item) => item.status === "정상").length, warning: forklifts.filter((item) => item.status === "주의").length, check: forklifts.filter((item) => item.status === "점검").length }), [forklifts]);

  function triggerIncident() {
    setForklifts((current) => current.map((forklift) => forklift.id === "FORK-C" ? { ...forklift, status: "점검", temperature: Math.max(82, forklift.temperature + 22), vibration: Math.max(6.4, forklift.vibration + 3.5), risk: "높음", task: "긴급 점검 대기" } : forklift));
    setSelectedId("FORK-C");
    setLastEvent("09:43:02 · FORK-C 온도·진동 상승 감지 · 점검 필요");
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">PF</div><div><strong>POSCO FUTURE M</strong><span>현장 운영 관제</span></div></div>
        <div className="title-block"><span className="eyebrow">DIGITAL TWIN CONTROL ROOM</span><h1>지게차 디지털 트윈 및 실시간 시뮬레이션</h1></div>
        <div className="top-actions"><span className="live-pill"><i /> LIVE · 09:43:02</span><button className="ghost-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "시뮬레이션 재생" : "시뮬레이션 일시정지"}>{paused ? "▶ 재생" : "Ⅱ 일시정지"}</button></div>
      </header>

      <section className="status-strip" aria-label="현장 요약"><div><span className="strip-label">운용 장비</span><strong>05 <small>대</small></strong></div><div><span className="strip-label">정상 운행</span><strong className="green">{stats.normal} <small>대</small></strong></div><div><span className="strip-label">주의 관찰</span><strong className="yellow">{stats.warning} <small>대</small></strong></div><div><span className="strip-label">점검 필요</span><strong className="red">{stats.check} <small>대</small></strong></div><div className="strip-note"><Icon>⌁</Icon> 마지막 데이터 수신 <b>2.4초 전</b></div></section>

      <section className="control-bar"><div className="section-kicker"><span className="live-dot" /> 실시간 시뮬레이션</div><div className="control-actions"><span className="control-label">속도</span>{[1, 2, 4].map((value) => <button key={value} className={`speed-button ${speed === value ? "active" : ""}`} onClick={() => setSpeed(value)}>{value}배</button>)}<button className="incident-button" onClick={triggerIncident}><Icon>⚠</Icon> 이상상황 발생</button></div></section>

      <section className="main-grid">
        <div className="map-card panel">
          <div className="panel-header"><div><span className="section-kicker">LIVE SITE MAP</span><h2>현장 배치도</h2></div><div className="legend"><span><i className="legend-dot green-bg" />정상</span><span><i className="legend-dot yellow-bg" />주의</span><span><i className="legend-dot red-bg" />점검</span></div></div>
          <div className="map-canvas" aria-label="5대 지게차가 표시된 현장 배치도">
            <div className="map-grid-lines" /><div className="north">N</div><div className="zone zone-yard"><span>원료 야드</span><small>RAW MATERIAL YARD</small></div><div className="zone zone-storage"><span>저장동</span><small>STORAGE BUILDING</small></div><div className="zone zone-shipping"><span>출하장</span><small>SHIPPING DOCK</small></div><div className="zone zone-maintenance"><span>정비구역</span><small>MAINTENANCE</small></div><div className="zone zone-charge"><span>대기 충전</span><small>CHARGE BAY</small></div><div className="road road-one" /><div className="road road-two" />
            {forklifts.map((forklift) => <button key={forklift.id} className={`forklift-marker status-${forklift.status}`} style={{ left: `${forklift.x}%`, top: `${forklift.y}%` }} onClick={() => setSelectedId(forklift.id)} aria-label={`${forklift.id} 상세 보기`}><span className="forklift-icon">▰</span><span className="marker-label">{forklift.id}</span><span className="tooltip"><b>{forklift.id}</b><span>{forklift.zone} · {forklift.status}</span><span>배터리 {Math.round(forklift.battery)}% · 모터 {Math.round(forklift.temperature)}°C</span></span></button>)}
          </div>
          <div className="map-footer"><span><Icon>⌖</Icon> 현장 좌표 기준 · 2026.08.12</span><span>구역을 선택하면 장비 위치가 강조됩니다</span></div>
        </div>

        <aside className="detail-card panel" aria-label="선택 지게차 상세 정보"><div className="panel-header detail-heading"><div><span className="section-kicker">FORKLIFT DETAIL</span><h2>{selected.id}</h2></div><span className={`status-badge status-${selected.status}`}>{selected.status}</span></div><div className="detail-location"><Icon>⌖</Icon><div><span>현재 위치</span><strong>{selected.zone}</strong></div><div className="task-label"><span>현재 작업</span><strong>{selected.task}</strong></div></div><div className="metric-grid"><Metric label="배터리 잔량" value={`${Math.round(selected.battery)}%`} sub={selected.battery < 35 ? "충전 필요" : "운용 가능"} tone={selected.battery < 35 ? "red" : "green"} /><Metric label="모터 온도" value={`${Math.round(selected.temperature)}°C`} sub={selected.temperature > 75 ? "과열 감지" : "정상 범위"} tone={selected.temperature > 75 ? "red" : "orange"} /><Metric label="진동 RMS" value={`${selected.vibration.toFixed(1)} mm/s`} sub={selected.vibration > 5 ? "이상 상승" : "안정"} tone={selected.vibration > 5 ? "red" : "teal"} /><Metric label="적재량" value={`${selected.load.toFixed(1)} t`} sub="정격 2.5 t" tone="teal" /></div><div className="detail-list"><InfoRow label="누적 운행 시간" value={selected.hours} /><InfoRow label="위험도" value={selected.risk} emphasis={selected.risk === "높음" ? "danger" : ""} /><InfoRow label="정비 권고" value={selected.status === "점검" ? "즉시 점검 필요" : selected.status === "주의" ? "금일 점검 권고" : "예정 정비 없음"} emphasis={selected.status === "점검" ? "danger" : ""} /></div><SensorChart forklift={selected} /><button className="report-button" onClick={() => setShowReport(true)}>상세 진단 리포트 <span>↗</span></button></aside>
      </section>

      <section className="bottom-grid"><div className="fleet-card panel"><div className="panel-header"><div><span className="section-kicker">FLEET OVERVIEW</span><h2>전체 지게차 현황</h2></div><span className="panel-meta">5대 운용 중</span></div><div className="fleet-list">{forklifts.map((forklift) => <button key={forklift.id} className={`fleet-row ${selected.id === forklift.id ? "selected" : ""}`} onClick={() => setSelectedId(forklift.id)}><span className={`mini-vehicle status-${forklift.status}`}>▰</span><span className="fleet-id">{forklift.id}<small>{forklift.zone}</small></span><span className={`fleet-status status-${forklift.status}`}>{forklift.status}</span><span className="fleet-battery"><span className="battery-track"><i style={{ width: `${forklift.battery}%` }} /></span>{Math.round(forklift.battery)}%</span><span className="fleet-temp">{Math.round(forklift.temperature)}°C</span><span className="row-arrow">›</span></button>)}</div></div><div className="event-card panel"><div className="panel-header"><div><span className="section-kicker">EVENT LOG</span><h2>이벤트 로그</h2></div><span className="panel-meta">실시간</span></div><div className="event-list">{lastEvent && <div className="event-row event-critical"><span className="event-time">09:43:02</span><span className="event-dot" /><span><b>FORK-C</b> {lastEvent.replace("09:43:02 · FORK-C ", "")}</span></div>}{events.map((event) => <div className="event-row" key={event.time}><span className="event-time">{event.time}</span><span className={`event-dot ${event.tone}`} /><span><b>{event.label}</b> {event.text}</span></div>)}</div></div></section>

      <footer className="footer-note"><span>포스코퓨처엠 스마트팩토리 운영 시스템</span><span>시연용 프로토타입 · 실제 센서 데이터가 아닌 시뮬레이션 데이터입니다</span></footer>
      {showReport && <div className="modal-backdrop" role="presentation" onClick={() => setShowReport(false)}><section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowReport(false)} aria-label="리포트 닫기">×</button><span className="section-kicker">DIAGNOSTIC REPORT</span><h2 id="report-title">{selected.id} 상세 진단 리포트</h2><div className="report-status"><span className={`status-badge status-${selected.status}`}>{selected.status}</span><strong>{selected.status === "점검" ? "즉시 현장 점검이 필요합니다" : "현재 운용 상태가 안정적입니다"}</strong></div><div className="report-grid"><InfoRow label="주요 감지 항목" value={selected.status === "점검" ? "모터 온도 · 진동 RMS" : "특이사항 없음"} /><InfoRow label="권고 조치" value={selected.status === "점검" ? "운행 중지 후 정비구역 이동" : "예정 정비 일정에 따라 점검"} /><InfoRow label="분석 기준" value="최근 30분 시뮬레이션 추이" /></div><button className="report-button" onClick={() => setShowReport(false)}>확인</button></section></div>}
    </main>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) { return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong><small>{sub}</small></div>; }
function InfoRow({ label, value, emphasis = "" }: { label: string; value: string; emphasis?: string }) { return <div className="info-row"><span>{label}</span><strong className={emphasis}>{value}</strong></div>; }
function SensorChart({ forklift }: { forklift: Forklift }) { const points = forklift.status === "점검" ? "0,54 20,51 40,48 60,46 80,41 100,44 120,32 140,34 160,20 180,14 200,6" : "0,42 20,39 40,44 60,36 80,40 100,29 120,32 140,24 160,27 180,20 200,22"; return <div className="chart-block"><div className="chart-title"><span>최근 센서 추이</span><span className="chart-legend"><i className="line-temp" /> 온도 <i className="line-vibration" /> 진동</span></div><div className="chart"><div className="chart-y"><span>높음</span><span>보통</span><span>낮음</span></div><svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-label="최근 센서 추이 그래프"><path d={`M${points}`} className="chart-line temp" /><path d="M0,51 20,48 40,51 60,46 80,48 100,42 120,44 140,39 160,42 180,37 200,39" className="chart-line vibration" /></svg><div className="chart-x"><span>30분 전</span><span>현재</span></div></div></div>; }

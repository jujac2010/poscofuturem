import type { EcuSnapshot } from "../ecu/types";

export type DiagnosticLevel = "정상" | "주의" | "위험" | "긴급";

export type DiagnosticReport = {
  level: DiagnosticLevel;
  score: number;
  confidence: number;
  findings: string[];
  recommendation: string;
  priority: string;
  summary: string;
  evaluatedAt: string;
};

/**
 * 더미 ECU 데이터에서 진단에 의미가 있는 입력만 라벨링한 시연용 학습 프로필입니다.
 * 실제 ML 모델 학습이 아니라, 발표에서 입력값 → 판정 → 정비권고 흐름을 재현하는
 * 결정론적 기준 데이터입니다. REAL 모드에서도 동일한 평가 함수를 재사용합니다.
 */
export const diagnosticTrainingProfiles = [
  { id: "normal", label: "정상 운행", battery: [50, 100], coolant: [55, 85], oil: [50, 88], vibration: [0, 3.4] },
  { id: "low-battery", label: "배터리 부족", battery: [0, 24], coolant: [50, 100], oil: [45, 105], vibration: [0, 5] },
  { id: "coolant-overheat", label: "냉각수 과열", battery: [0, 100], coolant: [90, 120], oil: [45, 105], vibration: [0, 5] },
  { id: "oil-overheat", label: "엔진오일 과열", battery: [0, 100], coolant: [50, 105], oil: [94, 125], vibration: [0, 5] },
  { id: "vibration-abnormal", label: "진동 이상", battery: [0, 100], coolant: [50, 105], oil: [45, 110], vibration: [4.2, 20] },
];

const within = (value: number, range: readonly [number, number]) => value >= range[0] && value <= range[1];

export function evaluateDiagnostic(snapshot: EcuSnapshot): DiagnosticReport {
  const findings: string[] = [];
  let score = 0;
  if (snapshot.battery <= 20) { score += 35; findings.push(`배터리 잔량 ${Math.round(snapshot.battery)}%로 충전이 필요합니다.`); }
  else if (snapshot.battery <= 35) { score += 18; findings.push(`배터리 잔량 ${Math.round(snapshot.battery)}%로 운행 후 충전을 권고합니다.`); }
  if (snapshot.coolantTemperature >= 100) { score += 35; findings.push(`냉각수 온도 ${Math.round(snapshot.coolantTemperature)}°C로 과열 위험이 감지되었습니다.`); }
  else if (snapshot.coolantTemperature >= 90) { score += 20; findings.push(`냉각수 온도 ${Math.round(snapshot.coolantTemperature)}°C가 상승 추세입니다.`); }
  if (snapshot.engineOilTemperature >= 105) { score += 35; findings.push(`엔진오일 온도 ${Math.round(snapshot.engineOilTemperature)}°C로 오일 계통 점검이 필요합니다.`); }
  else if (snapshot.engineOilTemperature >= 94) { score += 20; findings.push(`엔진오일 온도 ${Math.round(snapshot.engineOilTemperature)}°C가 주의 범위입니다.`); }
  if (snapshot.vibrationRms >= 6) { score += 40; findings.push(`진동 RMS ${snapshot.vibrationRms.toFixed(1)} mm/s로 구동계 이상이 의심됩니다.`); }
  else if (snapshot.vibrationRms >= 4.2) { score += 22; findings.push(`진동 RMS ${snapshot.vibrationRms.toFixed(1)} mm/s가 기준보다 높습니다.`); }

  const thermal = snapshot.coolantTemperature >= 100 || snapshot.engineOilTemperature >= 105;
  const mechanical = snapshot.vibrationRms >= 6;
  if (thermal && mechanical) { score += 20; findings.push("열 이상과 진동 이상이 동시에 발생해 복합 위험으로 상향했습니다."); }

  score = Math.min(100, score);
  const level: DiagnosticLevel = score >= 70 ? "긴급" : score >= 40 ? "위험" : score >= 18 ? "주의" : "정상";
  const recommendation = level === "긴급" ? "즉시 운행을 중지하고 정비구역에서 냉각·오일·구동계를 점검하십시오."
    : level === "위험" ? "운행을 제한하고 금일 정비 담당자의 현장 점검을 진행하십시오."
      : level === "주의" ? "다음 교대 전 점검 예약 후 온도·진동 추이를 관찰하십시오."
        : "현재 센서값은 정상 범위입니다. 정기 점검 주기를 유지하십시오.";
  const priority = level === "긴급" ? "즉시 조치" : level === "위험" ? "1시간 이내" : level === "주의" ? "금일 점검" : "정기 점검";
  const matched = diagnosticTrainingProfiles.filter((profile) => within(snapshot.battery, profile.battery) && within(snapshot.coolantTemperature, profile.coolant) && within(snapshot.engineOilTemperature, profile.oil) && within(snapshot.vibrationRms, profile.vibration));
  const confidence = Math.min(99, Math.round(78 + (matched.length ? 15 : 0) + (findings.length ? 4 : 0)));
  return {
    level, score, confidence, findings: findings.length ? findings : ["4개 ECU 입력값 모두 학습된 정상 프로필 범위입니다."],
    recommendation, priority,
    summary: level === "정상" ? "실시간 센서값이 안정적으로 유지되고 있습니다." : `${findings.length}개 이상 징후를 학습 프로필과 비교해 감지했습니다.`,
    evaluatedAt: snapshot.timestamp,
  };
}

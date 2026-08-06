import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../forklift-dashboard.html', import.meta.url), 'utf8');
const realtimeSource = readFileSync(new URL('../realtime-dashboard-data.js', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

if (!scriptMatch) {
  throw new Error('내장 JavaScript를 찾을 수 없습니다.');
}

class FakeElement {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.attributes = {};
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get('click')?.();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  dispatchEvent(event) {
    this.listeners.get(event.type)?.(event);
  }
}

const elements = new Map();
const getElement = (selector) => {
  const id = selector.startsWith('#') ? selector.slice(1) : selector;
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
};

let printCount = 0;
const document = {
  hidden: false,
  listeners: new Map(),
  getElementById: getElement,
  querySelector: getElement,
  querySelectorAll: () => [],
  addEventListener(type, listener) { this.listeners.set(type, listener); },
  dispatchEvent(event) { this.listeners.get(event.type)?.(event); }
};
const window = { print: () => { printCount += 1; } };
let intervalCallback = null;
let intervalDelay = null;
const setInterval = (callback,delay) => { intervalCallback = callback; intervalDelay = delay; return 1; };
const clearInterval = () => { intervalCallback = null; intervalDelay = null; };

const context = { document, window, console, setInterval, clearInterval };
vm.runInNewContext(realtimeSource, context, { filename: 'realtime-dashboard-data.js' });
vm.runInNewContext(scriptMatch[1], context, { filename: 'forklift-dashboard.html' });

const assertState = (state, expected) => {
  const actual = {
    backlog: state.maintenance.backlog,
    overduePm: state.maintenance.overduePm,
    created: state.maintenance.created,
    completed: state.maintenance.completed,
    overdue: state.maintenance.overdue,
    inspectionsDue: state.compliance.due,
    inspectionsCompleted: state.compliance.completed,
    inspectionsScheduled: state.compliance.scheduled,
    inspectionsOverdue: state.compliance.overdue,
    dvirPassRate: state.compliance.dvirPassRate,
    expiringLicenses: state.compliance.expiringLicenses,
    expiringRegistrations: state.compliance.expiringRegistrations,
    expiringInsurance: state.compliance.expiringInsurance,
    dtcCount: state.ecu.dtcCount,
    ecuWarnings: state.ecu.warnings,
    highLoadHours: state.ecu.highLoadHours
  };
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`Dashboard state ${key}: expected ${value}, received ${actual[key]}`);
  }
};

const first = context.calculateDashboardState('2026-07-08');
assertState(first, {
  backlog: 2, overduePm: 0, created: 2, completed: 0, overdue: 0,
  inspectionsDue: 0, inspectionsCompleted: 0, inspectionsScheduled: 0, inspectionsOverdue: 0, dvirPassRate: 0,
  expiringLicenses: 0, expiringRegistrations: 0, expiringInsurance: 0,
  dtcCount: 1, ecuWarnings: 1, highLoadHours: 10.6
});

const horizonBoundary = context.calculateDashboardState('2026-07-20');
assertState(horizonBoundary, {
  expiringLicenses: 1, expiringRegistrations: 2, expiringInsurance: 2
});

const last = context.calculateDashboardState('2026-08-06');
assertState(last, {
  backlog: 14, overduePm: 5, created: 30, completed: 16, overdue: 10,
  inspectionsDue: 14, inspectionsCompleted: 10, inspectionsScheduled: 1, inspectionsOverdue: 3, dvirPassRate: 80,
  expiringLicenses: 3, expiringRegistrations: 2, expiringInsurance: 4,
  dtcCount: 22, ecuWarnings: 25, highLoadHours: 254.1
});

if (getElement('dateInput').value !== '2026-08-06') throw new Error('초기 날짜가 2026-08-06이 아닙니다.');
getElement('previousDate').click();
if (getElement('dateInput').value !== '2026-08-05') throw new Error('이전 날짜 이동이 작동하지 않습니다.');
getElement('nextDate').click();
if (getElement('dateInput').value !== '2026-08-06') throw new Error('다음 날짜 이동이 작동하지 않습니다.');

context.setSelectedDate('2026-07-08');
const countRows = id => (getElement(id).innerHTML.match(/<tr/g) || []).length;
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const assertMetric = (regionId,label,value) => {
  const metric = new RegExp(`<span(?: class="[^"]*")?>${escapeRegExp(label)}</span>\\s*<strong(?: class="[^"]*")?>${escapeRegExp(value)}</strong>`);
  if (!metric.test(getElement(regionId).innerHTML)) {
    throw new Error(`${regionId} metric ${label}: expected ${value}`);
  }
};
const assertSensorMetric = (label,value) => {
  const metric = new RegExp(`<strong>${escapeRegExp(value)}</strong><p>${escapeRegExp(label)} ·`);
  if (!metric.test(getElement('sensorSummary').innerHTML)) {
    throw new Error(`sensorSummary metric ${label}: expected ${value}`);
  }
};
const assertRegionContains = (regionId, expected, description) => {
  if (!getElement(regionId).innerHTML.includes(expected)) {
    throw new Error(`${regionId} did not return to the 2026-07-08 ${description}`);
  }
};
const renderedRows = regionId => getElement(regionId).innerHTML.match(/<tr>[\s\S]*?<\/tr>/g) || [];
const assertDriverRow = ({ name, rank, score }) => {
  const row = renderedRows('driverRows').find(candidate => candidate.includes(`<b>${name}</b>`));
  if (!row) throw new Error(`driverRows is missing the ${name} row after autoplay wraparound`);
  const expected = [`<span class="rank">${rank}</span>`,`<b>${score}점</b>`];
  const missing = expected.filter(value => !row.includes(value));
  if (missing.length) throw new Error(`${name} row has incorrect first-day rank or score: ${missing.join(', ')}`);
};

// Regression target: changing playback to stop at the last date, to render only a subset
// of regions, or to use any interval other than 2000 ms must fail this end-to-end check.
if (!/<div class="eyebrow">전체 데이터 실시간 시뮬레이션 · 합성 데이터<\/div>/.test(html)) {
  throw new Error('상단 레이블은 전체 데이터 실시간 시뮬레이션 · 합성 데이터여야 합니다.');
}
context.setSelectedDate('2026-08-06');
getElement('playToggle').click();
if (getElement('playToggle').attributes['aria-pressed'] !== 'true' || !intervalCallback || intervalDelay !== 2000) {
  throw new Error('자동 재생은 정확히 2000 ms 간격으로 시작해야 합니다.');
}
intervalCallback();
if (getElement('dateInput').value !== '2026-07-08') {
  throw new Error('자동 재생 한 틱이 마지막 날짜에서 첫 날짜로 순환하지 않았습니다.');
}
assertMetric('overview','WO 백로그','2건');
assertMetric('overview','기한 초과 예방정비','0건');
assertMetric('maintenanceCards','총 작업','2건');
assertMetric('complianceCards','검사 예정','0건');
assertSensorMetric('활성 고장코드','1건');
assertSensorMetric('주의 차량','2대');
assertRegionContains('vehicleRows','1,768 rpm','1호기 ECU 행');
assertRegionContains('vehicleRows','2,857.5 h','1호기 누적 운행시간');
assertRegionContains('safetyEventRows','SAFE-0014','안전사건 행');
assertRegionContains('safetyEventRows','SAFE-0022','안전사건 행');
assertDriverRow({ name:'박성진', rank:9, score:95 });
assertDriverRow({ name:'송재민', rank:10, score:94 });
getElement('playToggle').click();
if (getElement('playToggle').attributes['aria-pressed'] !== 'false' || intervalCallback) {
  throw new Error('자동 재생 전체 동기화 검증 뒤에 재생을 중지하지 못했습니다.');
}

const assertRendered = ({ backlog, overduePm, created, dtc, highLoad, scheduled }) => {
  assertMetric('overview','WO 백로그',backlog);
  assertMetric('overview','기한 초과 예방정비',overduePm);
  assertMetric('maintenanceCards','총 작업',created);
  assertMetric('complianceCards','검사 예정',scheduled);
  assertSensorMetric('활성 고장코드',dtc);
  assertSensorMetric('고부하 운전',highLoad);
  if (getElement('maintenanceDateLabel').textContent !== getElement('dateInput').value || getElement('complianceDateLabel').textContent !== getElement('dateInput').value) {
    throw new Error('Selected-date labels are not synchronized');
  }
};
const assertVehicleRows = expectedRows => {
  const rows = getElement('vehicleRows').innerHTML.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  if (rows.length !== 10) throw new Error(`Combined vehicle sensor table row count: expected 10, received ${rows.length}`);
  for (const { vehicle,rpm,highLoad,cumulative,coolantMax,coolantAvg } of expectedRows) {
    const row = rows.find(candidate => candidate.includes(`>${vehicle} ·`));
    if (!row) throw new Error(`Combined vehicle sensor row missing: ${vehicle}`);
    const expected = [`${rpm.toLocaleString()} rpm`,`${highLoad} h`,`${cumulative.toLocaleString()} h`,`${coolantMax}℃`,`냉각수 평균 ${coolantAvg}℃`];
    const missing = expected.filter(value => !row.includes(value));
    if (missing.length) throw new Error(`${vehicle} selected-date sensor values missing: ${missing.join(', ')}`);
  }
};
assertRendered({ backlog:'2건', overduePm:'0건', created:'2건', dtc:'1건', highLoad:'10.6시간', scheduled:'0건' });
if (countRows('vehicleRows') !== 10) throw new Error('Combined vehicle sensor table must contain 10 vehicles');
assertVehicleRows([
  {vehicle:'1호기',rpm:1768,highLoad:1.7,cumulative:2857.5,coolantMax:97.1,coolantAvg:89.4},
  {vehicle:'2호기',rpm:1793,highLoad:1.5,cumulative:3220.4,coolantMax:94.1,coolantAvg:83.4},
  {vehicle:'3호기',rpm:1619,highLoad:0,cumulative:3585.7,coolantMax:88.6,coolantAvg:80},
  {vehicle:'4호기',rpm:1716,highLoad:0,cumulative:3950.4,coolantMax:87.5,coolantAvg:81.8},
  {vehicle:'5호기',rpm:1796,highLoad:1.8,cumulative:4318.2,coolantMax:96.1,coolantAvg:85.2},
  {vehicle:'6호기',rpm:1733,highLoad:0,cumulative:4683.2,coolantMax:87,coolantAvg:81},
  {vehicle:'7호기',rpm:1724,highLoad:0,cumulative:5049.9,coolantMax:85.7,coolantAvg:80.7},
  {vehicle:'8호기',rpm:1773,highLoad:3,cumulative:5410.9,coolantMax:93.8,coolantAvg:84.5},
  {vehicle:'9호기',rpm:1828,highLoad:2.6,cumulative:5777.3,coolantMax:93.7,coolantAvg:83.7},
  {vehicle:'10호기',rpm:1711,highLoad:0,cumulative:6141.8,coolantMax:88.7,coolantAvg:81}
]);

const firstDayVehicles = getElement('vehicleRows').innerHTML;
const firstDayEvents = getElement('safetyEventRows').innerHTML;
const firstDayDrivers = getElement('driverRows').innerHTML;
const firstDaySummary = getElement('sensorSummary').innerHTML;
if ((firstDayVehicles.match(/<tr/g) || []).length !== 10) throw new Error('2026-07-08 온도 차량 행이 10개가 아닙니다.');
if ((firstDayEvents.match(/<tr/g) || []).length !== 2 || !firstDayEvents.includes('SAFE-0014') || !firstDayEvents.includes('SAFE-0022')) {
  throw new Error('2026-07-08 안전사건 2건이 표시되지 않습니다.');
}
if (!firstDayDrivers.includes('박성진') || !firstDayDrivers.includes('95점') || !firstDayDrivers.includes('송재민') || !firstDayDrivers.includes('94점')) {
  throw new Error('2026-07-08 누적 운전자 점수가 올바르지 않습니다.');
}
if (!firstDaySummary.includes('주의 차량') || !firstDaySummary.includes('2대') || !firstDaySummary.includes('위험 차량') || !firstDaySummary.includes('0대')) {
  throw new Error('2026-07-08 온도 요약이 올바르지 않습니다.');
}

context.setSelectedDate('2026-07-11');
if (!getElement('safetyEventRows').innerHTML.includes('선택한 날짜에 발생한 안전사건이 없습니다.')) {
  throw new Error('안전사건이 없는 날짜의 안내가 표시되지 않습니다.');
}

context.setSelectedDate('2026-08-06');
assertRendered({ backlog:'14건', overduePm:'5건', created:'30건', dtc:'22건', highLoad:'254.1시간', scheduled:'1건' });
const lastDayEvents = getElement('safetyEventRows').innerHTML;
if ((lastDayEvents.match(/<tr/g) || []).length !== 1 || !lastDayEvents.includes('SAFE-0003')) {
  throw new Error('2026-08-06 안전사건 1건이 표시되지 않습니다.');
}

const overview = getElement('overview').innerHTML;
const maintenance = getElement('maintenanceCards').innerHTML;
const compliance = getElement('complianceCards').innerHTML;
const sensorSummary = getElement('sensorSummary').innerHTML;
const vehicles = getElement('vehicleRows').innerHTML;
const drivers = getElement('driverRows').innerHTML;
assertMetric('overview','가동 차량','9대');
assertMetric('overview','등록 운전자','10명');
assertMetric('maintenanceCards','완료','16건');
assertMetric('complianceCards','검사 대상','14건');
assertMetric('complianceCards','검사 완료','10건');
assertMetric('complianceCards','기한 초과 검사','3건');
assertMetric('complianceCards','DVIR 합격률','80%');
assertSensorMetric('ECU 경고','25건');
assertSensorMetric('위험 차량','0대');
assertSensorMetric('주의 차량','0대');
if (!vehicles.includes('냉각수') || !vehicles.includes('엔진오일') || !vehicles.includes('변속기오일') || !vehicles.includes('유압유')) {
  throw new Error('Selected-date temperature labels are missing');
}

const vehicleRowCount = (vehicles.match(/<tr/g) || []).length;
const driverRowCount = (drivers.match(/<tr/g) || []).length;
if (vehicleRowCount !== 10) throw new Error(`차량 행 ${vehicleRowCount}개: 10개 필요`);
if (driverRowCount !== 10) throw new Error(`운전자 행 ${driverRowCount}개: 10개 필요`);

const expectedDrivers = ['오세훈', '이준호', '송재민', '정우석', '장현우', '최동현', '한지훈', '김민수', '윤태영', '박성진'];
const positions = expectedDrivers.map((name) => drivers.indexOf(name));
if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position < positions[index - 1])) {
  throw new Error('운전자 안전순위가 예상 순서와 다릅니다.');
}

getElement('playToggle').click();
document.hidden = true;
document.dispatchEvent({ type:'visibilitychange' });
if (getElement('playToggle').attributes['aria-pressed'] !== 'false' || intervalCallback) {
  throw new Error('페이지 숨김 시 자동 재생이 정지되지 않습니다.');
}

const printButton = getElement('printButton');
printButton.click();
if (printCount !== 1) throw new Error('보고서 출력 버튼이 window.print를 호출하지 않습니다.');

const requiredStaticCopy = ['2026-08-06', '합성 데이터', '실제 정비 및 안전 의사결정에 사용하지 마십시오'];
const missingStaticCopy = requiredStaticCopy.filter((value) => !html.includes(value));
if (missingStaticCopy.length) throw new Error(`안내 문구 누락: ${missingStaticCopy.join(', ')}`);

console.log('대시보드 렌더링 검증 통과: 차량 10대, 운전자 10명, KPI·센서·출력 동작 정상');

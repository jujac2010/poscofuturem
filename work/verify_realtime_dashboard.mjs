import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../realtime-dashboard-data.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename:'realtime-dashboard-data.js' });

const data = context.window.realtimeDashboardData;
if (!data) throw new Error('realtimeDashboardData 객체가 없습니다.');
if (data.dates.length !== 30) throw new Error(`날짜 ${data.dates.length}개: 30개 필요`);
if (data.vehicles.length !== 10) throw new Error(`차량 ${data.vehicles.length}대: 10대 필요`);
if (data.temperatures.length !== 300) throw new Error(`온도 레코드 ${data.temperatures.length}개: 300개 필요`);
if (data.safetyEvents.length !== 27) throw new Error(`안전사건 ${data.safetyEvents.length}건: 27건 필요`);
if (data.maintenance.length !== 30) throw new Error('유지보수 30건 필요');
if (data.inspections.length !== 20) throw new Error('검사 20건 필요');
if (data.ecuRecords.length !== 300) throw new Error('ECU 300건 필요');
if (data.dates[0] !== '2026-07-08' || data.dates.at(-1) !== '2026-08-06') {
  throw new Error(`날짜 범위 오류: ${data.dates[0]} ~ ${data.dates.at(-1)}`);
}

for (const date of data.dates) {
  const dailyTemperatures = data.temperatures.filter((row) => row.date === date);
  if (dailyTemperatures.length !== 10) throw new Error(`${date} 온도 차량 ${dailyTemperatures.length}대: 10대 필요`);
}

const requiredTemperatureFields = [
  'coolantAvg','coolantMax','engineOilAvg','engineOilMax',
  'transmissionAvg','transmissionMax','hydraulicAvg','hydraulicMax',
  'overheatMinutes','status'
];
const incompleteTemperature = data.temperatures.find((row) => requiredTemperatureFields.some((key) => row[key] === undefined));
if (incompleteTemperature) throw new Error(`온도 필드 누락: ${incompleteTemperature.date} ${incompleteTemperature.vehicle}`);

const invalidEvent = data.safetyEvents.find((event) => !/^\d{2}:\d{2}$/.test(event.time) || !data.dates.includes(event.date));
if (invalidEvent) throw new Error(`안전사건 날짜·시간 오류: ${invalidEvent.id}`);

console.log('실시간 데이터 검증 통과: 날짜 30개, 차량 10대, 온도 300개, 안전사건 27건');

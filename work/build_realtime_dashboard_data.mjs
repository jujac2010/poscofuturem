import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const workbookUrl = new URL('../outputs/fleet_ops_dummy_data/지게차_통합운영_ECU_CAN_온도센서_더미데이터.xlsx', import.meta.url);
const outputUrl = new URL('../realtime-dashboard-data.js', import.meta.url);

const excelDate = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const date = new Date(Date.UTC(1899, 11, 30 + Number(value)));
  return date.toISOString().slice(0, 10);
};

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(workbookUrl)));
const vehicleRows = wb.worksheets.items[1].getRange('A2:F11').values;
const maintenanceRows = wb.worksheets.items[2].getRange('A2:K31').values;
const inspectionRows = wb.worksheets.items[3].getRange('A2:I21').values;
const safetyRows = wb.worksheets.items[4].getRange('A2:I28').values;
const ecuRows = wb.worksheets.items[6].getRange('A2:J301').values;
const temperatureRows = wb.worksheets.items[7].getRange('A2:M301').values;

const vehicles = vehicleRows.map(([vehicle, model, site, driver, licenseExpiry, status]) => ({
  vehicle,
  model,
  site,
  driver,
  licenseExpiry: excelDate(licenseExpiry),
  status
}));

const maintenance = maintenanceRows.map((r) => ({
  id: r[0],
  vehicle: r[1],
  workType: r[2],
  part: r[3],
  finalStatus: r[4],
  createdDate: excelDate(r[5]),
  dueDate: excelDate(r[6]),
  completedDate: r[7] ? excelDate(r[7]) : null,
  priority: r[8],
  owner: r[9]
}));

const inspections = inspectionRows.map((r) => ({
  id: r[0],
  vehicle: r[1],
  type: r[2],
  scheduledDate: excelDate(r[3]),
  completedDate: r[4] ? excelDate(r[4]) : null,
  result: r[5],
  registrationExpiry: excelDate(r[6]),
  insuranceExpiry: excelDate(r[7]),
  followUp: r[8]
}));

const ecuRecords = ecuRows.map((r) => ({
  date: excelDate(r[0]),
  vehicle: r[1],
  driver: r[2],
  rpm: r[3],
  load: r[4],
  dtc: r[5],
  dailyHours: r[6],
  cumulativeHours: r[7],
  highLoadHours: r[8],
  status: r[9]
}));

const temperatures = temperatureRows.map((row) => ({
  date: excelDate(row[0]),
  vehicle: row[1],
  driver: row[2],
  coolantAvg: row[3],
  coolantMax: row[4],
  engineOilAvg: row[5],
  engineOilMax: row[6],
  transmissionAvg: row[7],
  transmissionMax: row[8],
  hydraulicAvg: row[9],
  hydraulicMax: row[10],
  overheatMinutes: row[11],
  status: row[12]
}));

const safetyEvents = safetyRows.map((row, index) => {
  const elapsedMinutes = (index * 37) % 600;
  const hours = 8 + Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return {
    id: row[0],
    date: excelDate(row[1]),
    time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    vehicle: row[2],
    driver: row[3],
    type: row[4],
    severity: row[5],
    penalty: row[6],
    action: row[7]
  };
});

const dates = [...new Set(temperatures.map((row) => row.date))].sort();
const payload = { dates, vehicles, maintenance, inspections, temperatures, safetyEvents, ecuRecords };
const source = `window.realtimeDashboardData = ${JSON.stringify(payload)};\n`;

await writeFile(outputUrl, source, 'utf8');
console.log(`실시간 데이터 생성: 날짜 ${dates.length}개, 차량 ${vehicles.length}대, 온도 ${temperatures.length}개, 안전사건 ${safetyEvents.length}건`);

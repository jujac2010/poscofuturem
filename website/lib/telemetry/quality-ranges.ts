export const TELEMETRY_PHYSICAL_RANGES = {
  engineCoolantTemperature: { min: 0, max: 160 },
  engineOilTemperature: { min: 0, max: 180 },
  engineRpm: { min: 0, max: 8000 },
  loadRate: { min: 0, max: 1 },
  engineHours: { min: 0, max: 100_000 },
  ambientTemperature: { min: -50, max: 80 },
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
  speed: { min: 0, max: 120 },
} as const;

export const TELEMETRY_PHYSICAL_RANGES_NOTE =
  "Conservative default telemetry validation ranges pending OEM-provided operating limits.";

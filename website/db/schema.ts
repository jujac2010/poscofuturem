import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// These D1 tables store normalized operational telemetry and maintenance records.
// Raw one-second payload bodies remain outside the operational tables; only the
// upstream payload hash (or an explicit normalized fallback hash) is stored here.
export const telemetrySnapshots = sqliteTable("telemetrySnapshots", {
  id: text("id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  assetId: text("asset_id").notNull(),
  observedAt: text("observed_at").notNull(),
  receivedAt: text("received_at").notNull(),
  engineCoolantTemperature: real("engine_coolant_temperature"),
  engineOilTemperature: real("engine_oil_temperature"),
  engineRpm: integer("engine_rpm"),
  loadRate: real("load_rate"),
  engineHours: real("engine_hours"),
  ambientTemperature: real("ambient_temperature"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  speed: real("speed"),
  sourceType: text("source_type").notNull(),
  qualityStatus: text("quality_status").notNull(),
  missingFieldsJson: text("missing_fields_json").notNull(),
  invalidFieldsJson: text("invalid_fields_json").notNull(),
}, (table) => ({
  assetObservedAtIdx: index("telemetrySnapshots_asset_observed_idx").on(table.assetId, table.observedAt),
  payloadHashIdx: uniqueIndex("telemetrySnapshots_payload_hash_idx").on(table.payloadHash),
}));

export const telemetryAggregates = sqliteTable("telemetryAggregates", {
  id: text("id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  assetId: text("asset_id").notNull(),
  windowStart: text("window_start").notNull(),
  windowSeconds: integer("window_seconds").notNull(),
  sampleCount: integer("sample_count").notNull(),
  coolantTemperatureAvg: real("coolant_temperature_avg"),
  coolantTemperatureMax: real("coolant_temperature_max"),
  oilTemperatureAvg: real("oil_temperature_avg"),
  oilTemperatureMax: real("oil_temperature_max"),
  loadRateAvg: real("load_rate_avg"),
  engineRpmAvg: real("engine_rpm_avg"),
  qualityStatus: text("quality_status").notNull(),
}, (table) => ({
  payloadHashIdx: uniqueIndex("telemetryAggregates_payload_hash_idx").on(table.payloadHash),
}));

export const riskAssessments = sqliteTable("riskAssessments", {
  id: text("id").primaryKey(),
  dedupKey: text("dedup_key").notNull(),
  siteId: text("site_id").notNull(),
  assetId: text("asset_id").notNull(),
  level: text("level").notNull(),
  score: integer("score").notNull(),
  confidence: integer("confidence").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  observedWindow: text("observed_window").notNull(),
  shouldNotifyMaintenance: integer("should_notify_maintenance").notNull(),
  reasonKey: text("reason_key").notNull(),
  assessedAt: text("assessed_at").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  siteStatusIdx: index("riskAssessments_site_status_idx").on(table.siteId, table.status),
  dedupKeyIdx: uniqueIndex("riskAssessments_dedup_key_idx").on(table.dedupKey),
}));

export const maintenanceActions = sqliteTable("maintenanceActions", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull(),
  assetId: text("asset_id").notNull(),
  riskAssessmentId: text("risk_assessment_id").notNull().references(() => riskAssessments.id),
  assignee: text("assignee").notNull(),
  note: text("note").notNull(),
  status: text("status").notNull(),
  inspectionNote: text("inspection_note").notNull(),
  actionTaken: text("action_taken").notNull(),
  partsReplacedJson: text("parts_replaced_json").notNull(),
  canReturnToService: integer("can_return_to_service").notNull(),
  actualOverheatLabel: text("actual_overheat_label").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => ({
  riskAssessmentIdx: index("maintenanceActions_risk_assessment_idx").on(table.riskAssessmentId),
}));

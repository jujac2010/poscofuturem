CREATE TABLE `maintenanceActions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`risk_assessment_id` text NOT NULL,
	`assignee` text NOT NULL,
	`note` text NOT NULL,
	`status` text NOT NULL,
	`inspection_note` text NOT NULL,
	`action_taken` text NOT NULL,
	`parts_replaced_json` text NOT NULL,
	`can_return_to_service` integer NOT NULL,
	`actual_overheat_label` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`risk_assessment_id`) REFERENCES `riskAssessments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `maintenanceActions_risk_assessment_idx` ON `maintenanceActions` (`risk_assessment_id`);--> statement-breakpoint
CREATE TABLE `riskAssessments` (
	`id` text PRIMARY KEY NOT NULL,
	`dedup_key` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`level` text NOT NULL,
	`score` integer NOT NULL,
	`confidence` integer NOT NULL,
	`evidence_json` text NOT NULL,
	`observed_window` text NOT NULL,
	`should_notify_maintenance` integer NOT NULL,
	`reason_key` text NOT NULL,
	`assessed_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `riskAssessments_site_status_idx` ON `riskAssessments` (`site_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `riskAssessments_dedup_key_idx` ON `riskAssessments` (`dedup_key`);--> statement-breakpoint
CREATE TABLE `telemetryAggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`asset_id` text NOT NULL,
	`window_start` text NOT NULL,
	`window_seconds` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`coolant_temperature_avg` real,
	`coolant_temperature_max` real,
	`oil_temperature_avg` real,
	`oil_temperature_max` real,
	`load_rate_avg` real,
	`engine_rpm_avg` real,
	`quality_status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telemetryAggregates_payload_hash_idx` ON `telemetryAggregates` (`payload_hash`);--> statement-breakpoint
CREATE TABLE `telemetrySnapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`asset_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`received_at` text NOT NULL,
	`engine_coolant_temperature` real,
	`engine_oil_temperature` real,
	`engine_rpm` integer,
	`load_rate` real,
	`engine_hours` real,
	`ambient_temperature` real,
	`latitude` real,
	`longitude` real,
	`speed` real,
	`source_type` text NOT NULL,
	`quality_status` text NOT NULL,
	`missing_fields_json` text NOT NULL,
	`invalid_fields_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telemetrySnapshots_asset_observed_idx` ON `telemetrySnapshots` (`asset_id`,`observed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `telemetrySnapshots_payload_hash_idx` ON `telemetrySnapshots` (`payload_hash`);

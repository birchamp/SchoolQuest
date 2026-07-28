CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`actor_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_user_idx` ON `audit_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_idx` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `availability_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`energy_level` text DEFAULT 'medium' NOT NULL,
	`location` text DEFAULT 'anywhere' NOT NULL,
	`hardness` text DEFAULT 'soft' NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `availability_rules_term_idx` ON `availability_rules` (`term_id`);--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`guard_verdict` text,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coach_messages_user_idx` ON `coach_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`title` text NOT NULL,
	`commitment_type` text NOT NULL,
	`days_of_week` text DEFAULT '' NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`specific_date` text,
	`flexibility` text DEFAULT 'fixed' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `commitments_term_idx` ON `commitments` (`term_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`instructor` text,
	`credits` real,
	`color_token` text DEFAULT 'slate' NOT NULL,
	`expected_weekly_minutes` integer,
	`target_grade` real,
	`grading_confidence` text DEFAULT 'unknown' NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `courses_term_idx` ON `courses` (`term_id`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`predecessor_work_item_id` text NOT NULL,
	`successor_work_item_id` text NOT NULL,
	`dependency_type` text DEFAULT 'finish_to_start' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dependencies_successor_idx` ON `dependencies` (`successor_work_item_id`);--> statement-breakpoint
CREATE TABLE `extraction_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`source_document_id` text NOT NULL,
	`claim_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`page_number` integer,
	`source_excerpt` text,
	`confidence` real,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`resolved_entity_type` text,
	`resolved_entity_id` text,
	`prompt_version` text,
	`model` text,
	FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `extraction_claims_document_idx` ON `extraction_claims` (`source_document_id`);--> statement-breakpoint
CREATE TABLE `grade_results` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`points_earned` real,
	`points_possible` real,
	`letter_grade` text,
	`posted_at` text,
	`confirmation_status` text DEFAULT 'confirmed' NOT NULL,
	`source_document_id` text,
	`dropped` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grade_results_item_idx` ON `grade_results` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `grading_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`name` text NOT NULL,
	`weight_percent` real,
	`drop_rule_json` text,
	`confidence_status` text DEFAULT 'unknown' NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grading_categories_course_idx` ON `grading_categories` (`course_id`);--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_tokens_token_hash_idx` ON `login_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `meeting_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`days_of_week` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`location` text,
	`effective_start` text,
	`effective_end` text,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meeting_patterns_course_idx` ON `meeting_patterns` (`course_id`);--> statement-breakpoint
CREATE TABLE `plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`horizon_start` text NOT NULL,
	`horizon_end` text NOT NULL,
	`generation_reason` text NOT NULL,
	`algorithm_version` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_versions_term_idx` ON `plan_versions` (`term_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `source_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`type` text NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_documents_course_idx` ON `source_documents` (`course_id`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`planning_preferences_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `terms_user_idx` ON `terms` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`theme` text DEFAULT 'plain' NOT NULL,
	`reduced_motion` integer DEFAULT false NOT NULL,
	`detail_mode` text DEFAULT 'standard' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`parent_work_item_id` text,
	`title` text NOT NULL,
	`description` text,
	`work_type` text NOT NULL,
	`available_at` text,
	`due_at` text,
	`points_possible` real,
	`grading_category_id` text,
	`category_share_percent` real,
	`estimated_minutes` integer,
	`remaining_minutes` integer,
	`cognitive_demand` text DEFAULT 'medium' NOT NULL,
	`divisibility` text DEFAULT 'divisible' NOT NULL,
	`location_requirement` text DEFAULT 'anywhere' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`source_confidence` text DEFAULT 'confirmed' NOT NULL,
	`user_priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_items_course_idx` ON `work_items` (`course_id`);--> statement-breakpoint
CREATE INDEX `work_items_parent_idx` ON `work_items` (`parent_work_item_id`);--> statement-breakpoint
CREATE INDEX `work_items_due_idx` ON `work_items` (`due_at`);--> statement-breakpoint
CREATE TABLE `work_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`accepted_by_user` integer DEFAULT false NOT NULL,
	`actual_minutes` integer,
	`outcome_code` text,
	`reason_codes_json` text DEFAULT '[]' NOT NULL,
	`tradeoff_code` text,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_sessions_plan_idx` ON `work_sessions` (`plan_version_id`);--> statement-breakpoint
CREATE INDEX `work_sessions_item_idx` ON `work_sessions` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `work_sessions_start_idx` ON `work_sessions` (`start_at`);
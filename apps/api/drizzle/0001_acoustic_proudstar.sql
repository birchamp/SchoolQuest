CREATE TABLE `interruptions` (
	`id` text PRIMARY KEY NOT NULL,
	`term_id` text NOT NULL,
	`kind` text NOT NULL,
	`slot_key` text NOT NULL,
	`work_session_id` text,
	`title` text,
	`commitment_type` text,
	`start_at` text,
	`end_at` text,
	`recurring` integer,
	`resolution` text,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`promoted_commitment_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `interruptions_term_idx` ON `interruptions` (`term_id`,`slot_key`);
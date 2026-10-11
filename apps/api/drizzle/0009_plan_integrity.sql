-- Plan versions get a unique number per term; dependencies and blocks get the foreign keys they
-- were missing (issues #19 and #24).
--
-- Two replans of one term running at once both read the same latest version number and both
-- wrote it. The generate route now writes a plan in one batch and relies on this index to make
-- the second of two racing writes fail whole, so it can retry against the plan that won.
--
-- Any duplicates already stored are renumbered first, or the index could not be built: within a
-- term, versions are numbered again in their existing order, ties broken by creation time, so the
-- plan written last stays the current one. A term with no duplicates keeps its numbers.
UPDATE plan_versions
SET version_number = (
  SELECT ranked.n FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY term_id ORDER BY version_number, created_at, id
    ) AS n
    FROM plan_versions
  ) AS ranked
  WHERE ranked.id = plan_versions.id
)
WHERE term_id IN (
  SELECT term_id FROM plan_versions GROUP BY term_id, version_number HAVING COUNT(*) > 1
);--> statement-breakpoint
DROP INDEX `plan_versions_term_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_term_idx` ON `plan_versions` (`term_id`,`version_number`);--> statement-breakpoint
-- SQLite adds a foreign key only by rebuilding the table. Both rebuilt here are leaves -- no
-- foreign key points at them -- so dropping the old table cascades nowhere. `work_items` is not
-- rebuilt, for the reason given beside `parentWorkItemId` in `src/db/schema.ts`.
--
-- D1 enforces foreign keys and ignores `PRAGMA foreign_keys = OFF` inside a migration, so a row
-- pointing at nothing would fail the copy and with it the whole migration. Such rows are removed
-- first. A dependency on a deleted item blocks its successor forever; a block whose work item or
-- plan version is gone is shown nowhere. Neither is anything a student could still use.
DELETE FROM dependencies
WHERE predecessor_work_item_id NOT IN (SELECT id FROM work_items)
   OR successor_work_item_id NOT IN (SELECT id FROM work_items);--> statement-breakpoint
DELETE FROM work_sessions
WHERE work_item_id NOT IN (SELECT id FROM work_items)
   OR plan_version_id NOT IN (SELECT id FROM plan_versions);--> statement-breakpoint
CREATE TABLE `__new_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`predecessor_work_item_id` text NOT NULL,
	`successor_work_item_id` text NOT NULL,
	`dependency_type` text DEFAULT 'finish_to_start' NOT NULL,
	FOREIGN KEY (`predecessor_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`successor_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_dependencies`("id", "predecessor_work_item_id", "successor_work_item_id", "dependency_type") SELECT "id", "predecessor_work_item_id", "successor_work_item_id", "dependency_type" FROM `dependencies`;--> statement-breakpoint
DROP TABLE `dependencies`;--> statement-breakpoint
ALTER TABLE `__new_dependencies` RENAME TO `dependencies`;--> statement-breakpoint
CREATE INDEX `dependencies_successor_idx` ON `dependencies` (`successor_work_item_id`);--> statement-breakpoint
CREATE TABLE `__new_work_sessions` (
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
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_work_sessions`("id", "work_item_id", "plan_version_id", "start_at", "end_at", "status", "locked", "accepted_by_user", "actual_minutes", "outcome_code", "reason_codes_json", "tradeoff_code") SELECT "id", "work_item_id", "plan_version_id", "start_at", "end_at", "status", "locked", "accepted_by_user", "actual_minutes", "outcome_code", "reason_codes_json", "tradeoff_code" FROM `work_sessions`;--> statement-breakpoint
DROP TABLE `work_sessions`;--> statement-breakpoint
ALTER TABLE `__new_work_sessions` RENAME TO `work_sessions`;--> statement-breakpoint
CREATE INDEX `work_sessions_plan_idx` ON `work_sessions` (`plan_version_id`);--> statement-breakpoint
CREATE INDEX `work_sessions_item_idx` ON `work_sessions` (`work_item_id`);--> statement-breakpoint
CREATE INDEX `work_sessions_start_idx` ON `work_sessions` (`start_at`);

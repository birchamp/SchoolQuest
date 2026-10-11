-- The usage log (issue #40): which screens and controls get used, so the owner can tell what
-- earns its place and what nobody touches.
--
-- One row per UTC day, per allowlisted event name (USAGE_EVENTS in packages/domain), per person.
-- `subject` is an HMAC-SHA256 of the user id under a key derived from AUTH_SECRET -- never the id
-- itself -- so distinct people can be counted without the table saying who any of them are.
-- There is no column for free text, course details, or anything the student typed. Rows older
-- than 180 days are deleted by the API as it writes.
--
-- `users.share_usage` is the opt-out: on by default, and when off nothing is recorded.
CREATE TABLE `usage_daily` (
	`day` text NOT NULL,
	`event` text NOT NULL,
	`subject` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `event`, `subject`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `share_usage` integer DEFAULT true NOT NULL;

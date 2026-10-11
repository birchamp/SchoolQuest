-- Whether the student's plan follows the device's time zone or stays on one they chose.
--
-- Every scheduled time in SchoolQuest is a wall-clock time in the student's zone, and the app
-- keeps `users.timezone` in step with the device it is opened on. That is right for nearly
-- everyone and wrong for a student away from home whose classes and deadlines are not: on a
-- trip three zones west, "now" would move three hours and the plan with it. "pinned" keeps the
-- zone where the student put it. Defaults to "device", which is the behaviour every existing
-- account already has.
ALTER TABLE users ADD COLUMN timezone_mode TEXT NOT NULL DEFAULT 'device';

-- Retire blocks that a later plan replaced but that were never marked as replaced.
--
-- Until the weekly review existed, nothing ever asked the sessions table a question about
-- the past, so nothing noticed that generating a plan left its predecessor's blocks saying
-- "planned" forever. Three generations of one term held 83 live sessions where 26 were real.
--
-- Two things read those rows and were quietly wrong because of it: project health counted
-- them as time already booked when judging whether a project would fit, and the weekly
-- review — the moment it shipped — read them as time the student had let slip. The reference
-- semester opened with three questions and 1,465 minutes reported lost, spanning whole
-- afternoons at a stretch, none of which anyone had actually missed.
--
-- The generate route now marks these as it goes. This is the one-time correction for rows
-- written before it did.
--
-- A block is superseded when a later plan version for the same term had a horizon that
-- covered its date and did not include it. Locked and user-accepted blocks are excluded
-- because those are exactly the ones carry-over preserves: they keep their original id and
-- their original plan_version_id, so they look superseded and are not.
UPDATE work_sessions
SET status = 'moved'
WHERE status = 'planned'
  AND locked = 0
  AND accepted_by_user = 0
  AND EXISTS (
    SELECT 1
    FROM plan_versions own
    JOIN plan_versions newer
      ON newer.term_id = own.term_id
     AND newer.version_number > own.version_number
    WHERE own.id = work_sessions.plan_version_id
      AND newer.horizon_start <= substr(work_sessions.start_at, 1, 10)
  );

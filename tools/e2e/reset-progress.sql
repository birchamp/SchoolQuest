-- Returns the reference semester to "nothing done yet" without re-running extraction.
--
--   pnpm db:reset-progress:local
--
-- The visual-critique loop seeds a little progress before each round of screenshots so the
-- progression layer has something real to show. That turned out to mutate the fixture:
-- completing a session retires its work item and releases the item's remaining blocks, so a
-- naive "top up to four completed sessions" retired four more items every run. Six rounds
-- in, all ten exams in the term were marked done and the campaign arc was empty — the loop
-- had ground its own reference data into a finished term.
--
-- The harness no longer drifts (it completes a fixed set), but a reset is still worth having:
-- it makes a round reproducible from a known state, and it is far cheaper than replaying five
-- syllabus extractions through the mock model.
--
-- Touches progress only. Courses, work items, dates, weights, commitments, and availability
-- are left exactly as extraction produced them.

-- `remaining_minutes` goes back to NULL, not to `estimated_minutes`: extraction never sets
-- an estimate (no syllabus says how long something takes), so COALESCE(estimated, remaining)
-- resolved to the already-zeroed remaining value and the reset silently restored nothing.
-- NULL is the honest "unknown", and both the scheduler and the stats layer already fall back
-- to the same per-type default when they see it.
UPDATE work_items
SET status = CASE WHEN status = 'canceled' THEN 'canceled' ELSE 'not_started' END,
    remaining_minutes = estimated_minutes;

-- Blocks whose time has already passed are retired, not restored.
--
-- This used to set *every* session back to "planned", which was harmless while nothing read
-- the past. The weekly review does read it: a restored block sitting in a day that has
-- already gone by is indistinguishable from an hour the student lost, so a reset meant to
-- produce a clean fixture instead produced one that opens by asking three questions about
-- time nobody ever missed. A demo term has no history worth having an opinion about.
UPDATE work_sessions
SET status = 'moved',
    actual_minutes = NULL,
    outcome_code = NULL
WHERE substr(start_at, 1, 10) < date('now');

-- Everything still ahead goes back to untouched. Blocks already retired by a replan stay
-- retired — they were never part of the live plan and restoring them would double-book it.
UPDATE work_sessions
SET status = 'planned',
    actual_minutes = NULL,
    outcome_code = NULL
WHERE substr(start_at, 1, 10) >= date('now')
  AND status <> 'moved';

DELETE FROM audit_events WHERE entity_type = 'work_session';

-- Reported interruptions and the answers given about them are progress too: leaving them
-- behind would have the review skip questions the reset is meant to bring back.
DELETE FROM interruptions;

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

UPDATE work_items
SET status = CASE WHEN status = 'canceled' THEN 'canceled' ELSE 'not_started' END,
    -- Estimated effort is the best available stand-in for "all of it still to do"; the
    -- original remaining value is not recoverable and inventing one would be worse.
    remaining_minutes = COALESCE(estimated_minutes, remaining_minutes);

UPDATE work_sessions
SET status = 'planned',
    actual_minutes = NULL,
    outcome_code = NULL
WHERE status <> 'moved';

DELETE FROM audit_events WHERE entity_type = 'work_session';

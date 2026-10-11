-- The zone a plan was made in (issue #4).
--
-- A plan's blocks are UTC instants, placed by weekly rules read in the student's zone. When the
-- zone changes -- the student moves, or pins another -- those instants no longer fall where the
-- rules say, and the plan has to be rebuilt. Before this nothing recorded which zone a plan was
-- made in, so nothing could tell. Null for plans made before; those are rebuilt once.
ALTER TABLE plan_versions ADD COLUMN time_zone TEXT;

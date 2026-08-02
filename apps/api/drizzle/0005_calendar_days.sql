-- Normalise the term calendar from break ranges to day-level exceptions.
--
-- 0004 stored `breaks: [{name, startDate, endDate}]` plus finalsStartDate/finalsEndDate. That
-- shape cannot say the things real academic calendars say: Labor Day is one Monday, fall break
-- is two days, and "Tuesday November 24 runs a Friday schedule" is not a range at all.
--
-- The bedrock is now one record per day, materialised from a list of exceptions. Anything that
-- arrives as a range — a student typing one in, or a model reading a pasted calendar — is
-- normalised to days at the door, so nothing downstream reasons about ranges.
--
-- Written as a rebuild rather than a transform because 0004 shipped hours ago and no term in
-- any environment has a non-empty calendar: every row holds '{}' or the empty-calendar
-- defaults. Anything that somehow does hold breaks is reset to '{}', which is the same state
-- as never having supplied one — less certain, and the app says so rather than guessing.
UPDATE terms
SET calendar_json = '{}'
WHERE calendar_json IS NULL
   OR calendar_json = ''
   OR calendar_json LIKE '%"breaks"%'
   OR calendar_json LIKE '%finalsStartDate%';

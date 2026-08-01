-- Give courses their identity colours where nothing ever assigned one.
--
-- `colorToken` exists so a student can tell five courses apart at a glance, and course
-- creation now hands out the next token in the palette cycle. That fix only reaches courses
-- created after it, so every term that predates it still holds the schema default on every
-- row — and the deterministic fallback cannot rescue them, because it only fires for a token
-- it does not recognise and "slate" is a perfectly valid one.
--
-- The result was five identical grey sigils on the week map, the roster, the term arc and
-- the new dashboard: the column was populated, so nothing looked broken, and the one thing
-- the colour exists to do was not happening anywhere.
--
-- Only terms where every course carries the default are touched, so a term whose colours
-- were assigned — or later chosen — is left exactly as it is.
UPDATE courses
SET color_token = (
  SELECT CASE ((
    SELECT COUNT(*)
    FROM courses AS earlier
    WHERE earlier.term_id = courses.term_id
      AND earlier.rowid < courses.rowid
  ) % 9)
    WHEN 0 THEN 'azure'
    WHEN 1 THEN 'vermilion'
    WHEN 2 THEN 'verdant'
    WHEN 3 THEN 'amber'
    WHEN 4 THEN 'violet'
    WHEN 5 THEN 'sable'
    WHEN 6 THEN 'teal'
    WHEN 7 THEN 'rose'
    ELSE 'slate'
  END
)
WHERE term_id IN (
  SELECT term_id
  FROM courses
  GROUP BY term_id
  HAVING COUNT(*) > 1
     AND COUNT(DISTINCT color_token) = 1
     AND MIN(color_token) = 'slate'
);

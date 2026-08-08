-- A student's own OpenRouter key and model choices.
--
-- SchoolQuest is run by whoever installs it, and the person paying for the model calls is the
-- person using the app. Before this the key was a deployment-wide Worker secret: workable for a
-- single self-hosted user, impossible for anyone sharing an install, and no way for a student to
-- see or change what their reading was costing them.
--
-- The key column holds ciphertext, never the key itself — see `apps/api/src/secrets.ts`.
-- Nullable throughout, so a deployment that configures OPENROUTER_API_KEY keeps working with
-- nobody entering anything.
ALTER TABLE users ADD COLUMN openrouter_key_encrypted TEXT;
ALTER TABLE users ADD COLUMN extraction_model TEXT;
ALTER TABLE users ADD COLUMN coach_model TEXT;

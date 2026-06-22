-- v2.2 PR2: Marketplace Detection
-- Adds marketplace_detected flag to founder_sessions (session-init heuristic result)
-- and founder_understanding (LLM-extracted, sticky across turns via the engine).
-- Default false — all existing sessions are unaffected.

ALTER TABLE founder_sessions
  ADD COLUMN IF NOT EXISTS marketplace_detected BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE founder_understanding
  ADD COLUMN IF NOT EXISTS marketplace_detected BOOLEAN NOT NULL DEFAULT false;

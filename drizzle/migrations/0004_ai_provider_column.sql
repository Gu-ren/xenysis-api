-- Sprint 3 Phase 1: AI Provider Column
--
-- Adds ai_provider enum and provider column to generation_jobs.
-- Provider is explicit — never inferred from model name.
-- Default 'openai' is safe for all existing rows (founder_chat jobs use gpt-4o).

CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic');

ALTER TABLE "generation_jobs"
  ADD COLUMN IF NOT EXISTS "provider" "ai_provider" NOT NULL DEFAULT 'openai';

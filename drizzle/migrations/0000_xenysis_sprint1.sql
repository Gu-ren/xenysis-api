-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0000_xenysis_sprint1
-- Sprint 1 — Foundation tables and indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────

CREATE TYPE lifecycle_stage AS ENUM (
  'founder-session', 'generating', 'preview', 'build', 'deployed'
);

CREATE TYPE session_status AS ENUM ('active', 'completed', 'abandoned');

CREATE TYPE question_type AS ENUM (
  'problem', 'customer', 'market', 'competition',
  'revenue', 'team', 'vision', 'assumption'
);

CREATE TYPE startup_category AS ENUM (
  'saas', 'marketplace', 'fintech', 'healthcare',
  'ecommerce', 'developer-tool', 'ai-tool', 'social', 'other'
);

-- ─────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────

CREATE TABLE profiles (
  id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name             TEXT,
  avatar_url               TEXT,
  onboarding_completed_at  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- STARTUPS
-- ─────────────────────────────────────────

CREATE TABLE startups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  category         startup_category,
  lifecycle_stage  lifecycle_stage NOT NULL DEFAULT 'founder-session',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

-- ─────────────────────────────────────────
-- FOUNDER SESSIONS
-- ─────────────────────────────────────────

CREATE TABLE founder_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id  UUID NOT NULL REFERENCES startups(id),
  user_id     UUID NOT NULL,
  idea        TEXT NOT NULL,
  status      session_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES founder_sessions(id),
  question_id     TEXT NOT NULL,
  question_type   question_type NOT NULL DEFAULT 'problem',
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL CHECK (char_length(answer) <= 2000),
  sequence_order  INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

-- Startup queries (soft delete aware)
CREATE INDEX idx_startups_user_id      ON startups(user_id)                         WHERE deleted_at IS NULL;
CREATE INDEX idx_startups_lifecycle    ON startups(user_id, lifecycle_stage)         WHERE deleted_at IS NULL;

-- Session queries
CREATE INDEX idx_sessions_startup_id   ON founder_sessions(startup_id);
CREATE INDEX idx_answers_session_id    ON session_answers(session_id);
CREATE INDEX idx_answers_type          ON session_answers(session_id, question_type);

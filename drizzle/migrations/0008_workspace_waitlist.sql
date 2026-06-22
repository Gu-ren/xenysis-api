-- v3.0: Workspace Generation Early Access waitlist
-- Captures user intent before Workspace Generation is publicly available.
-- Supports activation flow: status transitions waiting → notified → activated.

CREATE TABLE IF NOT EXISTS "workspace_waitlist" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid        NOT NULL,
  "startup_id"    uuid        NOT NULL,
  "startup_name"  text        NOT NULL,
  "founder_stage" text        NOT NULL DEFAULT 'building',
  "blueprint_id"  uuid,
  "email"         text        NOT NULL,
  "source"        text        NOT NULL DEFAULT 'workspace_generation',
  "status"        text        NOT NULL DEFAULT 'waiting',
  "joined_at"     timestamptz NOT NULL DEFAULT now(),
  "notified_at"   timestamptz,
  "activated_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "workspace_waitlist_status_check"
    CHECK (status IN ('waiting', 'notified', 'activated')),

  CONSTRAINT "workspace_waitlist_founder_stage_check"
    CHECK (founder_stage IN ('idea', 'building', 'revenue')),

  CONSTRAINT "workspace_waitlist_user_startup_unique"
    UNIQUE (user_id, startup_id)
);

CREATE INDEX IF NOT EXISTS "workspace_waitlist_user_id_idx"    ON "workspace_waitlist" ("user_id");
CREATE INDEX IF NOT EXISTS "workspace_waitlist_startup_id_idx" ON "workspace_waitlist" ("startup_id");
CREATE INDEX IF NOT EXISTS "workspace_waitlist_status_idx"     ON "workspace_waitlist" ("status");
CREATE INDEX IF NOT EXISTS "workspace_waitlist_joined_at_idx"  ON "workspace_waitlist" ("joined_at" DESC);

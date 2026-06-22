-- Requires Postgres 11+.
-- On Postgres 11+, ADD COLUMN with a NOT NULL DEFAULT is a metadata-only operation
-- (the default is stored in pg_attrdef, not backfilled row-by-row), so this runs
-- without an ACCESS EXCLUSIVE lock that would block reads/writes.
-- On Postgres < 11, this triggers a full table rewrite and should be split into:
--   (1) ADD COLUMN "founder_stage" text DEFAULT 'building'   -- no lock
--   (2) ALTER COLUMN "founder_stage" SET NOT NULL             -- lightweight once column exists
-- Rollback: DROP CONSTRAINT "founder_stage_check"; DROP COLUMN "founder_stage";

ALTER TABLE "founder_sessions"
  ADD COLUMN "founder_stage" text NOT NULL DEFAULT 'building';

ALTER TABLE "founder_sessions"
  ADD CONSTRAINT "founder_stage_check"
  CHECK ("founder_stage" IN ('idea', 'building', 'revenue'));

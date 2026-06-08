-- Sprint 3 pre-flight: structural constraints for opportunity_assessments.
--
-- 1. UNIQUE(startup_id) on opportunity_assessments
--    Enforces one parent record per startup. OpportunityAgent upserts this row;
--    all versions are appended to opportunity_assessment_versions. Without this
--    constraint, each regeneration would create a new orphaned parent row.
--
-- 2. Partial unique index on opportunity_assessment_versions(assessment_id) WHERE is_current
--    Enforces at most one current version per assessment at the DB level.
--    Mirrors the application-level "flip is_current" transaction pattern.

ALTER TABLE "opportunity_assessments"
  ADD CONSTRAINT "uq_opportunity_startup" UNIQUE ("startup_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "idx_current_opportunity_version"
  ON "opportunity_assessment_versions" ("assessment_id")
  WHERE "is_current" = true;

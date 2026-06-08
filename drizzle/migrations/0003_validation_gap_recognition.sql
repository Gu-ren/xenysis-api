-- Sprint 2.5 R2: Validation Gap Recognition
--
-- Adds novelty_signal column to evidence_records.
-- All new per-category state (validationStatus, weakAbsenceCount, saturationCount,
-- lastFocusConfidence, assessmentTier, validationGaps, questioningMode) is stored in
-- the existing 'understanding' JSONB column on founder_understanding — no column migration
-- required for those fields. Zod defaults handle old rows on read.

ALTER TABLE "evidence_records"
  ADD COLUMN IF NOT EXISTS "novelty_signal" text;

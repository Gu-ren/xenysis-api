import { boolean, check, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { founderSessions } from './founder-sessions.ts'
import { startups } from './startups.ts'

// ── founder_understanding ─────────────────────────────────────────────────────
// Materialized per-session understanding state. One row per session (UNIQUE on session_id).
// Upserted after every AI exchange via understanding-engine.ts.
//
// Normalized confidence columns exist for query performance (sorting, filtering).
// The 'understanding' JSONB column holds the full CategoryState per category
// (evidence arrays, evidenceStrength, status) which are document-shaped and not queried.
//
// Revision 2: added founder_fit_confidence column.
// Revision 3: added overall_evidence_strength column (max strength across all categories).
export const founderUnderstanding = pgTable(
  'founder_understanding',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => founderSessions.id),
    startupId: uuid('startup_id').notNull().references(() => startups.id),
    userId:    uuid('user_id').notNull(),

    // Per-category confidence scores (0-100) — normalized for query performance.
    problemConfidence:     integer('problem_confidence').notNull().default(0),
    customerConfidence:    integer('customer_confidence').notNull().default(0),
    solutionConfidence:    integer('solution_confidence').notNull().default(0),
    marketConfidence:      integer('market_confidence').notNull().default(0),
    pricingConfidence:     integer('pricing_confidence').notNull().default(0),
    competitionConfidence: integer('competition_confidence').notNull().default(0),
    risksConfidence:       integer('risks_confidence').notNull().default(0),
    founderFitConfidence:  integer('founder_fit_confidence').notNull().default(0),   // Revision 2

    // Weighted overall confidence across all 8 categories.
    overallConfidence: integer('overall_confidence').notNull().default(0),

    // Revision 3: highest evidence strength reached across all categories (1-6).
    // Normalized for use in priority queries (e.g. "sessions with only assumption-level evidence").
    overallEvidenceStrength: integer('overall_evidence_strength').notNull().default(1),

    // Revision 4: true when required categories (problem/customer/solution) >= 80
    // AND overall >= 75. Supporting categories generate warnings but do not block.
    isComplete: boolean('is_complete').notNull().default(false),

    // v2.2 PR2: sticky marketplace signal — true once set, never reverts.
    // Normalized here for filtering/analytics; canonical value lives in the understanding JSONB.
    marketplaceDetected: boolean('marketplace_detected').notNull().default(false),

    // v2.2 PR3: supply-side confidence for marketplace sessions (always 0 for non-marketplace).
    supplySideConfidence: integer('supply_side_confidence').notNull().default(0),

    // Category with the highest gap priority: (100 - confidence) × businessImportance.
    weakestCategory: text('weakest_category'),

    // Full FounderUnderstanding JSONB — CategoryState (evidence, evidenceStrength, status) per category.
    // Per Rule 8: document-shaped data lives here; anything filtered/sorted has a normalized column.
    understanding: jsonb('understanding').notNull().default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_understanding_session').on(t.sessionId),
    check('problem_confidence_range',      sql`${t.problemConfidence}     BETWEEN 0 AND 100`),
    check('customer_confidence_range',     sql`${t.customerConfidence}    BETWEEN 0 AND 100`),
    check('solution_confidence_range',     sql`${t.solutionConfidence}    BETWEEN 0 AND 100`),
    check('market_confidence_range',       sql`${t.marketConfidence}      BETWEEN 0 AND 100`),
    check('pricing_confidence_range',      sql`${t.pricingConfidence}     BETWEEN 0 AND 100`),
    check('competition_confidence_range',  sql`${t.competitionConfidence} BETWEEN 0 AND 100`),
    check('risks_confidence_range',        sql`${t.risksConfidence}       BETWEEN 0 AND 100`),
    check('founder_fit_confidence_range',  sql`${t.founderFitConfidence}  BETWEEN 0 AND 100`),
    check('overall_confidence_range',      sql`${t.overallConfidence}     BETWEEN 0 AND 100`),
    check('overall_evidence_strength_range', sql`${t.overallEvidenceStrength} BETWEEN 1 AND 6`),
    check('supply_side_confidence_range',    sql`${t.supplySideConfidence}     BETWEEN 0 AND 100`),
  ],
)

// ── evidence_records ──────────────────────────────────────────────────────────
// Append-only audit trail — one row per evidence statement per category per turn.
// Revision 3: added evidence_strength column for quality tracking.
// Never updated after insertion.
export const evidenceRecords = pgTable('evidence_records', {
  id:               uuid('id').primaryKey().defaultRandom(),
  sessionId:        uuid('session_id').notNull().references(() => founderSessions.id),
  startupId:        uuid('startup_id').notNull().references(() => startups.id),
  userId:           uuid('user_id').notNull(),

  // One of: problem | customer | solution | market | pricing | competition | risks | founder_fit
  category:         text('category').notNull(),

  // The evidence statement extracted from the conversation.
  evidence:         text('evidence').notNull(),

  // Revision 3: quality level of this specific evidence item (1-6).
  // 1 = founder assumption … 6 = usage/revenue data.
  evidenceStrength: integer('evidence_strength').notNull().default(1),

  // Optional pointer to the generation job (message exchange) that produced this evidence.
  sourceMessageId:  text('source_message_id'),

  // Estimated contribution to the category confidence score this turn.
  confidenceImpact: integer('confidence_impact').notNull().default(0),

  // Evidence novelty classification for this record's turn.
  // 'new' = fresh evidence item; 'absent_confirmed' = absence signal fired; 'repetitive' = no delta.
  noveltySignal: text('novelty_signal'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Inferred types ────────────────────────────────────────────────────────────

export type FounderUnderstandingRow    = typeof founderUnderstanding.$inferSelect
export type NewFounderUnderstandingRow = typeof founderUnderstanding.$inferInsert
export type EvidenceRecordRow          = typeof evidenceRecords.$inferSelect
export type NewEvidenceRecordRow       = typeof evidenceRecords.$inferInsert

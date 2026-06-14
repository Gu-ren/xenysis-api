/**
 * Verifies that all Drizzle migrations are consistent across three sources of truth:
 *   1. drizzle/migrations/meta/_journal.json  — what Drizzle knows it should apply
 *   2. drizzle.__drizzle_migrations table     — what has actually been applied to the DB
 *   3. drizzle/migrations/*.sql files         — the SQL files on disk
 *
 * Also spot-checks specific columns and constraints introduced by each migration.
 *
 * Run: npx tsx --env-file=.env scripts/verify-migrations.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DB_URL, { ssl: "require", max: 1 });

// ─── helpers ─────────────────────────────────────────────────────────────────

function pass(msg: string) {
  console.log(`  ✓  ${msg}`);
}
function fail(msg: string) {
  console.log(`  ✗  ${msg}`);
}
function info(msg: string) {
  console.log(`  ·  ${msg}`);
}
function header(msg: string) {
  console.log(`\n── ${msg} ──`);
}

// ─── 1. Read journal ──────────────────────────────────────────────────────────

header("Journal (_journal.json)");

const journalPath = resolve("drizzle/migrations/meta/_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  version: string;
  dialect: string;
  entries: { idx: number; version: string; when: number; tag: string }[];
};

info(`Drizzle schema version: ${journal.version}`);
info(`${journal.entries.length} entries registered:`);
for (const e of journal.entries) {
  info(`  idx=${e.idx}  tag=${e.tag}  when=${new Date(e.when).toISOString()}`);
}

// ─── 2. Applied migrations in DB ─────────────────────────────────────────────

header("Applied migrations (drizzle.__drizzle_migrations)");

const applied = await sql`
  SELECT id, hash, created_at
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at
`;

info(`${applied.length} migration(s) recorded as applied:`);
for (const row of applied) {
  info(`  id=${row.id}  hash=${String(row.hash).slice(0, 12)}…  at=${new Date(Number(row.created_at)).toISOString()}`);
}

// Cross-check: every journal entry should have a matching applied row.
// Drizzle matches by the hash of the SQL file, not by idx/tag.
// We reproduce the hash check by comparing created_at timestamps (journal `when` = applied `created_at`).
header("Journal ↔ DB cross-check");

const appliedTimestamps = new Set(applied.map((r) => String(r.created_at)));

for (const entry of journal.entries) {
  if (appliedTimestamps.has(String(entry.when))) {
    pass(`${entry.tag} — applied (matched by timestamp ${entry.when})`);
  } else {
    fail(`${entry.tag} — IN JOURNAL but NOT in __drizzle_migrations`);
  }
}

// ─── 3. SQL files on disk vs journal ─────────────────────────────────────────

header("SQL files on disk vs journal");

import { readdirSync } from "fs";

const migDir = resolve("drizzle/migrations");
const sqlFiles = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const journalTags = new Set(journal.entries.map((e) => e.tag));

for (const file of sqlFiles) {
  const tag = file.replace(/\.sql$/, "");
  if (journalTags.has(tag)) {
    pass(`${file} — registered in journal`);
  } else {
    fail(`${file} — EXISTS ON DISK but missing from _journal.json`);
  }
}

// ─── 4. Per-migration DB spot-checks ─────────────────────────────────────────

header("DB spot-checks per migration");

// 0000 — baseline: evidence_records table must exist
const evidenceTable = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'evidence_records'
`;
evidenceTable.length > 0
  ? pass("0000 — evidence_records table exists")
  : fail("0000 — evidence_records table MISSING");

// 0002 — opportunity_assessments UNIQUE constraint + partial unique index
const uqConstraint = await sql`
  SELECT constraint_name FROM information_schema.table_constraints
  WHERE table_name = 'opportunity_assessments'
    AND constraint_name = 'uq_opportunity_startup'
`;
uqConstraint.length > 0
  ? pass("0002 — uq_opportunity_startup constraint exists")
  : fail("0002 — uq_opportunity_startup constraint MISSING");

const partialIdx = await sql`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'opportunity_assessment_versions'
    AND indexname = 'idx_current_opportunity_version'
`;
partialIdx.length > 0
  ? pass("0002 — idx_current_opportunity_version index exists")
  : fail("0002 — idx_current_opportunity_version index MISSING");

// 0003 — novelty_signal column on evidence_records
const noveltyCol = await sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'evidence_records'
    AND column_name = 'novelty_signal'
`;
if (noveltyCol.length > 0) {
  pass(`0003 — novelty_signal column exists (type: ${noveltyCol[0].data_type})`);
} else {
  fail("0003 — novelty_signal column MISSING from evidence_records");
}

// ─── 5. Summary ──────────────────────────────────────────────────────────────

header("Summary");

const journalCount = journal.entries.length;
const appliedCount = applied.length;
const diskCount = sqlFiles.length;
const unapplied = journal.entries.filter(
  (e) => !appliedTimestamps.has(String(e.when))
);
const unregistered = sqlFiles.filter(
  (f) => !journalTags.has(f.replace(/\.sql$/, ""))
);

info(`SQL files on disk : ${diskCount}`);
info(`Journal entries   : ${journalCount}`);
info(`Applied to DB     : ${appliedCount}`);

if (unapplied.length > 0) {
  fail(`${unapplied.length} journal entry/entries not yet applied: ${unapplied.map((e) => e.tag).join(", ")}`);
} else {
  pass("All journal entries are applied to the database");
}

if (unregistered.length > 0) {
  fail(`${unregistered.length} SQL file(s) not in journal: ${unregistered.join(", ")}`);
} else {
  pass("All SQL files are registered in the journal");
}

await sql.end();

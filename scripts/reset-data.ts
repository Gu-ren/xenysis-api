// Wipes all application data while preserving users and profiles.
// Run with: npm run db:reset
//
// What is cleared (via CASCADE from startups):
//   startups, founder_sessions, session_answers, session_summaries,
//   founder_memories, founder_understanding, evidence_records,
//   opportunity_assessments (+versions), blueprints (+versions),
//   workspace_graphs (+versions, +asset_configs), preview_contexts,
//   generation_jobs, ai_usage_log, deploy_environments (+vars, +releases),
//   activity_log
//
// What is preserved:
//   users, profiles, refresh_tokens

import postgres from 'postgres'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL)

async function reset() {
  console.log('Resetting database...\n')

  await client`TRUNCATE startups CASCADE`

  console.log('All application data cleared.')
  console.log('users and profiles preserved — your login is still valid.\n')
  console.log('Next: clear browser localStorage to remove cached startup/session IDs.')
  console.log('  Open DevTools → Application → Local Storage → delete xenysis-founder-session')
}

reset()
  .catch((err) => {
    console.error('Reset failed:', err)
    process.exit(1)
  })
  .finally(() => client.end())

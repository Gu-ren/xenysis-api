/**
 * Blueprint provider comparison script.
 * Generates one Blueprint from the existing StudioLink E2E session using Claude Sonnet 4.6
 * and one using GPT-4o, using the exact same context input.
 * Outputs a structured comparison to stdout.
 */

import { drizzle }               from 'drizzle-orm/postgres-js'
import postgres                   from 'postgres'
import Anthropic                  from '@anthropic-ai/sdk'
import OpenAI                     from 'openai'
import * as schema                from '../src/lib/db/schema/index.ts'
import { and, desc, eq, isNull }  from 'drizzle-orm'

import { FounderMemorySchema, EMPTY_FOUNDER_MEMORY }      from '../src/lib/contracts/founder-memory.ts'
import { FounderUnderstandingSchema, EMPTY_UNDERSTANDING } from '../src/lib/contracts/founder-understanding.ts'
import { OpportunityAssessmentContentSchema }              from '../src/lib/contracts/opportunity-assessment.ts'
import { BlueprintContentSchema }                          from '../src/lib/contracts/blueprint.ts'
import { buildSystemPrompt, buildUserMessage }             from '../src/agents/blueprint-agent/prompt.ts'
import { BLUEPRINT_SCHEMA }                                from '../src/agents/blueprint-agent/schemas.ts'
import { AnthropicStructuredAdapter }                      from '../src/lib/ai/adapters/anthropic.ts'
import { OpenAIStructuredAdapter }                         from '../src/lib/ai/adapters/openai.ts'
import type { BlueprintContent }                           from '../src/lib/contracts/blueprint.ts'

const TEST_USER_ID = 'e2e00000-0000-0000-0000-000000000001'

const client = postgres(process.env.DATABASE_URL!, { prepare: false })
const db     = drizzle(client, { schema })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── Helpers ───────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n${'═'.repeat(80)}`)
  console.log(`  ${label}`)
  console.log('═'.repeat(80))
}

function section(label: string) {
  console.log(`\n${'─'.repeat(80)}`)
  console.log(`  ${label}`)
  console.log('─'.repeat(80))
}

function score(label: string, val: string | number) {
  console.log(`  ${label.padEnd(28)} ${val}`)
}

// ── Load context ──────────────────────────────────────────────────────────────

async function loadContext() {
  // Use the most-recently-created E2E startup so stale rows from prior runs don't interfere.
  const startupRows = await db
    .select()
    .from(schema.startups)
    .where(and(eq(schema.startups.userId, TEST_USER_ID), isNull(schema.startups.deletedAt)))
    .orderBy(desc(schema.startups.createdAt))
    .limit(5)

  // Find the most recent startup that actually has an OA.
  let startupRow: typeof startupRows[0] | undefined
  let assessmentRow: Awaited<ReturnType<typeof db.query.opportunityAssessments.findFirst>>

  for (const s of startupRows) {
    const oa = await db.query.opportunityAssessments.findFirst({
      where: eq(schema.opportunityAssessments.startupId, s.id),
    })
    if (oa) { startupRow = s; assessmentRow = oa; break }
  }

  if (!startupRow || !assessmentRow) throw new Error('No E2E startup with an OA found. Run the E2E pipeline script first.')

  const [versionRow, memoryRow, understandingRow] = await Promise.all([
    db.query.opportunityAssessmentVersions.findFirst({
      where: and(
        eq(schema.opportunityAssessmentVersions.assessmentId, assessmentRow.id),
        eq(schema.opportunityAssessmentVersions.isCurrent, true),
      ),
    }),
    db.query.founderMemories.findFirst({
      where: eq(schema.founderMemories.sessionId, assessmentRow.sessionId),
    }),
    db.query.founderUnderstanding.findFirst({
      where: eq(schema.founderUnderstanding.sessionId, assessmentRow.sessionId),
    }),
  ])

  if (!versionRow) throw new Error('No current OA version found.')

  const assessmentParsed = OpportunityAssessmentContentSchema.safeParse(versionRow.content)
  if (!assessmentParsed.success) throw new Error('OA content failed schema validation.')

  const founderMemory = memoryRow
    ? (FounderMemorySchema.safeParse(memoryRow.memory).data ?? EMPTY_FOUNDER_MEMORY)
    : EMPTY_FOUNDER_MEMORY

  const understanding = understandingRow
    ? (FounderUnderstandingSchema.safeParse(understandingRow.understanding).data ?? EMPTY_UNDERSTANDING)
    : EMPTY_UNDERSTANDING

  return {
    startup:      startupRow,
    founderMemory,
    understanding,
    assessment:   assessmentParsed.data,
    startupId:    startupRow.id,
    sessionId:    assessmentRow.sessionId,
    assessmentId: assessmentRow.id,
  }
}

// ── Generate blueprint ─────────────────────────────────────────────────────────

async function generateBlueprint(
  ctx: Awaited<ReturnType<typeof loadContext>>,
  provider: 'anthropic' | 'openai',
  model: string,
): Promise<{ blueprint: BlueprintContent; inputTokens: number; outputTokens: number; durationMs: number }> {
  const systemPrompt = buildSystemPrompt(
    ctx.understanding.blueprintMode,
    ctx.understanding.gapsInBlueprint ?? [],
  )
  const userMessage = buildUserMessage({
    startup:       ctx.startup,
    founderMemory: ctx.founderMemory,
    understanding: ctx.understanding,
    assessment:    ctx.assessment,
  })

  const adapter = provider === 'anthropic'
    ? new AnthropicStructuredAdapter(anthropic)
    : new OpenAIStructuredAdapter(openai)

  const start = Date.now()
  const result = await adapter.complete({ model, systemPrompt, userMessage, schema: BLUEPRINT_SCHEMA })
  const durationMs = Date.now() - start

  const parsed = JSON.parse(result.rawContent)
  const validated = BlueprintContentSchema.parse(parsed)

  return {
    blueprint:    validated,
    inputTokens:  result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs,
  }
}

// ── Evaluation ────────────────────────────────────────────────────────────────

function evalBlueprint(b: BlueprintContent, label: string) {
  const r = b.risks?.risks ?? []
  const personas = b.personas?.personas ?? []
  const journeys = b.userJourneys?.journeys ?? []
  const milestones = b.roadmap?.milestones ?? []
  const mvpScope = b.mvpScope?.scope ?? []
  const requirements = [
    ...(b.requirements?.functional ?? []),
    ...(b.requirements?.nonFunctional ?? []),
  ]
  const metrics = b.metrics?.metrics ?? []

  // 1. Schema compliance — does it parse and have all 13 top-level sections?
  const topLevelSections = ['overview','problem','customer','solution','businessModel',
    'personas','userJourneys','mvpScope','requirements','roadmap','risks','metrics','_schemaVersion']
  const sectionsMissing = topLevelSections.filter(s => !(s in b))

  // 2. Completeness — check key sub-fields
  const completenessFlags = [
    b.overview?.tagline ? '✓ tagline' : '✗ tagline',
    b.overview?.positionStatement ? '✓ positionStatement' : '✗ positionStatement',
    b.problem?.statement ? '✓ problem.statement' : '✗ problem.statement',
    b.problem?.whyNow ? '✓ problem.whyNow' : '✗ problem.whyNow',
    b.customer?.icp?.title ? '✓ customer.icp' : '✗ customer.icp',
    b.businessModel?.goToMarketSummary ? '✓ GTM summary' : '✗ GTM summary',
    b.mvpScope?.hypothesis ? '✓ MVP hypothesis' : '✗ MVP hypothesis',
    b.roadmap?.criticalPath ? '✓ criticalPath' : '✗ criticalPath',
    b.metrics?.northStar?.name ? '✓ northStar' : '✗ northStar',
  ]

  // 7. Assumption labeling — count [HYPOTHESIS] tags
  const hypothesisTags = JSON.stringify(b).match(/\[HYPOTHESIS/g)?.length ?? 0

  // 6. Risk identification
  const highCritRisks = r.filter(x => x.severity === 'high' || x.severity === 'critical')
  const riskCategories = [...new Set(r.map(x => x.category))]

  return {
    label,
    sectionsMissing,
    completenessFlags,
    personaCount: personas.length,
    personaRoles: personas.map(p => p.role),
    personaGoalDepth: personas.map(p => `${p.name}: ${p.goals.length} goals, ${p.frustrations.length} frustrations`),
    journeyCount: journeys.length,
    journeyStages: journeys.map(j => `${j.personaName}: ${j.stages.length} stages`),
    journeyKeyInsights: journeys.map(j => j.keyInsight),
    milestoneCount: milestones.length,
    milestones: milestones.map(m => `P${m.phase}: ${m.name} (${m.estimatedDuration})`),
    criticalPath: b.roadmap?.criticalPath ?? '',
    totalTimeline: b.roadmap?.totalEstimatedTimeline ?? '',
    riskCount: r.length,
    highCritRisks: highCritRisks.length,
    riskCategories,
    risks: r.map(x => `[${x.severity.toUpperCase()}] ${x.title}`),
    hypothesisTags,
    mvpItemCount: mvpScope.length,
    requirementCount: requirements.length,
    metricCount: metrics.length,
    northStar: b.metrics?.northStar?.name ?? '',
    northStarTarget: b.metrics?.northStar?.target ?? '',
    gtmMotion: b.businessModel?.gtmMotion ?? '',
    tagline: b.overview?.tagline ?? '',
    positionStatement: b.overview?.positionStatement ?? '',
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep('BLUEPRINT PROVIDER COMPARISON — StudioLink E2E Session')
  console.log('  Same founder session, same OA, same prompt. Two providers.')

  section('Loading context from database...')
  const ctx = await loadContext()
  console.log(`  startup:    ${ctx.startup.name} (${ctx.startupId})`)
  console.log(`  session:    ${ctx.sessionId}`)
  console.log(`  assessment: ${ctx.assessmentId}`)
  console.log(`  blueprintMode:   ${ctx.understanding.blueprintMode}`)
  console.log(`  gapsInBlueprint: [${(ctx.understanding.gapsInBlueprint ?? []).join(', ')}]`)

  section('Generating Blueprint — Claude Sonnet 4.6 (anthropic)...')
  let claudeResult: Awaited<ReturnType<typeof generateBlueprint>>
  let openaiResult: Awaited<ReturnType<typeof generateBlueprint>>

  try {
    claudeResult = await generateBlueprint(ctx, 'anthropic', 'claude-sonnet-4-6')
    console.log(`  ✓ Done — ${claudeResult.durationMs}ms  in=${claudeResult.inputTokens} out=${claudeResult.outputTokens}`)
  } catch (e: any) {
    console.error(`  ✗ FAILED: ${e.message}`)
    await client.end()
    process.exit(1)
  }

  section('Generating Blueprint — GPT-4o (openai)...')
  try {
    openaiResult = await generateBlueprint(ctx, 'openai', 'gpt-4o')
    console.log(`  ✓ Done — ${openaiResult.durationMs}ms  in=${openaiResult.inputTokens} out=${openaiResult.outputTokens}`)
  } catch (e: any) {
    console.error(`  ✗ FAILED: ${e.message}`)
    await client.end()
    process.exit(1)
  }

  const claude = evalBlueprint(claudeResult!.blueprint, 'Claude Sonnet 4.6')
  const gpt    = evalBlueprint(openaiResult!.blueprint, 'GPT-4o')

  // ── 1. Schema compliance ───────────────────────────────────────────────────
  sep('1. SCHEMA COMPLIANCE')
  console.log(`  Claude  — missing sections: ${claude.sectionsMissing.length === 0 ? 'none ✓' : claude.sectionsMissing.join(', ')}`)
  console.log(`  GPT-4o  — missing sections: ${gpt.sectionsMissing.length === 0 ? 'none ✓' : gpt.sectionsMissing.join(', ')}`)

  // ── 2. Completeness ────────────────────────────────────────────────────────
  sep('2. COMPLETENESS')
  console.log('\n  Claude:')
  claude.completenessFlags.forEach(f => console.log(`    ${f}`))
  console.log(`    MVP items:     ${claude.mvpItemCount}`)
  console.log(`    Requirements:  ${claude.requirementCount}`)
  console.log(`    Metrics:       ${claude.metricCount}`)
  console.log('\n  GPT-4o:')
  gpt.completenessFlags.forEach(f => console.log(`    ${f}`))
  console.log(`    MVP items:     ${gpt.mvpItemCount}`)
  console.log(`    Requirements:  ${gpt.requirementCount}`)
  console.log(`    Metrics:       ${gpt.metricCount}`)

  // ── 3. Persona quality ─────────────────────────────────────────────────────
  sep('3. PERSONA QUALITY')
  console.log(`\n  Claude  — ${claude.personaCount} persona(s)`)
  claude.personaGoalDepth.forEach(p => console.log(`    ${p}`))
  console.log(`  Roles: ${claude.personaRoles.join(', ')}`)
  console.log(`\n  GPT-4o  — ${gpt.personaCount} persona(s)`)
  gpt.personaGoalDepth.forEach(p => console.log(`    ${p}`))
  console.log(`  Roles: ${gpt.personaRoles.join(', ')}`)

  // ── 4. User journey quality ────────────────────────────────────────────────
  sep('4. USER JOURNEY QUALITY')
  console.log(`\n  Claude  — ${claude.journeyCount} journey(s)`)
  claude.journeyStages.forEach(j => console.log(`    ${j}`))
  console.log('  Key insights:')
  claude.journeyKeyInsights.forEach(i => console.log(`    "${i.slice(0, 100)}"`))
  console.log(`\n  GPT-4o  — ${gpt.journeyCount} journey(s)`)
  gpt.journeyStages.forEach(j => console.log(`    ${j}`))
  console.log('  Key insights:')
  gpt.journeyKeyInsights.forEach(i => console.log(`    "${i.slice(0, 100)}"`))

  // ── 5. Roadmap quality ─────────────────────────────────────────────────────
  sep('5. ROADMAP QUALITY')
  console.log(`\n  Claude  — ${claude.milestoneCount} milestones, ${claude.totalTimeline}`)
  claude.milestones.forEach(m => console.log(`    ${m}`))
  console.log(`  Critical path: "${claude.criticalPath.slice(0, 120)}"`)
  console.log(`\n  GPT-4o  — ${gpt.milestoneCount} milestones, ${gpt.totalTimeline}`)
  gpt.milestones.forEach(m => console.log(`    ${m}`))
  console.log(`  Critical path: "${gpt.criticalPath.slice(0, 120)}"`)

  // ── 6. Risk identification ─────────────────────────────────────────────────
  sep('6. RISK IDENTIFICATION')
  console.log(`\n  Claude  — ${claude.riskCount} risks (${claude.highCritRisks} high/critical)`)
  console.log(`  Categories: ${claude.riskCategories.join(', ')}`)
  claude.risks.forEach(r => console.log(`    ${r}`))
  console.log(`\n  GPT-4o  — ${gpt.riskCount} risks (${gpt.highCritRisks} high/critical)`)
  console.log(`  Categories: ${gpt.riskCategories.join(', ')}`)
  gpt.risks.forEach(r => console.log(`    ${r}`))

  // ── 7. Assumption labeling ─────────────────────────────────────────────────
  sep('7. ASSUMPTION LABELING ([HYPOTHESIS] tags)')
  console.log(`  Claude  — ${claude.hypothesisTags} [HYPOTHESIS] tag(s)`)
  console.log(`  GPT-4o  — ${gpt.hypothesisTags} [HYPOTHESIS] tag(s)`)
  console.log('  (Expected: >0 tags since gapsInBlueprint is empty due to force-terminated session)')

  // ── 8. Overall usefulness ──────────────────────────────────────────────────
  sep('8. NARRATIVE QUALITY SAMPLES')
  console.log('\n  Tagline:')
  console.log(`    Claude:  "${claudeResult!.blueprint.overview?.tagline}"`)
  console.log(`    GPT-4o:  "${openaiResult!.blueprint.overview?.tagline}"`)
  console.log('\n  Position statement:')
  console.log(`    Claude:  "${claudeResult!.blueprint.overview?.positionStatement?.slice(0, 150)}"`)
  console.log(`    GPT-4o:  "${openaiResult!.blueprint.overview?.positionStatement?.slice(0, 150)}"`)
  console.log('\n  Problem statement:')
  console.log(`    Claude:  "${claudeResult!.blueprint.problem?.statement?.slice(0, 200)}"`)
  console.log(`    GPT-4o:  "${openaiResult!.blueprint.problem?.statement?.slice(0, 200)}"`)
  console.log('\n  GTM motion:')
  console.log(`    Claude:  ${claudeResult!.blueprint.businessModel?.gtmMotion}`)
  console.log(`    GPT-4o:  ${openaiResult!.blueprint.businessModel?.gtmMotion}`)
  console.log('\n  North star metric:')
  console.log(`    Claude:  ${claude.northStar} — target: ${claude.northStarTarget}`)
  console.log(`    GPT-4o:  ${gpt.northStar} — target: ${gpt.northStarTarget}`)
  console.log('\n  GTM summary (first 200 chars):')
  console.log(`    Claude:  "${claudeResult!.blueprint.businessModel?.goToMarketSummary?.slice(0, 200)}"`)
  console.log(`    GPT-4o:  "${openaiResult!.blueprint.businessModel?.goToMarketSummary?.slice(0, 200)}"`)
  console.log('\n  MVP hypothesis:')
  console.log(`    Claude:  "${claudeResult!.blueprint.mvpScope?.hypothesis?.slice(0, 200)}"`)
  console.log(`    GPT-4o:  "${openaiResult!.blueprint.mvpScope?.hypothesis?.slice(0, 200)}"`)

  // ── Token / cost summary ───────────────────────────────────────────────────
  sep('TOKEN USAGE')
  console.log(`  Claude   in=${claudeResult!.inputTokens}  out=${claudeResult!.outputTokens}  time=${claudeResult!.durationMs}ms`)
  console.log(`  GPT-4o   in=${openaiResult!.inputTokens}  out=${openaiResult!.outputTokens}  time=${openaiResult!.durationMs}ms`)

  await client.end()
}

main().catch(e => {
  console.error('[COMPARISON ERROR]', e.message)
  process.exit(1)
})

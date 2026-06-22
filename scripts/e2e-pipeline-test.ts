/**
 * E2E Pipeline Audit — Founder Session → Opportunity Assessment → Blueprint
 *
 * Scenario: "Marketplace connecting photographers with studio venues"
 * Intentionally unvalidated responses across all dimensions:
 *   - No customer conversations (photographers or studio owners)
 *   - No supply-side validation
 *   - Pricing is an assumption
 *   - Marketplace liquidity is an assumption
 *
 * Goal: verify that uncertainty survives the full pipeline without fabrication.
 *
 * Run with:
 *   npx tsx --env-file=.env scripts/e2e-pipeline-test.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema/index.ts'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'

import {
  buildChatSystemPrompt,
  buildMemoryExtractionSystemPrompt,
  FOUNDER_MEMORY_EXTRACTION_SCHEMA,
} from '../src/modules/founder-sessions/chat-prompt.ts'
import {
  EMPTY_FOUNDER_MEMORY,
  FounderMemorySchema,
  mergeFounderMemory,
  type FounderMemory,
} from '../src/lib/contracts/founder-memory.ts'
import {
  EMPTY_UNDERSTANDING,
  FounderUnderstandingSchema,
  UNDERSTANDING_CATEGORIES,
  type FounderUnderstanding,
} from '../src/lib/contracts/founder-understanding.ts'
import { updateUnderstanding } from '../src/services/understanding-engine.ts'
import { buildOpportunityContext } from '../src/agents/opportunity-agent/context-builder.ts'
import { OpportunityAgent } from '../src/agents/opportunity-agent/index.ts'
import { buildBlueprintContext } from '../src/agents/blueprint-agent/context-builder.ts'
import { BlueprintAgent } from '../src/agents/blueprint-agent/index.ts'
import { PROMPT_VERSION as OA_PROMPT_VERSION } from '../src/agents/opportunity-agent/prompt.ts'
import { PROMPT_VERSION as BP_PROMPT_VERSION } from '../src/agents/blueprint-agent/prompt.ts'
import { runAgent } from '../src/agents/base/runner.ts'
import { computeEvidenceConfidence } from '../src/lib/evidence/confidence.ts'
import { computeValidationGaps } from '../src/lib/evidence/gaps.ts'
import type { OpportunityAssessmentContent } from '../src/lib/contracts/opportunity-assessment.ts'
import type { BlueprintContent } from '../src/lib/contracts/blueprint.ts'

// ── Config ────────────────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL, { prepare: false })
const db = drizzle(client, { schema })
const openai = new OpenAI()
const anthropic = new Anthropic()

// ── Conversation script ───────────────────────────────────────────────────────
// Intentionally unvalidated responses. Every dimension is an assumption.

const FOUNDER_RESPONSES = [
  "I'm building a marketplace platform that connects freelance photographers with studio venues. Photographers can browse and book studio spaces by the hour, and studio owners can list their empty spaces to earn passive income.",

  "I haven't spoken with any photographers yet. My assumption is that they want flexible, affordable studio access without long-term commitments — but that's based on observation, not interviews. I don't actually know if they'd pay for this.",

  "I also haven't spoken with any studio owners. I assume they have unused capacity and would want to monetize it, but I have no idea whether they'd actually list on a platform like this or what it would take to get them to sign up.",

  "I don't know whether either side would participate. The whole two-sided dynamic is an assumption. I think photographers need studios, and I think studios sit empty, but I haven't verified either of those things.",

  "For pricing, I'm thinking a 15% commission on each booking from the photographer side. But I have absolutely no evidence that photographers would accept this rate. I haven't tested any pricing with anyone.",

  "I don't have any information about market size. I'm guessing it's big enough because there are a lot of photographers and a lot of studios, but I don't have any numbers to back that up.",

  "In terms of competition, I know Peerspace exists but I haven't deeply researched it. I don't know if photographers actually use it or what their experience is. I'm assuming there's a gap in the market but I haven't validated that.",

  "I have no traction. No waitlist, no pilots, no letters of intent. Nothing. I built a rough landing page but haven't launched it. This is all just an idea at this point.",

  "My background is in software engineering. I don't have any specific expertise in photography or studio management. I think I can build the tech but I don't have industry relationships on either side of the marketplace.",
]

// ── Utilities ─────────────────────────────────────────────────────────────────

function sep(char = '─', width = 80) { return char.repeat(width) }
function header(title: string) { console.log('\n' + sep('═') + '\n  ' + title + '\n' + sep('═')) }
function section(title: string) { console.log('\n' + sep() + '\n  ' + title + '\n' + sep()) }
function log(msg: string) { console.log(msg) }

function printUnderstandingState(u: FounderUnderstanding, turnLabel: string) {
  section(`Understanding State — ${turnLabel}`)
  log(`marketplaceDetected: ${u.marketplaceDetected}`)
  log(`weakestCategory: ${u.weakestCategory}`)
  log(`isComplete: ${u.isComplete}`)
  log(`questioningMode: ${u.questioningMode}`)
  log(`overallConfidence: ${u.overallConfidence}%`)
  log('')
  for (const cat of UNDERSTANDING_CATEGORIES) {
    if (cat === 'supply_side' && !u.marketplaceDetected) continue
    const s = u.categories[cat]
    log(`  ${cat.padEnd(14)} conf=${String(s.confidence).padStart(3)}%  status=${s.validationStatus.padEnd(22)}  satCount=${s.saturationCount}  vpc=${s.validationPlanningCompleted}`)
  }
  log('')

  // validationPlanningCandidate — mirror of buildChatSystemPrompt logic
  const vpc = UNDERSTANDING_CATEGORIES.find((cat) => {
    if (cat === 'supply_side' && !u.marketplaceDetected) return false
    const s = u.categories[cat]
    return s.validationStatus === 'explicitly_unvalidated' && s.saturationCount >= 1 && !s.validationPlanningCompleted
  }) ?? null
  log(`  validationPlanningCandidate: ${vpc ?? 'null'}`)
  log(`  validationGaps: [${u.validationGaps.join(', ')}]`)
  if (u.gapsInBlueprint.length > 0) {
    log(`  gapsInBlueprint: [${u.gapsInBlueprint.join(', ')}]`)
  }
}

// ── Session history (for chat completions) ───────────────────────────────────

type ChatMsg = { role: 'user' | 'assistant'; content: string }
const history: ChatMsg[] = []

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  header('XENYSIS E2E PIPELINE AUDIT')
  log('Scenario: Marketplace connecting photographers with studio venues')
  log('All responses are intentionally unvalidated.')

  // ── 1. Create test startup + session ───────────────────────────────────────

  section('SETUP: Creating Test Data')

  // Use a fixed test UUID — no FK constraint on startups.user_id
  const userId = 'e2e00000-0000-0000-0000-000000000001'
  log(`Using userId: ${userId} (test UUID)`)

  const [startup] = await db.insert(schema.startups).values({
    userId,
    name: 'StudioLink',
    description: 'Marketplace connecting photographers with studio venues',
    category: 'marketplace',
    lifecycleStage: 'founder-session',
  }).returning()
  log(`Created startup: ${startup.id} (${startup.name})`)

  const [session] = await db.insert(schema.founderSessions).values({
    startupId: startup.id,
    userId,
    idea: 'A marketplace platform connecting freelance photographers with studio venues. Photographers browse and book studio spaces hourly; studio owners monetize empty capacity.',
    status: 'active',
    founderStage: 'idea',
    marketplaceDetected: true,
    messagesCount: 0,
  }).returning()
  log(`Created session: ${session.id} (founderStage=idea, marketplaceDetected=true)`)

  // ── 2. Conversation loop ───────────────────────────────────────────────────

  header('PHASE 1: FOUNDER SESSION')

  let currentMemory: FounderMemory = EMPTY_FOUNDER_MEMORY
  let currentUnderstanding: FounderUnderstanding = EMPTY_UNDERSTANDING
  let messagesCount = 0
  let sessionComplete = false

  for (let i = 0; i < FOUNDER_RESPONSES.length; i++) {
    const founderMsg = FOUNDER_RESPONSES[i]
    messagesCount++

    section(`Turn ${i + 1} / Founder Message`)
    log(`> "${founderMsg.slice(0, 120)}${founderMsg.length > 120 ? '...' : ''}"`)

    // Build system prompt with current understanding
    const systemPrompt = buildChatSystemPrompt(
      startup,
      null,
      currentUnderstanding,
      'idea',
      session.marketplaceDetected || currentUnderstanding.marketplaceDetected,
    )

    // Chat completion (AI advisor response)
    log('\n[Chat LLM calling...]')
    const chatRes = await openai.chat.completions.create({
      model:  'gpt-4o',
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: `<user_input>${founderMsg}</user_input>` },
      ],
    })
    const advisorResponse = chatRes.choices[0]?.message?.content ?? ''
    log(`[AI Advisor]: "${advisorResponse.slice(0, 160)}${advisorResponse.length > 160 ? '...' : ''}"`)

    // Append to history
    history.push({ role: 'user', content: founderMsg })
    history.push({ role: 'assistant', content: advisorResponse })

    // Memory extraction
    log('\n[Memory extraction calling...]')
    const extractRes = await openai.chat.completions.create({
      model:           'gpt-4o',
      stream:          false,
      response_format: { type: 'json_schema', json_schema: FOUNDER_MEMORY_EXTRACTION_SCHEMA },
      messages: [
        { role: 'system', content: buildMemoryExtractionSystemPrompt(startup.name, currentMemory) },
        ...history.slice(-10),
      ],
    })
    const extractContent = extractRes.choices[0]?.message?.content ?? '{}'
    const extracted = FounderMemorySchema.safeParse(JSON.parse(extractContent))

    if (!extracted.success) {
      log(`[ERROR] Memory extraction schema failed: ${JSON.stringify(extracted.error.format())}`)
      continue
    }

    // Merge memory
    currentMemory = mergeFounderMemory(currentMemory, extracted.data)

    // Update understanding
    const result = await updateUnderstanding({
      db,
      sessionId:       session.id,
      startupId:       startup.id,
      userId,
      memory:          currentMemory,
      founderStage:    'idea',
      messagesCount,
      marketplaceDetected: true,
    })

    currentUnderstanding = result.understanding
    printUnderstandingState(currentUnderstanding, `Turn ${i + 1}`)

    if (result.isComplete) {
      log('*** SESSION COMPLETE ***')
      sessionComplete = true

      // Mark session completed in DB
      await db.update(schema.founderSessions)
        .set({ status: 'completed', messagesCount })
        .where(eq(schema.founderSessions.id, session.id))

      break
    }
  }

  if (!sessionComplete) {
    log('\n[!] Session did not complete within the provided responses.')
    log('[!] Forcing session completion for pipeline audit...')

    // Force-complete so OA + Blueprint can run
    await db.update(schema.founderSessions)
      .set({ status: 'completed', messagesCount })
      .where(eq(schema.founderSessions.id, session.id))

    // Patch gapsInBlueprint so [HYPOTHESIS] labels fire in Blueprint.
    // In production, gapsInBlueprint is populated at natural completion (isComplete=true).
    // Force-completion leaves isComplete=false and gapsInBlueprint=[] — bypassing the label
    // mechanism. We patch the stored understanding here so the E2E audit exercises truthfulness.
    const rawU = await db.query.founderUnderstanding.findFirst({
      where: eq(schema.founderUnderstanding.sessionId, session.id),
    })
    if (rawU) {
      const parsed = FounderUnderstandingSchema.safeParse(rawU.understanding)
      if (parsed.success) {
        const u = parsed.data
        const gapResult = computeValidationGaps(u)
        const gapsToInject = gapResult.gaps.map(g => g.category)
        if (gapsToInject.length > 0) {
          const patched = { ...u, gapsInBlueprint: gapsToInject }
          await db.update(schema.founderUnderstanding)
            .set({ understanding: patched })
            .where(eq(schema.founderUnderstanding.sessionId, session.id))
          log(`[!] Patched gapsInBlueprint: [${gapsToInject.join(', ')}]`)
        }
      }
    }
  }

  // ── 3. Final understanding state ───────────────────────────────────────────

  header('FINAL UNDERSTANDING STATE')

  const finalUnderstanding = await db.query.founderUnderstanding.findFirst({
    where: eq(schema.founderUnderstanding.sessionId, session.id),
  })
  const finalU = finalUnderstanding
    ? (FounderUnderstandingSchema.safeParse(finalUnderstanding.understanding).data ?? EMPTY_UNDERSTANDING)
    : EMPTY_UNDERSTANDING

  log(`blueprintMode: ${finalU.blueprintMode}`)
  log(`isComplete: ${finalU.isComplete}`)
  log(`overallConfidence: ${finalU.overallConfidence}%`)
  log(`marketplaceDetected: ${finalU.marketplaceDetected}`)
  log(`validationGaps: [${finalU.validationGaps.join(', ')}]`)
  log(`gapsInBlueprint: [${finalU.gapsInBlueprint.join(', ')}]`)
  log('')
  log('Per-category state:')
  for (const cat of UNDERSTANDING_CATEGORIES) {
    if (cat === 'supply_side' && !finalU.marketplaceDetected) continue
    const s = finalU.categories[cat]
    log(`  ${cat.padEnd(14)} conf=${String(s.confidence).padStart(3)}%  validationStatus=${s.validationStatus.padEnd(22)}  evidenceStrength=${s.evidenceStrength}  assessmentTier=${s.assessmentTier}`)
  }

  // Pre-computed confidence (what OA sees)
  const preComputedConfidence = computeEvidenceConfidence(finalU)
  const preComputedGaps       = computeValidationGaps(finalU)

  log('')
  log('Pre-computed confidence (input to OA):')
  log(`  overallQualityScore: ${preComputedConfidence.overallQualityScore}`)
  for (const cat of preComputedConfidence.categories) {
    log(`  ${cat.category.padEnd(14)} qualityScore=${String(cat.qualityScore).padStart(3)}  tier=${cat.tier.padEnd(16)}  ceiling=${cat.ceiling}`)
  }

  log('')
  log(`Validation gaps (${preComputedGaps.gaps.length} gaps):`)
  for (const gap of preComputedGaps.gaps) {
    log(`  [priority=${gap.priority}] ${gap.category} — ${gap.tier} — ${(gap.description ?? '').slice(0, 80)}`)
  }

  // ── 4. Opportunity Assessment ──────────────────────────────────────────────

  header('PHASE 2: OPPORTUNITY ASSESSMENT')

  // Create generation job for OA
  const [oaJob] = await db.insert(schema.generationJobs).values({
    userId,
    startupId:     startup.id,
    type:          'opportunity',
    status:        'pending',
    model:         'gpt-4o',
    provider:      'openai',
    promptVersion: OA_PROMPT_VERSION,
  }).returning()

  log(`OA job created: ${oaJob.id}`)
  log('[Running OpportunityAgent...]')

  const oaInput = await buildOpportunityContext(db, startup.id, session.id, userId, oaJob.id)
  let oaContent: OpportunityAssessmentContent | null = null

  for await (const event of runAgent(new OpportunityAgent(), oaInput, db, anthropic, openai)) {
    if (event.type === 'stage') {
      log(`  [stage] ${event.data.stageId} → ${event.data.state}`)
    }
    if (event.type === 'complete') {
      log(`  [complete] assessmentId=${event.data.artifactId}`)
    }
  }

  // Load OA result from DB
  const oaRow = await db.query.opportunityAssessments.findFirst({
    where: eq(schema.opportunityAssessments.startupId, startup.id),
  })
  if (oaRow) {
    const versionRow = await db.query.opportunityAssessmentVersions.findFirst({
      where: eq(schema.opportunityAssessmentVersions.assessmentId, oaRow.id),
    })
    if (versionRow) {
      const { OpportunityAssessmentContentSchema } = await import('../src/lib/contracts/opportunity-assessment.ts')
      const parsed = OpportunityAssessmentContentSchema.safeParse(versionRow.content)
      if (parsed.success) {
        oaContent = parsed.data
      }
    }
  }

  if (oaContent) {
    section('OA OUTPUT — Verification')
    log(`opportunityScore: ${oaContent.opportunityScore}/100`)
    log(`confidenceScore: ${oaContent.confidenceScore}/100`)
    log(`executiveSummary: "${oaContent.executiveSummary?.slice(0, 200)}..."`)

    if (oaContent.scoreBreakdown) {
      log('')
      log('Score Breakdown:')
      const sb = oaContent.scoreBreakdown
      log(`  problemStrength:      ${sb.problemStrength.score}/100  — "${sb.problemStrength.rationale?.slice(0, 80)}"`)
      log(`  customerClarity:      ${sb.customerClarity.score}/100  — "${sb.customerClarity.rationale?.slice(0, 80)}"`)
      log(`  marketPotential:      ${sb.marketPotential.score}/100  — "${sb.marketPotential.rationale?.slice(0, 80)}"`)
      log(`  competitiveAdvantage: ${sb.competitiveAdvantage.score}/100  — "${sb.competitiveAdvantage.rationale?.slice(0, 80)}"`)
      log(`  founderFit:           ${sb.founderFit.score}/100  — "${sb.founderFit.rationale?.slice(0, 80)}"`)
    }

    if (oaContent.confidenceBreakdown) {
      log('')
      log('Confidence Breakdown (evidence quality per category):')
      const cb = oaContent.confidenceBreakdown
      if (cb.categories) {
        for (const cat of cb.categories) {
          log(`  ${cat.category.padEnd(14)} score=${String(cat.qualityScore).padStart(3)}  tier=${cat.tier.padEnd(16)}  ${cat.label?.slice(0, 60) ?? ''}`)
        }
      }
      log(`  computedScore: ${cb.computedScore}`)
      log(`  adjustmentRationale: "${cb.adjustmentRationale?.slice(0, 120) ?? 'none'}"`)
    }

    log('')
    log('Validation Gap Summary:')
    if (oaContent.validationGapSummary?.gaps) {
      for (const gap of oaContent.validationGapSummary.gaps) {
        log(`  [p=${gap.priority}] ${gap.category} — ${gap.tier} — "${(gap.gapDescription ?? '').slice(0, 80)}"`)
      }
    }

    log('')
    log('Key Risks:')
    if (oaContent.keyRisks) {
      for (const risk of oaContent.keyRisks.slice(0, 5)) {
        log(`  [${risk.severity}] ${risk.title}: ${risk.description?.slice(0, 80)}`)
      }
    }

    log('')
    log('Supply-side risk specifically:')
    const supplyRisk = oaContent.keyRisks?.find(r =>
      r.title?.toLowerCase().includes('supply') ||
      r.description?.toLowerCase().includes('studio owner') ||
      r.description?.toLowerCase().includes('supply-side') ||
      r.description?.toLowerCase().includes('supply side') ||
      r.category === 'supply_side'
    )
    if (supplyRisk) {
      log(`  FOUND: [${supplyRisk.severity}] "${supplyRisk.title}" — ${supplyRisk.description}`)
    } else {
      log('  NOT FOUND explicitly — check risks above for implicit coverage')
    }

    // A. Validation status preservation check
    section('OA AUDIT A: Validation Status Preservation')
    log(`supply_side.validationStatus in final understanding: ${finalU.categories.supply_side.validationStatus}`)
    log(`customer.validationStatus in final understanding: ${finalU.categories.customer.validationStatus}`)

    const supplyGap = oaContent.validationGapSummary?.gaps?.find(g => g.category === 'supply_side' as string)
    const customerGap = oaContent.validationGapSummary?.gaps?.find(g => g.category === 'customer')

    log(`supply_side appears in OA validationGapSummary: ${supplyGap ? 'YES' : 'NO'}`)
    if (supplyGap) log(`  tier=${supplyGap.tier}  priority=${supplyGap.priority}`)
    log(`customer appears in OA validationGapSummary: ${customerGap ? 'YES' : 'NO'}`)
    if (customerGap) log(`  tier=${customerGap.tier}  priority=${customerGap.priority}`)

    // B. Risk propagation check
    section('OA AUDIT B: Risk Propagation')
    const highSeverityRisks = oaContent.keyRisks?.filter(r => r.severity === 'high' || r.severity === 'critical') ?? []
    log(`High/Critical risks: ${highSeverityRisks.length}`)
    for (const r of highSeverityRisks) {
      log(`  [${r.severity}] ${r.title}`)
    }
    log(`Overall opportunity score: ${oaContent.opportunityScore}/100`)
    log(`Confidence score: ${oaContent.confidenceScore}/100`)
  } else {
    log('[ERROR] Failed to load OA content from DB')
  }

  // ── 5. Blueprint ───────────────────────────────────────────────────────────

  header('PHASE 3: BLUEPRINT')

  const [bpJob] = await db.insert(schema.generationJobs).values({
    userId,
    startupId:     startup.id,
    type:          'blueprint',
    status:        'pending',
    model:         'gpt-4o',
    provider:      'openai',
    promptVersion: BP_PROMPT_VERSION,
  }).returning()

  log(`Blueprint job created: ${bpJob.id}`)
  log('[Running BlueprintAgent...]')

  const bpInput = await buildBlueprintContext(db, startup.id, userId, bpJob.id)
  let bpContent: BlueprintContent | null = null

  for await (const event of runAgent(new BlueprintAgent(), bpInput, db, anthropic, openai)) {
    if (event.type === 'stage') {
      log(`  [stage] ${event.data.stageId} → ${event.data.state}`)
    }
    if (event.type === 'complete') {
      log(`  [complete] blueprintId=${event.data.artifactId}`)
    }
  }

  // Load Blueprint result from DB
  const bpRow = await db.query.blueprints.findFirst({
    where: eq(schema.blueprints.startupId, startup.id),
  })
  if (bpRow) {
    const versionRow = await db.query.blueprintVersions.findFirst({
      where: eq(schema.blueprintVersions.blueprintId, bpRow.id),
    })
    if (versionRow) {
      const { BlueprintContentSchema } = await import('../src/lib/contracts/blueprint.ts')
      const parsed = BlueprintContentSchema.safeParse(versionRow.content)
      if (parsed.success) {
        bpContent = parsed.data
      }
    }
  }

  if (bpContent) {
    // C. Blueprint trustworthiness check
    section('BLUEPRINT AUDIT C: Trustworthiness')

    log(`blueprintMode in understanding: ${finalU.blueprintMode}`)

    // Check for hypothesis markers in the blueprint
    const blueprintJson = JSON.stringify(bpContent)
    const hypothesisCount = (blueprintJson.match(/\[HYPOTHESIS/gi) ?? []).length
    const assumptionCount = (blueprintJson.match(/assumption|assumed|hypothes/gi) ?? []).length

    log(`[HYPOTHESIS labels in blueprint JSON: ${hypothesisCount}`)
    log(`'assumption'/'hypothes' occurrences in blueprint JSON: ${assumptionCount}`)

    // Check problem statement
    if (bpContent.problem) {
      log('')
      log('Problem statement:')
      log(`  "${bpContent.problem.statement?.slice(0, 200)}"`)
    }

    // Check customer section
    if (bpContent.customer) {
      log('')
      log('Customer section:')
      log(`  targetMarket: "${bpContent.customer.targetMarket?.slice(0, 120)}"`)
      if (bpContent.customer.icp) {
        log(`  icp.role: "${bpContent.customer.icp.role}"`)
        log(`  icp.description: "${bpContent.customer.icp.description?.slice(0, 100)}"`)
      }
    }

    // Check business model (pricing)
    if (bpContent.businessModel) {
      log('')
      log('Business model:')
      log(`  revenueStreams (first): "${JSON.stringify(bpContent.businessModel.revenueStreams?.[0])?.slice(0, 120)}"`)
      log(`  pricingModel: "${bpContent.businessModel.pricingModel?.slice(0, 120)}"`)
    }

    // D. Fabrication Audit
    section('BLUEPRINT AUDIT D: Fabrication Classification')
    log('Classifying key blueprint claims:')
    log('')

    // Define what we know the founder actually said
    const founderFacts = [
      'marketplace connecting photographers with studios',
      '15% commission assumption (stated as untested)',
      'studios may sit empty (no data)',
      'no customer interviews',
      'no studio owner conversations',
      'no traction, no waitlist',
      'software engineering background',
      'Peerspace exists as competitor (not researched)',
    ]

    log('Known founder-stated facts:')
    for (const f of founderFacts) log(`  ✓ ${f}`)
    log('')

    // Sample key fields for fabrication audit
    const auditItems: Array<{ field: string; value: string; classification: 'supported' | 'inferred' | 'speculative' }> = []

    function classify(field: string, value: string | undefined | null): void {
      if (!value) return
      const v = value.toLowerCase()
      const isSpeculative = (
        v.includes('[hypothesis') ||
        v.includes('assumption') ||
        v.includes('hypothes') ||
        v.includes('estimated') ||
        v.includes('projected') ||
        v.includes('potential') ||
        v.includes('expected') ||
        v.includes('likely') ||
        v.includes('may ') ||
        v.includes('could ') ||
        v.includes('would ')
      )
      const isSupported = (
        v.includes('photographer') ||
        v.includes('studio') ||
        v.includes('marketplace') ||
        v.includes('15%') ||
        v.includes('commission') ||
        v.includes('peerspace')
      )
      auditItems.push({
        field,
        value: value.slice(0, 100),
        classification: isSpeculative ? 'speculative' : isSupported ? 'supported' : 'inferred',
      })
    }

    classify('problem.statement', bpContent.problem?.statement)
    classify('customer.targetMarket', bpContent.customer?.targetMarket)
    classify('customer.icp.role', bpContent.customer?.icp?.role)
    classify('customer.icp.description', bpContent.customer?.icp?.description)
    classify('businessModel.pricingModel', bpContent.businessModel?.pricingModel)
    classify('businessModel.revenueStreams[0]', JSON.stringify(bpContent.businessModel?.revenueStreams?.[0]))
    classify('solution.unfairAdvantage', bpContent.solution?.unfairAdvantage)

    // Check personas
    if (bpContent.personas?.personas) {
      for (let i = 0; i < Math.min(2, bpContent.personas.personas.length); i++) {
        const p = bpContent.personas.personas[i]
        classify(`personas[${i}].name`, p.name)
        classify(`personas[${i}].description`, p.description)
        classify(`personas[${i}].goals[0]`, p.goals?.[0])
        classify(`personas[${i}].painPoints[0]`, p.painPoints?.[0])
      }
    }

    const supported  = auditItems.filter(a => a.classification === 'supported')
    const inferred   = auditItems.filter(a => a.classification === 'inferred')
    const speculative = auditItems.filter(a => a.classification === 'speculative')

    log(`SUPPORTED (${supported.length}):`)
    for (const a of supported) log(`  ${a.field}: "${a.value}"`)

    log('')
    log(`INFERRED (${inferred.length}):`)
    for (const a of inferred) log(`  ${a.field}: "${a.value}"`)

    log('')
    log(`SPECULATIVE (${speculative.length}):`)
    for (const a of speculative) log(`  ${a.field}: "${a.value}"`)

    log('')
    log('--- Supply-side in Blueprint ---')
    // Search for supply_side / studio owner references in blueprint
    const supplyMentions = blueprintJson.match(/"[^"]*studio[^"]*"/gi) ?? []
    log(`References to 'studio' in blueprint JSON: ${supplyMentions.length}`)
    for (const m of supplyMentions.slice(0, 5)) log(`  ${m.slice(0, 100)}`)

    const hypothesisMentions = blueprintJson.match(/"[^"]*\[HYPOTHESIS[^"]*"/gi) ?? []
    log(`[HYPOTHESIS mentions: ${hypothesisMentions.length}`)
    for (const m of hypothesisMentions.slice(0, 5)) log(`  ${m.slice(0, 100)}`)
  } else {
    log('[ERROR] Failed to load Blueprint content from DB')
  }

  // ── 6. Final summary ────────────────────────────────────────────────────────

  header('AUDIT SUMMARY')
  log(`Startup ID:  ${startup.id}`)
  log(`Session ID:  ${session.id}`)
  log(`Turns run:   ${messagesCount}`)
  log(`Completed:   ${sessionComplete}`)
  log(`Blueprint mode: ${finalU.blueprintMode}`)
  log(`Overall confidence: ${finalU.overallConfidence}%`)
  log('')
  log('Validation status preservation:')
  log(`  supply_side: ${finalU.categories.supply_side.validationStatus}`)
  log(`  customer:    ${finalU.categories.customer.validationStatus}`)
  log(`  pricing:     ${finalU.categories.pricing.validationStatus}`)
  log(`  market:      ${finalU.categories.market.validationStatus}`)
  log('')
  if (oaContent) {
    log(`OA opportunityScore: ${oaContent.opportunityScore}/100`)
    log(`OA confidenceLevel: ${oaContent.confidenceLevel}`)
    log(`OA gaps found: ${oaContent.validationGapSummary?.gaps?.length ?? 0}`)
    log(`OA risks found: ${oaContent.risks?.length ?? 0} (high/critical: ${oaContent.risks?.filter(r => r.severity === 'high' || r.severity === 'critical').length ?? 0})`)
  }
  if (bpContent) {
    const bpJson = JSON.stringify(bpContent)
    const hypCount = (bpJson.match(/\[HYPOTHESIS/gi) ?? []).length
    log(`Blueprint [HYPOTHESIS labels: ${hypCount}`)
    log(`Blueprint mode confirmed by labels: ${hypCount > 0 ? 'YES — assumptions labeled' : 'NO — labels absent (potential fabrication risk)'}`)
  }

  log('')
  log('Test data created:')
  log(`  DELETE FROM startups WHERE id = '${startup.id}' (cascades to session, memory, understanding, OA, blueprint)`)
  log('')
  log('Audit complete.')

  // Close DB connection
  await client.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('[E2E PIPELINE TEST ERROR]', err)
  process.exit(1)
})

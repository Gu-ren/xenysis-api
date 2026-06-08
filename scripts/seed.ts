// Run with: npx tsx --env-file=.env scripts/seed.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema/index.ts'
import type { FounderMemory } from '../src/lib/contracts/founder-memory.ts'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL, { prepare: false })
const db = drizzle(client, { schema })

// Fixed test user UUID — must match a real user in your Supabase Auth table.
// Replace with an actual user ID from your project's auth.users table.
const TEST_USER_ID = process.env.SEED_USER_ID ?? '00000000-0000-0000-0000-000000000001'

async function seed() {
  console.log('🌱 Seeding database...\n')

  // ── Startups ──────────────────────────────────────────────────────────────

  const [startup1] = await db
    .insert(schema.startups)
    .values({
      userId: TEST_USER_ID,
      name: 'TalentLoop',
      description: 'AI-powered hiring copilot that screens candidates and drafts role requirements from job descriptions',
      category: 'ai-tool',
      lifecycleStage: 'founder-session',
    })
    .returning()

  const [startup2] = await db
    .insert(schema.startups)
    .values({
      userId: TEST_USER_ID,
      name: 'FlowDesk',
      description: 'Customer support platform for SMBs with smart ticket routing and AI-assisted responses',
      category: 'saas',
      lifecycleStage: 'generating',
    })
    .returning()

  console.log(`✓ Created startups: ${startup1.id}, ${startup2.id}`)

  // ── Founder sessions ──────────────────────────────────────────────────────

  const [session1] = await db
    .insert(schema.founderSessions)
    .values({
      startupId: startup1.id,
      userId: TEST_USER_ID,
      idea: 'I want to build an AI tool that helps hiring managers screen candidates 10x faster by automatically reviewing resumes and drafting job requirements.',
      status: 'active',
      messagesCount: 3,
    })
    .returning()

  const [session2] = await db
    .insert(schema.founderSessions)
    .values({
      startupId: startup2.id,
      userId: TEST_USER_ID,
      idea: 'SMBs spend hours on customer support. I want to build a platform that routes tickets intelligently and uses AI to suggest responses for agents.',
      status: 'completed',
      messagesCount: 8,
      completionRate: '85.00',
    })
    .returning()

  console.log(`✓ Created sessions: ${session1.id}, ${session2.id}`)

  // ── Session answers ───────────────────────────────────────────────────────

  const answers1 = [
    { questionType: 'problem' as const, question: 'What problem are you solving?', answer: 'Hiring managers spend 40% of their time reviewing resumes. Most are unqualified and the good ones get missed in the noise.' },
    { questionType: 'customer' as const, question: 'Who is your primary customer?', answer: 'Series A/B tech startups with 50-500 employees that are hiring 10-50 engineers per year.' },
    { questionType: 'market' as const, question: 'How big is the market?', answer: 'The HR tech market is $30B. Just the ATS segment is $3B. We target a subsegment of AI screening tools.' },
    { questionType: 'competition' as const, question: 'Who are your competitors?', answer: 'Greenhouse, Lever, and a few AI startups like Fetcher. None fully automate screening with good accuracy.' },
    { questionType: 'revenue' as const, question: 'How will you make money?', answer: 'SaaS subscription per seat, starting at $200/mo per recruiter. Enterprise deals with custom integrations.' },
    { questionType: 'team' as const, question: 'What does your team look like?', answer: 'Just me for now. Ex-Google engineer. Building an MVP solo, looking for a co-founder with recruiting ops background.' },
  ]

  const answers2 = [
    { questionType: 'problem' as const, question: 'What problem are you solving?', answer: 'SMBs get 200+ support tickets per week but only have 2-3 agents. Response times are 12+ hours which drives churn.' },
    { questionType: 'customer' as const, question: 'Who is your primary customer?', answer: 'E-commerce brands doing $1M-$10M ARR with small support teams. They use Shopify + Gorgias/Zendesk.' },
    { questionType: 'market' as const, question: 'How big is the market?', answer: 'There are 500k+ SMB e-commerce brands in the US alone. Customer service software market is $12B globally.' },
    { questionType: 'competition' as const, question: 'Who are your competitors?', answer: 'Zendesk (too complex), Freshdesk (cheap but no AI), Gorgias (e-comm focused but limited AI). Gap in the market.' },
    { questionType: 'revenue' as const, question: 'How will you make money?', answer: 'Usage-based pricing on top of a base SaaS fee. $99/mo base + $0.10 per AI-assisted ticket resolution.' },
    { questionType: 'vision' as const, question: 'What is your long-term vision?', answer: 'Become the operating system for SMB customer success — not just support, but proactive outreach and retention.' },
    { questionType: 'assumption' as const, question: 'What are your key assumptions?', answer: 'We assume SMBs are willing to pay for AI-assisted tools if the ROI is clear. We assume GPT-4 accuracy is sufficient for 80% of tickets.' },
    { questionType: 'assumption' as const, question: 'What is your biggest risk?', answer: 'Zendesk or Gorgias could add AI features quickly. We need to move fast and build integrations they can\'t match.' },
  ]

  for (let i = 0; i < answers1.length; i++) {
    await db.insert(schema.sessionAnswers).values({
      sessionId: session1.id,
      questionId: `q1-${i + 1}`,
      questionType: answers1[i].questionType,
      question: answers1[i].question,
      answer: answers1[i].answer,
      sequenceOrder: i + 1,
    })
  }

  for (let i = 0; i < answers2.length; i++) {
    await db.insert(schema.sessionAnswers).values({
      sessionId: session2.id,
      questionId: `q2-${i + 1}`,
      questionType: answers2[i].questionType,
      question: answers2[i].question,
      answer: answers2[i].answer,
      sequenceOrder: i + 1,
    })
  }

  console.log(`✓ Created ${answers1.length + answers2.length} session answers`)

  // ── Founder memories ──────────────────────────────────────────────────────

  const memory1: FounderMemory = {
    startup_name: 'TalentLoop',
    one_sentence_pitch: 'AI hiring copilot that screens candidates and drafts job requirements 10x faster than humans.',
    problem: 'Hiring managers spend 40% of their time reviewing unqualified resumes, missing top candidates.',
    customer: 'Series A/B tech startups, 50-500 employees, hiring 10-50 engineers per year.',
    industry: 'HR Technology / AI Tools',
    business_model: 'SaaS subscription per recruiter seat',
    pricing_model: '$200/month per recruiter seat',
    market_signals: ['$30B HR tech market', 'AI screening tools growing 40% YoY', 'Remote hiring increased candidate volume 3x'],
    competitive_advantages: ['Deeper automation than Greenhouse/Lever', 'AI-native from day one', 'Solo engineer reduces overhead'],
    assumptions: ['Hiring managers will trust AI screening', 'GPT-4 accuracy sufficient for initial screening', 'Enterprise will pay for integrations'],
    risks: ['Incumbent ATS vendors add AI features', 'Bias concerns in AI screening', 'Long enterprise sales cycles'],
    key_insights: ['Time savings is primary value prop, not accuracy', 'Need recruiting ops co-founder urgently', 'Start with contract-to-hire market to validate'],
    confidence_score: 62,
  }

  const memory2: FounderMemory = {
    startup_name: 'FlowDesk',
    one_sentence_pitch: 'AI customer support platform that routes tickets intelligently and suggests responses for SMB e-commerce brands.',
    problem: 'SMB e-commerce brands have 200+ tickets/week with 2-3 agents, causing 12+ hour response times and churn.',
    customer: 'E-commerce brands doing $1M-$10M ARR on Shopify, with small support teams.',
    industry: 'Customer Service Software / SaaS',
    business_model: 'Usage-based SaaS with base subscription',
    pricing_model: '$99/month base + $0.10 per AI-assisted ticket resolution',
    market_signals: ['500k+ SMB e-commerce brands in US', '$12B customer service software market', 'AI in support growing 60% YoY'],
    competitive_advantages: ['Shopify-native integration', 'Usage-based pricing aligns with SMB cash flow', 'Proactive retention features planned'],
    assumptions: ['SMBs pay for AI if ROI is clear', 'GPT-4 handles 80% of tickets accurately', 'Shopify ecosystem provides distribution'],
    risks: ['Zendesk/Gorgias add competitive AI features', 'Enterprise pivot temptation', 'Usage-based pricing complexity'],
    key_insights: ['E-commerce vertical focus creates defensibility', 'Retention/proactive support is bigger long-term play', 'Shopify App Store is key distribution channel'],
    confidence_score: 78,
  }

  await db.insert(schema.founderMemories).values([
    { sessionId: session1.id, startupId: startup1.id, userId: TEST_USER_ID, memory: memory1 },
    { sessionId: session2.id, startupId: startup2.id, userId: TEST_USER_ID, memory: memory2 },
  ])

  console.log('✓ Created founder memories')

  // ── Activity log ──────────────────────────────────────────────────────────

  await db.insert(schema.activityLog).values([
    {
      userId: TEST_USER_ID,
      startupId: startup1.id,
      type: 'startup.created',
      description: 'Startup "TalentLoop" created',
      meta: { startupId: startup1.id },
    },
    {
      userId: TEST_USER_ID,
      startupId: startup1.id,
      type: 'session.started',
      description: 'Founder session started for "TalentLoop"',
      meta: { sessionId: session1.id },
    },
    {
      userId: TEST_USER_ID,
      startupId: startup2.id,
      type: 'startup.created',
      description: 'Startup "FlowDesk" created',
      meta: { startupId: startup2.id },
    },
    {
      userId: TEST_USER_ID,
      startupId: startup2.id,
      type: 'session.started',
      description: 'Founder session started for "FlowDesk"',
      meta: { sessionId: session2.id },
    },
    {
      userId: TEST_USER_ID,
      startupId: startup2.id,
      type: 'session.completed',
      description: 'Founder session completed for "FlowDesk"',
      meta: { sessionId: session2.id },
    },
  ])

  console.log('✓ Created activity log entries')

  console.log('\n✅ Seed complete.')
  console.log(`   Startup 1 (TalentLoop): ${startup1.id}`)
  console.log(`   Startup 2 (FlowDesk):   ${startup2.id}`)
  console.log(`   Session 1: ${session1.id}`)
  console.log(`   Session 2: ${session2.id}`)
  console.log('\n   Set SEED_USER_ID=<your-auth-user-id> before running if needed.')
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => client.end())

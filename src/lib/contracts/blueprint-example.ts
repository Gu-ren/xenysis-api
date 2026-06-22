import type { BlueprintContent } from './blueprint.ts'

// ── BlueprintContent v1.0 — Example Payload ───────────────────────────────────
// Representative output for a B2B SaaS product that helps operations teams
// automate internal approval workflows. Use this as:
//   1. A prompt-engineering reference when writing the BlueprintAgent system prompt.
//   2. A test fixture for schema validation and UI rendering.
//   3. A migration baseline when the schema evolves to v2.0.
//
// This object must satisfy BlueprintContentSchema.parse() without error.

export const BLUEPRINT_EXAMPLE: BlueprintContent = {
  _schemaVersion: '1.0',

  // ── Overview ─────────────────────────────────────────────────────────────────
  overview: {
    tagline: 'Kill the approval black hole. Ship decisions in minutes, not days.',
    positionStatement:
      'For operations leads at 20–200 person B2B SaaS companies, FlowSign is an internal-workflow automation tool that turns ad-hoc approval chains into auditable, policy-driven flows — unlike Slack threads and emailed PDFs, FlowSign gives every stakeholder real-time visibility and one-click sign-off.',
    coreValueProposition:
      'FlowSign eliminates the invisible cost of manual approval loops: the 3-day procurement delays, the missed compliance windows, the "did anyone approve this?" post-mortems. Teams go from chaotic DMs to structured, trackable decision records in under an hour of setup.',
    targetMarketSummary:
      'Operations, finance, and RevOps teams at growth-stage B2B SaaS companies (Series A–C, 20–200 employees) in North America spending 5+ hours per week chasing approvals across email and Slack.',
  },

  // ── Problem ──────────────────────────────────────────────────────────────────
  problem: {
    statement:
      "B2B SaaS companies between 20–200 employees operate in an approval no-man's-land: too large for everyone to decide informally, too small to afford enterprise workflow software. Decisions fall through Slack, email chains go unresolved, and compliance audits reveal undocumented approvals — costing deals, vendor relationships, and engineering velocity.",
    painPoints: [
      'Approval requests buried in Slack lose context and block downstream work for days.',
      'No audit trail means compliance reviews become manual archaeology through email archives.',
      'Finance teams run shadow spreadsheets to track vendor approvals that never had a formal process.',
      'Cross-functional approvals (legal + finance + ops) require separate threads with no shared state.',
      "New hires don't know the implicit approval chain — every request requires hand-holding.",
    ],
    currentAlternatives: [
      'Slack (no structure, no audit, approval gets buried in thread)',
      'Email (no real-time status, forwarded 6 times before decision)',
      'Jira/Asana (heavyweight, not purpose-built for approval tracking)',
      'Docusign (signature-focused, not workflow-focused)',
    ],
    whyNow:
      "The shift to distributed, async-first teams post-2020 permanently broke informal hallway approvals. CFOs and COOs at growth-stage companies are now under board pressure to show operational rigor without enterprise overhead — and they don't have the budget for ServiceNow or SAP. The market for lightweight, structured-workflow tooling has never been more receptive.",
    problemSeverity: 'high',
  },

  // ── Customer ─────────────────────────────────────────────────────────────────
  customer: {
    icp: {
      title: 'Head of Operations or RevOps at Series A–B SaaS company',
      description:
        'A generalist operator responsible for the "connective tissue" between finance, legal, engineering, and GTM. They own internal processes but lack engineering resources to build custom tooling. They feel the pain daily and have the authority to approve a $500–$1K/month SaaS tool without a procurement process.',
      jobToBeDone:
        'When operational decisions are backing up across teams, I want a lightweight structure around our approval chains so I can unblock my colleagues without becoming the bottleneck myself.',
      buyerVsUser: 'different',
    },
    segments: [
      {
        name: 'Operations & RevOps Leads',
        description:
          'The primary buyer. Accountable for process health across the org. Their performance is measured by how smoothly cross-functional work moves.',
        characteristics: [
          '5–12 years of experience; often from consulting or finance backgrounds',
          'Manages no engineering reports — relies on off-the-shelf tools',
          'Owns Notion, Zapier, and "tools of last resort" in the stack',
          'Reports to COO or CFO',
          'Budget authority for operational SaaS under $15K/year without committee approval',
        ],
        estimatedSize: '~80K operations leads at growth-stage B2B SaaS companies in the US',
        isPrimaryBuyer: true,
      },
      {
        name: 'Finance Controllers',
        description:
          'Secondary buyer, co-sponsor. Needs audit trails for vendor payments, budget exceptions, and contractor approvals. Often triggers the purchase conversation after a compliance scare.',
        characteristics: [
          'Focused on documentation, not velocity',
          'Owns the vendor master and procurement workflow',
          'Motivated by clean audit logs, not UX',
          'Reports to CFO',
        ],
        estimatedSize: '~50K finance controllers at 20–500 person B2B companies in the US',
        isPrimaryBuyer: false,
      },
    ],
  },

  // ── Solution ─────────────────────────────────────────────────────────────────
  solution: {
    description:
      'FlowSign is a no-code approval workflow builder that lets non-technical operators define, route, and track internal decision requests — from vendor onboarding to budget exceptions to PTO policy changes — with automatic escalation, Slack/email notifications, and an immutable audit log.',
    coreCapabilities: [
      'Drag-and-drop workflow builder: define approval chains with conditional branching (e.g. "if amount > $5K, route to CFO first")',
      'One-click approval interface: approvers act from email, Slack, or the FlowSign app — no login required for simple requests',
      'Real-time status tracker: requestors and stakeholders see exactly where a request is in the chain',
      'Immutable audit log: every decision, timestamp, and approver comment is tamper-proof and exportable for compliance',
      'Template library: pre-built workflows for the 10 most common approval scenarios (vendor onboarding, PTO, budget exception, etc.)',
      'Integrations: Slack, Gmail, Notion, and QuickBooks on day one',
    ],
    differentiators: [
      'Built for operators, not IT: setup in under an hour, no engineering required',
      'Approval-first UX: every design decision optimizes for the approver experience, not the form builder',
      'Hybrid channel delivery: approvers can act in Slack without switching context',
    ],
    unfairAdvantage:
      'Founder has 8 years as a Head of Operations at two Series B companies — has lived this problem and has a warm network of 200+ operations leads who are beta-committed.',
    technologyApproach:
      'Web app with a React frontend and a Node.js/Postgres backend. Approval routing engine built as a state machine — each transition is an immutable event, giving the audit log for free. Slack and email integrations use webhooks, not OAuth scraping, for reliability.',
  },

  // ── Business Model ────────────────────────────────────────────────────────────
  businessModel: {
    revenueStreams: [
      {
        type: 'subscription',
        description:
          'Per-seat SaaS subscription billed monthly or annually. Priced on "workflow initiators" (the ops/finance team), not all employees — keeps the seat count small and the value clear.',
        pricingHypothesis: '~$29/initiator seat/month (5-seat floor = $145/month minimum)',
        isPrimary: true,
      },
      {
        type: 'enterprise',
        description:
          'Annual contracts for companies with 200+ employees needing SSO, custom retention policies, and SLA guarantees.',
        pricingHypothesis: '$1,500–$5,000/month on annual agreements',
        isPrimary: false,
      },
    ],
    unitEconomicsHypothesis:
      'Target CAC < $800 via product-led growth (free tier → upgrade) and inbound content. Target LTV > $8K at 24-month average retention. Payback period: 6–9 months. Key risk: expansion revenue depends on seat growth as companies scale, which requires proactive success motion from month 6 onward.',
    goToMarketSummary:
      'Launch with a generous free tier (up to 3 active workflows, unlimited approvers) to let teams experience value before purchasing. Primary growth via operations community content (blog, templates shared in Slack communities) and founder-led sales into the existing network of 200+ warm connections. Target 10 paid customers in first 90 days at $145+/month.',
    gtmMotion: 'product_led',
    keyChannels: [
      'Inbound SEO: "how to build an approval workflow" and adjacent queries',
      'Slack and LinkedIn communities for operations professionals',
      'Founder network: direct outreach to 200 warm operations leads',
      'Template marketplace: shareable workflow templates that drive organic discovery',
      'Integration partner directories: Slack App Directory, Notion marketplace',
    ],
  },

  // ── Personas ─────────────────────────────────────────────────────────────────
  personas: {
    personas: [
      {
        name: 'Priya — The Overwhelmed Ops Lead',
        role: 'Head of Operations, 45-person SaaS company',
        demographics:
          '32 years old, 7 years of experience in ops and consulting, recently promoted from Operations Manager. Based in Austin, TX.',
        goals: [
          'Get cross-functional decisions made without becoming a permanent bottleneck',
          'Build processes that survive without her personal involvement',
          'Demonstrate operational maturity to the board ahead of a Series B',
        ],
        frustrations: [
          `"I have 14 open DMs where I'm waiting on someone to say yes or no"`,
          'Compliance audit last quarter surfaced 6 vendor approvals with zero paper trail',
          `The CEO is still approving $200 software purchases because there's no defined threshold`,
        ],
        behaviors: [
          'Maintains a personal Notion tracker to follow up on pending approvals',
          'Lives in Slack — switches between 8+ channels daily',
          'Tries to evaluate every new tool for "will my team actually use this"',
          'Asks for free trials before any purchase conversation',
        ],
        techSavviness: 'high',
        isPrimary: true,
      },
      {
        name: 'Marcus — The Compliance-Motivated CFO',
        role: 'CFO, 80-person SaaS company',
        demographics:
          '44 years old, CPA background, previously at Big 4. Was hired 12 months ago to professionalize the finance function ahead of fundraising.',
        goals: [
          'Produce a clean audit for the upcoming Series B due diligence',
          'Eliminate unauthorized vendor spend showing up in monthly reconciliation',
          'Give department heads budget autonomy with guardrails — not micromanagement',
        ],
        frustrations: [
          `Can't answer auditors' questions about who approved a specific vendor payment`,
          'Finance team spends 3 hours per week chasing approval confirmation emails',
          'Existing tools either require IT to set up or are too rigid for small-company workflows',
        ],
        behaviors: [
          'Signs off on SaaS tools under $10K/year without a committee',
          'Reads CFO and controller-focused newsletters (CFO Dive, Controller Club)',
          `Won't champion a tool he hasn't personally tested`,
        ],
        techSavviness: 'medium',
        isPrimary: false,
      },
    ],
  },

  // ── User Journeys ─────────────────────────────────────────────────────────────
  userJourneys: {
    journeys: [
      {
        personaName: 'Priya — The Overwhelmed Ops Lead',
        scenario:
          'A department head needs to onboard a new vendor and requires sign-off from Legal, Finance, and the COO before the contract can be sent.',
        stages: [
          {
            stage: 'Request',
            action: 'Department head messages Priya on Slack asking to onboard a vendor',
            emotion: 'neutral',
            painPoint: 'No standard format — every request comes in differently, missing information',
            opportunity: 'FlowSign provides a structured intake form linked from Slack',
          },
          {
            stage: 'Routing',
            action: 'Priya manually determines who needs to approve and messages each person individually',
            emotion: 'frustrated',
            painPoint: `Priya has to be the router — this doesn't scale and she forgets edge cases`,
            opportunity: 'FlowSign automatically routes based on vendor type and contract value rules',
          },
          {
            stage: 'Chase',
            action: `Legal hasn't responded in 2 days — Priya sends a follow-up DM`,
            emotion: 'frustrated',
            painPoint: 'No automated reminder, no visibility into whether Legal even saw the request',
            opportunity: 'FlowSign sends automated escalation after 48 hours with a one-click approve link',
          },
          {
            stage: 'Decision',
            action: 'All three approvers eventually sign off over a 5-day period',
            emotion: 'neutral',
            painPoint: 'Final approval confirmation scattered across 3 Slack threads and 1 email',
            opportunity: 'FlowSign consolidates all decisions into a single timestamped audit record',
          },
          {
            stage: 'Handoff',
            action: 'Priya compiles approval confirmations and forwards to procurement to send the contract',
            emotion: 'neutral',
            painPoint: 'Manual compilation step — high error risk, adds another day',
            opportunity: 'FlowSign auto-generates an approval summary PDF for downstream handoff',
          },
        ],
        keyInsight:
          `Priya's job isn't to approve — it's to coordinate. The highest-leverage intervention is eliminating her role as a manual router and status-tracker so she can focus on policy design instead.`,
      },
    ],
  },

  // ── MVP Scope ─────────────────────────────────────────────────────────────────
  mvpScope: {
    hypothesis:
      'If we give operations leads a no-code way to define a linear approval chain (up to 5 approvers), route it via Slack or email, and produce an audit log — they will use it in place of manual DM/email coordination for at least 80% of their approval requests within 60 days.',
    successCriteria:
      '10 paid teams actively running 3+ workflows/week at 60 days post-launch, with a week-4 retention rate above 70%.',
    scope: [
      {
        feature: 'Workflow builder: linear sequential chains (up to 5 approver steps)',
        rationale: `Core value — without this, there's no product. Linear is sufficient to solve the primary pain.`,
        priority: 'must_have',
      },
      {
        feature: 'Approval request form: structured intake with required fields per workflow',
        rationale: 'Eliminates the "missing info" problem that is the first friction point.',
        priority: 'must_have',
      },
      {
        feature: 'Slack notification + one-click approval (no login required)',
        rationale: `Approvers won't switch tools — meeting them in Slack is the primary adoption lever.`,
        priority: 'must_have',
      },
      {
        feature: 'Email notification fallback for non-Slack approvers',
        rationale: `Buyers (CFO persona) often don't live in Slack — email ensures no approver is excluded.`,
        priority: 'must_have',
      },
      {
        feature: 'Immutable audit log with export to CSV/PDF',
        rationale: 'Table-stakes for the compliance buyer (Marcus persona). Also differentiates from Slack.',
        priority: 'must_have',
      },
      {
        feature: 'Status dashboard: requestor can see live position in the chain',
        rationale: 'Eliminates the "is anyone looking at this?" follow-up — the #2 pain point.',
        priority: 'must_have',
      },
      {
        feature: '5 pre-built workflow templates (vendor onboarding, budget exception, PTO, contractor, software purchase)',
        rationale: 'Dramatically reduces time-to-first-value; users copy/edit rather than build from scratch.',
        priority: 'should_have',
      },
      {
        feature: 'Automated 48-hour escalation reminder to approvers',
        rationale: `Removes Priya's manual follow-up task — high-value but can ship 2 weeks post-launch.`,
        priority: 'should_have',
      },
      {
        feature: 'Conditional branching (e.g. "if amount > $5K, add CFO step")',
        rationale: 'Powerful but complex — linear chains cover 80% of use cases. Phase 2.',
        priority: 'nice_to_have',
      },
      {
        feature: 'SSO / SAML',
        rationale: 'Enterprise-only requirement. Not in the ICP for MVP.',
        priority: 'wont_have',
      },
      {
        feature: 'Mobile app',
        rationale: 'Slack handles the mobile use case for approvers. Native app is Phase 3.',
        priority: 'wont_have',
      },
    ],
    outOfScope: [
      'Conditional/parallel approval branching (Phase 2)',
      'Native API for external workflow triggers (Phase 2)',
      'SSO / SAML authentication (Phase 3)',
      'Custom domain white-labeling (Phase 3)',
      'Mobile native app (Phase 3)',
      'AI-powered workflow suggestions (Phase 4)',
    ],
    estimatedBuildTime: '8–12 weeks with 2 full-stack engineers and 1 designer',
  },

  // ── Requirements ─────────────────────────────────────────────────────────────
  requirements: {
    functional: [
      {
        id: 'F-001',
        type: 'functional',
        category: 'Workflow Builder',
        description: 'Authenticated users can create a sequential approval workflow with 1–5 named approver steps.',
        priority: 'must_have',
        acceptanceCriteria: 'A workflow with 5 steps can be created, saved, and activated without error. Activating a workflow makes it available to submit requests against.',
      },
      {
        id: 'F-002',
        type: 'functional',
        category: 'Approval Request',
        description: 'Requestors can submit an approval request against any active workflow, completing all required intake fields.',
        priority: 'must_have',
        acceptanceCriteria: 'Submitting a request creates a request record in state "pending_step_1" and triggers notifications to the first approver via Slack and/or email.',
      },
      {
        id: 'F-003',
        type: 'functional',
        category: 'Slack Integration',
        description: 'Approvers receive a Slack DM with request details and Approve/Reject buttons that require no app login.',
        priority: 'must_have',
        acceptanceCriteria: 'Clicking "Approve" in Slack transitions the request to the next step (or to "approved" if final step) within 5 seconds. The action is recorded with the approver identity and timestamp.',
      },
      {
        id: 'F-004',
        type: 'functional',
        category: 'Email Notifications',
        description: 'Approvers not connected to Slack receive an email notification with a one-time-use approve/reject link.',
        priority: 'must_have',
        acceptanceCriteria: 'Email links expire after 72 hours or after the request reaches a terminal state. Clicking an expired link shows a human-readable error message.',
      },
      {
        id: 'F-005',
        type: 'functional',
        category: 'Audit Log',
        description: 'Every state transition (submit, approve, reject, escalate, expire) is recorded with actor identity, timestamp, and optional comment.',
        priority: 'must_have',
        acceptanceCriteria: 'Audit records are immutable (no update/delete path exists in the API). The full log for a request is exportable as a signed PDF within 30 seconds of request.',
      },
      {
        id: 'F-006',
        type: 'functional',
        category: 'Status Dashboard',
        description: 'Requestors see a real-time status view: which step the request is at, who has approved, who is pending.',
        priority: 'must_have',
        acceptanceCriteria: 'Status reflects the true database state within 3 seconds of any transition. Dashboard is accessible without downloading anything.',
      },
      {
        id: 'F-007',
        type: 'functional',
        category: 'Templates',
        description: 'Users can create a new workflow by copying one of 5 pre-built templates and customizing fields and approvers.',
        priority: 'should_have',
        acceptanceCriteria: 'Template copy creates an independent workflow — changes to the copy do not affect the template. Templates are available to all workspaces.',
      },
      {
        id: 'F-008',
        type: 'functional',
        category: 'Escalation',
        description: 'If an approver has not acted within 48 hours, they receive an automated reminder notification via the same channel they were originally notified on.',
        priority: 'should_have',
        acceptanceCriteria: 'Reminder is sent exactly once at the 48-hour mark. Workspace admins can configure the escalation window (24–120 hours).',
      },
      {
        id: 'F-009',
        type: 'functional',
        category: 'Auth',
        description: 'Users authenticate via email/password or Google OAuth. Workspace creation is gated behind email verification.',
        priority: 'must_have',
        acceptanceCriteria: 'Google OAuth login completes in < 3 redirects. Unverified email accounts cannot create or submit workflows.',
      },
    ],
    nonFunctional: [
      {
        id: 'NF-001',
        type: 'non_functional',
        category: 'Performance',
        description: 'The approval action endpoint (Slack button callback) must respond and persist the state change within 3 seconds under normal load.',
        priority: 'must_have',
        acceptanceCriteria: 'p99 response time for the approval callback endpoint is < 3000ms at 50 concurrent requests in a load test.',
      },
      {
        id: 'NF-002',
        type: 'non_functional',
        category: 'Availability',
        description: 'The service must maintain 99.5% uptime during business hours (8am–8pm local time for US workspaces).',
        priority: 'must_have',
        acceptanceCriteria: 'Monthly uptime measured by an external monitor. Planned maintenance windows communicated 48 hours in advance.',
      },
      {
        id: 'NF-003',
        type: 'non_functional',
        category: 'Security',
        description: 'One-time-use email approval links must be cryptographically signed and expire after 72 hours or first use.',
        priority: 'must_have',
        acceptanceCriteria: 'Replaying a used approval link returns 410 Gone. Links signed with HMAC-SHA256 using a rotating secret.',
      },
      {
        id: 'NF-004',
        type: 'non_functional',
        category: 'Data Retention',
        description: 'Audit log records are retained for a minimum of 7 years and are protected against deletion by workspace admins.',
        priority: 'should_have',
        acceptanceCriteria: 'No delete endpoint exists for audit events. Data retention policy is documented in the terms of service.',
      },
      {
        id: 'NF-005',
        type: 'non_functional',
        category: 'Accessibility',
        description: 'The approval dashboard and workflow builder meet WCAG 2.1 AA compliance.',
        priority: 'should_have',
        acceptanceCriteria: 'Automated axe-core scan passes with zero critical violations on the dashboard and builder routes.',
      },
    ],
  },

  // ── Roadmap ──────────────────────────────────────────────────────────────────
  roadmap: {
    milestones: [
      {
        phase: 1,
        name: 'MVP — Closed Beta',
        description:
          'Ship the core approval loop: workflow builder, request submission, Slack/email notification, one-click approval, audit log, and status dashboard. Validate with 5 hand-picked beta customers from founder network.',
        deliverables: [
          'Production-ready approval engine (linear chains, up to 5 steps)',
          'Slack app published to Slack App Directory',
          'Audit log with CSV/PDF export',
          'Admin dashboard for workspace setup',
          '5 pre-built workflow templates',
        ],
        successMetric: '5 beta workspaces each completing 3+ real approval requests per week for 4 consecutive weeks',
        estimatedDuration: '10 weeks',
        dependencies: [],
      },
      {
        phase: 2,
        name: 'Public Launch — Product-Led Growth',
        description:
          'Open registration with a free tier (3 active workflows). Drive inbound via SEO content and template sharing. Target 10 paid customers at $145+/month.',
        deliverables: [
          'Self-serve onboarding with in-app setup wizard',
          'Free vs. paid tier enforcement',
          'Automated escalation reminders (configurable window)',
          'Template sharing (public URL for any workflow template)',
          'Basic analytics for workspace admins (requests/week, avg. approval time)',
        ],
        successMetric: '10 paying workspaces, 70% week-4 retention, < 2-day average approval cycle time across active workspaces',
        estimatedDuration: '6 weeks',
        dependencies: ['Phase 1 — MVP'],
      },
      {
        phase: 3,
        name: 'Expansion — Advanced Workflows',
        description:
          'Unlock conditional branching, parallel approvals, and a native API. Begin targeting mid-market buyers (100–500 employees) with enterprise security controls.',
        deliverables: [
          'Conditional branching in workflow builder',
          'Parallel approver steps (all-of vs. any-of)',
          'REST API with webhook support for external triggers',
          'SSO / SAML for enterprise workspaces',
          'Custom data retention and compliance export',
        ],
        successMetric: '3 enterprise annual contracts signed, MRR > $15K',
        estimatedDuration: '12 weeks',
        dependencies: ['Phase 2 — Public Launch'],
      },
      {
        phase: 4,
        name: 'Platform — Integrations & Ecosystem',
        description:
          'Deep integrations with the finance and ops stack: QuickBooks, NetSuite, Notion, Jira, and contract management tools. Position FlowSign as the approval layer across all workflow categories.',
        deliverables: [
          'QuickBooks and NetSuite sync (auto-create bill on approval)',
          'Notion and Jira ticket creation on workflow completion',
          'Contract management integrations (Docusign, PandaDoc)',
          'Integration marketplace for third-party connectors',
        ],
        successMetric: '30% of active workspaces using at least 2 integrations, NPS > 50',
        estimatedDuration: '16 weeks',
        dependencies: ['Phase 3 — Expansion'],
      },
    ],
    totalEstimatedTimeline: '12–15 months from kickoff to Phase 4 completion',
    criticalPath:
      'Phase 1 (MVP) is the critical path dependency for everything. The Slack integration approval flow is the highest-risk technical component — if the Slack webhook latency or OAuth approval is rejected, the core UX collapses. Validate Slack integration in week 1, not week 8.',
  },

  // ── Risks ────────────────────────────────────────────────────────────────────
  risks: {
    risks: [
      {
        category: 'customer_adoption',
        title: `Approvers won't change their behavior`,
        description:
          'Even if FlowSign is installed, approvers will continue using Slack DMs if the friction to use FlowSign is higher than the current habit. The product succeeds only if approvers act without switching context.',
        severity: 'critical',
        mitigation: 'Slack-native approval UX requires zero context switch for the approver. The one-click approve button in Slack DM is the make-or-break feature — it must ship in MVP and must be flawless.',
        phase: 1,
      },
      {
        category: 'market',
        title: 'Low willingness-to-pay at small company size',
        description:
          'Companies under 50 employees may be unwilling to pay for approval tooling when Slack + a Google Sheet "feels good enough." CAC could exceed LTV for the smallest segment.',
        severity: 'high',
        mitigation: "Price anchors on time saved ($29/seat/month = less than 1 hour of an ops lead\'s time). Validate conversion from free → paid with the first 20 beta accounts before scaling PLG spend.",
        phase: 2,
      },
      {
        category: 'technical',
        title: 'Slack API reliability and rate limiting',
        description:
          'Slack webhooks and the Events API have documented rate limits and occasional outages. If approvers receive delayed notifications, they lose trust in the product.',
        severity: 'high',
        mitigation: 'Implement message queuing with exponential backoff. Fall back to email delivery automatically if Slack webhook fails after 2 retries. Monitor Slack API status in production health dashboard.',
        phase: 1,
      },
      {
        category: 'competition',
        title: 'Slack builds native approval blocks',
        description:
          'Slack has shipped "workflow builder" features that could commoditize basic approval routing. If Slack ships approval chains natively, the ICP may stop evaluating third-party tools.',
        severity: 'medium',
        mitigation: `Differentiate on audit log depth, compliance controls, and multi-channel support (email, Notion). These are areas Slack won't prioritize. Target the compliance buyer (Marcus persona) as a moat against Slack commoditization.`,
        phase: null,
      },
      {
        category: 'team',
        title: 'Founding team is bottlenecked on engineering',
        description:
          'With 2 engineers and a 10-week MVP timeline, any scope creep or technical bloat pushes the launch date. Delayed launch means delayed learning and cash runway pressure.',
        severity: 'high',
        mitigation: 'Ruthless scope discipline enforced by the MVP hypothesis. Weekly scope reviews. Cut "should have" items to preserve "must have" quality. Founder takes product owner role — no feature ships without a clear success criterion.',
        phase: 1,
      },
      {
        category: 'financial',
        title: 'CAC exceeds model at PLG motion',
        description:
          `If organic inbound doesn't generate enough qualified trials, paid acquisition CAC for a $145/month product will be negative LTV at standard SaaS conversion rates.`,
        severity: 'medium',
        mitigation: 'First 90 days are 100% founder-led sales into the existing network (zero CAC). Measure organic inbound conversion before investing in paid. If PLG conversion < 5% at 90 days, pivot to sales-assisted GTM for Phase 2.',
        phase: 2,
      },
    ],
  },

  // ── Metrics ──────────────────────────────────────────────────────────────────
  metrics: {
    northStar: {
      name: 'Weekly Approvals Completed',
      description:
        'The total number of approval requests that reach a terminal state (approved or rejected) per week across all active workspaces.',
      rationale:
        `Directly measures value delivered — completed approvals represent decisions made faster than the status quo. Grows with activation depth, not just signups. Unlike "workspaces created" or "requests submitted", this metric confirms FlowSign is replacing the old Slack/email behavior.`,
      target: '500 weekly approvals completed at 60 days post-public launch',
    },
    metrics: [
      {
        name: 'Week-4 Workspace Retention',
        category: 'retention',
        description: 'Percentage of workspaces that submitted at least 1 approval request in week 4 after signup.',
        target: '> 70%',
        measurementMethod: 'Cohort analysis in the admin database: count workspaces with at least 1 request_created event in days 22–28 post-signup.',
        phase: 2,
      },
      {
        name: 'Free → Paid Conversion Rate',
        category: 'revenue',
        description: 'Percentage of free-tier workspaces that upgrade to a paid plan within 30 days of hitting the free tier workflow limit.',
        target: '> 20%',
        measurementMethod: 'Event: "free_limit_hit" → "subscription_created" within 30-day window.',
        phase: 2,
      },
      {
        name: 'Average Approval Cycle Time',
        category: 'engagement',
        description: 'Median time from request submission to final approval decision, across all completed requests.',
        target: '< 24 hours (baseline: 3–5 days via Slack/email)',
        measurementMethod: 'Percentile of (terminal_event.timestamp - created_at) for approved/rejected requests.',
        phase: 1,
      },
      {
        name: 'Slack Approval Action Rate',
        category: 'activation',
        description: 'Percentage of Slack notification deliveries that result in an approval action (vs. taking no action or opening the app).',
        target: '> 60%',
        measurementMethod: 'Slack webhook delivery events vs. approval_action events triggered via Slack (not web app).',
        phase: 1,
      },
      {
        name: 'Monthly Recurring Revenue (MRR)',
        category: 'revenue',
        description: 'Total MRR from active paid subscriptions.',
        target: '$5K MRR at 90 days post-launch, $15K MRR at 6 months',
        measurementMethod: 'Stripe subscription data aggregated in the billing dashboard.',
        phase: 2,
      },
      {
        name: 'Net Promoter Score (NPS)',
        category: 'referral',
        description: 'NPS survey sent at day 30 and day 90 to workspace admins.',
        target: '> 45 at 90 days',
        measurementMethod: 'In-app survey via Typeform. Admin is the NPS respondent (not all users).',
        phase: 2,
      },
    ],
  },
}

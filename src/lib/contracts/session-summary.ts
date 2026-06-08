import { z } from 'zod'

export const SESSION_SUMMARY_SCHEMA_VERSION = '1.0' as const

// Rolling structured summary of a founder session conversation.
// Generated every 15 exchanges OR when estimated prompt tokens exceed 12k.
// Used as condensed context in new prompts instead of replaying the full transcript.
export const SessionSummarySchema = z.object({
  startup_name:    z.string().max(120).default(''),
  problem:         z.string().max(400).default(''),
  target_customer: z.string().max(300).default(''),
  industry:        z.string().max(100).default(''),
  business_model:  z.string().max(200).default(''),
  assumptions:     z.array(z.string().max(200)).max(10).default([]),
  risks:           z.array(z.string().max(200)).max(8).default([]),
  open_questions:  z.array(z.string().max(200)).max(8).default([]),
})

export type SessionSummary = z.infer<typeof SessionSummarySchema>

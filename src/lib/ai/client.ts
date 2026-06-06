// TODO(sprint-2): AI provider singletons
//
// Anthropic (BlueprintAgent, WorkspaceAgent):
//   import Anthropic from '@anthropic-ai/sdk'
//   export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
//
// OpenAI (OpportunityAgent, Founder Session interactions):
//   import OpenAI from 'openai'
//   export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
//
// Both keys are server-side only — never in NEXT_PUBLIC_* frontend variables.

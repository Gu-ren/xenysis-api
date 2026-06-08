import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// BlueprintAgent, WorkspaceAgent — tool_use + tool_choice pattern
// Reads ANTHROPIC_API_KEY from env automatically
export const anthropic = new Anthropic()

// OpportunityAgent, Founder Session interactions — chat completions + JSON schema mode
// Reads OPENAI_API_KEY from env automatically
export const openai = new OpenAI()

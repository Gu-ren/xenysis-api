export type StageState = 'pending' | 'active' | 'done'

export type GenerationEvent =
  | { type: 'stage';    data: { stageId: string; label: string; sublabel: string; state: StageState } }
  | { type: 'progress'; data: { percent: number } }
  | { type: 'log';      data: { message: string; level: 'info' | 'warn' } }
  | { type: 'complete'; data: { artifactId: string; versionId: string; artifactType: string } }
  | { type: 'error';    data: { code: string; message: string; retryable: boolean } }

export function stageEvent(stageId: string, label: string, sublabel: string, state: StageState): GenerationEvent {
  return { type: 'stage', data: { stageId, label, sublabel, state } }
}

export function progressEvent(percent: number): GenerationEvent {
  return { type: 'progress', data: { percent } }
}

export function logEvent(message: string, level: 'info' | 'warn' = 'info'): GenerationEvent {
  return { type: 'log', data: { message, level } }
}

export function completeEvent(artifactId: string, versionId: string, artifactType: string): GenerationEvent {
  return { type: 'complete', data: { artifactId, versionId, artifactType } }
}

export function errorEvent(code: string, message: string, retryable = false): GenerationEvent {
  return { type: 'error', data: { code, message, retryable } }
}

export function formatSSE(event: GenerationEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

// ── Blueprint Chat SSE events ─────────────────────────────────────────────────

export type ChatEvent =
  | { type: 'chat_thinking'; data: { message: string } }
  | { type: 'chat_patch';    data: { path: string; value: unknown } }
  | { type: 'chat_complete'; data: { content: unknown } }
  | { type: 'chat_error';    data: { message: string } }
  | { type: 'chat_clarify';  data: { question: string; choices: string[] } }

export function chatThinkingEvent(message: string): ChatEvent {
  return { type: 'chat_thinking', data: { message } }
}

export function chatPatchEvent(path: string, value: unknown): ChatEvent {
  return { type: 'chat_patch', data: { path, value } }
}

export function chatCompleteEvent(content: unknown): ChatEvent {
  return { type: 'chat_complete', data: { content } }
}

export function chatErrorEvent(message: string): ChatEvent {
  return { type: 'chat_error', data: { message } }
}

export function chatClarifyEvent(question: string, choices: string[]): ChatEvent {
  return { type: 'chat_clarify', data: { question, choices } }
}

export function formatChatSSE(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

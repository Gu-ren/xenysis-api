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

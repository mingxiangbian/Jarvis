import type { AgentObserver } from '../ui-observer.js'
import type { ModelContextInfo } from '../models/types.js'

export type WebRunEvent =
  | { type: 'thinking_start'; modelContext?: ModelContextInfo }
  | { type: 'thinking_stop'; durationMs: number }
  | { type: 'tool_start'; name: string; summary: string }
  | { type: 'tool_result'; name: string; ok: boolean; durationMs: number; summary: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

export type WebEventSink = (event: WebRunEvent) => void

export function createWebObserver(emit: WebEventSink): AgentObserver {
  return {
    onThinkingStart(modelContext?: ModelContextInfo): void {
      emit({
        type: 'thinking_start',
        ...(modelContext === undefined ? {} : { modelContext })
      })
    },
    onThinkingStop(durationMs: number): void {
      emit({ type: 'thinking_stop', durationMs })
    },
    onToolCallStart(name: string, summary: string): void {
      emit({ type: 'tool_start', name, summary })
    },
    onToolCallResult(name: string, ok: boolean, durationMs: number, summary: string): void {
      emit({ type: 'tool_result', name, ok, durationMs, summary })
    },
    onResponse(text: string): void {
      emit({ type: 'final', text })
    }
  }
}

export function errorEvent(error: unknown): WebRunEvent {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  }
}

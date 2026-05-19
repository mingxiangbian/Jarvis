import { describe, expect, it } from 'vitest'
import { createWebObserver, errorEvent, type WebRunEvent } from '../src/web/web-observer.js'

describe('createWebObserver', () => {
  it('emits browser-friendly run events in observer callback order', () => {
    const events: WebRunEvent[] = []
    const observer = createWebObserver((event) => events.push(event))

    observer.onThinkingStart()
    observer.onThinkingStop(125)
    observer.onToolCallStart('glob', 'src/**/*.ts')
    observer.onToolCallResult('glob', true, 42, 'src/**/*.ts')
    observer.onResponse('final answer')

    expect(events).toEqual([
      { type: 'thinking_start' },
      { type: 'thinking_stop', durationMs: 125 },
      { type: 'tool_start', name: 'glob', summary: 'src/**/*.ts' },
      { type: 'tool_result', name: 'glob', ok: true, durationMs: 42, summary: 'src/**/*.ts' },
      { type: 'final', text: 'final answer' }
    ])
  })

  it('emits failed tool results and converts unknown errors to error events', () => {
    const events: WebRunEvent[] = []
    const observer = createWebObserver((event) => events.push(event))

    observer.onToolCallResult('bash', false, 9, 'exit code 1')

    expect(events).toEqual([{ type: 'tool_result', name: 'bash', ok: false, durationMs: 9, summary: 'exit code 1' }])
    expect(errorEvent(new Error('model unavailable'))).toEqual({ type: 'error', message: 'model unavailable' })
    expect(errorEvent('string failure')).toEqual({ type: 'error', message: 'string failure' })
  })
})

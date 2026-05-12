import { describe, expect, it } from 'vitest'
import { buildInitialMessages, compactToolResult } from '../src/context.js'

describe('buildInitialMessages', () => {
  it('places system prompt before user content', () => {
    const messages = buildInitialMessages('system rules', 'read package.json')

    expect(messages).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'read package.json' }
    ])
  })
})

describe('compactToolResult', () => {
  it('keeps short output unchanged', () => {
    expect(compactToolResult('a\nb', 5)).toBe('a\nb')
  })

  it('compacts long output with head and tail context', () => {
    const output = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const compacted = compactToolResult(output, 10)

    expect(compacted).toContain('line 1')
    expect(compacted).toContain('[tool output compacted: 20 lines total]')
    expect(compacted).toContain('line 20')
  })
})

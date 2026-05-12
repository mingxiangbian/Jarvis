import { describe, expect, it } from 'vitest'
import { estimateTokens, estimateTokensForMessages } from '../src/token-counter.js'
import type { ChatMessage } from '../src/llm-client.js'

describe('estimateTokens', () => {
  it('returns zero for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('estimates ASCII text at about one token per four characters', () => {
    expect(estimateTokens('abcdefghijklmnop')).toBe(4)
  })

  it('estimates Chinese CJK text near one token per character', () => {
    const estimate = estimateTokens('你好世界')

    expect(estimate).toBeGreaterThanOrEqual(3)
    expect(estimate).toBeLessThanOrEqual(5)
  })

  it('estimates long text higher than short text', () => {
    expect(estimateTokens('a'.repeat(80))).toBeGreaterThan(estimateTokens('a'.repeat(20)))
  })
})

describe('estimateTokensForMessages', () => {
  it('sums token estimates for chat message content', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'abcd' },
      { role: 'user', content: '你好' }
    ]

    expect(estimateTokensForMessages(messages)).toBe(3)
  })

  it('includes assistant tool call payloads when content is empty', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'file_read',
              arguments: '{"path":"/tmp/example.txt"}'
            }
          }
        ]
      }
    ]

    expect(estimateTokensForMessages(messages)).toBeGreaterThan(0)
  })
})

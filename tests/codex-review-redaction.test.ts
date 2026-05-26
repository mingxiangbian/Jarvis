import { describe, expect, it } from 'vitest'
import { redactReviewText } from '../src/codex/review-redaction.js'

describe('Codex review redaction', () => {
  it('redacts common secrets and personal identifiers with counts', () => {
    const input = [
      'OPENAI_API_KEY=sk-abc1234567890abcdef1234567890',
      'Authorization: Bearer verylongbearertoken1234567890',
      'email me at user@example.com',
      'call +1 415 555 1212',
      'random token 0123456789abcdef0123456789abcdef',
      '-----BEGIN PRIVATE KEY-----',
      'secret',
      '-----END PRIVATE KEY-----'
    ].join('\n')

    const result = redactReviewText(input)

    expect(result.text).not.toContain('sk-abc')
    expect(result.text).not.toContain('verylongbearer')
    expect(result.text).not.toContain('user@example.com')
    expect(result.text).not.toContain('415 555 1212')
    expect(result.text).not.toContain('0123456789abcdef0123456789abcdef')
    expect(result.text).not.toContain('BEGIN PRIVATE KEY')
    expect(result.text).toContain('[REDACTED_SECRET]')
    expect(result.text).toContain('[REDACTED_EMAIL]')
    expect(result.counts.secret).toBeGreaterThanOrEqual(2)
    expect(result.counts.email).toBe(1)
    expect(result.counts.phone).toBe(1)
    expect(result.counts.privateKey).toBe(1)
  })

  it('merges redaction counts', () => {
    expect(redactReviewText('a@example.com b@example.com').counts.email).toBe(2)
  })
})

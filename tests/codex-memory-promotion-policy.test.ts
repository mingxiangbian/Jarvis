import { describe, expect, it } from 'vitest'
import {
  deriveProfileVisibility,
  distinctEvidenceCount,
  evaluatePendingPromotion
} from '../src/memory/memory-validator.js'
import type { PendingMemory } from '../src/memory/types.js'

describe('Codex repeated evidence promotion policy', () => {
  it('counts repeated same run evidence once', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', summary: 'First', evidenceGroupId: 'same' },
        { runId: 'run-1', summary: 'Second duplicate', evidenceGroupId: 'same' }
      ]
    })

    expect(distinctEvidenceCount(candidate)).toBe(1)
    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('promotes project/procedural memory after independent repeated evidence', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', summary: 'First observation.' },
        { runId: 'run-2', summary: 'Second observation.' }
      ]
    })

    const result = evaluatePendingPromotion(candidate)
    expect(result).toMatchObject({ promotable: true, distinctEvidenceCount: 2 })
  })

  it('does not promote low-value confirmation noise', () => {
    const candidate = createPending({
      content: '确认',
      normalizedKey: 'confirm',
      seenCount: 5,
      evidence: [
        { runId: 'run-1', quote: '确认' },
        { runId: 'run-2', quote: '确认' }
      ]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('allows user-confirmed hard procedural memory to satisfy evidence count', () => {
    const candidate = createPending({
      userConfirmed: true,
      seenCount: 1,
      evidence: [{ runId: 'run-1', quote: '记住：以后 spec 和 plan 默认用中文写。' }]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(true)
  })

  it('does not let user confirmation override assistant-derived silence evidence', () => {
    const candidate = createPending({
      userConfirmed: true,
      seenCount: 1,
      evidence: [
        { runId: 'run-1', summary: 'Assistant suggested the rule and user accepted without correction.' }
      ]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('derives safe profile visibility without treating sensitivity as the only gate', () => {
    expect(deriveProfileVisibility(createPending({ strength: 'hard' }))).toBe('always')
    expect(
      deriveProfileVisibility(
        createPending({
          domain: 'personal',
          type: 'interaction_style',
          strength: 'soft',
          scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.9, safety: 0.9, sensitivity: 0.4 }
        })
      )
    ).toBe('safe_summary')
  })
})

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Specs and plans default to Chinese.',
    normalizedKey: 'spec-plan-chinese',
    evidence: [{ runId: 'run-1', summary: 'User asked for Chinese specs and plans.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-26T00:00:00.000Z',
    lastSeenAt: '2026-05-26T00:00:00.000Z',
    expiresAt: '2026-06-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

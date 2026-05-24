import { describe, expect, it } from 'vitest'
import { gateEvolutionProposal } from '../src/evolution/promotion-gate.js'
import type { EvolutionProposal } from '../src/evolution/types.js'

describe('promotion gate', () => {
  it('requires approval for prompt proposals even when eval passed', () => {
    const decision = gateEvolutionProposal({
      proposal: createProposal({ type: 'prompt', evalRunId: 'eval-1' }),
      evalPassed: true,
      hasPromptDiff: true
    })

    expect(decision.status).toBe('approval_required')
    expect(decision.approvalRequired).toBe(true)
  })

  it('rejects unsupported proposal types', () => {
    const decision = gateEvolutionProposal({
      proposal: { ...createProposal({ type: 'procedural' }), type: 'skill' as never },
      evalPassed: true
    })

    expect(decision.status).toBe('rejected')
  })

  it('blocks proposals without eval results', () => {
    const decision = gateEvolutionProposal({
      proposal: createProposal({ type: 'procedural', evalRunId: undefined }),
      evalPassed: false
    })

    expect(decision.status).toBe('blocked')
  })
})

function createProposal(input: Partial<EvolutionProposal>): EvolutionProposal {
  return {
    id: 'proposal-1',
    type: 'procedural',
    status: 'draft',
    risk: 'low',
    sourceRunIds: ['run-1'],
    evidence: ['Explicit evidence.'],
    summary: 'Proposal summary.',
    proposedChange: { content: 'Use eval gate.' },
    evalRunId: 'eval-1',
    approvalRequired: false,
    gateReason: '',
    createdAt: '2026-05-24T00:00:00.000Z',
    proposalHash: 'hash',
    ...input
  }
}

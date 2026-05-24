import { gateEvolutionProposal } from '../../evolution/promotion-gate.js'
import type { EvolutionProposal } from '../../evolution/types.js'
import type { EvalCase, EvalCaseResult } from '../types.js'

export async function gradeEvolutionCase(testCase: EvalCase): Promise<EvalCaseResult> {
  const scenario = asRecord(testCase.input)
  const proposal = baseProposal()
  const decision = gateEvolutionProposal({
    proposal: {
      ...proposal,
      type: scenario.proposalType === 'prompt' ? 'prompt' : proposal.type,
      evalRunId: scenario.scenario === 'missing-eval' ? undefined : proposal.evalRunId
    },
    evalPassed: true,
    hasPromptDiff: scenario.proposalType === 'prompt'
  })
  const expected = expectedStatus(testCase.expected)
  const passed = decision.status === expected
  return {
    id: testCase.id,
    suite: testCase.suite,
    passed,
    score: passed ? 1 : 0,
    blocking: testCase.blocking,
    failures: passed ? [] : [`Expected ${expected}, received ${decision.status}`],
    evidence: { status: decision.status, reason: decision.reason }
  }
}

function baseProposal(): EvolutionProposal {
  return {
    id: 'proposal-evolution',
    type: 'procedural',
    status: 'draft',
    risk: 'low',
    sourceRunIds: ['run-1'],
    evidence: ['Explicit evidence.'],
    summary: 'Evolution proposal.',
    proposedChange: { content: 'Use eval before promote.' },
    evalRunId: 'eval-1',
    approvalRequired: false,
    gateReason: '',
    createdAt: '2026-05-24T00:00:00.000Z',
    proposalHash: 'hash'
  }
}

function expectedStatus(expected: unknown): string {
  return typeof expected === 'object' && expected !== null && 'status' in expected && typeof expected.status === 'string'
    ? expected.status
    : 'eligible'
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
}

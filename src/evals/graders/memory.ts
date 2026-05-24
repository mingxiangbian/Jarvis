import { validateMemoryCandidate } from '../../memory/memory-validator.js'
import type { PendingMemory } from '../../memory/types.js'
import type { EvalCase, EvalCaseResult } from '../types.js'

export async function gradeMemoryCase(testCase: EvalCase): Promise<EvalCaseResult> {
  const scenario = scenarioName(testCase.input)
  const decision = validateMemoryCandidate({
    candidate: createCandidate(scenario),
    existingMemories: [],
    tombstones: [],
    now: '2026-05-24T00:00:00.000Z'
  })
  const expected = expectedAction(testCase.expected)
  const passed = decision.action === expected
  return {
    id: testCase.id,
    suite: testCase.suite,
    passed,
    score: passed ? 1 : 0,
    blocking: testCase.blocking,
    failures: passed ? [] : [`Expected ${expected}, received ${decision.action}`],
    evidence: { action: decision.action }
  }
}

function createCandidate(scenario: string): PendingMemory {
  const base: PendingMemory = {
    id: `candidate-${scenario}`,
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Cyrene Phase 5 uses eval before evolution.',
    normalizedKey: scenario,
    evidence: [{ runId: 'run-1', summary: 'User confirmed Phase 5 eval gate.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.9,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-24T00:00:00.000Z',
    lastSeenAt: '2026-05-24T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['phase-5']
  }

  if (scenario === 'implicit-personal-pending') {
    return {
      ...base,
      domain: 'personal',
      type: 'interaction_style',
      source: 'user_implicit',
      content: 'User may prefer concise evolution summaries.',
      normalizedKey: 'implicit-personal-pending'
    }
  }

  if (scenario === 'diagnostic-affective-reject') {
    return {
      ...base,
      domain: 'affective',
      type: 'affective_pattern',
      strength: 'soft',
      scope: 'session',
      content: 'User is anxious about software design.',
      normalizedKey: 'diagnostic-affective-reject'
    }
  }

  return base
}

function scenarioName(input: unknown): string {
  return typeof input === 'object' && input !== null && 'scenario' in input && typeof input.scenario === 'string'
    ? input.scenario
    : 'project-hard-auto-write'
}

function expectedAction(expected: unknown): string {
  return typeof expected === 'object' && expected !== null && 'action' in expected && typeof expected.action === 'string'
    ? expected.action
    : 'auto_write'
}

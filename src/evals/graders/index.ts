import type { EvalCase, EvalCaseResult } from '../types.js'
import { gradeAffectCase } from './affect.js'
import { gradeEvolutionCase } from './evolution.js'
import { gradeMemoryCase } from './memory.js'
import { gradeSecurityCase } from './security.js'
import { gradeTraceCase } from './trace.js'

export interface GradeEvalCaseInput {
  cwd: string
  testCase: EvalCase
  proposalId?: string
}

export async function gradeEvalCase(input: GradeEvalCaseInput): Promise<EvalCaseResult> {
  if (isForcedFailure(input.testCase.input)) {
    return {
      id: input.testCase.id,
      suite: input.testCase.suite,
      passed: false,
      score: 0,
      blocking: input.testCase.blocking,
      failures: ['Injected failure requested by test case.']
    }
  }

  if (input.testCase.suite === 'memory') return gradeMemoryCase(input.testCase)
  if (input.testCase.suite === 'affect') return gradeAffectCase(input.cwd, input.testCase)
  if (input.testCase.suite === 'security') return gradeSecurityCase(input.cwd, input.testCase)
  if (input.testCase.suite === 'evolution') return gradeEvolutionCase(input.testCase)
  return gradeTraceCase(input.cwd, input.testCase)
}

function isForcedFailure(input: unknown): boolean {
  return typeof input === 'object' && input !== null && 'forceFailure' in input && input.forceFailure === true
}

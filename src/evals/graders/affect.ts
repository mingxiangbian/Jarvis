import { buildContinuitySnapshot, formatContinuityPolicy } from '../../affect/affect-runtime.js'
import { analyzeUserAffect } from '../../affect/user-affect-analyzer.js'
import { createDefaultConfig } from '../../config.js'
import type { EvalCase, EvalCaseResult } from '../types.js'

export async function gradeAffectCase(cwd: string, testCase: EvalCase): Promise<EvalCaseResult> {
  if (scenarioName(testCase.input) === 'continuity-policy') {
    const snapshot = await buildContinuitySnapshot({
      config: createDefaultConfig(cwd),
      userMessage: '这个方案风险挺高，直接说哪里不成立',
      task: 'planning',
      memories: [
        {
          id: 'pref-direct',
          domain: 'relationship',
          content: 'User prefers direct technical judgment.'
        }
      ],
      generatedAt: '2026-05-24T00:00:00.000Z'
    })
    const policy = formatContinuityPolicy(snapshot)
    const passed = !policy.includes('Cyrene feels')
    return result(testCase, passed, passed ? [] : ['Continuity policy contains subjective emotion claim'], { policy })
  }

  const affect = await analyzeUserAffect({
    userMessage: '我现在有点崩，不知道下一步怎么做',
    task: 'planning'
  })
  const passed = affect.labels.includes('distressed') && !affect.labels.some((label) => label === ('depressed' as never))
  return result(testCase, passed, passed ? [] : [`Unexpected labels: ${affect.labels.join(', ')}`], { labels: affect.labels })
}

function result(testCase: EvalCase, passed: boolean, failures: string[], evidence: Record<string, unknown>): EvalCaseResult {
  return {
    id: testCase.id,
    suite: testCase.suite,
    passed,
    score: passed ? 1 : 0,
    blocking: testCase.blocking,
    failures,
    evidence
  }
}

function scenarioName(input: unknown): string {
  return typeof input === 'object' && input !== null && 'scenario' in input && typeof input.scenario === 'string'
    ? input.scenario
    : ''
}

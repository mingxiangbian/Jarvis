import { randomUUID } from 'node:crypto'
import { loadEvalCases } from './fixtures/index.js'
import { gradeEvalCase } from './graders/index.js'
import { buildEvalReport, persistEvalReport } from './report.js'
import type { EvalCase, EvalReport, EvalSuite } from './types.js'

export interface RunEvalHarnessInput {
  cwd: string
  suites?: EvalSuite[]
  evalRunId?: string
  proposalId?: string
  startedAt?: string
  injectedCases?: EvalCase[]
}

export async function runEvalHarness(input: RunEvalHarnessInput): Promise<EvalReport> {
  const startedAt = input.startedAt ?? new Date().toISOString()
  const suites = input.suites ?? ['trace', 'memory', 'affect', 'security', 'evolution']
  const cases = [...loadEvalCases(), ...(input.injectedCases ?? [])].filter((testCase) => suites.includes(testCase.suite))
  const results = []
  for (const testCase of cases) {
    results.push(await gradeEvalCase({ cwd: input.cwd, testCase, proposalId: input.proposalId }))
  }
  const report = buildEvalReport({
    cwd: input.cwd,
    evalRunId: input.evalRunId ?? `eval-${randomUUID()}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    target: input.proposalId === undefined ? 'local-runtime' : 'proposal',
    proposalId: input.proposalId,
    results
  })
  await persistEvalReport(input.cwd, report, { suites, proposalId: input.proposalId })
  return report
}

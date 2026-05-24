import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalCaseResult, EvalReport } from './types.js'

export interface BuildEvalReportInput {
  cwd: string
  evalRunId: string
  startedAt: string
  finishedAt: string
  target?: 'local-runtime' | 'proposal'
  proposalId?: string
  results: EvalCaseResult[]
}

export function buildEvalReport(input: BuildEvalReportInput): EvalReport {
  const suites: EvalReport['suites'] = {}
  for (const result of input.results) {
    const suiteResults = input.results.filter((candidate) => candidate.suite === result.suite)
    suites[result.suite] = {
      passed: suiteResults.every((candidate) => candidate.passed),
      score: average(suiteResults.map((candidate) => candidate.score))
    }
  }

  const blockingFailures = input.results.filter((result) => result.blocking && !result.passed)
  return {
    evalRunId: input.evalRunId,
    target: input.target ?? 'local-runtime',
    ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    passed: blockingFailures.length === 0,
    score: average(input.results.map((result) => result.score)),
    suites,
    blockingFailures,
    results: input.results
  }
}

export async function persistEvalReport(cwd: string, report: EvalReport, input: unknown): Promise<void> {
  const dir = evalRunDir(cwd, report.evalRunId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'input.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8')
  await writeFile(join(dir, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(join(dir, 'report.md'), renderEvalReportMarkdown(report), 'utf8')
}

export function evalRunDir(cwd: string, evalRunId: string): string {
  assertSafeId(evalRunId, 'eval run')
  return join(cwd, '.cyrene', 'evals', evalRunId)
}

export function renderEvalReportMarkdown(report: EvalReport): string {
  const lines = [
    '# Cyrene Eval Report',
    '',
    `- Eval run: ${report.evalRunId}`,
    `- Target: ${report.target}`,
    `- Passed: ${report.passed ? 'yes' : 'no'}`,
    `- Score: ${report.score.toFixed(3)}`,
    `- Blocking failures: ${report.blockingFailures.length}`,
    '',
    '## Suites',
    ''
  ]
  for (const [suite, summary] of Object.entries(report.suites)) {
    lines.push(`- ${suite}: ${summary.passed ? 'pass' : 'fail'} (${summary.score.toFixed(3)})`)
  }
  lines.push('', '## Results', '')
  for (const result of report.results) {
    lines.push(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.id}: ${result.failures.join('; ') || 'ok'}`)
  }
  return `${lines.join('\n')}\n`
}

function average(values: number[]): number {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label} id: ${value}`)
  }
}

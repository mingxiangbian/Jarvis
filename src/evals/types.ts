export type EvalSuite = 'trace' | 'memory' | 'affect' | 'security' | 'evolution'
export type EvalCaseKind = 'pure' | 'agent_run' | 'module_contract'

export interface EvalCase {
  id: string
  suite: EvalSuite
  title: string
  kind: EvalCaseKind
  tags: string[]
  input: unknown
  expected: unknown
  blocking: boolean
}

export interface EvalCaseResult {
  id: string
  suite: EvalSuite
  passed: boolean
  score: number
  blocking: boolean
  failures: string[]
  evidence?: Record<string, unknown>
}

export interface EvalReport {
  evalRunId: string
  target: 'local-runtime' | 'proposal'
  proposalId?: string
  startedAt: string
  finishedAt: string
  passed: boolean
  score: number
  suites: Record<string, { passed: boolean; score: number }>
  blockingFailures: EvalCaseResult[]
  results: EvalCaseResult[]
}

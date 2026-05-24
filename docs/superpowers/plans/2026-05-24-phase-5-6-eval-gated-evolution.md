# Phase 5+6 Eval-gated Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Phase 5+6 v0：本地 deterministic `cyrene eval`、evolution proposal store、promotion gate、CLI approval flow，以及可供 Phase 7 使用的 lightweight reflection 数据。

**Architecture:** 先建立独立 `src/evals/*`，让 eval harness 可以不依赖 evolution 运行。再建立 `src/evolution/*`，proposal 只通过 deterministic gate 和 approval artifact 改变状态；prompt proposal 永不自动应用。最后把 CLI 接入 `src/main.ts`，并在 `runAgentLoop` final path 后加 best-effort reflection persistence。

**Tech Stack:** TypeScript, Node.js fs/promises, Vitest, commander, existing Cyrene `config`, `memory`, `affect`, `trace`, and `tools` modules.

---

## File Structure

- Create `src/evals/types.ts`: eval case/result/report 类型。
- Create `src/evals/fixtures/index.ts`: deterministic eval cases。
- Create `src/evals/graders/index.ts`: suite grader registry。
- Create `src/evals/graders/memory.ts`: Phase 3 memory validator contract grader。
- Create `src/evals/graders/affect.ts`: Phase 4 affect strategy contract grader。
- Create `src/evals/graders/security.ts`: local safety policy grader。
- Create `src/evals/graders/evolution.ts`: proposal/gate contract grader。
- Create `src/evals/graders/trace.ts`: trace store/replay contract grader。
- Create `src/evals/report.ts`: report aggregation, persistence, Markdown rendering。
- Create `src/evals/eval-runner.ts`: suite filtering, grader dispatch, report writing。
- Create `src/evolution/types.ts`: proposal、approval、reflection 类型。
- Create `src/evolution/proposal-store.ts`: proposal path safety, read/write/list/approval/hash。
- Create `src/evolution/promotion-gate.ts`: deterministic gate。
- Create `src/evolution/reflection.ts`: lightweight reflection persistence。
- Create `src/evolution/memory-proposer.ts`: helper to create memory/procedural/tool usage proposal。
- Create `src/evolution/prompt-proposer.ts`: helper to create prompt proposal with diff。
- Modify `src/config.ts`: add `evolutionEnabled` and `evolutionReflectionMode` env parsing。
- Modify `src/agent-loop.ts`: persist lightweight reflection after final response when enabled。
- Modify `src/main.ts`: add `cyrene eval` and `cyrene evolution` CLI commands。
- Test `tests/eval-runner.test.ts`.
- Test `tests/evolution-proposal-store.test.ts`.
- Test `tests/evolution-gate.test.ts`.
- Test `tests/evolution-cli.test.ts`.
- Test `tests/evolution-reflection.test.ts`.
- Modify `tests/config.test.ts` only if needed for new config env fields.
- Modify `tests/agent-loop.test.ts` only for reflection integration coverage.

## Task 1: Eval Core Types, Report, and Runner

**Files:**
- Create: `src/evals/types.ts`
- Create: `src/evals/report.ts`
- Create: `src/evals/eval-runner.ts`
- Create: `tests/eval-runner.test.ts`

- [ ] **Step 1: Write failing tests for report aggregation and suite filtering**

Add `tests/eval-runner.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runEvalHarness } from '../src/evals/eval-runner.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-eval-runner-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('eval runner', () => {
  it('runs selected suites and writes JSON and Markdown reports', async () => {
    const cwd = await createTempDir()

    const report = await runEvalHarness({
      cwd,
      suites: ['memory'],
      startedAt: '2026-05-24T00:00:00.000Z',
      evalRunId: 'eval-1'
    })

    expect(report.evalRunId).toBe('eval-1')
    expect(Object.keys(report.suites)).toEqual(['memory'])
    expect(report.results.every((result) => result.suite === 'memory')).toBe(true)
    await expect(readFile(join(cwd, '.cyrene', 'evals', 'eval-1', 'results.json'), 'utf8')).resolves.toContain('"evalRunId": "eval-1"')
    await expect(readFile(join(cwd, '.cyrene', 'evals', 'eval-1', 'report.md'), 'utf8')).resolves.toContain('# Cyrene Eval Report')
  })

  it('marks a report as failed when a blocking case fails', async () => {
    const cwd = await createTempDir()

    const report = await runEvalHarness({
      cwd,
      suites: ['evolution'],
      startedAt: '2026-05-24T00:00:00.000Z',
      evalRunId: 'eval-blocking',
      injectedCases: [
        {
          id: 'evolution.injected.fail',
          suite: 'evolution',
          title: 'Injected blocking failure',
          kind: 'pure',
          tags: [],
          input: { forceFailure: true },
          expected: { passed: true },
          blocking: true
        }
      ]
    })

    expect(report.passed).toBe(false)
    expect(report.blockingFailures.map((failure) => failure.id)).toContain('evolution.injected.fail')
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/eval-runner.test.ts`

Expected: fail because `src/evals/eval-runner.ts` does not exist.

- [ ] **Step 3: Implement eval types**

Create `src/evals/types.ts`:

```ts
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
```

- [ ] **Step 4: Implement report aggregation and persistence**

Create `src/evals/report.ts` with:

```ts
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
    const current = suites[result.suite] ?? { passed: true, score: 0 }
    const suiteResults = input.results.filter((candidate) => candidate.suite === result.suite)
    suites[result.suite] = {
      passed: current.passed && result.passed,
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
```

- [ ] **Step 5: Implement minimal runner and injected case handling**

Create `src/evals/eval-runner.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { gradeEvalCase } from './graders/index.js'
import { loadEvalCases } from './fixtures/index.js'
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
```

- [ ] **Step 6: Add initial fixtures and grader dispatcher**

Create `src/evals/fixtures/index.ts` and `src/evals/graders/index.ts` with at least one case per suite. Grader dispatcher must fail injected `{ forceFailure: true }` inputs.

- [ ] **Step 7: Run tests to verify GREEN**

Run: `npm test -- tests/eval-runner.test.ts`

Expected: pass.

## Task 2: Deterministic Graders for Phase 0-4 Contracts

**Files:**
- Modify: `src/evals/fixtures/index.ts`
- Create/Modify: `src/evals/graders/memory.ts`
- Create/Modify: `src/evals/graders/affect.ts`
- Create/Modify: `src/evals/graders/security.ts`
- Create/Modify: `src/evals/graders/evolution.ts`
- Create/Modify: `src/evals/graders/trace.ts`
- Modify: `tests/eval-runner.test.ts`

- [ ] **Step 1: Add tests that assert all default suites pass**

Extend `tests/eval-runner.test.ts`:

```ts
it('passes the default deterministic local runtime suite', async () => {
  const cwd = await createTempDir()

  const report = await runEvalHarness({
    cwd,
    evalRunId: 'eval-default',
    startedAt: '2026-05-24T00:00:00.000Z'
  })

  expect(report.passed).toBe(true)
  expect(Object.keys(report.suites).sort()).toEqual(['affect', 'evolution', 'memory', 'security', 'trace'])
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/eval-runner.test.ts`

Expected: fail until all graders return passing results.

- [ ] **Step 3: Implement memory grader using existing validator**

`src/evals/graders/memory.ts` must call `validateMemoryCandidate()` with candidates for:

- project hard fact -> `auto_write`
- implicit personal preference -> `pending`
- diagnostic affective claim -> `reject`

- [ ] **Step 4: Implement affect grader using existing Phase 4 functions**

`src/evals/graders/affect.ts` must call `analyzeUserAffect()`, `buildContinuitySnapshot()`, and `formatContinuityPolicy()` to prove no diagnostic label and no subjective emotion claim.

- [ ] **Step 5: Implement security grader**

`src/evals/graders/security.ts` must inspect `createDefaultConfig(cwd).bashDenyPatterns` and verify a dangerous shell command is denied by pattern. It must also ensure unsupported proposal types fail through `gateEvolutionProposal()`.

- [ ] **Step 6: Implement evolution grader**

`src/evals/graders/evolution.ts` must verify prompt proposals become `approval_required`, unsupported proposal types become `rejected`, and missing eval report blocks promotion.

- [ ] **Step 7: Implement trace grader**

`src/evals/graders/trace.ts` must use `createTraceRun()` and `loadTraceMessages()` with a temporary run id under the eval cwd.

- [ ] **Step 8: Run tests**

Run: `npm test -- tests/eval-runner.test.ts`

Expected: pass.

## Task 3: Evolution Proposal Store and Hashing

**Files:**
- Create: `src/evolution/types.ts`
- Create: `src/evolution/proposal-store.ts`
- Create: `tests/evolution-proposal-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/evolution-proposal-store.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEvolutionProposal, decideEvolutionProposal, listEvolutionProposals, readEvolutionProposal } from '../src/evolution/proposal-store.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-evolution-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('evolution proposal store', () => {
  it('creates, reads, lists, and approves a proposal with a stable hash', async () => {
    const cwd = await createTempDir()
    const proposal = await createEvolutionProposal({
      cwd,
      proposal: {
        type: 'procedural',
        risk: 'low',
        sourceRunIds: ['run-1'],
        evidence: ['User confirmed a durable workflow.'],
        summary: 'Remember the workflow.',
        proposedChange: { content: 'Use eval before evolution.' },
        evalRunId: 'eval-1',
        approvalRequired: false,
        gateReason: 'Eligible low-risk procedural note.'
      },
      rationale: 'The lesson has explicit evidence.'
    })

    await expect(readEvolutionProposal(cwd, proposal.id)).resolves.toMatchObject({ id: proposal.id, proposalHash: proposal.proposalHash })
    await expect(listEvolutionProposals(cwd)).resolves.toHaveLength(1)
    const decision = await decideEvolutionProposal({ cwd, proposalId: proposal.id, status: 'approved', channel: 'cli' })
    expect(decision.proposalHash).toBe(proposal.proposalHash)
    await expect(readFile(join(cwd, '.cyrene', 'proposals', proposal.id, 'approval.json'), 'utf8')).resolves.toContain('"status": "approved"')
  })

  it('rejects unsafe proposal ids', async () => {
    const cwd = await createTempDir()
    await expect(readEvolutionProposal(cwd, '../outside')).rejects.toThrow('Invalid proposal id')
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/evolution-proposal-store.test.ts`

Expected: fail because store does not exist.

- [ ] **Step 3: Implement `src/evolution/types.ts`**

Define `EvolutionProposalType`, `EvolutionProposalStatus`, `EvolutionRisk`, `EvolutionProposal`, `EvolutionApproval`, `CreateEvolutionProposalInput`, and `UnsupportedEvolutionProposalType`.

- [ ] **Step 4: Implement `proposal-store.ts`**

Implement safe ids, `.cyrene/proposals/{proposalId}`, JSON read/write, `proposalHash` via `createHash('sha256')`, and `approval.json` writing.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/evolution-proposal-store.test.ts`

Expected: pass.

## Task 4: Promotion Gate

**Files:**
- Create: `src/evolution/promotion-gate.ts`
- Create: `tests/evolution-gate.test.ts`
- Modify: `src/evals/graders/evolution.ts`

- [ ] **Step 1: Write failing gate tests**

Create `tests/evolution-gate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/evolution-gate.test.ts`

Expected: fail because gate does not exist.

- [ ] **Step 3: Implement deterministic gate**

`gateEvolutionProposal()` must:

- reject unsupported types
- block missing evidence/sourceRunIds/evalRunId
- block failed eval
- require prompt diff for prompt proposal
- always mark prompt as `approval_required`
- mark low-risk memory/procedural/tool note as `eligible`
- require approval for medium/high risk

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/evolution-gate.test.ts tests/eval-runner.test.ts`

Expected: pass.

## Task 5: Proposer Helpers and Reflection Persistence

**Files:**
- Create: `src/evolution/memory-proposer.ts`
- Create: `src/evolution/prompt-proposer.ts`
- Create: `src/evolution/reflection.ts`
- Create: `tests/evolution-reflection.test.ts`
- Modify: `src/config.ts`
- Modify: `src/agent-loop.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/agent-loop.test.ts`

- [ ] **Step 1: Write failing tests for reflection persistence**

Create `tests/evolution-reflection.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistRunReflection } from '../src/evolution/reflection.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-reflection-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('run reflection persistence', () => {
  it('writes reflection json and index lines', async () => {
    const cwd = await createTempDir()

    await persistRunReflection(cwd, {
      runId: 'run-1',
      mode: 'light',
      summary: 'No reusable evolution signal was recorded for this run.',
      signal: 'none',
      proposalIds: [],
      approvalRequired: false,
      evalRunIds: [],
      createdAt: '2026-05-24T00:00:00.000Z'
    })

    await expect(readFile(join(cwd, '.cyrene', 'reflections', 'run-1.json'), 'utf8')).resolves.toContain('"runId": "run-1"')
    await expect(readFile(join(cwd, '.cyrene', 'reflections', 'index.jsonl'), 'utf8')).resolves.toContain('"signal":"none"')
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/evolution-reflection.test.ts`

Expected: fail because reflection module does not exist.

- [ ] **Step 3: Implement reflection persistence**

Create `src/evolution/reflection.ts` with `RunReflection`, `persistRunReflection()`, and safe `runId` validation.

- [ ] **Step 4: Add config fields**

In `src/config.ts`, add:

```ts
export type EvolutionReflectionMode = 'manual' | 'light' | 'off'
```

Add to `AppConfig`:

```ts
evolutionEnabled: boolean
evolutionReflectionMode: EvolutionReflectionMode
```

Parse:

```ts
CYRENE_EVOLUTION_ENABLED=false
CYRENE_EVOLUTION_REFLECTION_MODE=manual|light|off
```

- [ ] **Step 5: Integrate best-effort reflection after final response**

In `src/agent-loop.ts`, after `processMemoryAfterFinal(...)`, call a new helper that writes `signal: 'none'` only when `input.runId` exists, `config.evolutionEnabled` is true, and mode is not `off`.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/evolution-reflection.test.ts tests/config.test.ts tests/agent-loop.test.ts`

Expected: pass.

## Task 6: CLI Commands

**Files:**
- Modify: `src/main.ts`
- Create: `tests/evolution-cli.test.ts`
- Modify: `tests/main-cli.test.ts` if needed

- [ ] **Step 1: Write failing CLI tests**

Create `tests/evolution-cli.test.ts` using `execa` pattern already present in `tests/main-cli.test.ts` or Node `spawn` helper from that file. Cover:

- `cyrene eval --suite memory --json`
- `cyrene evolution list`
- `cyrene evolution inspect <proposalId>`
- `cyrene evolution approve <proposalId>`
- `cyrene evolution reject <proposalId> --reason "..."`

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/evolution-cli.test.ts`

Expected: fail because CLI commands do not exist.

- [ ] **Step 3: Implement `cyrene eval`**

In `src/main.ts`, add a command branch before normal prompt validation:

```ts
if (program.args[0] === 'eval') {
  await handleEvalCommand(options.cwd, program.args.slice(1))
  return
}
```

`handleEvalCommand()` must parse `--suite`, `--json`, and `--proposal` from `args`, call `runEvalHarness()`, print JSON or summary, and set `process.exitCode = 1` when report failed.

- [ ] **Step 4: Implement `cyrene evolution`**

In `src/main.ts`, add:

```ts
if (program.args[0] === 'evolution') {
  await handleEvolutionCommand(options.cwd, program.args.slice(1))
  return
}
```

Support `list`, `inspect`, `approve`, and `reject --reason`.

- [ ] **Step 5: Allow unknown options for eval/evolution**

Generalize the existing memory command argv detector so commander accepts `--suite`, `--json`, and `--reason` after subcommands.

- [ ] **Step 6: Run focused CLI tests**

Run: `npm test -- tests/evolution-cli.test.ts tests/main-cli.test.ts`

Expected: pass.

## Task 7: Full Verification and Commit

**Files:**
- All changed files from prior tasks.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: pass.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: pass.

- [ ] **Step 3: Check git diff**

Run: `git status --short` and `git diff --stat`

Expected: only Phase 5+6 implementation files and tests changed in the implementation worktree.

- [ ] **Step 4: Commit**

```bash
git add src/evals src/evolution src/config.ts src/agent-loop.ts src/main.ts tests/eval-runner.test.ts tests/evolution-proposal-store.test.ts tests/evolution-gate.test.ts tests/evolution-reflection.test.ts tests/evolution-cli.test.ts tests/config.test.ts tests/agent-loop.test.ts
git commit -m "feat: add eval gated evolution v0"
```

Expected: commit succeeds.

## Self-review

- Spec coverage: eval harness, proposal store, gate, approval CLI, reflection persistence, Phase 7 data handoff, and Phase 0-4 contract suites are represented.
- Scope control: no skill system, no code self-modification, no permission/shell policy proposal support, no Web UI panel.
- TDD order: each production task starts with a failing focused test.
- Known implementation choice: post-run reflection v0 writes a deterministic `signal: none` summary when enabled. Proposal generation helpers exist, but automatic model-generated proposal creation can remain behind future explicit enablement.

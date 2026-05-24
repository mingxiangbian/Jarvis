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
    await expect(readFile(join(cwd, '.cyrene', 'evals', 'eval-1', 'results.json'), 'utf8')).resolves.toContain(
      '"evalRunId": "eval-1"'
    )
    await expect(readFile(join(cwd, '.cyrene', 'evals', 'eval-1', 'report.md'), 'utf8')).resolves.toContain(
      '# Cyrene Eval Report'
    )
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
})

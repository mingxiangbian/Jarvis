import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistRunReflection } from '../src/evolution/reflection.js'

describe('persistRunReflection', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cyrene-reflection-'))
    tempDirs.push(dir)
    return dir
  }

  it('writes a run reflection and append-only index entry', async () => {
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

    const reflection = JSON.parse(await readFile(join(cwd, '.cyrene', 'reflections', 'run-1.json'), 'utf8')) as {
      runId: string
      signal: string
    }
    expect(reflection).toMatchObject({ runId: 'run-1', signal: 'none' })

    const index = await readFile(join(cwd, '.cyrene', 'reflections', 'index.jsonl'), 'utf8')
    expect(index.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(index.trim())).toMatchObject({ runId: 'run-1', signal: 'none' })
  })

  it('rejects unsafe run ids', async () => {
    await expect(
      persistRunReflection(await createTempDir(), {
        runId: '../run-1',
        mode: 'light',
        summary: 'unsafe',
        signal: 'none',
        proposalIds: [],
        approvalRequired: false,
        evalRunIds: [],
        createdAt: '2026-05-24T00:00:00.000Z'
      })
    ).rejects.toThrow(/Invalid run id/)
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadTraceMessages, renderTraceReplay } from '../src/tracing/replay.js'
import { createTraceRun } from '../src/tracing/trace-store.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-replay-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('trace replay', () => {
  it('loads messages and renders a readable transcript', async () => {
    const cwd = await createTempDir()
    const store = await createTraceRun({
      cwd,
      runId: 'run-1',
      input: {
        runId: 'run-1',
        mode: 'cli',
        cwd,
        startedAt: '2026-05-23T00:00:00.000Z',
        userMessage: { role: 'user', content: 'hello' }
      }
    })
    await store.appendMessage({ at: '2026-05-23T00:00:00.000Z', message: { role: 'user', content: 'hello' } })
    await store.appendMessage({ at: '2026-05-23T00:00:01.000Z', message: { role: 'assistant', content: 'hi' } })

    await expect(loadTraceMessages(cwd, 'run-1')).resolves.toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ])
    await expect(renderTraceReplay(cwd, 'run-1')).resolves.toBe('user: hello\n\nassistant: hi\n')
  })

  it('rejects missing trace runs', async () => {
    const cwd = await createTempDir()
    await expect(loadTraceMessages(cwd, 'missing')).rejects.toThrow('Trace run not found: missing')
  })
})

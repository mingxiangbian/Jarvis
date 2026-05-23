import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTraceRun, traceRunDir } from '../src/tracing/trace-store.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-trace-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('trace-store', () => {
  it('creates a trace run and appends JSONL files', async () => {
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

    await store.appendMessage({
      at: '2026-05-23T00:00:01.000Z',
      message: { role: 'assistant', content: 'hi' }
    })
    await store.appendModelCall({
      callId: 'model-1',
      at: '2026-05-23T00:00:01.000Z',
      useCase: 'chat',
      messageCount: 2,
      toolCount: 0,
      durationMs: 5,
      ok: true
    })
    await store.appendToolCall({
      toolCallId: 'call-1',
      at: '2026-05-23T00:00:02.000Z',
      name: 'glob',
      inputSummary: 'package.json',
      outputSummary: 'package.json',
      durationMs: 3,
      ok: true
    })
    await store.finalize({
      runId: 'run-1',
      status: 'ok',
      startedAt: '2026-05-23T00:00:00.000Z',
      finishedAt: '2026-05-23T00:00:03.000Z',
      durationMs: 3000,
      modelCallCount: 1,
      toolCallCount: 1,
      errorCount: 0,
      finalTextLength: 2
    }, 'hi')

    const dir = traceRunDir(cwd, 'run-1')
    await expect(readFile(join(dir, 'input.json'), 'utf8')).resolves.toContain('"mode": "cli"')
    await expect(readFile(join(dir, 'messages.jsonl'), 'utf8')).resolves.toContain('"content":"hi"')
    await expect(readFile(join(dir, 'model-calls.jsonl'), 'utf8')).resolves.toContain('"callId":"model-1"')
    await expect(readFile(join(dir, 'tool-calls.jsonl'), 'utf8')).resolves.toContain('"toolCallId":"call-1"')
    await expect(readFile(join(dir, 'final.md'), 'utf8')).resolves.toBe('hi')
    await expect(readFile(join(dir, 'metrics.json'), 'utf8')).resolves.toContain('"status": "ok"')
  })

  it('rejects unsafe run ids', async () => {
    const cwd = await createTempDir()
    await expect(createTraceRun({
      cwd,
      runId: '../escape',
      input: {
        runId: '../escape',
        mode: 'cli',
        cwd,
        startedAt: '2026-05-23T00:00:00.000Z',
        userMessage: { role: 'user', content: 'hello' }
      }
    })).rejects.toThrow('Unsafe trace run id')
  })
})

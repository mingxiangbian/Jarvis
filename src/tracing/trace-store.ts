import { appendFile, mkdir, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import type {
  TraceInput,
  TraceMessageLine,
  TraceMetrics,
  TraceModelCallLine,
  TraceToolCallLine
} from './types.js'

export interface CreateTraceRunInput {
  cwd: string
  runId?: string
  input: TraceInput
}

export interface TraceRunStore {
  runId: string
  dir: string
  appendMessage(line: TraceMessageLine): Promise<void>
  appendModelCall(line: TraceModelCallLine): Promise<void>
  appendToolCall(line: TraceToolCallLine): Promise<void>
  finalize(metrics: TraceMetrics, finalText: string): Promise<void>
}

export async function createTraceRun(input: CreateTraceRunInput): Promise<TraceRunStore> {
  const runId = input.runId ?? randomUUID()
  assertSafeTraceRunId(runId)
  const dir = traceRunDir(input.cwd, runId)
  await ensureTraceDir(input.cwd, dir)
  await writeJson(join(dir, 'input.json'), { ...input.input, runId })

  return {
    runId,
    dir,
    appendMessage: (line) => appendJsonLine(join(dir, 'messages.jsonl'), line),
    appendModelCall: (line) => appendJsonLine(join(dir, 'model-calls.jsonl'), line),
    appendToolCall: (line) => appendJsonLine(join(dir, 'tool-calls.jsonl'), line),
    finalize: async (metrics, finalText) => {
      await writeFile(join(dir, 'final.md'), finalText, 'utf8')
      await writeJson(join(dir, 'metrics.json'), metrics)
    }
  }
}

export function traceRunDir(cwd: string, runId: string): string {
  assertSafeTraceRunId(runId)
  const root = tracesDir(cwd)
  const dir = resolve(root, runId)
  if (dir !== root && !dir.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe trace run id: ${runId}`)
  }
  return dir
}

export function tracesDir(cwd: string): string {
  return resolve(cwd, '.cyrene', 'runs')
}

export function assertSafeTraceRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runId)) {
    throw new Error(`Unsafe trace run id: ${runId}`)
  }
}

async function ensureTraceDir(cwd: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const [cwdRealPath, dirRealPath] = await Promise.all([
    realpath(cwd),
    realpath(dir)
  ])
  if (dirRealPath !== cwdRealPath && !dirRealPath.startsWith(`${cwdRealPath}${sep}`)) {
    throw new Error('Trace directory must stay inside the project.')
  }
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

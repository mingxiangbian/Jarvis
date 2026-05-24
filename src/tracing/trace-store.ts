import { appendFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import type {
  TraceInput,
  TraceMessageLine,
  TraceMetrics,
  TraceModelCallLine,
  TraceToolCallLine
} from './types.js'

const DEFAULT_TRACE_RUN_LIMIT = 100

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

export interface TraceRunSummary extends TraceMetrics {
  mode?: TraceInput['mode']
  sessionId?: string
  workspaceId?: string
  userMessage?: {
    role: 'user'
    contentLength: number
  }
}

export interface TraceRunSummaryDetail {
  input: Omit<TraceInput, 'userMessage'> & {
    userMessage: {
      role: 'user'
      contentLength: number
    }
  }
  metrics: TraceMetrics
  modelCalls: TraceModelCallLine[]
  toolCalls: TraceToolCallLine[]
  messages: Array<{
    at: string
    role: TraceMessageLine['message']['role']
    contentLength: number
  }>
  finalText: string
}

export async function createTraceRun(input: CreateTraceRunInput): Promise<TraceRunStore> {
  const runId = input.runId ?? randomUUID()
  assertSafeTraceRunId(runId)
  const dir = traceRunDir(input.cwd, runId)
  await ensureTraceDir(input.cwd, dir)
  await writeJson(join(dir, 'input.json'), { ...input.input, runId })
  await pruneTraceRuns(input.cwd, runId).catch(() => undefined)

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

export async function listTraceRunSummaries(cwd: string, limit = 25): Promise<TraceRunSummary[]> {
  let entries
  try {
    entries = await readdir(tracesDir(cwd), { withFileTypes: true })
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }

  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      try {
        assertSafeTraceRunId(entry.name)
        return {
          runId: entry.name,
          mtimeMs: (await stat(join(tracesDir(cwd), entry.name))).mtimeMs
        }
      } catch {
        return null
      }
    }))

  const summaries: TraceRunSummary[] = []
  for (const candidate of candidates
    .filter((entry): entry is { runId: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.runId.localeCompare(left.runId))
    .slice(0, Math.max(0, limit))) {
    const detail = await readTraceRunSummary(cwd, candidate.runId)
    if (detail !== null) {
      summaries.push({
        ...detail.metrics,
        mode: detail.input.mode,
        sessionId: detail.input.sessionId,
        workspaceId: detail.input.workspaceId,
        userMessage: detail.input.userMessage
      })
    }
  }
  return summaries
}

export async function readTraceRunSummary(cwd: string, runId: string): Promise<TraceRunSummaryDetail | null> {
  assertSafeTraceRunId(runId)
  const dir = traceRunDir(cwd, runId)
  try {
    const [input, metrics, modelCalls, toolCalls, messages, finalText] = await Promise.all([
      readJson<TraceInput>(join(dir, 'input.json')),
      readJson<TraceMetrics>(join(dir, 'metrics.json')),
      readJsonLines<TraceModelCallLine>(join(dir, 'model-calls.jsonl')),
      readJsonLines<TraceToolCallLine>(join(dir, 'tool-calls.jsonl')),
      readJsonLines<TraceMessageLine>(join(dir, 'messages.jsonl')),
      readText(join(dir, 'final.md'))
    ])
    return {
      input: {
        ...input,
        userMessage: {
          role: input.userMessage.role,
          contentLength: input.userMessage.content.length
        }
      },
      metrics,
      modelCalls,
      toolCalls,
      messages: messages.map((line) => ({
        at: line.at,
        role: line.message.role,
        contentLength: line.message.content.length
      })),
      finalText
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
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

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8').catch((error: unknown) => {
    if (isFileErrorCode(error, 'ENOENT')) {
      return ''
    }
    throw error
  })
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    if (isFileErrorCode(error, 'ENOENT')) {
      return ''
    }
    throw error
  })
}

async function pruneTraceRuns(cwd: string, currentRunId: string): Promise<void> {
  const root = tracesDir(cwd)
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => {
    if (!entry.isDirectory() || entry.name === currentRunId) {
      return false
    }

    try {
      assertSafeTraceRunId(entry.name)
      return true
    } catch {
      return false
    }
  })

  const overflowCount = entries.length + 1 - DEFAULT_TRACE_RUN_LIMIT
  if (overflowCount <= 0) {
    return
  }

  const candidates = await Promise.all(entries.map(async (entry) => ({
    name: entry.name,
    mtimeMs: (await stat(join(root, entry.name))).mtimeMs
  })))
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))

  await Promise.all(
    candidates.slice(0, overflowCount).map((candidate) =>
      rm(join(root, candidate.name), { recursive: true, force: true })
    )
  )
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

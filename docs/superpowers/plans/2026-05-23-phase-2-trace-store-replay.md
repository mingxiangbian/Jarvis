# Phase 2 Trace Store Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Phase 2 trace store：CLI one-shot、REPL turn、Web run 都生成持久 trace，并支持 `cyrene trace replay <runId>` 查看 transcript。

**Architecture:** 新增 `src/tracing/` 作为旁路记录层：`trace-store` 只负责安全文件写入，`run-recorder` 包装 `callModel` 和 `AgentObserver`，`replay` 读取 `messages.jsonl`。`agent-loop` 只补充 `toolCallId` observer 参数，不直接写 trace 文件；CLI、REPL、Web 在调用 `runAgentLoop` 前创建 recorder，在结束后记录 messages delta 和 metrics。

**Tech Stack:** TypeScript, Node.js 20, Vitest, JSONL, existing `AgentObserver`, existing OpenAI-compatible `callModel`.

---

## File Structure

新增：

```txt
src/tracing/types.ts          // trace line/input/metrics 类型
src/tracing/trace-store.ts    // .cyrene/runs/{runId} 安全路径和 JSON/JSONL 写入
src/tracing/run-recorder.ts   // callModel wrapper + observer wrapper + counters/finalize
src/tracing/replay.ts         // 读取 messages.jsonl 并渲染 transcript
tests/trace-store.test.ts
tests/run-recorder.test.ts
tests/replay.test.ts
```

修改：

```txt
src/ui-observer.ts            // AgentObserver tool events 增加 optional toolCallId
src/web/web-observer.ts       // 忽略新增 optional 参数，保持 SSE 不变
src/agent-loop.ts             // observer tool events 传入 toolCall.id
src/main.ts                   // CLI one-shot trace + trace replay command
src/repl.ts                   // 每个 REPL agent turn 创建 trace
src/web/server.ts             // Web run 使用 RunRecord.id 写 trace
tests/main-cli.test.ts
tests/repl.test.ts
tests/web-server.test.ts
```

不改：

```txt
src/session-store.ts          // session resume 语义保持不变
src/models/*                  // Phase 1 router/provider 语义保持不变
src/web/static/*              // 本次不做 Trace 面板
```

---

### Task 1: Trace Store

**Files:**
- Create: `src/tracing/types.ts`
- Create: `src/tracing/trace-store.ts`
- Test: `tests/trace-store.test.ts`

- [x] **Step 1: Write failing trace-store tests**

Create `tests/trace-store.test.ts`:

```ts
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
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/trace-store.test.ts
```

Expected: FAIL because `src/tracing/trace-store.ts` does not exist.

- [x] **Step 3: Add trace types**

Create `src/tracing/types.ts`:

```ts
import type { ChatMessage } from '../llm-client.js'
import type {
  ModelContextInfo,
  ModelProviderName,
  ModelUseCase,
  NormalizedUsage,
  ThinkingMode
} from '../models/types.js'

export type TraceMode = 'cli' | 'repl' | 'web'
export type TraceStatus = 'ok' | 'error'

export interface TraceInput {
  runId: string
  mode: TraceMode
  cwd: string
  workspaceId?: string
  workspacePath?: string
  sessionId?: string
  startedAt: string
  userMessage: {
    role: 'user'
    content: string
  }
  modelContext?: ModelContextInfo
}

export interface TraceMessageLine {
  at: string
  message: ChatMessage
}

export interface TraceModelCallLine {
  callId: string
  at: string
  useCase: ModelUseCase
  provider?: ModelProviderName
  model?: string
  thinkingMode?: ThinkingMode
  messageCount: number
  toolCount: number
  durationMs: number
  ok: boolean
  usage?: NormalizedUsage
  error?: string
}

export interface TraceToolCallLine {
  toolCallId: string
  at: string
  name: string
  inputSummary: string
  outputSummary?: string
  durationMs?: number
  ok?: boolean
  error?: string
}

export interface TraceMetrics {
  runId: string
  status: TraceStatus
  startedAt: string
  finishedAt: string
  durationMs: number
  modelCallCount: number
  toolCallCount: number
  errorCount: number
  finalTextLength: number
}
```

- [x] **Step 4: Implement trace-store**

Create `src/tracing/trace-store.ts`:

```ts
import { appendFile, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
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
```

- [x] **Step 5: Verify trace-store**

Run:

```bash
npm test -- tests/trace-store.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit trace-store**

```bash
git add src/tracing/types.ts src/tracing/trace-store.ts tests/trace-store.test.ts
git commit -m "feat: add trace store"
```

---

### Task 2: Run Recorder and Observer Tool IDs

**Files:**
- Create: `src/tracing/run-recorder.ts`
- Modify: `src/ui-observer.ts`
- Modify: `src/web/web-observer.ts`
- Modify: `src/agent-loop.ts`
- Test: `tests/run-recorder.test.ts`
- Test: `tests/agent-loop.test.ts`

- [x] **Step 1: Write failing recorder tests**

Create `tests/run-recorder.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'
import { createRunRecorder } from '../src/tracing/run-recorder.js'
import { traceRunDir } from '../src/tracing/trace-store.js'
import type { AgentObserver } from '../src/ui-observer.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-run-recorder-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('run-recorder', () => {
  it('records model calls and forwards observer events', async () => {
    const cwd = await createTempDir()
    const events: string[] = []
    const baseObserver: AgentObserver = {
      onThinkingStart: () => events.push('thinking:start'),
      onThinkingStop: () => events.push('thinking:stop'),
      onToolCallStart: (_name, _summary, toolCallId) => events.push(`tool:start:${toolCallId}`),
      onToolCallResult: (_name, ok, _durationMs, _summary, toolCallId) => events.push(`tool:result:${toolCallId}:${ok}`),
      onResponse: (text) => events.push(`response:${text}`)
    }
    const recorder = await createRunRecorder({
      cwd,
      runId: 'run-1',
      mode: 'cli',
      startedAt: new Date('2026-05-23T00:00:00.000Z'),
      userMessage: { role: 'user', content: 'hello' },
      modelContext: {
        provider: 'openai-compatible',
        model: 'test-model',
        thinkingMode: 'auto',
        contextWindowTokens: 256000
      }
    })

    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({
      content: 'ok',
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 2 },
      route: {
        provider: 'openai-compatible',
        model: 'test-model',
        useCase: 'chat',
        thinkingMode: 'auto',
        temperature: 0.7,
        capabilities: {
          contextWindowTokens: 256000,
          supportsToolCalls: true,
          supportsThinking: false,
          supportsReasoningReplay: false
        }
      }
    }))

    await recorder.wrapCallModel(callModel)({
      config: createDefaultConfig(cwd),
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      useCase: 'chat'
    })
    const observer = recorder.createObserver(baseObserver)
    observer.onThinkingStart()
    observer.onThinkingStop(12)
    observer.onToolCallStart('glob', 'package.json', 'call-1')
    observer.onToolCallResult('glob', true, 3, 'package.json', 'call-1')
    observer.onResponse('ok')
    await recorder.recordMessages([{ role: 'assistant', content: 'ok' }])
    await recorder.finalize({ status: 'ok', finalText: 'ok' })

    expect(events).toEqual([
      'thinking:start',
      'thinking:stop',
      'tool:start:call-1',
      'tool:result:call-1:true',
      'response:ok'
    ])
    const dir = traceRunDir(cwd, 'run-1')
    await expect(readFile(join(dir, 'model-calls.jsonl'), 'utf8')).resolves.toContain('"promptTokens":1')
    await expect(readFile(join(dir, 'tool-calls.jsonl'), 'utf8')).resolves.toContain('"toolCallId":"call-1"')
    await expect(readFile(join(dir, 'messages.jsonl'), 'utf8')).resolves.toContain('"content":"ok"')
    await expect(readFile(join(dir, 'metrics.json'), 'utf8')).resolves.toContain('"modelCallCount": 1')
  })

  it('records failed model calls and error metrics', async () => {
    const cwd = await createTempDir()
    const recorder = await createRunRecorder({
      cwd,
      runId: 'run-error',
      mode: 'cli',
      startedAt: new Date('2026-05-23T00:00:00.000Z'),
      userMessage: { role: 'user', content: 'hello' }
    })
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => {
      throw new Error('model failed')
    })

    await expect(recorder.wrapCallModel(callModel)({
      config: createDefaultConfig(cwd),
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      useCase: 'chat'
    })).rejects.toThrow('model failed')
    await recorder.finalize({ status: 'error', finalText: '', error: new Error('model failed') })

    const dir = traceRunDir(cwd, 'run-error')
    await expect(readFile(join(dir, 'model-calls.jsonl'), 'utf8')).resolves.toContain('"ok":false')
    await expect(readFile(join(dir, 'metrics.json'), 'utf8')).resolves.toContain('"status": "error"')
  })
})
```

- [x] **Step 2: Add failing agent-loop observer id test**

In `tests/agent-loop.test.ts`, add a focused test near existing observer/tool tests:

```ts
it('passes tool call ids to observer tool events', async () => {
  const events: string[] = []
  const callModel = vi.fn(async ({ messages }: CallModelInput): Promise<ModelResponse> => {
    const hasToolResult = messages.some((message) => message.role === 'tool')
    if (!hasToolResult) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'call-glob',
            type: 'function',
            function: { name: 'glob', arguments: JSON.stringify({ pattern: 'package.json' }) }
          }
        ]
      }
    }
    return { content: 'done', toolCalls: [] }
  })

  await runAgentLoop({
    config: createDefaultConfig(process.cwd()),
    systemPrompt: 'system',
    userPrompt: 'find package',
    tools: createCoreTools(createDefaultConfig(process.cwd())),
    callModel,
    observer: {
      onThinkingStart: () => {},
      onThinkingStop: () => {},
      onToolCallStart: (_name, _summary, toolCallId) => events.push(`start:${toolCallId}`),
      onToolCallResult: (_name, _ok, _durationMs, _summary, toolCallId) => events.push(`result:${toolCallId}`),
      onResponse: () => {}
    }
  })

  expect(events).toContain('start:call-glob')
  expect(events).toContain('result:call-glob')
})
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/run-recorder.test.ts tests/agent-loop.test.ts
```

Expected: FAIL because `createRunRecorder` does not exist and `AgentObserver` does not expose `toolCallId`.

- [x] **Step 4: Extend AgentObserver tool event signatures**

Modify `src/ui-observer.ts`:

```ts
export interface AgentObserver {
  onThinkingStart(modelContext?: ModelContextInfo): void
  onThinkingStop(durationMs: number): void
  onToolCallStart(name: string, summary: string, toolCallId?: string): void
  onToolCallResult(name: string, ok: boolean, durationMs: number, summary: string, toolCallId?: string): void
  onResponse(text: string): void
}
```

No other terminal observer behavior changes are needed.

- [x] **Step 5: Pass toolCall.id from agent-loop**

Modify `src/agent-loop.ts` where tool observer events fire:

```ts
notifyObserver(() => observer?.onToolCallStart(name, summary, toolCall.id))
```

and:

```ts
observer?.onToolCallResult(
  name,
  result.ok,
  Date.now() - toolStartedAt,
  summarizeToolResult(result.content, result.ok),
  toolCall.id
)
```

- [x] **Step 6: Keep Web observer compatible**

Modify `src/web/web-observer.ts` signatures only:

```ts
onToolCallStart(name: string, summary: string, _toolCallId?: string): void
onToolCallResult(name: string, ok: boolean, durationMs: number, summary: string, _toolCallId?: string): void
```

Do not add `toolCallId` to SSE events in this phase.

- [x] **Step 7: Implement run-recorder**

Create `src/tracing/run-recorder.ts`:

```ts
import type { CallModelInput, ChatMessage, ModelResponse } from '../llm-client.js'
import type { ModelContextInfo } from '../models/types.js'
import type { AgentObserver } from '../ui-observer.js'
import { createTraceRun, type TraceRunStore } from './trace-store.js'
import type { TraceInput, TraceMode, TraceStatus, TraceToolCallLine } from './types.js'

export interface CreateRunRecorderInput {
  cwd: string
  runId?: string
  mode: TraceMode
  startedAt?: Date
  workspaceId?: string
  workspacePath?: string
  sessionId?: string
  userMessage: { role: 'user'; content: string }
  modelContext?: ModelContextInfo
}

export interface FinalizeRunRecorderInput {
  status: TraceStatus
  finalText: string
  error?: unknown
}

interface ToolStart {
  at: string
  name: string
  inputSummary: string
}

export class RunRecorder {
  readonly runId: string
  readonly dir?: string
  readonly warnings: string[] = []
  private readonly startedAt: Date
  private readonly store?: TraceRunStore
  private modelCallCount = 0
  private toolCallCount = 0
  private errorCount = 0
  private readonly toolStarts = new Map<string, ToolStart>()

  constructor(input: { startedAt: Date; store?: TraceRunStore; runId: string }) {
    this.startedAt = input.startedAt
    this.store = input.store
    this.runId = input.runId
    this.dir = input.store?.dir
  }

  wrapCallModel(callModel: (input: CallModelInput) => Promise<ModelResponse>): (input: CallModelInput) => Promise<ModelResponse> {
    return async (input) => {
      const callId = `model-${this.modelCallCount + 1}`
      const startedAt = new Date()
      const startedMs = Date.now()
      try {
        const response = await callModel(input)
        this.modelCallCount += 1
        await this.safeWrite(() => this.store?.appendModelCall({
          callId,
          at: startedAt.toISOString(),
          useCase: input.useCase ?? 'chat',
          provider: response.route?.provider ?? response.providerMetadata?.provider,
          model: response.route?.model ?? response.providerMetadata?.model,
          thinkingMode: response.route?.thinkingMode ?? response.providerMetadata?.thinking?.mode,
          messageCount: input.messages.length,
          toolCount: input.tools.length,
          durationMs: Date.now() - startedMs,
          ok: true,
          usage: response.usage ?? response.providerMetadata?.usage
        }))
        return response
      } catch (error) {
        this.modelCallCount += 1
        this.errorCount += 1
        await this.safeWrite(() => this.store?.appendModelCall({
          callId,
          at: startedAt.toISOString(),
          useCase: input.useCase ?? 'chat',
          messageCount: input.messages.length,
          toolCount: input.tools.length,
          durationMs: Date.now() - startedMs,
          ok: false,
          error: errorMessage(error)
        }))
        throw error
      }
    }
  }

  createObserver(baseObserver?: AgentObserver): AgentObserver {
    return {
      onThinkingStart: (modelContext) => baseObserver?.onThinkingStart(modelContext),
      onThinkingStop: (durationMs) => baseObserver?.onThinkingStop(durationMs),
      onToolCallStart: (name, summary, toolCallId) => {
        if (toolCallId !== undefined) {
          this.toolStarts.set(toolCallId, {
            at: new Date().toISOString(),
            name,
            inputSummary: summary
          })
        }
        baseObserver?.onToolCallStart(name, summary, toolCallId)
      },
      onToolCallResult: (name, ok, durationMs, summary, toolCallId) => {
        this.toolCallCount += 1
        if (!ok) {
          this.errorCount += 1
        }
        const fallbackId = toolCallId ?? `tool-${this.toolCallCount}`
        const started = this.toolStarts.get(fallbackId)
        const line: TraceToolCallLine = {
          toolCallId: fallbackId,
          at: started?.at ?? new Date().toISOString(),
          name: started?.name ?? name,
          inputSummary: started?.inputSummary ?? name,
          outputSummary: summary,
          durationMs,
          ok,
          ...(ok ? {} : { error: summary })
        }
        void this.safeWrite(() => this.store?.appendToolCall(line))
        baseObserver?.onToolCallResult(name, ok, durationMs, summary, toolCallId)
      },
      onResponse: (text) => baseObserver?.onResponse(text)
    }
  }

  async recordMessages(messages: ChatMessage[]): Promise<void> {
    for (const message of messages) {
      if (message.role === 'system') {
        continue
      }
      await this.safeWrite(() => this.store?.appendMessage({
        at: new Date().toISOString(),
        message
      }))
    }
  }

  async finalize(input: FinalizeRunRecorderInput): Promise<void> {
    if (input.status === 'error') {
      this.errorCount += 1
    }
    const finishedAt = new Date()
    await this.safeWrite(() => this.store?.finalize({
      runId: this.runId,
      status: input.status,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      modelCallCount: this.modelCallCount,
      toolCallCount: this.toolCallCount,
      errorCount: this.errorCount,
      finalTextLength: input.finalText.length
    }, input.status === 'ok' ? input.finalText : errorMessage(input.error)))
  }

  private async safeWrite(action: () => Promise<void> | undefined): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.warnings.push(errorMessage(error))
    }
  }
}

export async function createRunRecorder(input: CreateRunRecorderInput): Promise<RunRecorder> {
  const startedAt = input.startedAt ?? new Date()
  const traceInput: TraceInput = {
    runId: input.runId ?? 'pending',
    mode: input.mode,
    cwd: input.cwd,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    ...(input.workspacePath === undefined ? {} : { workspacePath: input.workspacePath }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    startedAt: startedAt.toISOString(),
    userMessage: input.userMessage,
    ...(input.modelContext === undefined ? {} : { modelContext: input.modelContext })
  }

  try {
    const store = await createTraceRun({
      cwd: input.cwd,
      runId: input.runId,
      input: traceInput
    })
    return new RunRecorder({ startedAt, store, runId: store.runId })
  } catch (error) {
    const recorder = new RunRecorder({ startedAt, runId: input.runId ?? 'trace-disabled' })
    recorder.warnings.push(errorMessage(error))
    return recorder
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

- [x] **Step 8: Verify recorder and observer id tests**

Run:

```bash
npm test -- tests/run-recorder.test.ts tests/agent-loop.test.ts
```

Expected: PASS.

- [x] **Step 9: Commit recorder**

```bash
git add src/tracing/run-recorder.ts src/ui-observer.ts src/web/web-observer.ts src/agent-loop.ts tests/run-recorder.test.ts tests/agent-loop.test.ts
git commit -m "feat: record trace model and tool events"
```

---

### Task 3: Replay Reader and CLI Command

**Files:**
- Create: `src/tracing/replay.ts`
- Modify: `src/main.ts`
- Test: `tests/replay.test.ts`
- Test: `tests/main-cli.test.ts`

- [x] **Step 1: Write failing replay tests**

Create `tests/replay.test.ts`:

```ts
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
```

- [x] **Step 2: Add failing CLI replay test**

In `tests/main-cli.test.ts`, add:

```ts
it('creates a trace for one-shot runs and replays it from the CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cyrene-main-trace-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'trace answer' } }] }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Expected TCP server address')
  }

  try {
    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', root, 'hello trace'],
      {
        env: cliEnv({
          CYRENE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          CYRENE_MODEL: 'test-model'
        })
      }
    )
    expect(result.stdout).toBe('trace answer\n')
    const traceLine = result.stderr.split('\n').find((line) => line.startsWith('trace: .cyrene/runs/'))
    expect(traceLine).toBeDefined()
    const runId = traceLine?.split('/').at(-1) ?? ''

    const replay = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', root, 'trace', 'replay', runId],
      { env: cliEnv() }
    )
    expect(replay.stderr).toBe('')
    expect(replay.stdout).toContain('user: hello trace')
    expect(replay.stdout).toContain('assistant: trace answer')
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await rm(root, { recursive: true, force: true })
  }
})
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/replay.test.ts tests/main-cli.test.ts
```

Expected: FAIL because replay helpers and CLI command do not exist.

- [x] **Step 4: Implement replay helpers**

Create `src/tracing/replay.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage } from '../llm-client.js'
import { traceRunDir } from './trace-store.js'

export async function loadTraceMessages(cwd: string, runId: string): Promise<ChatMessage[]> {
  const path = join(traceRunDir(cwd, runId), 'messages.jsonl')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') {
      throw new Error(`Trace run not found: ${runId}`)
    }
    throw error
  }

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => parseTraceMessageLine(line, runId))
}

export async function renderTraceReplay(cwd: string, runId: string): Promise<string> {
  const messages = await loadTraceMessages(cwd, runId)
  return messages
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n') + (messages.length === 0 ? '' : '\n')
}

function parseTraceMessageLine(line: string, runId: string): ChatMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    throw new Error(`Trace run is corrupt: ${runId}`)
  }
  if (!isObject(parsed) || !isObject(parsed.message)) {
    throw new Error(`Trace run is corrupt: ${runId}`)
  }
  const message = parsed.message
  if (
    (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') ||
    typeof message.content !== 'string'
  ) {
    throw new Error(`Trace run is corrupt: ${runId}`)
  }
  return {
    role: message.role,
    content: message.content,
    ...(typeof message.tool_call_id === 'string' ? { tool_call_id: message.tool_call_id } : {}),
    ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls as ChatMessage['tool_calls'] } : {}),
    ...(isObject(message.providerMetadata) ? { providerMetadata: message.providerMetadata as ChatMessage['providerMetadata'] } : {})
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
```

- [x] **Step 5: Add CLI trace replay and one-shot tracing**

Modify `src/main.ts`:

```ts
import { buildInitialMessages } from './context.js'
import { callModel as defaultCallModel } from './llm-client.js'
import { contextInfoForRoute } from './models/provider-router.js'
import { createRunRecorder } from './tracing/run-recorder.js'
import { renderTraceReplay } from './tracing/replay.js'
```

Add command handling after `config doctor` handling:

```ts
if (program.args[0] === 'trace') {
  if (program.args.length !== 3 || program.args[1] !== 'replay') {
    console.error('Usage: cyrene trace replay <runId>')
    process.exit(1)
  }
  console.log(await renderTraceReplay(options.cwd, program.args[2]))
  return
}
```

Change one-shot run to explicit messages + recorder:

```ts
const observer = createTerminalObserver(process.stderr, { spinner: false, responseDivider: false })
const messages = buildInitialMessages(systemPrompt, prompt)
const recorder = await createRunRecorder({
  cwd: config.cwd,
  mode: 'cli',
  userMessage: { role: 'user', content: prompt },
  modelContext: contextInfoForRoute(config, 'chat')
})

try {
  const result = await runAgentLoop({
    config,
    observer: recorder.createObserver(observer),
    messages,
    tools,
    callModel: recorder.wrapCallModel(defaultCallModel)
  })
  await recorder.recordMessages(messages.slice(1))
  await recorder.finalize({ status: 'ok', finalText: result.finalText })
  console.log(result.finalText)
  if (result.toolCallCount > 0) {
    console.error(`tool calls: ${result.toolCallCount}`)
  }
  if (recorder.dir !== undefined) {
    console.error(`trace: .cyrene/runs/${recorder.runId}`)
  }
  await compactDailyIfNeeded({ cwd: config.cwd, config })
} catch (error) {
  await recorder.recordMessages(messages.slice(1))
  await recorder.finalize({ status: 'error', finalText: '', error })
  throw error
}
```

- [x] **Step 6: Verify replay and CLI**

Run:

```bash
npm test -- tests/replay.test.ts tests/main-cli.test.ts
```

Expected: PASS. If existing CLI tests expect empty stderr for successful one-shot runs, update only those one-shot expectations to allow `trace: .cyrene/runs/...`; do not hide the trace line.

- [x] **Step 7: Commit replay and CLI tracing**

```bash
git add src/tracing/replay.ts src/main.ts tests/replay.test.ts tests/main-cli.test.ts
git commit -m "feat: add trace replay command"
```

---

### Task 4: REPL and Web Trace Integration

**Files:**
- Modify: `src/repl.ts`
- Modify: `src/web/server.ts`
- Test: `tests/repl.test.ts`
- Test: `tests/web-server.test.ts`

- [x] **Step 1: Add failing REPL trace test**

In `tests/repl.test.ts`, add:

```ts
it('creates a trace for each agent turn', async () => {
  const root = await createTempDir()
  const config = createDefaultConfig(root)
  const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]

  await runReplTurn({
    config,
    messages,
    input: 'trace this turn',
    tools: [],
    session: { cwd: root },
    callModel: async (): Promise<ModelResponse> => ({ content: 'turn answer', toolCalls: [] })
  })

  const runsDir = join(root, '.cyrene', 'runs')
  const runIds = await readdir(runsDir)
  expect(runIds).toHaveLength(1)
  await expect(readFile(join(runsDir, runIds[0], 'messages.jsonl'), 'utf8')).resolves.toContain('turn answer')
  await expect(readFile(join(runsDir, runIds[0], 'input.json'), 'utf8')).resolves.toContain('"mode": "repl"')
})
```

Add `readdir` to the `node:fs/promises` import.

- [x] **Step 2: Add failing Web trace test**

In `tests/web-server.test.ts`, add near run tests:

```ts
it('creates a persistent trace using the Web run id', async () => {
  const cwd = await createTempCwd()
  const callModel = vi.fn(async (): Promise<ModelResponse> => ({ content: 'web trace answer', toolCalls: [] }))
  const server = await startWebServer({
    cwd,
    host: '127.0.0.1',
    port: 0,
    callModel
  })
  servers.push(server)

  const createResponse = await fetch(`${server.url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'trace web run' })
  })
  const createBody = (await createResponse.json()) as { runId: string }
  await readRunEventStream(`${server.url}/api/runs/${createBody.runId}/events`)

  const traceDir = join(cwd, '.cyrene', 'runs', createBody.runId)
  await expect(readFile(join(traceDir, 'input.json'), 'utf8')).resolves.toContain('"mode": "web"')
  await expect(readFile(join(traceDir, 'messages.jsonl'), 'utf8')).resolves.toContain('web trace answer')
  await expect(readFile(join(traceDir, 'metrics.json'), 'utf8')).resolves.toContain('"status": "ok"')
})
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/repl.test.ts tests/web-server.test.ts
```

Expected: FAIL because REPL/Web do not create traces yet.

- [x] **Step 4: Integrate recorder into REPL turns**

Modify `src/repl.ts` imports:

```ts
import { contextInfoForRoute } from './models/provider-router.js'
import { createRunRecorder } from './tracing/run-recorder.js'
```

In `runReplTurn`, after session creation/update and before `runAgentLoop`:

```ts
const turnStartIndex = input.messages.length - 1
const recorder = await createRunRecorder({
  cwd: input.session?.cwd ?? input.config.cwd,
  mode: 'repl',
  sessionId: input.session?.sessionId,
  userMessage,
  modelContext: contextInfoForRoute(input.config, 'chat')
})
const callModel = recorder.wrapCallModel(input.callModel ?? defaultCallModel)
const observer = recorder.createObserver(input.observer)
```

Pass `callModel` and `observer` into `runAgentLoop`. After success:

```ts
await recorder.recordMessages(input.messages.slice(turnStartIndex))
await recorder.finalize({ status: 'ok', finalText: result.finalText })
```

In the catch path before rethrow:

```ts
await recorder.recordMessages(input.messages.slice(turnStartIndex))
await recorder.finalize({ status: 'error', finalText: '', error })
```

- [x] **Step 5: Integrate recorder into Web runs**

Modify `src/web/server.ts` imports:

```ts
import { callModel as defaultCallModel } from '../llm-client.js'
import { createRunRecorder } from '../tracing/run-recorder.js'
```

In `runWebAgent`, after runtime and `persistedStartIndex`:

```ts
const recorder = await createRunRecorder({
  cwd: record.cwd,
  runId: record.id,
  mode: 'web',
  workspaceId: record.workspace.id,
  workspacePath: record.workspace.absolutePath,
  sessionId: record.sessionId,
  userMessage: record.userMessage,
  modelContext: record.modelContext
})
const baseCallModel = callModel ?? defaultCallModel
```

Pass wrapped values into `runAgentLoop`:

```ts
observer: recorder.createObserver(createWebObserver((event) => {
  if (event.type !== 'final') {
    emit(record, event)
  }
})),
callModel: recorder.wrapCallModel(baseCallModel)
```

After `appendRunModelMessages(...)`:

```ts
await recorder.recordMessages(modelMessages.slice(persistedStartIndex))
await recorder.finalize({ status: 'ok', finalText: result.finalText })
```

In the catch path, create/finalize should not throw. If recorder creation itself is inside try, keep a `let recorder` variable and finalize when available:

```ts
await recorder?.recordMessages(modelMessages.slice(persistedStartIndex)).catch(() => {})
await recorder?.finalize({ status: 'error', finalText: '', error }).catch(() => {})
```

- [x] **Step 6: Verify REPL/Web**

Run:

```bash
npm test -- tests/repl.test.ts tests/web-server.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit REPL/Web integration**

```bash
git add src/repl.ts src/web/server.ts tests/repl.test.ts tests/web-server.test.ts
git commit -m "feat: trace repl and web runs"
```

---

### Task 5: Full Verification and Plan Cleanup

**Files:**
- Modify: `docs/superpowers/plans/2026-05-23-phase-2-trace-store-replay.md`

- [x] **Step 1: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [x] **Step 3: Run CLI replay smoke test**

Run the CLI trace test directly:

```bash
npm test -- tests/main-cli.test.ts
```

Expected: PASS. The `creates a trace for one-shot runs and replays it from the CLI` test proves the command path.

- [x] **Step 4: Mark completed plan checkboxes**

Update this plan file from `- [ ]` to `- [x]` only for completed steps.

- [x] **Step 5: Commit final plan status if changed**

```bash
git add docs/superpowers/plans/2026-05-23-phase-2-trace-store-replay.md
git commit -m "docs: update phase 2 trace execution plan"
```

---

## Self-Review

- Spec coverage: plan covers persistent run IDs, `.cyrene/runs/{runId}` files, model call metadata, tool call summaries with `toolCallId`, transcript replay, and CLI/REPL/Web integration.
- Scope: plan excludes Web Trace panel, deterministic replay, raw request/response persistence, tool re-execution, eval, typed memory, affect, and evolution.
- Placeholder scan: no placeholder markers or unspecified “add tests” steps remain.
- Type consistency: `TraceInput`, `TraceMessageLine`, `TraceModelCallLine`, `TraceToolCallLine`, and `TraceMetrics` names match the implementation steps.

# Web Prism Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cc-local --web`, a local browser console with real agent runs, SSE status events, Prism glass styling, resizable left sidebar, center chat, and manually opened right inspector.

**Architecture:** Add a focused `src/web/` boundary around a framework-free Node HTTP server, Web observer, and static assets. The server reuses existing config/memory/tool loading and `runAgentLoop`, while browser state stays in the current page session. The frontend is plain HTML/CSS/JS organized so it can be replaced by React/Vite in a future phase.

**Tech Stack:** TypeScript, Node.js `http`, built-in `crypto.randomUUID`, Vitest, existing `runAgentLoop`, existing `AgentObserver`, plain HTML/CSS/JS, Server-Sent Events.

---

## Spec Reference

Design spec: `docs/superpowers/specs/2026-05-18-web-prism-console-design.md`

## File Structure

- Create `src/web/prompt-context.ts`
  - Loads the system prompt, persona, rules, memories, daily memory, config, and core tools for a workspace.
  - Keeps CLI and Web prompt setup consistent.

- Modify `src/main.ts`
  - Uses `buildAgentRuntime()` from `src/web/prompt-context.ts`.
  - Adds `--web`, `--host`, and `--port`.
  - Preserves existing one-shot and REPL behavior.

- Create `src/web/web-observer.ts`
  - Defines browser event types.
  - Implements `AgentObserver`.
  - Sends thinking/tool/final events through an event sink.

- Create `src/web/server.ts`
  - Starts the local HTTP server.
  - Serves static frontend files.
  - Handles `POST /api/runs`.
  - Handles `GET /api/runs/:runId/events` as SSE.
  - Owns in-memory run records.

- Create `src/web/static/index.html`
  - App shell only.

- Create `src/web/static/styles.css`
  - Prism glass visual system and layout.

- Create `src/web/static/app.js`
  - Current-page chat state.
  - Run creation.
  - SSE subscription.
  - Tool timeline rendering.
  - Sidebar/inspector resizing and manual inspector toggle.

- Create `tests/web-prompt-context.test.ts`
  - Verifies Web prompt context matches existing CLI prompt composition behavior.

- Create `tests/web-observer.test.ts`
  - Verifies observer events.

- Create `tests/web-server.test.ts`
  - Verifies static serving, API validation, run creation, and SSE behavior with a fake model.

- Modify `tests/main-cli.test.ts`
  - Verifies `--web` mode dispatch and mode conflicts.

---

### Task 1: Extract Shared Agent Runtime Context

**Files:**
- Create: `src/web/prompt-context.ts`
- Modify: `src/main.ts`
- Create: `tests/web-prompt-context.test.ts`
- Modify: `tests/main-cli.test.ts`

- [ ] **Step 1: Write failing tests for shared runtime prompt loading**

Create `tests/web-prompt-context.test.ts`:

```typescript
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAgentRuntime } from '../src/web/prompt-context.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-web-context-'))
  tempDirs.push(dir)
  return dir
}

describe('buildAgentRuntime', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('builds the same runtime pieces needed by CLI and Web modes', async () => {
    const home = await createTempDir()
    const root = join(home, 'workspace', 'project')
    const userCcLocalDir = join(home, '.cc-local')
    await mkdir(join(root, '.cc-local', 'memory'), { recursive: true })
    await mkdir(join(userCcLocalDir, 'memory'), { recursive: true })
    await writeFile(join(userCcLocalDir, 'soul.md'), 'Be precise.\n')
    await writeFile(join(userCcLocalDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(root, '.cc-local', 'Rule.md'), 'Project rule.\n')
    await writeFile(join(root, '.cc-local', 'instructions.md'), 'Use small patches.\n')
    await writeFile(join(root, '.cc-local', 'memory', 'MEMORY.md'), '- [Local](local.md) - local\n')
    await writeFile(join(root, '.cc-local', 'memory', 'local.md'), 'Local memory.\n')
    await writeFile(join(root, '.cc-local', 'memory', 'daily.md'), 'recent one\nrecent two\n')

    const runtime = await buildAgentRuntime(root)

    expect(runtime.config.cwd).toBe(root)
    expect(runtime.systemPrompt).toContain('Be precise.')
    expect(runtime.systemPrompt).toContain('Global rule.')
    expect(runtime.systemPrompt).toContain('Project rule.')
    expect(runtime.systemPrompt).toContain('Use small patches.')
    expect(runtime.systemPrompt).toContain('Local memory.')
    expect(runtime.systemPrompt).toContain('recent one\nrecent two')
    expect(runtime.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['file_read', 'file_write', 'file_edit', 'grep', 'glob', 'bash', 'ask_user'])
    )
  })
})
```

- [ ] **Step 2: Run the new runtime test and verify it fails**

Run:

```bash
npm test -- tests/web-prompt-context.test.ts
```

Expected: FAIL because `src/web/prompt-context.ts` does not exist.

- [ ] **Step 3: Implement `buildAgentRuntime()`**

Create `src/web/prompt-context.ts`:

```typescript
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultConfig, type AppConfig } from '../config.js'
import {
  loadDaily,
  loadGlobalMemories,
  loadInstructionsIfExists,
  loadProjectMemories,
  loadRuleStack,
  loadSoul
} from '../memory.js'
import { createCoreTools } from '../tools/index.js'
import type { Tool } from '../tools/types.js'

export interface AgentRuntime {
  config: AppConfig
  systemPrompt: string
  tools: Tool<unknown>[]
}

export async function buildAgentRuntime(cwd: string, currentDate = new Date()): Promise<AgentRuntime> {
  const currentFile = fileURLToPath(import.meta.url)
  const systemPromptPath = resolve(dirname(currentFile), '..', 'prompts', 'system.md')
  const config = createDefaultConfig(resolve(cwd))
  const baseSystemPrompt = await readFile(systemPromptPath, 'utf8')
  const dateText = currentDate.toISOString().slice(0, 10)
  const persona = await loadSoul(config.userCcLocalDir)
  const rules = await loadRuleStack(config.cwd, config.userCcLocalDir)
  const projectInstructions = await loadInstructionsIfExists(config.cwd)
  const projectMemories = await loadProjectMemories(config.cwd)
  const globalMemories = await loadGlobalMemories(config.userCcLocalDir)
  const daily = await loadDaily(config.cwd, config.dailyLoadLines)
  const systemPrompt = [
    baseSystemPrompt.trimEnd(),
    `# currentDate\nToday's date is ${dateText}.`,
    persona,
    rules,
    projectInstructions,
    projectMemories,
    globalMemories,
    daily
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    config,
    systemPrompt,
    tools: createCoreTools()
  }
}
```

- [ ] **Step 4: Refactor `src/main.ts` to use `buildAgentRuntime()`**

Replace the direct prompt/memory loading imports and runtime construction in `src/main.ts`.

The imports at the top should become:

```typescript
#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { runAgentLoop } from './agent-loop.js'
import { runRepl } from './repl.js'
import { createTerminalObserver } from './ui-observer.js'
import { buildAgentRuntime } from './web/prompt-context.js'
```

Inside `main()`, replace the block that reads `systemPromptPath`, creates config, loads memory, and creates tools with:

```typescript
  const runtime = await buildAgentRuntime(options.cwd)
  const { config, systemPrompt, tools } = runtime
```

Keep the existing REPL and one-shot branches unchanged after they receive `config`, `systemPrompt`, and `tools`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/web-prompt-context.test.ts tests/main-cli.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/web/prompt-context.ts src/main.ts tests/web-prompt-context.test.ts tests/main-cli.test.ts
git commit -m "refactor: share agent runtime setup"
```

---

### Task 2: Add Web Observer Events

**Files:**
- Create: `src/web/web-observer.ts`
- Create: `tests/web-observer.test.ts`

- [ ] **Step 1: Write failing observer tests**

Create `tests/web-observer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { createWebObserver, type WebRunEvent } from '../src/web/web-observer.js'

describe('createWebObserver', () => {
  it('emits thinking, tool, and final events in browser-friendly shape', () => {
    const events: WebRunEvent[] = []
    const observer = createWebObserver((event) => events.push(event))

    observer.onThinkingStart()
    observer.onThinkingStop(125)
    observer.onToolCallStart('glob', 'src/**/*.ts')
    observer.onToolCallResult('glob', true, 42, 'src/**/*.ts')
    observer.onResponse('final answer')

    expect(events).toEqual([
      { type: 'thinking_start' },
      { type: 'thinking_stop', durationMs: 125 },
      { type: 'tool_start', name: 'glob', summary: 'src/**/*.ts' },
      { type: 'tool_result', name: 'glob', ok: true, durationMs: 42, summary: 'src/**/*.ts' },
      { type: 'final', text: 'final answer' }
    ])
  })

  it('emits failed tool results with summaries', () => {
    const events: WebRunEvent[] = []
    const observer = createWebObserver((event) => events.push(event))

    observer.onToolCallResult('bash', false, 9, 'exit code 1')

    expect(events).toEqual([{ type: 'tool_result', name: 'bash', ok: false, durationMs: 9, summary: 'exit code 1' }])
  })
})
```

- [ ] **Step 2: Run observer tests and verify they fail**

Run:

```bash
npm test -- tests/web-observer.test.ts
```

Expected: FAIL because `src/web/web-observer.ts` does not exist.

- [ ] **Step 3: Implement the Web observer**

Create `src/web/web-observer.ts`:

```typescript
import type { AgentObserver } from '../ui-observer.js'

export type WebRunEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_stop'; durationMs: number }
  | { type: 'tool_start'; name: string; summary: string }
  | { type: 'tool_result'; name: string; ok: boolean; durationMs: number; summary: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

export type WebEventSink = (event: WebRunEvent) => void

export function createWebObserver(emit: WebEventSink): AgentObserver {
  return {
    onThinkingStart(): void {
      emit({ type: 'thinking_start' })
    },
    onThinkingStop(durationMs: number): void {
      emit({ type: 'thinking_stop', durationMs })
    },
    onToolCallStart(name: string, summary: string): void {
      emit({ type: 'tool_start', name, summary })
    },
    onToolCallResult(name: string, ok: boolean, durationMs: number, summary: string): void {
      emit({ type: 'tool_result', name, ok, durationMs, summary })
    },
    onResponse(text: string): void {
      emit({ type: 'final', text })
    }
  }
}

export function errorEvent(error: unknown): WebRunEvent {
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  }
}
```

- [ ] **Step 4: Run observer tests and typecheck**

Run:

```bash
npm test -- tests/web-observer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/web/web-observer.ts tests/web-observer.test.ts
git commit -m "feat: add web observer events"
```

---

### Task 3: Implement Web Server Core and SSE Runs

**Files:**
- Create: `src/web/server.ts`
- Create: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing tests for static serving and run SSE**

Create `tests/web-server.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'

let handles: WebServerHandle[] = []

async function startTestServer(callModel: (input: CallModelInput) => Promise<ModelResponse>): Promise<WebServerHandle> {
  const handle = await startWebServer({
    cwd: process.cwd(),
    host: '127.0.0.1',
    port: 0,
    callModel
  })
  handles.push(handle)
  return handle
}

async function readSse(url: string): Promise<string[]> {
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('Expected SSE body')

  const chunks: string[] = []
  const decoder = new TextDecoder()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value, { stream: true }))
    if (chunks.join('').includes('"type":"final"')) {
      await reader.cancel()
      break
    }
  }
  return chunks
}

describe('web server', () => {
  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()))
  })

  it('serves the static Web shell', async () => {
    const handle = await startTestServer(async (): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))

    const response = await fetch(`${handle.url}/`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('Prism Console')
    expect(html).toContain('app.js')
    expect(html).toContain('styles.css')
  })

  it('rejects invalid run requests', async () => {
    const handle = await startTestServer(async (): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))

    const response = await fetch(`${handle.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'At least one user message is required.' })
  })

  it('creates a run and streams thinking plus final events', async () => {
    const callModel = vi.fn(async (): Promise<ModelResponse> => ({ content: 'web answer', toolCalls: [] }))
    const handle = await startTestServer(callModel)

    const runResponse = await fetch(`${handle.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello web' }] })
    })
    const body = (await runResponse.json()) as { runId: string }
    const chunks = await readSse(`${handle.url}/api/runs/${body.runId}/events`)
    const stream = chunks.join('')

    expect(runResponse.status).toBe(202)
    expect(body.runId).toMatch(/^[0-9a-f-]+$/)
    expect(stream).toContain('event: message')
    expect(stream).toContain('"type":"thinking_start"')
    expect(stream).toContain('"type":"final","text":"web answer"')
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for unknown run event streams', async () => {
    const handle = await startTestServer(async (): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))

    const response = await fetch(`${handle.url}/api/runs/missing/events`)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Run not found.' })
  })
})
```

- [ ] **Step 2: Run server tests and verify they fail**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: FAIL because `src/web/server.ts` and static files do not exist.

- [ ] **Step 3: Implement minimal static files required by the server tests**

Create `src/web/static/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Prism Console</title>
    <link rel="stylesheet" href="/static/styles.css">
  </head>
  <body>
    <div id="app" class="app-shell">
      <aside id="sidebar" class="sidebar">
        <div class="brand-mark"></div>
        <div>
          <h1>Prism Console</h1>
          <p id="workspaceLabel">Local workspace</p>
        </div>
      </aside>
      <main class="chat-shell">
        <section id="messages" class="messages" aria-live="polite"></section>
        <form id="composer" class="composer">
          <textarea id="promptInput" rows="2" placeholder="Ask cc-local..."></textarea>
          <button id="sendButton" type="submit">Send</button>
        </form>
      </main>
      <button id="inspectorToggle" class="inspector-toggle" type="button" aria-expanded="false">Inspector</button>
      <aside id="inspector" class="inspector" hidden>
        <div class="tabs">
          <button type="button" data-tab="context">Context</button>
          <button type="button" data-tab="tools">Tools</button>
          <button type="button" data-tab="memory">Memory</button>
        </div>
        <div id="inspectorContent"></div>
      </aside>
    </div>
    <script src="/static/app.js" type="module"></script>
  </body>
</html>
```

Create `src/web/static/styles.css`:

```css
:root {
  color-scheme: light;
  --fog: #f8fbff;
  --ice: #eaf7ff;
  --cyan: #86e6f1;
  --pink: #f7a8cf;
  --violet: #d8b7ff;
  --glass: rgba(255, 255, 255, 0.62);
  --ink: #2f3545;
  --muted: #6f7a90;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 18% 12%, rgba(247, 168, 207, 0.34), transparent 28%),
    radial-gradient(circle at 82% 6%, rgba(134, 230, 241, 0.32), transparent 30%),
    linear-gradient(135deg, var(--fog), var(--ice) 52%, #fff4fb);
}

button,
textarea {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr auto;
  gap: 14px;
  padding: 18px;
}

.sidebar,
.chat-shell,
.inspector {
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 22px;
  background: var(--glass);
  box-shadow: 0 22px 54px rgba(135, 176, 210, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(18px);
}

.sidebar {
  min-width: 180px;
  resize: horizontal;
  overflow: auto;
  padding: 16px;
}

.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 15px;
  background: linear-gradient(135deg, var(--pink), var(--cyan));
  box-shadow: 0 12px 28px rgba(247, 168, 207, 0.26);
}

.sidebar h1 {
  margin: 12px 0 4px;
  font-size: 18px;
}

.sidebar p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.chat-shell {
  min-width: 320px;
  display: grid;
  grid-template-rows: 1fr auto;
  gap: 14px;
  padding: 18px;
}

.messages {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}

.composer textarea {
  width: 100%;
  resize: vertical;
  border: 0;
  border-radius: 16px;
  padding: 12px 14px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92), 0 12px 28px rgba(135, 176, 210, 0.14);
}

.composer button,
.inspector-toggle,
.tabs button {
  border: 0;
  border-radius: 14px;
  padding: 10px 14px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 12px 28px rgba(135, 176, 210, 0.14);
  cursor: pointer;
}

.inspector-toggle {
  writing-mode: vertical-rl;
  align-self: start;
}

.inspector {
  width: 320px;
  resize: horizontal;
  overflow: auto;
  padding: 16px;
}

.inspector[hidden] {
  display: none;
}
```

Create `src/web/static/app.js`:

```javascript
const messages = document.querySelector('#messages')
const composer = document.querySelector('#composer')
const promptInput = document.querySelector('#promptInput')
const sendButton = document.querySelector('#sendButton')
const inspector = document.querySelector('#inspector')
const inspectorToggle = document.querySelector('#inspectorToggle')
const inspectorContent = document.querySelector('#inspectorContent')

const state = {
  messages: [],
  activeRun: null,
  tools: []
}

function appendMessage(role, text) {
  state.messages.push({ role, content: text })
  const item = document.createElement('article')
  item.className = `message message-${role}`
  item.textContent = text
  messages.append(item)
  messages.scrollTop = messages.scrollHeight
}

function appendStatus(text) {
  const item = document.createElement('article')
  item.className = 'message message-status'
  item.textContent = text
  messages.append(item)
  messages.scrollTop = messages.scrollHeight
  return item
}

function renderInspector() {
  inspectorContent.innerHTML = ''
  const list = document.createElement('div')
  list.className = 'tool-list'
  for (const tool of state.tools) {
    const row = document.createElement('div')
    row.className = `tool-row ${tool.ok === false ? 'tool-row-error' : ''}`
    row.textContent = `${tool.name}: ${tool.summary}${tool.durationMs === undefined ? '' : ` (${tool.durationMs}ms)`}`
    list.append(row)
  }
  inspectorContent.append(list)
}

function handleRunEvent(event, statusNode) {
  if (event.type === 'thinking_start') {
    statusNode.textContent = 'Thinking...'
  }
  if (event.type === 'tool_start') {
    state.tools.push({ name: event.name, summary: event.summary })
    statusNode.textContent = `${event.name} · ${event.summary}`
    renderInspector()
  }
  if (event.type === 'tool_result') {
    const tool = [...state.tools].reverse().find((entry) => entry.name === event.name && entry.durationMs === undefined)
    if (tool) {
      tool.ok = event.ok
      tool.durationMs = event.durationMs
      tool.summary = event.summary
    }
    statusNode.textContent = `${event.name} ${event.ok ? 'finished' : 'failed'}`
    renderInspector()
  }
  if (event.type === 'final') {
    statusNode.remove()
    appendMessage('assistant', event.text)
    state.activeRun = null
    sendButton.disabled = false
  }
  if (event.type === 'error') {
    statusNode.textContent = event.message
    state.activeRun = null
    sendButton.disabled = false
  }
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault()
  const prompt = promptInput.value.trim()
  if (!prompt || state.activeRun !== null) return

  promptInput.value = ''
  appendMessage('user', prompt)
  sendButton.disabled = true
  const statusNode = appendStatus('Starting...')

  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: state.messages })
  })

  if (!response.ok) {
    const body = await response.json()
    statusNode.textContent = body.error || 'Run failed.'
    sendButton.disabled = false
    return
  }

  const body = await response.json()
  state.activeRun = body.runId
  const events = new EventSource(`/api/runs/${body.runId}/events`)
  events.addEventListener('message', (message) => {
    const runEvent = JSON.parse(message.data)
    handleRunEvent(runEvent, statusNode)
    if (runEvent.type === 'final' || runEvent.type === 'error') {
      events.close()
    }
  })
})

inspectorToggle.addEventListener('click', () => {
  const isHidden = inspector.hidden
  inspector.hidden = !isHidden
  inspectorToggle.setAttribute('aria-expanded', String(isHidden))
})
```

- [ ] **Step 4: Implement `src/web/server.ts`**

Create `src/web/server.ts`:

```typescript
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAgentLoop } from '../agent-loop.js'
import type { ChatMessage, ModelResponse } from '../llm-client.js'
import { createWebObserver, errorEvent, type WebRunEvent } from './web-observer.js'
import { buildAgentRuntime } from './prompt-context.js'

type CallModel = (input: {
  config: Awaited<ReturnType<typeof buildAgentRuntime>>['config']
  messages: ChatMessage[]
  tools: unknown[]
}) => Promise<ModelResponse>

interface StartWebServerInput {
  cwd: string
  host: string
  port: number
  callModel?: CallModel
}

export interface WebServerHandle {
  url: string
  close(): Promise<void>
}

interface RunRecord {
  id: string
  events: WebRunEvent[]
  clients: Set<ServerResponse>
  done: boolean
}

const staticDir = fileURLToPath(new URL('./static/', import.meta.url))

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? {} : JSON.parse(text)
}

function isUserMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { role?: unknown; content?: unknown }
  return message.role === 'user' && typeof message.content === 'string' && message.content.trim().length > 0
}

function validateMessages(value: unknown): ChatMessage[] | string {
  if (!Array.isArray(value)) return 'Messages must be an array.'
  if (!value.some(isUserMessage)) return 'At least one user message is required.'
  const messages: ChatMessage[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return 'Each message must be an object.'
    const message = entry as { role?: unknown; content?: unknown; tool_call_id?: unknown }
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') {
      return 'Message role must be system, user, assistant, or tool.'
    }
    if (typeof message.content !== 'string') return 'Message content must be a string.'
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string') return 'Tool messages must include tool_call_id.'
      messages.push({ role: 'tool', content: message.content, tool_call_id: message.tool_call_id })
    } else {
      messages.push({ role: message.role, content: message.content })
    }
  }
  return messages
}

function writeSse(response: ServerResponse, event: WebRunEvent): void {
  response.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`)
}

function emit(record: RunRecord, event: WebRunEvent): void {
  record.events.push(event)
  for (const client of record.clients) {
    writeSse(client, event)
  }
  if (event.type === 'final' || event.type === 'error') {
    record.done = true
    for (const client of record.clients) {
      client.end()
    }
    record.clients.clear()
  }
}

function contentType(pathname: string): string {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  return 'application/octet-stream'
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/static\//, '')
  const normalized = normalize(relativePath)
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }
  const filePath = join(staticDir, normalized)
  try {
    await readFile(filePath)
  } catch {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }
  response.writeHead(200, { 'content-type': contentType(filePath) })
  createReadStream(filePath).pipe(response)
}

export async function startWebServer(input: StartWebServerInput): Promise<WebServerHandle> {
  const runtime = await buildAgentRuntime(input.cwd)
  const runs = new Map<string, RunRecord>()

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${input.host}:${input.port}`)

    try {
      if (request.method === 'GET' && url.pathname === '/') {
        await serveStatic('/', response)
        return
      }

      if (request.method === 'GET' && url.pathname.startsWith('/static/')) {
        await serveStatic(url.pathname, response)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const body = (await readJson(request)) as { messages?: unknown }
        const messages = validateMessages(body.messages)
        if (typeof messages === 'string') {
          sendJson(response, 400, { error: messages })
          return
        }

        const id = randomUUID()
        const record: RunRecord = { id, events: [], clients: new Set(), done: false }
        runs.set(id, record)
        sendJson(response, 202, { runId: id })

        void runAgentLoop({
          config: runtime.config,
          messages,
          tools: runtime.tools,
          observer: createWebObserver((event) => emit(record, event)),
          callModel: input.callModel
        })
          .then((result) => {
            if (!record.done) emit(record, { type: 'final', text: result.finalText })
          })
          .catch((error: unknown) => {
            if (!record.done) emit(record, errorEvent(error))
          })
        return
      }

      const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
      if (request.method === 'GET' && eventMatch !== null) {
        const record = runs.get(eventMatch[1])
        if (record === undefined) {
          sendJson(response, 404, { error: 'Run not found.' })
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        })
        for (const event of record.events) {
          writeSse(response, event)
        }
        if (record.done) {
          response.end()
          return
        }
        record.clients.add(response)
        request.on('close', () => {
          record.clients.delete(response)
        })
        return
      }

      sendJson(response, 404, { error: 'Not found.' })
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Expected TCP server address.')
  }

  return {
    url: `http://${input.host}:${address.port}`,
    close: () => closeServer(server)
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
```

- [ ] **Step 5: Run server tests and typecheck**

Run:

```bash
npm test -- tests/web-server.test.ts tests/web-observer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/web/server.ts src/web/static/index.html src/web/static/styles.css src/web/static/app.js tests/web-server.test.ts
git commit -m "feat: add local web server"
```

---

### Task 4: Wire `cc-local --web`

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/main-cli.test.ts`

- [ ] **Step 1: Add failing CLI tests for Web mode conflicts and startup**

Append these tests inside `describe('main CLI', ...)` in `tests/main-cli.test.ts`:

```typescript
  it('rejects --web with a one-shot prompt', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', 'hello'])
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('--web cannot be combined with a prompt.')
    }
  })

  it('rejects --web with --repl', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', '--repl'])
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('--web cannot be combined with --repl.')
    }
  })
```

Add a startup test using a child process so the server can stay alive until the test kills it:

```typescript
  it('starts the Web server and prints the local URL', async () => {
    const child = execFile(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', '--port', '0'], {
      env: cliEnv({
        CC_LOCAL_BASE_URL: 'http://127.0.0.1:1/v1'
      })
    })
    const stdoutChunks: string[] = []
    child.stdout?.on('data', (chunk) => stdoutChunks.push(String(chunk)))

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for web startup')), 5000)
        child.stdout?.on('data', () => {
          if (stdoutChunks.join('').includes('cc-local web listening at http://127.0.0.1:')) {
            clearTimeout(timeout)
            resolve()
          }
        })
        child.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.once('exit', (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Web process exited early with code ${code}`))
          }
        })
      })
      expect(stdoutChunks.join('')).toContain('cc-local web listening at http://127.0.0.1:')
    } finally {
      child.kill()
    }
  })
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```bash
npm test -- tests/main-cli.test.ts
```

Expected: FAIL because `--web`, `--host`, and `--port` are not wired.

- [ ] **Step 3: Modify `src/main.ts`**

Update imports:

```typescript
#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { runAgentLoop } from './agent-loop.js'
import { runRepl } from './repl.js'
import { createTerminalObserver } from './ui-observer.js'
import { buildAgentRuntime } from './web/prompt-context.js'
import { startWebServer } from './web/server.js'
```

Add options:

```typescript
    .option('--repl', 'start an interactive session')
    .option('--web', 'start the local Web console')
    .option('--host <host>', 'host for --web', '127.0.0.1')
    .option('--port <port>', 'port for --web', '4317')
```

Use this options type:

```typescript
  const options = program.opts<{ cwd: string; repl?: boolean; web?: boolean; host: string; port: string }>()
```

Replace the initial prompt validation with:

```typescript
  if (options.web && options.repl) {
    console.error('--web cannot be combined with --repl.')
    process.exit(1)
  }
  if (options.web && prompt) {
    console.error('--web cannot be combined with a prompt.')
    process.exit(1)
  }
  if (!options.repl && !options.web && !prompt) {
    console.error('Prompt cannot be empty.')
    process.exit(1)
  }
```

After building runtime, add the Web branch before REPL:

```typescript
  if (options.web) {
    const port = Number.parseInt(options.port, 10)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error('--port must be an integer from 0 to 65535.')
      process.exit(1)
    }
    const server = await startWebServer({
      cwd: config.cwd,
      host: options.host,
      port
    })
    console.log(`cc-local web listening at ${server.url}`)
    await new Promise(() => {})
  }
```

- [ ] **Step 4: Run CLI and server tests**

Run:

```bash
npm test -- tests/main-cli.test.ts tests/web-server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/main.ts tests/main-cli.test.ts
git commit -m "feat: add web mode entrypoint"
```

---

### Task 5: Build Prism Layout and Client Run UX

**Files:**
- Modify: `src/web/static/index.html`
- Modify: `src/web/static/styles.css`
- Modify: `src/web/static/app.js`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add static shell assertions for required layout hooks**

Extend the static serving test in `tests/web-server.test.ts`:

```typescript
    expect(html).toContain('id="sidebar"')
    expect(html).toContain('id="messages"')
    expect(html).toContain('id="inspector"')
    expect(html).toContain('id="inspectorToggle"')
    expect(html).toContain('id="leftResizeHandle"')
```

Add CSS asset assertions:

```typescript
  it('serves Prism styles with glass surfaces and resizable layout hooks', async () => {
    const handle = await startTestServer(async (): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))

    const response = await fetch(`${handle.url}/static/styles.css`)
    const css = await response.text()

    expect(response.status).toBe(200)
    expect(css).toContain('--pink: #f7a8cf')
    expect(css).toContain('backdrop-filter')
    expect(css).toContain('.left-resize-handle')
    expect(css).toContain('.inspector.is-open')
  })
```

- [ ] **Step 2: Run server tests and verify they fail**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: FAIL because the static shell lacks the full layout hooks and CSS classes.

- [ ] **Step 3: Replace `index.html` with the first usable Prism Console shell**

Update `src/web/static/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Prism Console</title>
    <link rel="stylesheet" href="/static/styles.css">
  </head>
  <body>
    <div class="ambient ambient-pink"></div>
    <div class="ambient ambient-cyan"></div>
    <div id="app" class="app-shell">
      <aside id="sidebar" class="sidebar glass-panel">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div>
            <h1>Prism Console</h1>
            <p id="workspaceLabel">Local workspace</p>
          </div>
        </div>
        <nav class="nav-list" aria-label="Console sections">
          <button class="nav-item is-active" type="button">Chat</button>
          <button class="nav-item" type="button">Runs</button>
          <button class="nav-item" type="button">Model</button>
        </nav>
        <section class="sidebar-card">
          <h2>Current Model</h2>
          <p>Qwen local endpoint</p>
        </section>
      </aside>
      <div id="leftResizeHandle" class="left-resize-handle" role="separator" aria-label="Resize sidebar"></div>

      <main class="chat-shell glass-panel">
        <header class="chat-header">
          <div>
            <p class="eyebrow">Local Agent</p>
            <h2>Ask, inspect, continue</h2>
          </div>
          <button id="newChatButton" type="button" class="icon-button">New</button>
        </header>
        <section id="messages" class="messages" aria-live="polite">
          <article class="empty-state">
            <div class="mascot-mini" aria-hidden="true">✦</div>
            <h3>Prism is ready</h3>
            <p>Start with a focused task. Tool activity will stay visible without crowding the answer.</p>
          </article>
        </section>
        <form id="composer" class="composer">
          <textarea id="promptInput" rows="2" placeholder="Ask cc-local to inspect, edit, or explain..."></textarea>
          <button id="sendButton" type="submit">Send</button>
        </form>
      </main>

      <button id="inspectorToggle" class="inspector-toggle" type="button" aria-expanded="false" aria-controls="inspector">
        Inspector
      </button>
      <aside id="inspector" class="inspector glass-panel" hidden>
        <header class="inspector-header">
          <h2>Inspector</h2>
          <button id="inspectorClose" class="icon-button" type="button">Close</button>
        </header>
        <div class="tabs" role="tablist">
          <button type="button" class="tab is-active" data-tab="context">Context</button>
          <button type="button" class="tab" data-tab="tools">Tools</button>
          <button type="button" class="tab" data-tab="memory">Memory</button>
        </div>
        <div id="inspectorContent" class="inspector-content"></div>
      </aside>
    </div>
    <script src="/static/app.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 4: Replace `styles.css` with the first Prism visual system**

Update `src/web/static/styles.css` with the full stylesheet below:

```css
:root {
  color-scheme: light;
  --fog: #f8fbff;
  --ice: #eaf7ff;
  --pale-cyan: #ddf7f8;
  --pink: #f7a8cf;
  --violet: #d8b7ff;
  --cyan: #86e6f1;
  --glass-blue: #b7d7ff;
  --ink: #2f3545;
  --muted: #6f7a90;
  --panel: rgba(255, 255, 255, 0.62);
  --panel-strong: rgba(255, 255, 255, 0.78);
  --shadow: 0 22px 54px rgba(135, 176, 210, 0.2);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  overflow: hidden;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 16% 10%, rgba(247, 168, 207, 0.35), transparent 28%),
    radial-gradient(circle at 82% 8%, rgba(134, 230, 241, 0.34), transparent 30%),
    radial-gradient(circle at 55% 90%, rgba(216, 183, 255, 0.28), transparent 34%),
    linear-gradient(135deg, var(--fog), var(--ice) 52%, #fff4fb);
}

button,
textarea {
  font: inherit;
}

.ambient {
  position: fixed;
  border-radius: 999px;
  filter: blur(20px);
  pointer-events: none;
}

.ambient-pink {
  width: 220px;
  height: 220px;
  top: -70px;
  right: 16%;
  background: rgba(247, 168, 207, 0.32);
}

.ambient-cyan {
  width: 260px;
  height: 260px;
  left: 34%;
  bottom: -100px;
  background: rgba(134, 230, 241, 0.26);
}

.app-shell {
  position: relative;
  z-index: 1;
  height: 100vh;
  display: grid;
  grid-template-columns: minmax(180px, 260px) 8px minmax(360px, 1fr) auto auto;
  gap: 14px;
  padding: 18px;
}

.glass-panel {
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 22px;
  background: var(--panel);
  box-shadow: var(--shadow), inset 0 1px 0 rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(18px);
}

.sidebar {
  min-width: 180px;
  overflow: hidden;
  padding: 16px;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 16px;
}

.brand {
  display: flex;
  gap: 11px;
  align-items: center;
}

.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 15px;
  background: linear-gradient(135deg, var(--pink), var(--cyan));
  box-shadow: 0 12px 28px rgba(247, 168, 207, 0.26);
}

.brand h1,
.chat-header h2,
.inspector h2,
.empty-state h3,
.sidebar-card h2 {
  margin: 0;
  letter-spacing: 0;
}

.brand h1 {
  font-size: 18px;
}

.brand p,
.empty-state p,
.sidebar-card p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.nav-list {
  display: grid;
  gap: 8px;
}

.nav-item,
.icon-button,
.composer button,
.inspector-toggle,
.tab {
  border: 0;
  border-radius: 14px;
  color: var(--ink);
  background: var(--panel-strong);
  box-shadow: 0 12px 28px rgba(135, 176, 210, 0.14);
  cursor: pointer;
}

.nav-item {
  min-height: 36px;
  text-align: left;
  padding: 0 12px;
}

.nav-item.is-active {
  background: linear-gradient(135deg, rgba(247, 168, 207, 0.34), rgba(134, 230, 241, 0.26));
}

.sidebar-card {
  align-self: end;
  border-radius: 18px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.42);
}

.left-resize-handle {
  align-self: center;
  width: 8px;
  height: 84px;
  border-radius: 999px;
  cursor: col-resize;
  background: linear-gradient(var(--violet), var(--cyan));
  box-shadow: 0 0 18px rgba(134, 230, 241, 0.42);
}

.chat-shell {
  min-width: 360px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 14px;
  padding: 18px;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.messages {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state,
.message {
  border-radius: 18px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 10px 24px rgba(135, 176, 210, 0.12);
}

.empty-state {
  margin: auto;
  max-width: 420px;
  text-align: center;
}

.mascot-mini {
  width: 46px;
  height: 46px;
  margin: 0 auto 12px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(247, 168, 207, 0.42), rgba(134, 230, 241, 0.32));
}

.message-user {
  align-self: flex-end;
  max-width: 78%;
  background: linear-gradient(135deg, rgba(247, 168, 207, 0.36), rgba(134, 230, 241, 0.28));
}

.message-assistant,
.message-status {
  align-self: flex-start;
  max-width: 82%;
}

.message-status {
  color: var(--muted);
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}

.composer textarea {
  width: 100%;
  max-height: 180px;
  resize: vertical;
  border: 0;
  border-radius: 18px;
  padding: 12px 14px;
  color: var(--ink);
  background: var(--panel-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92), 0 12px 28px rgba(135, 176, 210, 0.14);
}

.composer button,
.icon-button {
  padding: 10px 14px;
}

.inspector-toggle {
  align-self: start;
  writing-mode: vertical-rl;
  padding: 14px 10px;
}

.inspector {
  width: 320px;
  min-width: 260px;
  max-width: 460px;
  overflow: hidden;
  resize: horizontal;
  padding: 16px;
  display: none;
  grid-template-rows: auto auto 1fr;
  gap: 14px;
}

.inspector.is-open {
  display: grid;
}

.inspector[hidden] {
  display: none;
}

.inspector-header,
.tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tab {
  flex: 1;
  padding: 9px 10px;
}

.tab.is-active {
  background: rgba(216, 183, 255, 0.3);
}

.inspector-content {
  min-height: 0;
  overflow: auto;
}

.tool-list {
  display: grid;
  gap: 10px;
}

.tool-row {
  border-radius: 14px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.56);
}

.tool-row-error {
  background: rgba(247, 168, 207, 0.24);
}
```

- [ ] **Step 5: Replace `app.js` with the first usable client behavior**

Update `src/web/static/app.js`:

```javascript
const messages = document.querySelector('#messages')
const composer = document.querySelector('#composer')
const promptInput = document.querySelector('#promptInput')
const sendButton = document.querySelector('#sendButton')
const newChatButton = document.querySelector('#newChatButton')
const inspector = document.querySelector('#inspector')
const inspectorToggle = document.querySelector('#inspectorToggle')
const inspectorClose = document.querySelector('#inspectorClose')
const inspectorContent = document.querySelector('#inspectorContent')
const leftResizeHandle = document.querySelector('#leftResizeHandle')
const sidebar = document.querySelector('#sidebar')

const state = {
  messages: [],
  activeRun: null,
  tools: [],
  resizingLeft: false
}

function clearEmptyState() {
  const empty = messages.querySelector('.empty-state')
  if (empty) empty.remove()
}

function appendMessage(role, text) {
  clearEmptyState()
  state.messages.push({ role, content: text })
  const item = document.createElement('article')
  item.className = `message message-${role}`
  item.textContent = text
  messages.append(item)
  messages.scrollTop = messages.scrollHeight
}

function appendStatus(text) {
  clearEmptyState()
  const item = document.createElement('article')
  item.className = 'message message-status'
  item.textContent = text
  messages.append(item)
  messages.scrollTop = messages.scrollHeight
  return item
}

function renderInspector() {
  inspectorContent.innerHTML = ''
  const list = document.createElement('div')
  list.className = 'tool-list'
  for (const tool of state.tools) {
    const row = document.createElement('div')
    row.className = `tool-row ${tool.ok === false ? 'tool-row-error' : ''}`
    row.textContent = `${tool.name}: ${tool.summary}${tool.durationMs === undefined ? '' : ` (${tool.durationMs}ms)`}`
    list.append(row)
  }
  if (state.tools.length === 0) {
    const row = document.createElement('div')
    row.className = 'tool-row'
    row.textContent = 'No tools have run in this page session.'
    list.append(row)
  }
  inspectorContent.append(list)
}

function openInspector() {
  inspector.hidden = false
  inspector.classList.add('is-open')
  inspectorToggle.setAttribute('aria-expanded', 'true')
  renderInspector()
}

function closeInspector() {
  inspector.classList.remove('is-open')
  inspector.hidden = true
  inspectorToggle.setAttribute('aria-expanded', 'false')
}

function handleRunEvent(event, statusNode) {
  if (event.type === 'thinking_start') {
    statusNode.textContent = 'Thinking...'
  }
  if (event.type === 'tool_start') {
    state.tools.push({ name: event.name, summary: event.summary })
    statusNode.textContent = `${event.name} · ${event.summary}`
    renderInspector()
  }
  if (event.type === 'tool_result') {
    const tool = [...state.tools].reverse().find((entry) => entry.name === event.name && entry.durationMs === undefined)
    if (tool) {
      tool.ok = event.ok
      tool.durationMs = event.durationMs
      tool.summary = event.summary
    }
    statusNode.textContent = `${event.name} ${event.ok ? 'finished' : 'failed'}`
    renderInspector()
  }
  if (event.type === 'final') {
    statusNode.remove()
    appendMessage('assistant', event.text)
    state.activeRun = null
    sendButton.disabled = false
  }
  if (event.type === 'error') {
    statusNode.textContent = event.message
    state.activeRun = null
    sendButton.disabled = false
  }
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault()
  const prompt = promptInput.value.trim()
  if (!prompt || state.activeRun !== null) return

  promptInput.value = ''
  appendMessage('user', prompt)
  sendButton.disabled = true
  const statusNode = appendStatus('Starting...')

  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: state.messages })
  })

  if (!response.ok) {
    const body = await response.json()
    statusNode.textContent = body.error || 'Run failed.'
    sendButton.disabled = false
    return
  }

  const body = await response.json()
  state.activeRun = body.runId
  const events = new EventSource(`/api/runs/${body.runId}/events`)
  events.addEventListener('message', (message) => {
    const runEvent = JSON.parse(message.data)
    handleRunEvent(runEvent, statusNode)
    if (runEvent.type === 'final' || runEvent.type === 'error') {
      events.close()
    }
  })
})

newChatButton.addEventListener('click', () => {
  if (state.activeRun !== null) return
  state.messages = []
  state.tools = []
  messages.innerHTML = [
    '<article class="empty-state">',
    '<div class="mascot-mini" aria-hidden="true">✦</div>',
    '<h3>Prism is ready</h3>',
    '<p>Start with a focused task. Tool activity will stay visible without crowding the answer.</p>',
    '</article>'
  ].join('')
  renderInspector()
})

inspectorToggle.addEventListener('click', () => {
  if (inspector.hidden) {
    openInspector()
  } else {
    closeInspector()
  }
})

inspectorClose.addEventListener('click', closeInspector)

leftResizeHandle.addEventListener('pointerdown', (event) => {
  state.resizingLeft = true
  leftResizeHandle.setPointerCapture(event.pointerId)
})

leftResizeHandle.addEventListener('pointermove', (event) => {
  if (!state.resizingLeft) return
  const width = Math.min(Math.max(event.clientX - 18, 180), 360)
  sidebar.style.width = `${width}px`
})

leftResizeHandle.addEventListener('pointerup', (event) => {
  state.resizingLeft = false
  leftResizeHandle.releasePointerCapture(event.pointerId)
})

renderInspector()
```

- [ ] **Step 6: Run focused static tests**

Run:

```bash
npm test -- tests/web-server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/web/static/index.html src/web/static/styles.css src/web/static/app.js tests/web-server.test.ts
git commit -m "feat: build prism web console shell"
```

---

### Task 6: Web Event Integration and Error Behavior

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add failing SSE tests for tool events and errors**

Append to `tests/web-server.test.ts`:

```typescript
  it('streams tool events before the final response', async () => {
    let callCount = 0
    const callModel = vi.fn(async (): Promise<ModelResponse> => {
      callCount += 1
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'glob', arguments: JSON.stringify({ pattern: 'package.json' }) }
            }
          ]
        }
      }
      return { content: 'found package', toolCalls: [] }
    })
    const handle = await startTestServer(callModel)

    const runResponse = await fetch(`${handle.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'find package' }] })
    })
    const body = (await runResponse.json()) as { runId: string }
    const stream = (await readSse(`${handle.url}/api/runs/${body.runId}/events`)).join('')

    expect(stream).toContain('"type":"tool_start","name":"glob","summary":"package.json"')
    expect(stream).toContain('"type":"tool_result","name":"glob","ok":true')
    expect(stream).toContain('"type":"final","text":"found package"')
  })

  it('streams concise error events when a run fails', async () => {
    const handle = await startTestServer(async (): Promise<ModelResponse> => {
      throw new Error('model unavailable')
    })

    const runResponse = await fetch(`${handle.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
    })
    const body = (await runResponse.json()) as { runId: string }
    const stream = (await readSse(`${handle.url}/api/runs/${body.runId}/events`)).join('')

    expect(stream).toContain('"type":"error","message":"model unavailable"')
    expect(stream).not.toContain('at runAgentLoop')
  })
```

Update `readSse()` so it also stops on error:

```typescript
    if (chunks.join('').includes('"type":"final"') || chunks.join('').includes('"type":"error"')) {
      await reader.cancel()
      break
    }
```

- [ ] **Step 2: Run tests and verify failures**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected: FAIL if server does not yet preserve tool events and error event close behavior.

- [ ] **Step 3: Fix server event ordering if needed**

If duplicate final events appear, keep the current `record.done` guard in `src/web/server.ts`. If tool events do not appear, confirm `createWebObserver()` is passed to `runAgentLoop()` and that the fake `glob` tool can execute using `runtime.tools`.

The relevant run block in `src/web/server.ts` must be:

```typescript
        void runAgentLoop({
          config: runtime.config,
          messages,
          tools: runtime.tools,
          observer: createWebObserver((event) => emit(record, event)),
          callModel: input.callModel
        })
          .then((result) => {
            if (!record.done) emit(record, { type: 'final', text: result.finalText })
          })
          .catch((error: unknown) => {
            if (!record.done) emit(record, errorEvent(error))
          })
```

- [ ] **Step 4: Run focused integration tests**

Run:

```bash
npm test -- tests/web-server.test.ts tests/agent-loop.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/web/server.ts tests/web-server.test.ts
git commit -m "test: cover web run event streams"
```

---

### Task 7: Final Verification and Manual QA

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS with all Vitest files green and `tsc --noEmit` exit code 0.

- [ ] **Step 2: Start the Web UI manually**

Run:

```bash
npm run dev -- --web --port 4317
```

Expected output:

```text
cc-local web listening at http://127.0.0.1:4317
```

- [ ] **Step 3: Manual browser QA**

Open:

```text
http://127.0.0.1:4317
```

Check:

- Page loads with Prism glass background.
- Left sidebar is visible.
- Center chat takes the largest space.
- Right inspector is hidden by default.
- Inspector opens only after pressing the Inspector rail button.
- Left resize handle changes sidebar width.
- Empty state mascot mark is visible but not dominant.
- Sending a no-tool prompt appends user and assistant messages.
- Sending a tool-using prompt updates the compact status and the Tools inspector.
- A model failure renders an error message without a stack trace.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: no untracked `.cc-local/` test output and no unintended file changes.

- [ ] **Step 5: Final code review**

Dispatch a reviewer against the full feature branch. Review requirements:

- `--web` mode works and does not break CLI/REPL.
- Web server has clear API behavior.
- SSE event lifecycle is correct.
- No persistent session claims are accidentally implemented.
- Frontend layout matches A1/R1 scope.
- No unnecessary dependencies were added.

- [ ] **Step 6: Commit final fixes if the review finds issues**

If the reviewer finds a valid issue, fix it with a focused commit:

```bash
git add <changed-files>
git commit -m "fix: address web console review"
```

Then re-run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

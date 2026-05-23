# Phase 0 API-first T2I Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Phase 0 API-first 减负升级，硬删除当前 T2I runtime，并让工具注册由 startup-time manual `FeatureFlags` 控制。

**Architecture:** `createDefaultConfig()` 只负责读取 API-first 模型配置和 `FeatureFlags`，不再包含 T2I 配置。`buildAgentRuntime()` 把 `AppConfig` 传给 `createCoreTools(config)`，所有入口共用同一套工具 schema。`llm-client` 保持单一 OpenAI-compatible client，不引入 Phase 1 model router。

**Tech Stack:** TypeScript, Node.js 20, Commander, Vitest, OpenAI-compatible `/chat/completions`.

---

## File Structure

修改或删除以下文件：

```txt
src/config.ts
  - Add ModelConfig.apiKey
  - Add FeatureFlags and AppConfig.features
  - Remove T2IConfig and AppConfig.t2i
  - Remove local MLX implicit defaults

src/tools/index.ts
  - Remove generateImageTool import
  - Change createCoreTools(config)
  - Register bash/web_search only when FeatureFlags enable them

src/web/prompt-context.ts
  - Pass config into createCoreTools(config)

src/llm-client.ts
  - Validate CYRENE_BASE_URL and CYRENE_MODEL before fetch
  - Add Authorization header when CYRENE_API_KEY is set
  - Remove chat_template_kwargs from generic body

src/config-doctor.ts
  - New formatter for cyrene config doctor output

src/main.ts
  - Add cyrene config doctor command path
  - Keep existing one-shot, REPL, and Web behavior

README.md
  - Reframe local-first != local-model-first
  - Document API-first setup, feature flags, config doctor
  - Remove current T2I runtime docs

.env.example
  - Remove T2I_* examples
  - Add CYRENE_API_KEY and FeatureFlags examples

tests/config.test.ts
tests/tool-list.test.ts
tests/web-prompt-context.test.ts
tests/llm-client.test.ts
tests/main-cli.test.ts
tests/agent-loop.test.ts
tests/web-server.test.ts
tests/session-store.test.ts
  - Update coverage for API-first config, flags, no generate_image, and removed T2I special cases

Delete:
src/tools/generate-image.ts
scripts/t2i-worker.py
server/start-t2i.sh
requirements-t2i.txt
requirements-t2i-detail.txt
tests/generate-image-tool.test.ts
tests/t2i-worker.test.ts
tests/t2i-worker-smoke.test.ts
/Users/phoenix/Assistant/Cyrene/T2I
/Users/phoenix/Assistant/Cyrene/.venv-t2i
```

Do not delete:

```txt
/Users/phoenix/Assistant/Cyrene/Qwen3.5-9B-MLX-4bit
```

---

### Task 1: Config API-first and FeatureFlags

**Files:**
- Modify: `tests/config.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Update failing config tests**

Replace the model and T2I config tests in `tests/config.test.ts` with API-first and FeatureFlags coverage:

```ts
it('uses API-first model environment values', () => {
  vi.stubEnv('CYRENE_BASE_URL', 'https://api.example.com/v1')
  vi.stubEnv('CYRENE_MODEL', 'strong-model')
  vi.stubEnv('CYRENE_API_KEY', 'secret-key')

  const config = createDefaultConfig('/tmp/project')

  expect(config.model.baseUrl).toBe('https://api.example.com/v1')
  expect(config.model.model).toBe('strong-model')
  expect(config.model.apiKey).toBe('secret-key')
  expect(config.model.temperature).toBe(0)
})

it('does not invent model endpoint defaults', () => {
  const config = createDefaultConfig('/tmp/project')

  expect(config.model.baseUrl).toBe('')
  expect(config.model.model).toBe('')
  expect(config.model.apiKey).toBeUndefined()
})

it('uses startup-time manual feature flag defaults', () => {
  const config = createDefaultConfig('/tmp/project')

  expect(config.features).toEqual({
    bashEnabled: true,
    webSearchEnabled: true,
    mcpEnabled: false
  })
})

it('uses feature flag environment overrides', () => {
  vi.stubEnv('CYRENE_ENABLE_BASH', '0')
  vi.stubEnv('CYRENE_ENABLE_WEB_SEARCH', 'false')
  vi.stubEnv('CYRENE_ENABLE_MCP', '1')

  const config = createDefaultConfig('/tmp/project')

  expect(config.features).toEqual({
    bashEnabled: false,
    webSearchEnabled: false,
    mcpEnabled: true
  })
})
```

Update the legacy env tests so legacy variables now fall back to empty model config:

```ts
expect(config.model.baseUrl).toBe('')
expect(config.model.model).toBe('')
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL because `ModelConfig.apiKey`, `AppConfig.features`, and T2I removal are not implemented yet.

- [ ] **Step 3: Implement config changes**

In `src/config.ts`, replace the model/T2I config definitions with:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature: number
}

export interface FeatureFlags {
  bashEnabled: boolean
  webSearchEnabled: boolean
  mcpEnabled: boolean
}

export interface AppConfig {
  cwd: string
  model: ModelConfig
  features: FeatureFlags
  maxToolCallsPerTurn: number
  contextWindowTokens: number
  autoCompactThreshold: number
  snipThreshold: number
  microcompactThreshold: number
  collapseThreshold: number
  snipKeepRounds: number
  microcompactKeepRecentRounds: number
  userCyreneDir: string
  dailyCompactThreshold: number
  dailyLoadLines: number
  dailySummaryMaxLength: number
  sessionResumeRecentMessages: number
  memoryMaxLines: number
  memoryMaxLineLength: number
  readMaxInlineLines: number
  grepMaxMatches: number
  bashTimeoutMs: number
  llmRequestTimeoutMs: number
  llmRetryMaxAttempts: number
  llmRetryBaseDelayMs: number
  readableRoots: string[]
  writableRoots: string[]
  bashDenyPatterns: RegExp[]
}
```

Keep `parseBooleanEnv()` and `parsePositiveIntEnv()`. Remove `T2IConfig`, `appRoot`, and `resolveStartCommand()`.

In `createDefaultConfig(cwd)`, use:

```ts
model: {
  baseUrl: process.env.CYRENE_BASE_URL ?? '',
  model: process.env.CYRENE_MODEL ?? '',
  apiKey: process.env.CYRENE_API_KEY?.trim() === '' ? undefined : process.env.CYRENE_API_KEY,
  temperature: 0
},
features: {
  bashEnabled: parseBooleanEnv(process.env.CYRENE_ENABLE_BASH, true),
  webSearchEnabled: parseBooleanEnv(process.env.CYRENE_ENABLE_WEB_SEARCH, true),
  mcpEnabled: parseBooleanEnv(process.env.CYRENE_ENABLE_MCP, false)
},
```

- [ ] **Step 4: Run config tests and verify pass**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit config changes**

Run:

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add API-first config flags"
```

---

### Task 2: Remove T2I Tool from Core Registry

**Files:**
- Modify: `tests/tool-list.test.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/web/prompt-context.ts`
- Delete: `src/tools/generate-image.ts`

- [ ] **Step 1: Update failing tool registry tests**

Replace `tests/tool-list.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { createCoreTools } from '../src/tools/index.js'

describe('createCoreTools', () => {
  it('registers the default core tool set without generate_image', () => {
    const config = createDefaultConfig('/tmp/project')
    const names = createCoreTools(config).map((tool) => tool.name)

    expect(names).toEqual([
      'file_read',
      'file_write',
      'file_edit',
      'grep',
      'glob',
      'ask_user',
      'bash',
      'web_search'
    ])
    expect(names).not.toContain('generate_image')
    expect(names).not.toContain('task')
  })

  it('omits bash when the bash feature flag is disabled', () => {
    const config = createDefaultConfig('/tmp/project')
    config.features.bashEnabled = false

    const names = createCoreTools(config).map((tool) => tool.name)

    expect(names).not.toContain('bash')
    expect(names).toContain('web_search')
  })

  it('omits web_search when the web search feature flag is disabled', () => {
    const config = createDefaultConfig('/tmp/project')
    config.features.webSearchEnabled = false

    const names = createCoreTools(config).map((tool) => tool.name)

    expect(names).toContain('bash')
    expect(names).not.toContain('web_search')
  })
})
```

- [ ] **Step 2: Run tool registry tests and verify failure**

Run:

```bash
npm test -- tests/tool-list.test.ts
```

Expected: FAIL because `createCoreTools` does not accept config and still registers `generate_image`.

- [ ] **Step 3: Implement tool registry changes**

In `src/tools/index.ts`:

```ts
import type { AppConfig } from '../config.js'
import { askUserTool } from './ask-user.js'
import { bashTool } from './bash.js'
import { fileEditTool } from './file-edit.js'
import { fileReadTool } from './file-read.js'
import { fileWriteTool } from './file-write.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { webSearchTool } from './web-search.js'
import type { Tool, ToolCall, ToolContext, ToolResult } from './types.js'

export function createCoreTools(config: AppConfig): Tool<unknown>[] {
  const tools: Tool<unknown>[] = [
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    grepTool,
    globTool,
    askUserTool
  ] as Tool<unknown>[]

  if (config.features.bashEnabled) {
    tools.push(bashTool)
  }

  if (config.features.webSearchEnabled) {
    tools.push(webSearchTool)
  }

  return tools
}
```

Keep `toolDefinitions()` and `executeToolCall()` unchanged.

In `src/web/prompt-context.ts`, change:

```ts
tools: createCoreTools(config)
```

Delete `src/tools/generate-image.ts`.

- [ ] **Step 4: Run tool and prompt-context tests**

Run:

```bash
npm test -- tests/tool-list.test.ts tests/web-prompt-context.test.ts
```

Expected: `tool-list.test.ts` PASS. `web-prompt-context.test.ts` may fail until its expectations are updated in Task 3.

- [ ] **Step 5: Commit registry changes**

Run:

```bash
git add src/tools/index.ts src/web/prompt-context.ts tests/tool-list.test.ts
git add -u src/tools/generate-image.ts
git commit -m "feat: gate core tools by feature flags"
```

---

### Task 3: Runtime Tests for FeatureFlags

**Files:**
- Modify: `tests/web-prompt-context.test.ts`

- [ ] **Step 1: Update runtime tests**

Add `vi` import and env cleanup:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  process.env.TZ = originalTimeZone
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})
```

Add a runtime flag test:

```ts
it('uses feature flags when building runtime tools', async () => {
  vi.stubEnv('CYRENE_ENABLE_BASH', '0')
  vi.stubEnv('CYRENE_ENABLE_WEB_SEARCH', '0')
  const home = await mkdtemp(join(tmpdir(), 'cyrene-web-home-'))
  tempHomes.push(home)
  process.env.HOME = home

  const root = join(home, 'workspace', 'project')
  await mkdir(join(root, '.cyrene', 'memory'), { recursive: true })

  const runtime = await buildAgentRuntime(root)
  const names = runtime.tools.map((tool) => tool.name)

  expect(names).toEqual(['file_read', 'file_write', 'file_edit', 'grep', 'glob', 'ask_user'])
})
```

Update existing expectations to assert `generate_image` is absent:

```ts
expect(runtime.tools.map((tool) => tool.name)).not.toContain('generate_image')
```

- [ ] **Step 2: Run runtime tests and verify pass**

Run:

```bash
npm test -- tests/web-prompt-context.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit runtime test changes**

Run:

```bash
git add tests/web-prompt-context.test.ts
git commit -m "test: cover runtime feature flags"
```

---

### Task 4: LLM Client API-first Behavior

**Files:**
- Modify: `tests/llm-client.test.ts`
- Modify: `src/llm-client.ts`

- [ ] **Step 1: Update failing llm-client tests**

In the request body expectation, remove:

```ts
chat_template_kwargs: { enable_thinking: false },
```

Set model env or direct config values in tests that call `callModel`. Add these tests:

```ts
it('sends an Authorization header when an API key is configured', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  )
  vi.stubGlobal('fetch', fetch)
  const config = createDefaultConfig('/tmp/project')
  config.model.baseUrl = 'https://api.example.com/v1'
  config.model.model = 'strong-model'
  config.model.apiKey = 'secret-key'

  await callModel({
    config,
    messages: [{ role: 'user', content: 'Hello' }],
    tools: []
  })

  expect(fetch).toHaveBeenCalledWith('https://api.example.com/v1/chat/completions', expect.objectContaining({
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer secret-key'
    }
  }))
})

it('throws a clear error when model config is incomplete', async () => {
  const config = createDefaultConfig('/tmp/project')

  await expect(
    callModel({
      config,
      messages: [{ role: 'user', content: 'Hello' }],
      tools: []
    })
  ).rejects.toThrow('Model config is incomplete: set CYRENE_BASE_URL and CYRENE_MODEL.')
})
```

- [ ] **Step 2: Run llm-client tests and verify failure**

Run:

```bash
npm test -- tests/llm-client.test.ts
```

Expected: FAIL because Authorization and config validation are not implemented yet.

- [ ] **Step 3: Implement llm-client changes**

In `src/llm-client.ts`, update the request body type to remove `chat_template_kwargs`.

Add validation:

```ts
function validateModelConfig(config: AppConfig): void {
  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') {
    missing.push('CYRENE_BASE_URL')
  }
  if (config.model.model.trim() === '') {
    missing.push('CYRENE_MODEL')
  }
  if (missing.length > 0) {
    throw new Error(`Model config is incomplete: set ${missing.join(' and ')}.`)
  }
}
```

Call it at the start of `requestCompletion(input)`.

Build headers:

```ts
const headers: Record<string, string> = { 'content-type': 'application/json' }
if (input.config.model.apiKey?.trim()) {
  headers.authorization = `Bearer ${input.config.model.apiKey}`
}
```

Use `headers` in `fetch`.

- [ ] **Step 4: Run llm-client tests and verify pass**

Run:

```bash
npm test -- tests/llm-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit llm-client changes**

Run:

```bash
git add src/llm-client.ts tests/llm-client.test.ts
git commit -m "feat: make llm client API-first"
```

---

### Task 5: Config Doctor CLI

**Files:**
- Create: `src/config-doctor.ts`
- Modify: `src/main.ts`
- Modify: `tests/main-cli.test.ts`

- [ ] **Step 1: Add failing config doctor tests**

Add to `tests/main-cli.test.ts`:

```ts
it('prints config doctor output', async () => {
  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', process.cwd(), 'config', 'doctor'],
    {
      env: cliEnv({
        CYRENE_BASE_URL: 'https://api.example.com/v1',
        CYRENE_MODEL: 'strong-model',
        CYRENE_API_KEY: 'secret-key',
        CYRENE_ENABLE_BASH: '0'
      })
    }
  )

  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('Model:')
  expect(result.stdout).toContain('baseUrl: https://api.example.com/v1')
  expect(result.stdout).toContain('model: strong-model')
  expect(result.stdout).toContain('apiKey: configured')
  expect(result.stdout).toContain('enabled: file_read, file_write, file_edit, grep, glob, ask_user, web_search')
  expect(result.stdout).toContain('disabled: bash, mcp')
  expect(result.stdout).toContain('T2I: removed from runtime')
})

it('warns when remote HTTPS model config has no API key', async () => {
  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', process.cwd(), 'config', 'doctor'],
    {
      env: cliEnv({
        CYRENE_BASE_URL: 'https://api.example.com/v1',
        CYRENE_MODEL: 'strong-model',
        CYRENE_API_KEY: ''
      })
    }
  )

  expect(result.stdout).toContain('warning: CYRENE_API_KEY is not set for remote HTTPS endpoint')
})
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```bash
npm test -- tests/main-cli.test.ts --runInBand
```

Expected: FAIL because `config doctor` does not exist yet.

- [ ] **Step 3: Implement config doctor formatter**

Create `src/config-doctor.ts`:

```ts
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './config.js'
import { createCoreTools } from './tools/index.js'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function isRemoteHttps(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function formatConfigDoctor(config: AppConfig): string {
  const enabledTools = createCoreTools(config).map((tool) => tool.name)
  const disabledTools: string[] = []
  if (!config.features.bashEnabled) {
    disabledTools.push('bash')
  }
  if (!config.features.webSearchEnabled) {
    disabledTools.push('web_search')
  }
  if (!config.features.mcpEnabled) {
    disabledTools.push('mcp')
  }

  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') {
    missing.push('CYRENE_BASE_URL')
  }
  if (config.model.model.trim() === '') {
    missing.push('CYRENE_MODEL')
  }

  const warnings: string[] = []
  if (isRemoteHttps(config.model.baseUrl) && !config.model.apiKey?.trim()) {
    warnings.push('warning: CYRENE_API_KEY is not set for remote HTTPS endpoint')
  }

  const localServerPath = resolve(appRoot, 'server/start.sh')

  return [
    'Model:',
    `  baseUrl: ${config.model.baseUrl || '(missing)'}`,
    `  model: ${config.model.model || '(missing)'}`,
    `  apiKey: ${config.model.apiKey?.trim() ? 'configured' : 'missing'}`,
    `  missing: ${missing.length > 0 ? missing.join(', ') : 'none'}`,
    '',
    'Tools:',
    `  enabled: ${enabledTools.join(', ')}`,
    `  disabled: ${disabledTools.length > 0 ? disabledTools.join(', ') : 'none'}`,
    '',
    'Local fallback:',
    `  server/start.sh: ${existsSync(localServerPath) ? 'exists' : 'missing'}`,
    '  status: optional',
    '',
    'T2I: removed from runtime',
    'generate_image: unavailable',
    ...warnings.map((warning) => `\n${warning}`)
  ].join('\n') + '\n'
}
```

- [ ] **Step 4: Wire config doctor into CLI**

In `src/main.ts`, import:

```ts
import { createDefaultConfig } from './config.js'
import { formatConfigDoctor } from './config-doctor.js'
```

After `program.parse()` and `options` extraction, before prompt validation, add:

```ts
if (program.args[0] === 'config') {
  if (program.args.length !== 2 || program.args[1] !== 'doctor') {
    console.error('Usage: cyrene config doctor')
    process.exit(1)
  }
  const config = createDefaultConfig(options.cwd)
  console.log(formatConfigDoctor(config))
  return
}
```

- [ ] **Step 5: Run CLI tests and verify pass**

Run:

```bash
npm test -- tests/main-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit config doctor changes**

Run:

```bash
git add src/config-doctor.ts src/main.ts tests/main-cli.test.ts
git commit -m "feat: add config doctor"
```

---

### Task 6: Remove T2I Special Cases and Tests

**Files:**
- Modify: `src/agent-loop.ts`
- Modify: `src/session-store.ts`
- Modify: `tests/agent-loop.test.ts`
- Modify: `tests/session-store.test.ts`
- Modify: `tests/web-server.test.ts`
- Delete: T2I tests and runtime files listed below

- [ ] **Step 1: Find active T2I references**

Run:

```bash
rg -n "generate_image|T2I|t2i|generate-image|start-t2i|requirements-t2i" src tests README.md .env.example package.json
```

Expected: references remain before cleanup.

- [ ] **Step 2: Remove active source special cases**

In `src/agent-loop.ts`, remove `generate_image`-specific result summarization paths. Tool results should use the generic tool result handling.

In `src/session-store.ts`, remove `generate_image` history conversion logic. Previous sessions containing old image tool calls do not need compatibility for Phase 0.

- [ ] **Step 3: Remove active tests for T2I behavior**

Delete or update tests that assert `generate_image` behavior:

```txt
tests/generate-image-tool.test.ts
tests/t2i-worker.test.ts
tests/t2i-worker-smoke.test.ts
```

Remove `generate_image`-specific tests from:

```txt
tests/agent-loop.test.ts
tests/session-store.test.ts
tests/web-server.test.ts
```

- [ ] **Step 4: Remove tracked T2I runtime files**

Run:

```bash
git rm src/tools/generate-image.ts scripts/t2i-worker.py server/start-t2i.sh requirements-t2i.txt requirements-t2i-detail.txt tests/generate-image-tool.test.ts tests/t2i-worker.test.ts tests/t2i-worker-smoke.test.ts
```

- [ ] **Step 5: Delete local T2I assets and env**

Run:

```bash
rm -rf /Users/phoenix/Assistant/Cyrene/T2I /Users/phoenix/Assistant/Cyrene/.venv-t2i
```

Then verify:

```bash
test ! -e /Users/phoenix/Assistant/Cyrene/T2I
test ! -e /Users/phoenix/Assistant/Cyrene/.venv-t2i
test -e /Users/phoenix/Assistant/Cyrene/Qwen3.5-9B-MLX-4bit
```

- [ ] **Step 6: Verify no active T2I references remain**

Run:

```bash
rg -n "generate_image|T2I|t2i|generate-image|start-t2i|requirements-t2i" src tests README.md .env.example package.json
```

Expected: no output, except README/.env before Task 7 if docs have not yet been updated.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/agent-loop.test.ts tests/session-store.test.ts tests/web-server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit T2I removal**

Run:

```bash
git add src/agent-loop.ts src/session-store.ts tests/agent-loop.test.ts tests/session-store.test.ts tests/web-server.test.ts
git add -u
git commit -m "refactor: remove current T2I runtime"
```

---

### Task 7: Documentation and Env Example

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Replace `.env.example` content with API-first and feature flag examples:

```env
# OpenAI-compatible model endpoint.
# Cyrene is API-first by default. Set these before running agent tasks.
CYRENE_BASE_URL=https://api.example.com/v1
CYRENE_MODEL=strong-model-name
CYRENE_API_KEY=

# Startup-time manual feature flags.
CYRENE_ENABLE_BASH=1
CYRENE_ENABLE_WEB_SEARCH=1
CYRENE_ENABLE_MCP=0

# Optional local MLX server settings used by server/start.sh.
# This is a local fallback path, not the default recommended runtime.
MODEL_PATH=./Qwen3.5-9B-MLX-4bit
HOST=127.0.0.1
PORT=8080
PYTHON=./.venv/bin/python
```

- [ ] **Step 2: Update README**

Rewrite the model/T2I sections so they say:

```md
## Runtime Model

Cyrene is local-first, not local-model-first. The runtime keeps memory, sessions, tools, and Web UI state on this machine, while the main model endpoint is an OpenAI-compatible API.

Set:

\`\`\`bash
CYRENE_BASE_URL=https://api.example.com/v1
CYRENE_MODEL=strong-model-name
CYRENE_API_KEY=...
\`\`\`

Use `npm run dev -- config doctor` to inspect the active model and tool configuration.

## Optional Local MLX Fallback

`server/start.sh` remains as a convenience launcher for a local MLX/Qwen server. To use it, point `CYRENE_BASE_URL` and `CYRENE_MODEL` at that server explicitly.

## Feature Flags

Tool availability is controlled at startup:

\`\`\`bash
CYRENE_ENABLE_BASH=1
CYRENE_ENABLE_WEB_SEARCH=1
CYRENE_ENABLE_MCP=0
\`\`\`

Disabled tools are not sent to the model in the `tools` schema.

## Image Generation

The previous local SD1.5/T2I runtime has been removed from Phase 0. Future image generation should return as a capability/plugin rather than as a core runtime tool.
\`\`\`
```

- [ ] **Step 3: Verify docs contain no active T2I config**

Run:

```bash
rg -n "T2I_|start-t2i|requirements-t2i|generate_image|majicmix|adetailer" README.md .env.example
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md .env.example
git commit -m "docs: document API-first Phase 0 runtime"
```

---

### Task 8: Full Verification

**Files:**
- No planned source edits unless verification exposes a bug.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run config doctor manually**

Run:

```bash
CYRENE_BASE_URL=https://api.example.com/v1 CYRENE_MODEL=strong-model npm run dev -- config doctor
```

Expected output includes:

```txt
Model:
Tools:
T2I: removed from runtime
```

- [ ] **Step 4: Verify deleted local directories**

Run:

```bash
test ! -e /Users/phoenix/Assistant/Cyrene/T2I
test ! -e /Users/phoenix/Assistant/Cyrene/.venv-t2i
test -e /Users/phoenix/Assistant/Cyrene/Qwen3.5-9B-MLX-4bit
```

Expected: all commands exit 0.

- [ ] **Step 5: Verify no active T2I references**

Run:

```bash
rg -n "generate_image|T2I_|start-t2i|requirements-t2i|majicmix|adetailer" src tests README.md .env.example package.json
```

Expected: no output.

- [ ] **Step 6: Final commit if verification fixes were needed**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "fix: complete Phase 0 verification"
```

If no fixes were needed, do not create an empty commit.

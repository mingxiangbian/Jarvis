# Codex MCP Skill Local Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 给本机 Codex 增加 Cyrene MCP + Skill bridge，让 Codex 可调用 Cyrene continuity，但不启用 hooks、不自动写 memory、不覆盖全局 config。

**Architecture:** Cyrene 主仓库继续作为 source of truth。`src/codex/*` 负责 project identity、Codex memory root、continuity context、doctor/install；`src/mcp/*` 负责 stdio MCP server 和两个只读 tools；`integrations/codex/plugin/skills/cyrene-continuity/SKILL.md` 提供 Codex skill 指令。现有 `src/memory/*` 增加 root-level reader helper，让 Codex memory 能存放在 `~/.cyrene/codex/projects/<projectId>/memory`，不污染外部 repo。

**Tech Stack:** TypeScript, Node.js 20+, Vitest, Commander, Zod, `@modelcontextprotocol/sdk`, Codex skills.

---

## File Map

- Create: `src/codex/project-id.ts`
  - 识别 git root / remote hash / fallback cwd hash，并返回稳定 `projectId`。
- Create: `src/codex/codex-memory-root.ts`
  - 计算 `~/.cyrene/codex/projects/<projectId>/memory`，并安全创建 root。
- Create: `src/codex/continuity-context.ts`
  - 从 Codex project memory 读取 active memory，复用 Phase 4 continuity runtime，返回 compact context。
- Create: `src/codex/codex-doctor.ts`
  - 只读检查 Node、Codex config、Cyrene MCP、agentmemory、skill symlink、state root、project identity。
- Create: `src/codex/codex-install.ts`
  - 只创建 skill symlink 和 `~/.cyrene/codex`，打印 MCP config 和 agentmemory 停用建议。
- Create: `src/codex/codex-cli.ts`
  - 分发 `cyrene codex doctor` / `cyrene codex install --dev`。
- Create: `src/mcp/mcp-json.ts`
  - MCP text JSON response helper。
- Create: `src/mcp/mcp-server.ts`
  - 创建并启动 stdio MCP server。
- Create: `src/mcp/tools/project-identify.ts`
  - MCP tool schema 和 handler。
- Create: `src/mcp/tools/continuity-get.ts`
  - MCP tool schema 和 handler。
- Create: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
  - Codex skill 指令。
- Modify: `src/main.ts`
  - 加入 `mcp-server` / `codex` local command 分支。
- Modify: `src/memory/memory-store.ts`
  - 增加 root-level read helpers，保留 cwd API。
- Modify: `src/memory/memory-retriever.ts`
  - 增加可选 `memoryRoot` 输入。
- Modify: `package.json`
  - 增加 `@modelcontextprotocol/sdk` dependency。
- Modify: `package-lock.json`
  - 由 `npm install @modelcontextprotocol/sdk` 更新。
- Create: `tests/codex-project-id.test.ts`
- Create: `tests/codex-memory-root.test.ts`
- Create: `tests/codex-continuity-context.test.ts`
- Create: `tests/codex-cli.test.ts`
- Create: `tests/mcp-server.test.ts`

---

## Task 0: Baseline And Dependency

**Files:**
- Read: `package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Confirm branch and status**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/codex-mcp-skill-local-bridge`, worktree clean or only the plan file before first commit.

- [x] **Step 2: Run baseline typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

- [x] **Step 3: Run baseline tests**

Run:

```bash
npm test
```

Expected: exit code `0`.

- [x] **Step 4: Install MCP SDK**

Run:

```bash
npm install @modelcontextprotocol/sdk
```

Expected: `package.json` and `package-lock.json` include `@modelcontextprotocol/sdk`.

- [x] **Step 5: Verify dependency typecheck stays green**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

---

## Task 1: Codex Project Identity

**Files:**
- Create: `tests/codex-project-id.test.ts`
- Create: `src/codex/project-id.ts`

- [x] **Step 1: Write failing project identity tests**

Create `tests/codex-project-id.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { identifyCodexProject, renderModelVisibleProjectIdentity } from '../src/codex/project-id.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex project identity', () => {
  it('uses the git remote as stable project identity when available', async () => {
    const root = await createTempDir('cyrene-codex-git-')
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/private-repo.git'], { cwd: root })
    await mkdir(join(root, 'nested'), { recursive: true })

    const fromRoot = await identifyCodexProject(root)
    const fromNested = await identifyCodexProject(join(root, 'nested'))

    expect(fromRoot.projectId).toBe(fromNested.projectId)
    expect(fromRoot.gitRoot).toBe(root)
    expect(fromRoot.gitRemoteHash).toBeDefined()
    expect(fromRoot.displayName).toBe('cyrene-codex-git-' + root.split('cyrene-codex-git-').at(-1))
  })

  it('falls back to cwd identity outside git repos', async () => {
    const root = await createTempDir('cyrene-codex-nogit-')

    const identity = await identifyCodexProject(root)

    expect(identity.projectId).toMatch(/^[a-f0-9]{16}$/)
    expect(identity.gitRoot).toBeUndefined()
    expect(identity.gitRemoteHash).toBeUndefined()
    expect(identity.cwd).toBe(root)
  })

  it('does not expose full remote URLs in model-visible identity', async () => {
    const root = await createTempDir('cyrene-codex-visible-')
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://token@example.com/secret/repo.git'], { cwd: root })

    const identity = await identifyCodexProject(root)
    const visible = renderModelVisibleProjectIdentity(identity)

    expect(JSON.stringify(visible)).not.toContain('token@example.com')
    expect(JSON.stringify(visible)).not.toContain('secret/repo.git')
    expect(visible).toEqual({
      projectId: identity.projectId,
      displayName: identity.displayName,
      gitRootExists: true
    })
  })
})
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-project-id.test.ts
```

Expected: FAIL because `src/codex/project-id.ts` does not exist.

- [x] **Step 3: Implement project identity**

Create `src/codex/project-id.ts`:

```ts
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CodexProjectIdentity {
  projectId: string
  cwd: string
  gitRoot?: string
  gitRemoteHash?: string
  displayName: string
}

export interface ModelVisibleCodexProjectIdentity {
  projectId: string
  displayName: string
  gitRootExists: boolean
}

export async function identifyCodexProject(cwd: string): Promise<CodexProjectIdentity> {
  const resolvedCwd = resolve(cwd)
  const gitRootRaw = await tryGit(['rev-parse', '--show-toplevel'], resolvedCwd)
  const gitRoot = gitRootRaw?.trim()
  const root = gitRoot ?? resolvedCwd
  const remoteRaw = await tryGit(['config', '--get', 'remote.origin.url'], root)
  const remote = remoteRaw?.trim()
  const basis = remote && remote.length > 0 ? remote : root

  return {
    projectId: sha256Short(basis),
    cwd: resolvedCwd,
    gitRoot,
    gitRemoteHash: remote && remote.length > 0 ? sha256Short(remote) : undefined,
    displayName: basename(root) || 'unknown-project'
  }
}

export function renderModelVisibleProjectIdentity(
  identity: CodexProjectIdentity
): ModelVisibleCodexProjectIdentity {
  return {
    projectId: identity.projectId,
    displayName: identity.displayName,
    gitRootExists: identity.gitRoot !== undefined
  }
}

async function tryGit(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', args, { cwd })
    const text = result.stdout.trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

function sha256Short(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/codex-project-id.test.ts
```

Expected: PASS.

---

## Task 2: Codex Memory Root And Root-Level Store Reads

**Files:**
- Create: `tests/codex-memory-root.test.ts`
- Create: `src/codex/codex-memory-root.ts`
- Modify: `src/memory/memory-store.ts`

- [x] **Step 1: Write failing memory root tests**

Create `tests/codex-memory-root.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  codexGlobalRoot,
  codexProjectMemoryRoot,
  ensureCodexProjectMemoryRoot
} from '../src/codex/codex-memory-root.js'
import { readActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex memory root', () => {
  it('stores Codex project memory under ~/.cyrene/codex/projects/<projectId>/memory', async () => {
    const home = await createTempDir('cyrene-codex-home-')
    process.env.HOME = home

    expect(codexGlobalRoot()).toBe(join(home, '.cyrene', 'codex'))
    expect(codexProjectMemoryRoot('project-1')).toBe(
      join(home, '.cyrene', 'codex', 'projects', 'project-1', 'memory')
    )

    await expect(ensureCodexProjectMemoryRoot('project-1')).resolves.toBe(
      join(home, '.cyrene', 'codex', 'projects', 'project-1', 'memory')
    )
  })

  it('reads active memories from an explicit memory root', async () => {
    const root = await createTempDir('cyrene-codex-memory-root-')
    await writeFile(join(root, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')

    await expect(readActiveMemoriesFromRoot(root)).resolves.toMatchObject([
      {
        id: 'memory-1',
        content: 'Codex memory is isolated.'
      }
    ])
  })

  it('refuses explicit memory roots that are symlinks', async () => {
    const parent = await createTempDir('cyrene-codex-memory-parent-')
    const outside = await createTempDir('cyrene-codex-memory-outside-')
    await mkdir(join(outside, 'memory'), { recursive: true })
    await symlink(join(outside, 'memory'), join(parent, 'memory'))

    await expect(readActiveMemoriesFromRoot(join(parent, 'memory'))).rejects.toThrow(/memory symlink/)
    await expect(readFile(join(outside, 'memory', 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function createMemory(): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Codex memory is isolated.',
    normalizedKey: 'codex-memory-isolated',
    evidence: [{ runId: 'run-1', summary: 'Test evidence.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: []
  }
}
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-memory-root.test.ts
```

Expected: FAIL because codex memory root and root-level store helper do not exist.

- [x] **Step 3: Implement Codex memory root**

Create `src/codex/codex-memory-root.ts`:

```ts
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function codexGlobalRoot(): string {
  return join(homedir(), '.cyrene', 'codex')
}

export function codexProjectRoot(projectId: string): string {
  return join(codexGlobalRoot(), 'projects', projectId)
}

export function codexProjectMemoryRoot(projectId: string): string {
  return join(codexProjectRoot(projectId), 'memory')
}

export async function ensureCodexProjectMemoryRoot(projectId: string): Promise<string> {
  const root = codexProjectMemoryRoot(projectId)
  await mkdir(root, { recursive: true })
  return root
}
```

- [x] **Step 4: Refactor memory store reads**

In `src/memory/memory-store.ts`, add root-level helpers and route existing readers through them:

```ts
import { lstat } from 'node:fs/promises'

export async function readActiveMemoriesFromRoot(memoryRoot: string): Promise<CyreneMemory[]> {
  await assertReadableMemoryRoot(memoryRoot)
  return (await readJsonLines<CyreneMemory>(join(memoryRoot, INDEX_FILE))).filter((memory) => memory.status === 'active')
}

export async function readPendingMemoriesFromRoot(memoryRoot: string): Promise<PendingMemory[]> {
  await assertReadableMemoryRoot(memoryRoot)
  return (await readJsonLines<PendingMemory>(join(memoryRoot, PENDING_FILE))).filter((memory) => memory.status === 'pending')
}

async function assertReadableMemoryRoot(memoryRoot: string): Promise<void> {
  const stats = await lstat(memoryRoot)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory symlink: ${memoryRoot}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory memory path: ${memoryRoot}`)
  }
}
```

Then change:

```ts
return (await readJsonLines<CyreneMemory>(join(root, INDEX_FILE))).filter((memory) => memory.status === 'active')
```

to:

```ts
return readActiveMemoriesFromRoot(root)
```

and change pending read similarly.

- [x] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/codex-memory-root.test.ts tests/personal-memory-store.test.ts
```

Expected: PASS.

---

## Task 3: Continuity Context Adapter

**Files:**
- Create: `tests/codex-continuity-context.test.ts`
- Create: `src/codex/continuity-context.ts`
- Modify: `src/memory/memory-retriever.ts`

- [x] **Step 1: Write failing continuity tests**

Create `tests/codex-continuity-context.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { getCodexContinuityContext } from '../src/codex/continuity-context.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex continuity context', () => {
  it('returns compact project, memory, strategy, and dissent context', async () => {
    const home = await createTempDir('cyrene-codex-continuity-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/cyrene-demo.git'], { cwd: repo })
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Should we skip the validator and write active affect memory?',
      task: 'planning'
    })

    expect(context.project).toEqual({
      projectId: identity.projectId,
      displayName: identity.displayName
    })
    expect(context.memory.items).toEqual([
      {
        id: 'memory-1',
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        content: 'Phase 3 affective memory must go through pending validation.'
      }
    ])
    expect(context.strategy.shouldChallengeUser).toBe(true)
    expect(context.dissent.shouldChallenge).toBe(true)
    expect(JSON.stringify(context)).not.toContain('git@github.com')
  })

  it('returns strategy when no Codex memory exists yet', async () => {
    const home = await createTempDir('cyrene-codex-continuity-empty-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-empty-repo-')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Summarize this repo.',
      task: 'coding'
    })

    expect(context.project.projectId).toMatch(/^[a-f0-9]{16}$/)
    expect(context.memory.items).toEqual([])
    expect(context.strategy.tone).toBeDefined()
    expect(context.dissent.mode).toBeDefined()
  })
})

function createMemory(): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Phase 3 affective memory must go through pending validation.',
    normalizedKey: 'phase-3-affective-memory-validator',
    evidence: [{ runId: 'run-1', summary: 'Spec decision.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['codex']
  }
}
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: FAIL because continuity context and memory retriever root support do not exist.

- [x] **Step 3: Add memoryRoot support to retriever**

In `src/memory/memory-retriever.ts`, extend input:

```ts
memoryRoot?: string
```

Change the first line of `retrieveMemories` from:

```ts
const memories = await readActiveMemories(input.cwd)
```

to:

```ts
const memories = input.memoryRoot === undefined
  ? await readActiveMemories(input.cwd)
  : await readActiveMemoriesFromRoot(input.memoryRoot)
```

Import `readActiveMemoriesFromRoot`.

- [x] **Step 4: Implement continuity context**

Create `src/codex/continuity-context.ts`:

```ts
import { createDefaultConfig } from '../config.js'
import { buildContinuitySnapshot } from '../affect/affect-runtime.js'
import { retrieveMemories } from '../memory/memory-retriever.js'
import type { RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import type { PrincipledDissentPolicy } from '../affect/types.js'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export interface CodexContinuityContext {
  project: {
    projectId: string
    displayName: string
  }
  memory: {
    items: Array<{
      id: string
      domain: string
      type: string
      strength: string
      content: string
    }>
  }
  strategy: {
    tone: string
    verbosity: string
    challenge: string
    boundaryMode: string
    safetyMode: string
    shouldChallengeUser: boolean
    shouldAskClarifyingQuestion: boolean
    rationale: string
  }
  dissent: Pick<PrincipledDissentPolicy, 'shouldChallenge' | 'mode' | 'reason'>
}

export async function getCodexContinuityContext(input: {
  cwd: string
  userMessage: string
  task?: NonNullable<RetrieveMemoriesInput['task']>
}): Promise<CodexContinuityContext> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const task = input.task ?? 'coding'
  const memories = await retrieveMemories({
    cwd: input.cwd,
    userCyreneDir: createDefaultConfig(input.cwd).userCyreneDir,
    memoryRoot,
    query: input.userMessage,
    task,
    maxItems: 8,
    maxTokens: 1200
  })
  const config = {
    ...createDefaultConfig(input.cwd),
    memoryCwd: input.cwd
  }
  const snapshot = await buildContinuitySnapshot({
    config,
    userMessage: input.userMessage,
    task,
    memories: memories.map(({ memory }) => memory),
    generatedAt: new Date().toISOString()
  })

  return {
    project: {
      projectId: project.projectId,
      displayName: project.displayName
    },
    memory: {
      items: memories.map(({ memory }) => ({
        id: memory.id,
        domain: memory.domain,
        type: memory.type,
        strength: memory.strength,
        content: memory.content
      }))
    },
    strategy: {
      tone: snapshot.strategy.tone,
      verbosity: snapshot.strategy.verbosity,
      challenge: snapshot.strategy.challenge,
      boundaryMode: snapshot.strategy.boundaryMode,
      safetyMode: snapshot.strategy.safetyMode,
      shouldChallengeUser: snapshot.strategy.shouldChallengeUser,
      shouldAskClarifyingQuestion: snapshot.strategy.shouldAskClarifyingQuestion,
      rationale: snapshot.strategy.rationale
    },
    dissent: {
      shouldChallenge: snapshot.dissent.shouldChallenge,
      mode: snapshot.dissent.mode,
      reason: snapshot.dissent.reason
    }
  }
}
```

- [x] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts tests/personal-memory-retriever.test.ts tests/web-prompt-context.test.ts
```

Expected: PASS.

---

## Task 4: MCP Server And CLI Entry

**Files:**
- Create: `tests/mcp-server.test.ts`
- Create: `src/mcp/mcp-json.ts`
- Create: `src/mcp/tools/project-identify.ts`
- Create: `src/mcp/tools/continuity-get.ts`
- Create: `src/mcp/mcp-server.ts`
- Modify: `src/main.ts`

- [x] **Step 1: Write failing MCP server tests**

Create `tests/mcp-server.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createCyreneMcpServer } from '../src/mcp/mcp-server.js'
import { jsonText } from '../src/mcp/mcp-json.js'

const execFileAsync = promisify(execFile)

function cliEnv(): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

describe('Cyrene MCP server', () => {
  it('creates a named MCP server', () => {
    const server = createCyreneMcpServer({ cwd: process.cwd() })

    expect(server).toBeDefined()
  })

  it('formats JSON as MCP text content', () => {
    expect(jsonText({ ok: true })).toEqual({
      content: [
        {
          type: 'text',
          text: '{\n  "ok": true\n}'
        }
      ]
    })
  })

  it('accepts mcp-server as a local CLI command without requiring a prompt', async () => {
    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'mcp-server', '--help'],
      { env: cliEnv() }
    )

    expect(result.stderr).toBe('')
  })
})
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/mcp-server.test.ts
```

Expected: FAIL because MCP server files and CLI branch do not exist.

- [x] **Step 3: Implement JSON helper**

Create `src/mcp/mcp-json.ts`:

```ts
export function jsonText(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  }
}
```

- [x] **Step 4: Implement MCP tool modules**

Create `src/mcp/tools/project-identify.ts`:

```ts
import { z } from 'zod'
import { identifyCodexProject, renderModelVisibleProjectIdentity } from '../../codex/project-id.js'
import { jsonText } from '../mcp-json.js'

export const projectIdentifyInputSchema = {
  cwd: z.string().optional()
}

export async function handleProjectIdentify(input: { cwd?: string }, fallbackCwd: string) {
  const identity = await identifyCodexProject(input.cwd ?? fallbackCwd)
  return jsonText(renderModelVisibleProjectIdentity(identity))
}
```

Create `src/mcp/tools/continuity-get.ts`:

```ts
import { z } from 'zod'
import { getCodexContinuityContext } from '../../codex/continuity-context.js'
import { jsonText } from '../mcp-json.js'

export const continuityGetInputSchema = {
  cwd: z.string().optional(),
  userMessage: z.string(),
  task: z.enum(['coding', 'planning', 'debugging', 'conversation', 'memory']).optional()
}

export async function handleContinuityGet(
  input: { cwd?: string; userMessage: string; task?: 'coding' | 'planning' | 'debugging' | 'conversation' | 'memory' },
  fallbackCwd: string
) {
  const context = await getCodexContinuityContext({
    cwd: input.cwd ?? fallbackCwd,
    userMessage: input.userMessage,
    task: input.task ?? 'coding'
  })
  return jsonText(context)
}
```

- [x] **Step 5: Implement MCP server**

Create `src/mcp/mcp-server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { handleContinuityGet, continuityGetInputSchema } from './tools/continuity-get.js'
import { handleProjectIdentify, projectIdentifyInputSchema } from './tools/project-identify.js'

export function createCyreneMcpServer(options: { cwd: string }): McpServer {
  const server = new McpServer({
    name: 'cyrene',
    version: '0.1.0'
  })

  server.tool(
    'cyrene_project_identify',
    'Identify the current project namespace used by Cyrene continuity memory.',
    projectIdentifyInputSchema,
    async (input) => handleProjectIdentify(input, options.cwd)
  )

  server.tool(
    'cyrene_continuity_get',
    'Get compact Cyrene continuity context: relevant memory, response strategy, and principled dissent hints.',
    continuityGetInputSchema,
    async (input) => handleContinuityGet(input, options.cwd)
  )

  return server
}

export async function startCyreneMcpServer(options: { cwd: string; transport: 'stdio' }): Promise<void> {
  if (options.transport !== 'stdio') {
    throw new Error('Only stdio MCP transport is supported')
  }
  const server = createCyreneMcpServer({ cwd: options.cwd })
  await server.connect(new StdioServerTransport())
}
```

- [x] **Step 6: Wire main CLI**

In `src/main.ts`, import:

```ts
import { startCyreneMcpServer } from './mcp/mcp-server.js'
```

Change local command set:

```ts
new Set(['memory', 'eval', 'evolution', 'mcp-server', 'codex'])
```

Add before prompt validation:

```ts
if (program.args[0] === 'mcp-server') {
  if (program.args.length > 2 || (program.args[1] !== undefined && program.args[1] !== '--stdio')) {
    console.error('Usage: cyrene mcp-server --stdio')
    process.exit(1)
  }
  await startCyreneMcpServer({ cwd: options.cwd, transport: 'stdio' })
  return
}
```

- [x] **Step 7: Verify GREEN**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/main-cli.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 5: Codex Skill, Doctor, And Dev Install

**Files:**
- Create: `tests/codex-cli.test.ts`
- Create: `src/codex/codex-doctor.ts`
- Create: `src/codex/codex-install.ts`
- Create: `src/codex/codex-cli.ts`
- Create: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
- Modify: `src/main.ts`

- [x] **Step 1: Write failing Codex CLI tests**

Create `tests/codex-cli.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, HOME: home, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

describe('cyrene codex CLI', () => {
  it('doctor reports agentmemory as not ready when configured', async () => {
    const home = await createTempDir('cyrene-codex-cli-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        '',
        '[mcp_servers.cyrene]',
        'command = "cyrene"',
        'args = ["mcp-server", "--stdio"]'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Codex Doctor')
    expect(result.stdout).toContain('cyrene mcp: configured')
    expect(result.stdout).toContain('agentmemory: enabled')
    expect(result.stdout).toContain('status: not ready')
  })

  it('install --dev creates only the skill symlink and Cyrene Codex state root', async () => {
    const home = await createTempDir('cyrene-codex-install-home-')
    const codexConfig = join(home, '.codex', 'config.toml')
    await writeFile(codexConfig, 'existing = true\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('[mcp_servers.cyrene]')
    expect(result.stdout).toContain('Disable agentmemory before validating Cyrene')
    await expect(readFile(join(home, '.agents', 'skills', 'cyrene-continuity', 'SKILL.md'), 'utf8')).resolves.toContain(
      'Cyrene Continuity Skill'
    )
    await expect(readFile(codexConfig, 'utf8')).resolves.toBe('existing = true\n')
  })
})
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-cli.test.ts
```

Expected: FAIL because Codex CLI and skill do not exist.

- [x] **Step 3: Implement doctor**

Create `src/codex/codex-doctor.ts`:

```ts
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { codexGlobalRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export async function formatCodexDoctor(input: { cwd: string; configPath?: string }): Promise<string> {
  const configPath = input.configPath ?? join(homedir(), '.codex', 'config.toml')
  const configText = await readOptional(configPath)
  const cyreneConfigured = configText.includes('[mcp_servers.cyrene]')
  const agentmemoryEnabled = hasEnabledAgentmemory(configText)
  const skillPath = join(homedir(), '.agents', 'skills', 'cyrene-continuity', 'SKILL.md')
  const skillExists = await pathExists(skillPath)
  const identity = await identifyCodexProject(input.cwd)

  return [
    'Cyrene Codex Doctor',
    '',
    'runtime:',
    `  node: ${process.versions.node}`,
    '',
    'codex:',
    `  config: ${configText === '' ? 'missing' : configPath}`,
    `  cyrene mcp: ${cyreneConfigured ? 'configured' : 'missing'}`,
    `  agentmemory: ${agentmemoryEnabled ? 'enabled' : 'disabled'}`,
    `  status: ${agentmemoryEnabled ? 'not ready' : 'ready'}`,
    agentmemoryEnabled
      ? '  action: disable [mcp_servers.agentmemory] before validating Cyrene as the authoritative memory source'
      : '',
    '',
    'skill:',
    `  cyrene-continuity: ${skillExists ? 'ok' : 'missing'}`,
    '',
    'state:',
    `  codex root: ${codexGlobalRoot()}`,
    `  projectId: ${identity.projectId}`,
    `  displayName: ${identity.displayName}`
  ].filter((line) => line !== '').join('\n') + '\n'
}

function hasEnabledAgentmemory(configText: string): boolean {
  const match = /^\[mcp_servers\.agentmemory\]([\s\S]*?)(?:^\[|\z)/m.exec(configText)
  if (match === null) {
    return false
  }
  return !/^\s*enabled\s*=\s*false\s*$/m.test(match[1])
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
```

- [x] **Step 4: Implement install**

Create `src/codex/codex-install.ts`:

```ts
import { mkdir, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexGlobalRoot } from './codex-memory-root.js'

export async function installCodexDevBridge(): Promise<string> {
  const skillSource = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'integrations', 'codex', 'plugin', 'skills', 'cyrene-continuity')
  const skillTarget = join(homedir(), '.agents', 'skills', 'cyrene-continuity')
  await mkdir(dirname(skillTarget), { recursive: true })
  await rm(skillTarget, { recursive: true, force: true })
  await symlink(skillSource, skillTarget, 'dir')
  await mkdir(codexGlobalRoot(), { recursive: true })

  return [
    'Cyrene Codex dev bridge installed.',
    '',
    `skill: ${skillTarget} -> ${skillSource}`,
    '',
    'Add this MCP config manually to ~/.codex/config.toml:',
    '',
    '[mcp_servers.cyrene]',
    'command = "cyrene"',
    'args = ["mcp-server", "--stdio"]',
    'enabled = true',
    'required = false',
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 60',
    '',
    'Disable agentmemory before validating Cyrene as the authoritative memory source.',
    'Remove/comment [mcp_servers.agentmemory] or set enabled = false if your Codex config supports it.'
  ].join('\n') + '\n'
}
```

- [x] **Step 5: Implement Codex CLI dispatcher**

Create `src/codex/codex-cli.ts`:

```ts
import { formatCodexDoctor } from './codex-doctor.js'
import { installCodexDevBridge } from './codex-install.js'

export async function handleCodexCommand(input: { cwd: string; args: string[] }): Promise<void> {
  const command = input.args[0]
  if (command === 'doctor') {
    process.stdout.write(await formatCodexDoctor({ cwd: input.cwd, configPath: parseConfigPath(input.args) }))
    return
  }

  if (command === 'install' && input.args[1] === '--dev') {
    process.stdout.write(await installCodexDevBridge())
    return
  }

  console.error('Usage: cyrene codex <doctor [--config <path>]|install --dev>')
  process.exit(1)
}

function parseConfigPath(args: string[]): string | undefined {
  const index = args.indexOf('--config')
  if (index >= 0) return args[index + 1]
  const inline = args.find((arg) => arg.startsWith('--config='))
  return inline?.slice('--config='.length)
}
```

- [x] **Step 6: Create skill**

Create `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`:

```md
---
name: cyrene-continuity
description: Use Cyrene continuity for long-running engineering work, architecture decisions, typed memory, affective relationship strategy, MCP/Codex integration, persistent project context, and principled dissent.
---

# Cyrene Continuity Skill

Use this skill when the task benefits from Cyrene's long-term project memory, response strategy, or principled dissent.

## Required behavior

1. At the start of substantial planning, architecture, debugging, code review, or Cyrene-related work, call the MCP tool `cyrene_continuity_get` when available.
2. Use Cyrene memory as contextual guidance, not as unverified absolute truth.
3. If the user's proposal conflicts with safety, privacy, architecture quality, confirmed preferences, or Cyrene Phase 3/4 boundaries, challenge it directly with evidence.
4. Do not claim Cyrene has subjective emotion.
5. Do not infer mental health, dependence, instability, insecurity, or romantic attachment.
6. Do not write affective observations directly into active memory.
7. This MVP does not require hooks and does not automatically propose memory candidates.
8. Keep responses concise, concrete, and implementation-oriented.

## Boundaries

Phase 3 answers what Cyrene remembers.

Phase 4 answers how Cyrene understands the current interaction and what response policy it should use.

Affect and relationship analysis may influence tone, verbosity, dissent strength, and safety mode. It must not become psychological diagnosis or simulated subjective emotion.
```

- [x] **Step 7: Wire main CLI for codex command**

In `src/main.ts`, import:

```ts
import { handleCodexCommand } from './codex/codex-cli.js'
```

Add after `evolution` branch:

```ts
if (program.args[0] === 'codex') {
  await handleCodexCommand({
    cwd: options.cwd,
    args: program.args.slice(1)
  })
  return
}
```

- [x] **Step 8: Verify GREEN**

Run:

```bash
npm test -- tests/codex-cli.test.ts tests/main-cli.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 6: Full Verification And Commit

**Files:**
- All files from previous tasks.

- [x] **Step 1: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

- [x] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: exit code `0`.

- [x] **Step 3: Run doctor smoke command**

Run:

```bash
npm run dev -- codex doctor
```

Expected: stdout contains `Cyrene Codex Doctor` and does not modify files.

- [x] **Step 4: Run install smoke in isolated HOME**

Run:

```bash
tmp_home="$(mktemp -d)" && HOME="$tmp_home" npm run dev -- codex install --dev && test -f "$tmp_home/.agents/skills/cyrene-continuity/SKILL.md"
```

Expected: exit code `0`; stdout prints `[mcp_servers.cyrene]`; no real `~/.codex/config.toml` is modified.

- [x] **Step 5: Check git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status includes only intended files.

- [x] **Step 6: Commit implementation**

Run:

```bash
git add package.json package-lock.json src tests integrations docs/superpowers/plans/2026-05-25-codex-mcp-skill-local-bridge.md
git commit -m "feat: add codex mcp skill local bridge"
```

Expected: commit succeeds.


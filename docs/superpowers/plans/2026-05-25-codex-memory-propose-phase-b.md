# Codex Memory Propose Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Codex bridge 增加 `cyrene_memory_propose`、pending-only write、optional Stop hook install，并确保不会写 active memory。

**Architecture:** 新增 `src/codex/memory-propose.ts` 作为唯一 pending-only 写入入口，读写 `~/.cyrene/codex/projects/<projectId>/memory`。MCP server 注册 `cyrene_memory_propose`，Codex CLI 增加 `install-hook --stop` 和 `hook stop`，Stop hook 只捕获明确 durable signal。现有 memory lifecycle 不直接复用，以避免 auto-write 或 promote。

**Tech Stack:** TypeScript, Vitest, Node.js fs/path/crypto, Zod, `@modelcontextprotocol/sdk`, Codex hooks JSON。

---

## File Map

- Create: `src/codex/memory-propose.ts`
  - 构造 `PendingMemory`，调用 validator，但强制 pending-only 写入 Codex project memory root。
- Create: `src/codex/codex-hook-install.ts`
  - merge `~/.codex/hooks.json`，支持 dry-run 和真实安装 Stop hook。
- Create: `src/codex/codex-hook-stop.ts`
  - 读取 Stop hook stdin payload，best-effort 解析 transcript，捕获 explicit durable signal 并写 pending。
- Create: `src/mcp/tools/memory-propose.ts`
  - MCP tool schema 和 handler。
- Modify: `src/mcp/mcp-server.ts`
  - 注册 `cyrene_memory_propose`。
- Modify: `src/codex/codex-cli.ts`
  - 增加 `install-hook --stop [--dry-run]` 和 `hook stop`。
- Modify: `src/codex/codex-doctor.ts`
  - 增加 optional Stop hook 状态提示，不影响 readiness。
- Modify: `src/memory/memory-store.ts`
  - 增加 root-level pending/event/tombstone write helpers。
- Modify: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
  - 增加主动调用 `cyrene_memory_propose` 的规则。
- Create: `tests/codex-memory-propose.test.ts`
- Create: `tests/codex-hook-install.test.ts`
- Create: `tests/codex-hook-stop.test.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `tests/codex-cli.test.ts`

---

## Task 0: Baseline

**Files:**
- Read: `package.json`
- Read: `docs/superpowers/specs/2026-05-25-codex-memory-propose-phase-b-design.md`

- [ ] **Step 1: Confirm branch and status**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/codex-memory-propose-phase-b`, with only this plan file before the plan commit.

- [ ] **Step 2: Run baseline typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

- [ ] **Step 3: Run baseline tests**

Run:

```bash
npm test
```

Expected: exit code `0`.

---

## Task 1: Pending-Only Memory Propose Runtime

**Files:**
- Create: `tests/codex-memory-propose.test.ts`
- Create: `src/codex/memory-propose.ts`
- Modify: `src/memory/memory-store.ts`

- [ ] **Step 1: Write failing pending-only runtime tests**

Create `tests/codex-memory-propose.test.ts` with tests for:

```ts
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex memory propose', () => {
  it('writes a valid candidate to Codex project pending memory', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        content: 'Specs and plans for this user should be written in Chinese.',
        source: 'user_explicit',
        evidence: [{ runId: 'run-1', quote: '以后 spec 和 plan 默认用中文写。' }],
        tags: ['language']
      }
    })

    expect(result.result.action).toBe('pending')
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('Specs and plans for this user should be written in Chinese.')
    expect(pending).toContain('"seenCount":1')
    await expect(readFile(join(result.memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects candidates without evidence', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'The project uses Codex MCP.',
        evidence: []
      }
    })

    expect(result.result.action).toBe('reject')
    const events = await readFile(join(result.memoryRoot, 'events.jsonl'), 'utf8')
    expect(events).toContain('"action":"reject"')
  })

  it('downgrades auto-writable high-confidence candidates to pending', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        scope: 'project',
        content: 'Cyrene Phase B memory proposals are pending-only.',
        normalizedKey: 'cyrene-phase-b-pending-only',
        source: 'user_explicit',
        evidence: [{ runId: 'run-2', summary: 'User confirmed Phase B pending-only policy.' }],
        scores: {
          evidenceStrength: 0.95,
          stability: 0.95,
          usefulness: 0.9,
          safety: 0.95,
          sensitivity: 0.1
        }
      }
    })

    expect(result.result.action).toBe('pending')
    await expect(readFile(join(result.memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges duplicate pending candidates', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const candidate = {
      domain: 'procedural' as const,
      type: 'procedural_rule' as const,
      content: 'Use pending-only memory proposals for Codex.',
      normalizedKey: 'codex-pending-only-proposals',
      source: 'user_explicit' as const,
      evidence: [{ runId: 'run-1', summary: 'First observation.' }],
      tags: ['codex']
    }

    await proposeCodexMemoryCandidate({ cwd, candidate })
    await proposeCodexMemoryCandidate({
      cwd,
      candidate: { ...candidate, evidence: [{ runId: 'run-2', summary: 'Second observation.' }], tags: ['memory'] }
    })

    const identity = await identifyCodexProject(cwd)
    const pending = await readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"seenCount":2')
    expect(pending).toContain('First observation.')
    expect(pending).toContain('Second observation.')
    expect(pending).toContain('"codex"')
    expect(pending).toContain('"memory"')
  })

  it('refuses a symlinked Codex project memory root', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const outside = await createTempDir('cyrene-codex-propose-outside-')
    await mkdir(dirname(memoryRoot), { recursive: true })
    await symlink(outside, memoryRoot)

    await expect(proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'Should not write through symlink.',
        evidence: [{ runId: 'run-3', summary: 'Symlink test.' }]
      }
    })).rejects.toThrow(/memory symlink/)
  })
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-memory-propose.test.ts
```

Expected: FAIL because `src/codex/memory-propose.ts` does not exist.

- [ ] **Step 3: Add root-level write helpers**

Modify `src/memory/memory-store.ts` to export:

```ts
export async function writePendingMemoriesFromRoot(memoryRoot: string, memories: PendingMemory[]): Promise<void>
export async function upsertPendingMemoryFromRoot(memoryRoot: string, candidate: PendingMemory): Promise<PendingMemory>
export async function appendMemoryEventFromRoot(memoryRoot: string, event: MemoryEvent): Promise<void>
export async function readTombstonesFromRoot(memoryRoot: string): Promise<MemoryTombstone[]>
export async function appendTombstoneFromRoot(memoryRoot: string, tombstone: MemoryTombstone): Promise<void>
```

Implementation requirements:

- Use `mkdir(memoryRoot, { recursive: true })` before writes.
- Use existing symlink/non-directory check after creation.
- Existing `readActiveMemoriesFromRoot()` and `readPendingMemoriesFromRoot()` behavior must not change.
- Existing cwd-based functions should delegate to root helpers where possible.

- [ ] **Step 4: Implement `src/codex/memory-propose.ts`**

Create `src/codex/memory-propose.ts` with:

```ts
import type {
  MemoryDomain,
  MemoryEvidence,
  MemoryScope,
  MemoryScores,
  MemorySource,
  MemoryStrength,
  MemoryType
} from '../memory/types.js'

export interface CodexMemoryCandidateInput {
  domain: MemoryDomain
  type: MemoryType
  strength?: MemoryStrength
  scope?: MemoryScope
  content: string
  normalizedKey?: string
  source?: MemorySource
  evidence: MemoryEvidence[]
  scores?: Partial<MemoryScores>
  tags?: string[]
  userConfirmed?: boolean
}

export interface CodexMemoryProposeResult {
  project: {
    projectId: string
    displayName: string
  }
  result:
    | {
        action: 'pending'
        candidateId: string
        reason: string
      }
    | {
        action: 'reject'
        reason: string
      }
  memoryRoot: string
}

export async function proposeCodexMemoryCandidate(input: {
  cwd: string
  candidate: CodexMemoryCandidateInput
  now?: string
}): Promise<CodexMemoryProposeResult>
```

Implementation requirements:

- Identify project with `identifyCodexProject(input.cwd)`.
- Create Codex memory root with `ensureCodexProjectMemoryRoot(project.projectId)`.
- Convert input into `PendingMemory`.
- Validate with `validateMemoryCandidate()`.
- If decision is `reject`, write tombstone and reject event from root.
- If decision is `pending` or `auto_write`, write pending from root.
- Never call `processMemoryCandidate()`.
- Never call `writeActiveMemories()`.
- Never render memory projections.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/codex-memory-propose.test.ts tests/personal-memory-validator.test.ts tests/personal-memory-store.test.ts
```

Expected: all pass.

---

## Task 2: MCP Tool Registration

**Files:**
- Create: `src/mcp/tools/memory-propose.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP handler tests**

Modify `tests/mcp-server.test.ts` to import `handleMemoryPropose` and test:

```ts
it('handles memory propose as MCP JSON text', async () => {
  const result = await handleMemoryPropose({
    cwd: process.cwd(),
    candidate: {
      domain: 'procedural',
      type: 'procedural_rule',
      content: 'Codex memory proposals stay pending.',
      evidence: [{ runId: 'mcp-run-1', summary: 'MCP test.' }]
    }
  }, process.cwd())

  expect(result.content[0]?.type).toBe('text')
  expect(result.content[0]?.text).toContain('"action": "pending"')
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/mcp-server.test.ts
```

Expected: FAIL because `src/mcp/tools/memory-propose.ts` does not exist.

- [ ] **Step 3: Implement MCP tool module**

Create `src/mcp/tools/memory-propose.ts`:

```ts
export const memoryProposeInputSchema = {
  cwd: z.string().optional(),
  candidate: z.object({
    domain: z.enum(['project', 'personal', 'relationship', 'affective', 'procedural', 'system']),
    type: z.enum([
      'project_fact',
      'user_preference',
      'interaction_style',
      'relationship_boundary',
      'affective_pattern',
      'procedural_rule',
      'episode',
      'system_policy',
      'reference'
    ]),
    strength: z.enum(['hard', 'soft', 'session']).optional(),
    scope: z.enum(['global', 'project', 'session']).optional(),
    content: z.string(),
    normalizedKey: z.string().optional(),
    source: z.enum(['user_explicit', 'user_implicit', 'assistant_observed', 'tool_trace', 'file', 'legacy_markdown']).optional(),
    evidence: z.array(z.object({
      runId: z.string().optional(),
      quote: z.string().optional(),
      summary: z.string().optional()
    })),
    scores: z.object({
      evidenceStrength: z.number().optional(),
      stability: z.number().optional(),
      usefulness: z.number().optional(),
      safety: z.number().optional(),
      sensitivity: z.number().optional()
    }).optional(),
    tags: z.array(z.string()).optional(),
    userConfirmed: z.boolean().optional()
  })
}
```

`handleMemoryPropose(input, fallbackCwd)` calls `proposeCodexMemoryCandidate()` and returns `jsonText(result)`.

- [ ] **Step 4: Register tool in MCP server**

Modify `src/mcp/mcp-server.ts`:

```ts
server.registerTool(
  'cyrene_memory_propose',
  {
    description: 'Propose a structured Cyrene memory candidate for pending-only review.',
    inputSchema: memoryProposeInputSchema
  },
  async (input) => handleMemoryPropose(input, options.cwd)
)
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/codex-memory-propose.test.ts
npm run typecheck
```

Expected: all pass.

---

## Task 3: Optional Stop Hook Install And Doctor

**Files:**
- Create: `tests/codex-hook-install.test.ts`
- Create: `src/codex/codex-hook-install.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/codex-doctor.ts`
- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing hook install tests**

Create `tests/codex-hook-install.test.ts` with tests for:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatCodexStopHookInstall, installCodexStopHook } from '../src/codex/codex-hook-install.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex Stop hook install', () => {
  it('dry-runs without writing hooks.json', async () => {
    const home = await createTempDir('cyrene-codex-hook-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    const output = await formatCodexStopHookInstall({ hooksPath, dryRun: true })

    expect(output).toContain('dry-run')
    expect(output).toContain('codex hook stop')
    await expect(readFile(hooksPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges with an existing Stop hook and stays idempotent', async () => {
    const home = await createTempDir('cyrene-codex-hook-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(hooksPath, JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{ type: 'command', command: '/Users/phoenix/.codex/hooks/task_done_sound.sh', timeout: 5 }]
        }]
      }
    }, null, 2))

    await installCodexStopHook({ hooksPath })
    await installCodexStopHook({ hooksPath })

    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as { hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } }
    const commands = parsed.hooks.Stop.flatMap((entry) => entry.hooks.map((hook) => hook.command))
    expect(commands).toContain('/Users/phoenix/.codex/hooks/task_done_sound.sh')
    expect(commands.filter((command) => command.includes('codex hook stop'))).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-hook-install.test.ts
```

Expected: FAIL because hook install module does not exist.

- [ ] **Step 3: Implement hook install module**

Create `src/codex/codex-hook-install.ts`:

- `formatCodexStopHookInstall({ hooksPath?, dryRun })`
- `installCodexStopHook({ hooksPath? })`
- `mergeStopHookConfig(existing)`
- `codexStopHookCommand()`

Command string:

```txt
npm --prefix /Users/phoenix/Assistant/Cyrene run --silent dev -- codex hook stop
```

Hook entry:

```json
{
  "type": "command",
  "command": "<command>",
  "timeout": 5
}
```

- [ ] **Step 4: Wire CLI and doctor**

Modify `src/codex/codex-cli.ts`:

```ts
if (command === 'install-hook' && input.args[1] === '--stop') {
  const dryRun = input.args.includes('--dry-run')
  process.stdout.write(dryRun
    ? await formatCodexStopHookInstall({ dryRun: true })
    : await installCodexStopHook({})
  )
  return
}
```

Modify `src/codex/codex-doctor.ts` to show:

```txt
stop hook: configured|missing
advisory: optional Stop hook is not installed
```

Stop hook missing must not make `status` not ready.

- [ ] **Step 5: Add CLI tests**

Modify `tests/codex-cli.test.ts`:

- Test `codex install-hook --stop --dry-run` does not write isolated HOME hooks.
- Test `codex install-hook --stop` writes isolated HOME hooks and preserves existing sound hook.
- Test doctor shows stop hook advisory when missing.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- tests/codex-hook-install.test.ts tests/codex-cli.test.ts
npm run typecheck
```

Expected: all pass.

---

## Task 4: Stop Hook Runtime

**Files:**
- Create: `tests/codex-hook-stop.test.ts`
- Create: `src/codex/codex-hook-stop.ts`
- Modify: `src/codex/codex-cli.ts`

- [ ] **Step 1: Write failing hook stop tests**

Create `tests/codex-hook-stop.test.ts` with tests for:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { handleCodexStopHookPayload } from '../src/codex/codex-hook-stop.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex Stop hook runtime', () => {
  it('no-ops when transcript is missing', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-stop-project-')

    const result = await handleCodexStopHookPayload({ cwd, session_id: 's1', turn_id: 't1' })

    expect(result.action).toBe('noop')
    const identity = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes pending memory for explicit durable user instruction', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, [
      JSON.stringify({ role: 'user', content: '以后默认 Cyrene 的 spec 和 plan 用中文写。' }),
      JSON.stringify({ role: 'assistant', content: '已确认。' })
    ].join('\n') + '\n')

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's1',
      turn_id: 't1',
      transcript_path: transcript,
      last_assistant_message: '已确认。'
    })

    expect(result.action).toBe('pending')
    const identity = await identifyCodexProject(cwd)
    const pending = await readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')
    expect(pending).toContain('以后默认 Cyrene 的 spec 和 plan 用中文写。')
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('no-ops when transcript has no explicit durable signal', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '今天这个测试通过了吗？' }) + '\n')

    const result = await handleCodexStopHookPayload({ cwd, transcript_path: transcript })

    expect(result.action).toBe('noop')
  })
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts
```

Expected: FAIL because hook stop module does not exist.

- [ ] **Step 3: Implement hook stop module**

Create `src/codex/codex-hook-stop.ts`:

- `readJsonFromStdin()`
- `handleCodexStopHookPayload(payload)`
- `extractRecentExplicitMemoryInstruction(payload)`
- `parseTranscriptMessages(text)`

Durable signal regex must include:

```txt
记住|请记住|以后默认|之后默认|以后你要|以后请|from now on|please remember|remember that|default to
```

Candidate:

```ts
{
  domain: 'procedural',
  type: 'procedural_rule',
  strength: 'hard',
  scope: 'project',
  source: 'user_explicit',
  content: userMessage.slice(0, 500),
  evidence: [{ runId, quote: userMessage.slice(0, 500), summary: 'Codex Stop hook captured explicit durable user instruction.' }],
  tags: ['codex-hook', 'explicit-memory']
}
```

- [ ] **Step 4: Wire CLI**

Modify `src/codex/codex-cli.ts`:

```ts
if (command === 'hook' && input.args[1] === 'stop') {
  process.stdout.write(await handleCodexStopHookCommand())
  return
}
```

Invalid hook commands print usage.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts tests/codex-memory-propose.test.ts tests/codex-cli.test.ts
npm run typecheck
```

Expected: all pass.

---

## Task 5: Skill Update And Final Verification

**Files:**
- Modify: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
- Review: `docs/superpowers/specs/2026-05-25-codex-memory-propose-phase-b-design.md`

- [ ] **Step 1: Update skill instructions**

Modify the skill required behavior:

```md
9. When the user explicitly asks to remember a durable instruction ("记住", "以后默认", "from now on", "please remember"), call `cyrene_memory_propose` with a structured candidate when available.
10. Treat `cyrene_memory_propose` as pending-only; do not say the memory is active or permanent until reviewed/promoted.
11. Do not invent user preferences from assistant suggestions or silence.
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npm test -- tests/codex-memory-propose.test.ts tests/mcp-server.test.ts tests/codex-hook-install.test.ts tests/codex-hook-stop.test.ts tests/codex-cli.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected: exit code `0`.

- [ ] **Step 5: Smoke doctor and hook dry-run**

Run:

```bash
npm run dev -- codex doctor
npm run dev -- codex install-hook --stop --dry-run
```

Expected:

- doctor reports current MCP/skill/agentmemory state and optional Stop hook status.
- dry-run prints hook command and does not modify `~/.codex/hooks.json`.

- [ ] **Step 6: Check diff**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; changed files match this plan.

- [ ] **Step 7: Commit implementation**

Run:

```bash
git add src/codex src/mcp src/memory integrations/codex/plugin/skills/cyrene-continuity/SKILL.md tests/codex-memory-propose.test.ts tests/codex-hook-install.test.ts tests/codex-hook-stop.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts docs/superpowers/plans/2026-05-25-codex-memory-propose-phase-b.md
git commit -m "feat: add codex pending memory proposals"
```

Expected: commit succeeds on branch `codex/codex-memory-propose-phase-b`.

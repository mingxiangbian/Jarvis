# Codex Pending Memory Review Phase C-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Codex bridge 增加 pending memory 的 Codex 内 review 能力，让用户可以在 Codex 中 approve/reject 候选记忆，只有明确 approve 后才 promote 到 active。

**Architecture:** 新增 `src/codex/memory-review.ts` 作为 pending review 的唯一 runtime：负责 list/get、`reviewHash`、promote、reject、audit event 和 Codex memory root projection。MCP 层只做 schema/handler/registration，`cyrene_continuity_get` 只暴露 `pendingReview` notice，不把 pending 内容注入 ordinary continuity memory。`cyrene_memory_propose` 保持 pending-only，但 pending 结果附带 compact review metadata。

**Tech Stack:** TypeScript, Vitest, Node.js fs/path/crypto, Zod, `@modelcontextprotocol/sdk`, Codex MCP stdio tools, Cyrene memory store JSONL。

---

## File Map

- Create: `src/codex/memory-review.ts`
  - Codex pending review runtime。提供 list/get/promote/reject、`reviewHash`、pending summary、pending review notice。
- Create: `src/mcp/tools/memory-review.ts`
  - MCP schemas 和 handlers：`cyrene_memory_pending_list`、`cyrene_memory_pending_get`、`cyrene_memory_promote`、`cyrene_memory_reject`。
- Create: `tests/codex-memory-review.test.ts`
  - Runtime TDD 测试，覆盖 list/get/promote/reject/hash conflict/validator reject。
- Modify: `src/memory/memory-store.ts`
  - 增加 `writeActiveMemoriesFromRoot()` root-level helper。
- Modify: `src/memory/memory-exporter.ts`
  - 增加 `renderMemoryProjectionsFromRoot()`，让 Codex memory root 也能生成 projections。
- Modify: `src/codex/memory-propose.ts`
  - pending result 增加 `review` summary metadata，不改变 pending-only 写入。
- Modify: `src/codex/continuity-context.ts`
  - 返回 `pendingReview` notice；`memory.items` 仍只来自 active memory。
- Modify: `src/mcp/mcp-server.ts`
  - 注册 4 个 pending review tools。
- Modify: `tests/codex-memory-propose.test.ts`
  - 验证 pending result 包含 review metadata。
- Modify: `tests/codex-continuity-context.test.ts`
  - 验证 pendingReview notice 存在且 pending 内容不进入 `memory.items`。
- Modify: `tests/mcp-server.test.ts`
  - 验证 MCP handlers 返回 JSON text，server 注册仍可创建。
- Modify: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
  - 增加 Codex 内 review 行为规则。
- Create: `docs/superpowers/spikes/2026-05-25-codex-mcp-elicitation.md`
  - 记录 native approve/reject popup 能力验证结论和 fallback。

---

## Task 0: Baseline And Capability Spike Record

**Files:**
- Read: `docs/superpowers/specs/2026-05-25-codex-pending-memory-review-phase-c-a-design.md`
- Read: `node_modules/@modelcontextprotocol/sdk/README.md`
- Create: `docs/superpowers/spikes/2026-05-25-codex-mcp-elicitation.md`

- [x] **Step 1: Confirm branch and tracked status**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/codex-pending-memory-review-phase-c-a`.

- [x] **Step 2: Run narrow baseline tests**

Run:

```bash
npm test -- tests/codex-memory-propose.test.ts tests/codex-continuity-context.test.ts tests/mcp-server.test.ts
```

Expected: exit code `0`, 3 files pass.

- [ ] **Step 3: Write the elicitation spike record**

Create `docs/superpowers/spikes/2026-05-25-codex-mcp-elicitation.md`:

```markdown
# Codex MCP Elicitation Spike

## Question

Can Cyrene force Codex app to show a native approve/reject popup for pending memory, similar to tool permission approval?

## Local Evidence

- `@modelcontextprotocol/sdk` documents elicitation support, including form elicitation and URL elicitation.
- The current Cyrene MCP server uses `McpServer.registerTool()` over stdio.
- The current Codex-visible Cyrene MCP integration exposes tools, but this project has no proven path that renders custom MCP elicitation as a Codex-native permission modal.
- Stop hook execution happens after an assistant turn, so it cannot interrupt the already-finished response with a permission-style prompt.

## Decision For Phase C-A

Use Codex chat-native approval as the primary path:

1. Pending memory is written to `pending.jsonl`.
2. Codex surfaces a pending review notice through `cyrene_continuity_get` or `cyrene_memory_propose`.
3. User explicitly replies approve or reject.
4. Codex calls `cyrene_memory_promote` or `cyrene_memory_reject`.

Native elicitation remains future work unless a later manual Codex app test proves structured elicitation is rendered as a suitable approve/reject UI.

## Fallback

If Codex app does not support custom MCP elicitation UI, Phase C-A still works through MCP tools and chat review.
```

- [ ] **Step 4: Commit the spike record**

Run:

```bash
git add docs/superpowers/spikes/2026-05-25-codex-mcp-elicitation.md
git commit -m "docs: record codex mcp elicitation spike"
```

Expected: commit succeeds.

---

## Task 1: Pending Review Runtime

**Files:**
- Create: `tests/codex-memory-review.test.ts`
- Create: `src/codex/memory-review.ts`
- Modify: `src/memory/memory-store.ts`
- Modify: `src/memory/memory-exporter.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `tests/codex-memory-review.test.ts` with this structure:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  getCodexPendingMemory,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory,
  reviewHashForPendingMemory
} from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { PendingMemory } from '../src/memory/types.js'

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

async function seedPending(cwd: string, pending: PendingMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), pending.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return memoryRoot
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Use Codex chat approval before promoting pending memory.',
    normalizedKey: 'codex-chat-approval-before-promote',
    evidence: [{ runId: 'run-1', summary: 'User confirmed Codex pending review workflow.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

describe('Codex pending memory review', () => {
  it('lists pending memories with review hashes and evidence summaries', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    await seedPending(cwd, [candidate])

    const result = await listCodexPendingMemories({ cwd })

    expect(result.total).toBe(1)
    expect(result.pending[0]).toMatchObject({
      id: 'pending-1',
      content: 'Use Codex chat approval before promoting pending memory.',
      evidenceSummary: ['User confirmed Codex pending review workflow.']
    })
    expect(result.pending[0]?.reviewHash).toBe(reviewHashForPendingMemory(candidate))
  })

  it('gets a pending memory by id with full candidate and review hash', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    await seedPending(cwd, [candidate])

    const result = await getCodexPendingMemory({ cwd, id: 'pending-1' })

    expect(result.result.action).toBe('get')
    if (result.result.action !== 'get') throw new Error('expected get')
    expect(result.result.candidate.content).toBe(candidate.content)
    expect(result.result.reviewHash).toBe(reviewHashForPendingMemory(candidate))
  })

  it('promotes a pending memory after hash confirmation', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User approved in Codex.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    const index = await readFile(join(memoryRoot, 'index.jsonl'), 'utf8')
    expect(index).toContain(candidate.content)
    expect(index).toContain('"userConfirmed":true')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending.trim()).toBe('')
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(events).toContain('"action":"promote"')
    const projection = await readFile(join(memoryRoot, 'MEMORY.md'), 'utf8')
    expect(projection).toContain(candidate.content)
  })

  it('rejects a pending memory after hash confirmation and writes a tombstone', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await rejectCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User rejected in Codex.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('reject')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending.trim()).toBe('')
    const tombstones = await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')
    expect(tombstones).toContain(candidate.normalizedKey)
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(events).toContain('"action":"reject"')
  })

  it('returns conflict and does not mutate files when review hash is stale', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: 'stale',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('conflict')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
  })

  it('blocks promote when validator rejects the candidate', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending({
      id: 'pending-unsafe',
      normalizedKey: 'unsafe-affective-diagnostic',
      domain: 'affective',
      type: 'affective_pattern',
      content: 'The user is emotionally dependent and unstable.'
    })
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('rejected_by_validator')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
  })
})
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts
```

Expected: fail because `src/codex/memory-review.ts` does not exist or exported functions are missing.

- [ ] **Step 3: Add root-level active write and projection helpers**

Modify `src/memory/memory-store.ts` to export:

```ts
export async function writeActiveMemoriesFromRoot(memoryRoot: string, memories: CyreneMemory[]): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await writeJsonLinesAtomic(join(root, INDEX_FILE), memories.filter((memory) => memory.status === 'active'))
}
```

Modify `writeActiveMemories()` to call the new helper:

```ts
export async function writeActiveMemories(cwd: string, memories: CyreneMemory[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writeActiveMemoriesFromRoot(root, memories)
}
```

Modify `src/memory/memory-exporter.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureMemoryRoot } from './paths.js'
import { readActiveMemories, readActiveMemoriesFromRoot } from './memory-store.js'
import type { CyreneMemory } from './types.js'
```

Add:

```ts
export async function renderMemoryProjectionsFromRoot(memoryRoot: string): Promise<void> {
  const memories = await readActiveMemoriesFromRoot(memoryRoot)
  await writeMemoryProjections(memoryRoot, memories)
}
```

Change `renderMemoryProjections()` to:

```ts
export async function renderMemoryProjections(cwd: string): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  const memories = await readActiveMemories(cwd)
  await writeMemoryProjections(root, memories)
}
```

Add private helper:

```ts
async function writeMemoryProjections(root: string, memories: CyreneMemory[]): Promise<void> {
  const projectionsDir = join(root, 'projections')
  await mkdir(projectionsDir, { recursive: true })

  const overall = formatMemoryProjection(memories, 'overall')
  await Promise.all([
    writeFile(join(projectionsDir, 'MEMORY.md'), overall, 'utf8'),
    writeFile(join(projectionsDir, 'PROJECT.md'), formatMemoryProjection(memories, 'project'), 'utf8'),
    writeFile(join(projectionsDir, 'PERSONAL.md'), formatMemoryProjection(memories, 'personal'), 'utf8'),
    writeFile(join(projectionsDir, 'AFFECT.md'), formatMemoryProjection(memories, 'affect'), 'utf8'),
    writeFile(join(root, 'MEMORY.md'), overall, 'utf8')
  ])
}
```

- [ ] **Step 4: Implement `src/codex/memory-review.ts`**

Create `src/codex/memory-review.ts` with these exported APIs:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { renderMemoryProjectionsFromRoot } from '../memory/memory-exporter.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { activateCandidate, validateMemoryCandidate } from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'
```

Define types:

```ts
export interface CodexPendingMemorySummary {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  content: string
  normalizedKey: string
  source: string
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  expiresAt?: string
  reviewHash: string
  evidenceSummary: string[]
  scores: PendingMemory['scores']
}

export interface CodexPendingReviewNotice {
  count: number
  hasItems: boolean
  newestCandidateId?: string
  newestPreview?: string
}
```

Implementation rules:

```ts
export function reviewHashForPendingMemory(candidate: PendingMemory): string {
  const payload = {
    id: candidate.id,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    evidence: candidate.evidence,
    scores: candidate.scores,
    lastSeenAt: candidate.lastSeenAt
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
```

Use this summary helper:

```ts
export function summarizePendingMemory(candidate: PendingMemory): CodexPendingMemorySummary {
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    source: candidate.source,
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    expiresAt: candidate.expiresAt,
    reviewHash: reviewHashForPendingMemory(candidate),
    evidenceSummary: candidate.evidence
      .map((entry) => entry.summary ?? entry.quote ?? entry.runId ?? '')
      .filter((text) => text.trim() !== ''),
    scores: candidate.scores
  }
}
```

`listCodexPendingMemories()` should identify project, read pending from `codexProjectMemoryRoot(project.projectId)`, sort newest first by `lastSeenAt`, apply `limit` only when provided, and return `{ project, pending, total, memoryRoot }`.

`getCodexPendingMemory()` should return `{ action: 'get', candidate, reviewHash }` or `{ action: 'not_found', candidateId, reason }`.

`promoteCodexPendingMemory()` should:

1. read pending by id;
2. return `not_found` when missing;
3. compare `reviewHash`;
4. return `conflict` with latest summary when stale;
5. rerun `validateMemoryCandidate()` with current active memories and tombstones;
6. return `rejected_by_validator` only when validator returns `reject`;
7. set `userConfirmed: true`, call `activateCandidate()`, upsert by id or `normalizedKey`;
8. remove pending, append `promote` event, render projections from Codex root.

`rejectCodexPendingMemory()` should:

1. read pending by id;
2. return `not_found` when missing;
3. compare `reviewHash`;
4. return `conflict` with latest summary when stale;
5. remove pending;
6. append tombstone with `reason: 'rejected'`;
7. append `reject` event.

Use local helper:

```ts
function upsertActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  const index = active.findIndex((candidate) => candidate.id === memory.id || candidate.normalizedKey === memory.normalizedKey)
  if (index < 0) return [...active, memory]
  const next = [...active]
  next[index] = memory
  return next
}
```

- [ ] **Step 5: Run runtime tests and verify GREEN**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts
```

Expected: all tests in `tests/codex-memory-review.test.ts` pass.

- [ ] **Step 6: Commit runtime changes**

Run:

```bash
git add src/codex/memory-review.ts src/memory/memory-store.ts src/memory/memory-exporter.ts tests/codex-memory-review.test.ts
git commit -m "feat: add codex pending memory review runtime"
```

Expected: commit succeeds.

---

## Task 2: MCP Tools, Propose Review Metadata, And Continuity Notice

**Files:**
- Create: `src/mcp/tools/memory-review.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `tests/codex-memory-propose.test.ts`
- Modify: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Write failing propose metadata test**

Add to `tests/codex-memory-propose.test.ts`:

```ts
  it('returns review metadata for pending candidates', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        content: 'Review pending Codex memories before promotion.',
        source: 'user_explicit',
        evidence: [{ runId: 'run-review', summary: 'User approved Phase C-A review workflow.' }]
      }
    })

    expect(result.result.action).toBe('pending')
    if (result.result.action !== 'pending') throw new Error('expected pending')
    expect(result.result.review).toMatchObject({
      id: result.result.candidateId,
      content: 'Review pending Codex memories before promotion.',
      evidenceSummary: ['User approved Phase C-A review workflow.']
    })
    expect(result.result.review.reviewHash).toMatch(/^[a-f0-9]{64}$/)
  })
```

Run:

```bash
npm test -- tests/codex-memory-propose.test.ts
```

Expected: fail because `result.result.review` does not exist.

- [ ] **Step 2: Update `proposeCodexMemoryCandidate()` to include review metadata**

Modify `src/codex/memory-propose.ts`:

```ts
import type { CodexPendingMemorySummary } from './memory-review.js'
import { summarizePendingMemory } from './memory-review.js'
```

Change pending result type:

```ts
| {
    action: 'pending'
    candidateId: string
    reason: string
    review: CodexPendingMemorySummary
  }
```

Change pending return:

```ts
result: { action: 'pending', candidateId: merged.id, reason, review: summarizePendingMemory(merged) },
```

Run:

```bash
npm test -- tests/codex-memory-propose.test.ts
```

Expected: pass.

- [ ] **Step 3: Write failing continuity pendingReview test**

Add to `tests/codex-continuity-context.test.ts`:

```ts
  it('returns pendingReview metadata without exposing pending content as memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-pending-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-pending-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify({
      id: 'pending-1',
      domain: 'procedural',
      type: 'procedural_rule',
      strength: 'hard',
      scope: 'project',
      status: 'pending',
      content: 'Pending content must not be active continuity memory.',
      normalizedKey: 'pending-content-not-active',
      evidence: [{ runId: 'run-pending', summary: 'Pending test.' }],
      source: 'user_explicit',
      scores: {
        evidenceStrength: 0.9,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.95,
        sensitivity: 0.1
      },
      seenCount: 1,
      firstSeenAt: '2026-05-25T00:00:00.000Z',
      lastSeenAt: '2026-05-25T00:00:00.000Z',
      expiresAt: '2026-06-24T00:00:00.000Z',
      tags: ['codex']
    })}\n`)

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'review memory',
      task: 'memory'
    })

    expect(context.pendingReview).toEqual({
      count: 1,
      hasItems: true,
      newestCandidateId: 'pending-1',
      newestPreview: 'Pending content must not be active continuity memory.'
    })
    expect(context.memory.items).toEqual([])
  })
```

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: fail because `pendingReview` does not exist.

- [ ] **Step 4: Add pendingReview to continuity context**

Modify `src/codex/continuity-context.ts`:

```ts
import { getCodexPendingReviewNotice } from './memory-review.js'
```

Add to `CodexContinuityContext`:

```ts
  pendingReview: {
    count: number
    hasItems: boolean
    newestCandidateId?: string
    newestPreview?: string
  }
```

Inside `getCodexContinuityContext()` after memories are retrieved:

```ts
  const pendingReview = await getCodexPendingReviewNotice({ cwd: input.cwd })
```

Return:

```ts
    pendingReview,
```

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: pass.

- [ ] **Step 5: Write failing MCP handler tests**

Modify `tests/mcp-server.test.ts` imports:

```ts
import {
  handleMemoryPendingGet,
  handleMemoryPendingList,
  handleMemoryPromote,
  handleMemoryReject
} from '../src/mcp/tools/memory-review.js'
```

Add test:

```ts
  it('handles pending memory review tools as MCP JSON text', async () => {
    const home = await createTempDir('cyrene-mcp-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-review-project-')
    const proposed = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'procedural',
          type: 'procedural_rule',
          content: 'Codex can review pending memory in chat.',
          evidence: [{ runId: 'mcp-review-1', summary: 'MCP review test.' }]
        }
      },
      process.cwd()
    )
    const proposedJson = JSON.parse(proposed.content[0]?.text ?? '{}')
    const candidateId = proposedJson.result.candidateId
    const reviewHash = proposedJson.result.review.reviewHash

    const list = await handleMemoryPendingList({ cwd }, process.cwd())
    expect(list.content[0]?.text).toContain('"total": 1')

    const get = await handleMemoryPendingGet({ cwd, id: candidateId }, process.cwd())
    expect(get.content[0]?.text).toContain('"action": "get"')

    const reject = await handleMemoryReject({ cwd, id: candidateId, reviewHash, reason: 'MCP test reject.' }, process.cwd())
    expect(reject.content[0]?.text).toContain('"action": "reject"')

    const promoteMissing = await handleMemoryPromote({ cwd, id: candidateId, reviewHash }, process.cwd())
    expect(promoteMissing.content[0]?.text).toContain('"action": "not_found"')
  })
```

Run:

```bash
npm test -- tests/mcp-server.test.ts
```

Expected: fail because `src/mcp/tools/memory-review.ts` does not exist.

- [ ] **Step 6: Implement MCP review handlers and register tools**

Create `src/mcp/tools/memory-review.ts`:

```ts
import { z } from 'zod'
import {
  getCodexPendingMemory,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory
} from '../../codex/memory-review.js'
import { jsonText } from '../mcp-json.js'

export const memoryPendingListInputSchema = {
  cwd: z.string().optional(),
  limit: z.number().int().positive().optional()
}

export const memoryPendingGetInputSchema = {
  cwd: z.string().optional(),
  id: z.string()
}

export const memoryReviewDecisionInputSchema = {
  cwd: z.string().optional(),
  id: z.string(),
  reviewHash: z.string(),
  reason: z.string().optional()
}

export async function handleMemoryPendingList(input: { cwd?: string; limit?: number }, fallbackCwd: string) {
  return jsonText(await listCodexPendingMemories({ cwd: input.cwd ?? fallbackCwd, limit: input.limit }))
}

export async function handleMemoryPendingGet(input: { cwd?: string; id: string }, fallbackCwd: string) {
  return jsonText(await getCodexPendingMemory({ cwd: input.cwd ?? fallbackCwd, id: input.id }))
}

export async function handleMemoryPromote(
  input: { cwd?: string; id: string; reviewHash: string; reason?: string },
  fallbackCwd: string
) {
  return jsonText(await promoteCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    reason: input.reason
  }))
}

export async function handleMemoryReject(
  input: { cwd?: string; id: string; reviewHash: string; reason?: string },
  fallbackCwd: string
) {
  return jsonText(await rejectCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    reason: input.reason
  }))
}
```

Modify `src/mcp/mcp-server.ts` to import and register:

```ts
import {
  handleMemoryPendingGet,
  handleMemoryPendingList,
  handleMemoryPromote,
  handleMemoryReject,
  memoryPendingGetInputSchema,
  memoryPendingListInputSchema,
  memoryReviewDecisionInputSchema
} from './tools/memory-review.js'
```

Register tools:

```ts
  server.registerTool(
    'cyrene_memory_pending_list',
    {
      description: 'List Codex pending Cyrene memory candidates waiting for user review.',
      inputSchema: memoryPendingListInputSchema
    },
    async (input) => handleMemoryPendingList(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_pending_get',
    {
      description: 'Get one Codex pending Cyrene memory candidate and its review hash.',
      inputSchema: memoryPendingGetInputSchema
    },
    async (input) => handleMemoryPendingGet(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_promote',
    {
      description: 'Promote a reviewed Codex pending memory candidate after explicit user approval.',
      inputSchema: memoryReviewDecisionInputSchema
    },
    async (input) => handleMemoryPromote(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_reject',
    {
      description: 'Reject a reviewed Codex pending memory candidate after explicit user rejection.',
      inputSchema: memoryReviewDecisionInputSchema
    },
    async (input) => handleMemoryReject(input, options.cwd)
  )
```

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/codex-memory-propose.test.ts tests/codex-continuity-context.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 7: Commit MCP and continuity integration**

Run:

```bash
git add src/mcp/tools/memory-review.ts src/mcp/mcp-server.ts src/codex/memory-propose.ts src/codex/continuity-context.ts tests/mcp-server.test.ts tests/codex-memory-propose.test.ts tests/codex-continuity-context.test.ts
git commit -m "feat: expose codex pending memory review tools"
```

Expected: commit succeeds.

---

## Task 3: Skill Guidance And Final Verification

**Files:**
- Modify: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`

- [ ] **Step 1: Update skill rules**

Modify `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md` required behavior section:

```markdown
10. Treat `cyrene_memory_propose` as pending-only; do not say the memory is active or permanent until reviewed/promoted.
11. If `cyrene_memory_propose` returns a pending `review` object, show it as a pending candidate and ask for explicit approve/reject before calling promotion tools.
12. If `cyrene_continuity_get` returns `pendingReview.hasItems: true`, tell the user there are pending memory candidates and use `cyrene_memory_pending_list` / `cyrene_memory_pending_get` when they want to review them.
13. Only call `cyrene_memory_promote` after the user explicitly says approve/批准/同意/保留 for a specific pending candidate.
14. Only call `cyrene_memory_reject` after the user explicitly says reject/拒绝/删除/不要记 for a specific pending candidate.
15. Pending memory candidates are not active continuity memory. Do not use pending content as factual context until promoted.
16. When multiple pending candidates exist, show at most three at a time unless the user asks for more.
17. Do not invent user preferences from assistant suggestions or silence.
```

Keep existing safety boundaries about affective memory and durable explicit memory instructions.

- [ ] **Step 2: Add a test assertion for skill guidance**

Add to `tests/mcp-server.test.ts`:

```ts
  it('documents pending review behavior in the Codex continuity skill', async () => {
    const skill = await readFile('integrations/codex/plugin/skills/cyrene-continuity/SKILL.md', 'utf8')

    expect(skill).toContain('cyrene_memory_pending_list')
    expect(skill).toContain('cyrene_memory_promote')
    expect(skill).toContain('cyrene_memory_reject')
    expect(skill).toContain('Pending memory candidates are not active continuity memory')
  })
```

If adding this to `tests/mcp-server.test.ts`, add `readFile` to its `node:fs/promises` import.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-memory-propose.test.ts tests/codex-continuity-context.test.ts tests/mcp-server.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run dev -- codex doctor
git diff --check
```

Expected:

- `npm run typecheck` exits `0`.
- `npm test` exits `0`.
- `npm run dev -- codex doctor` exits `0`.
- `git diff --check` exits `0`.

- [ ] **Step 5: Commit skill and final verification changes**

Run:

```bash
git add integrations/codex/plugin/skills/cyrene-continuity/SKILL.md tests/mcp-server.test.ts
git commit -m "docs: update codex continuity pending review guidance"
```

Expected: commit succeeds.

---

## Self-Review Checklist

- [x] Spec coverage: plan covers Codex chat-native review, MCP list/get/promote/reject, propose review metadata, continuity pendingReview notice, explicit user approval, reject tombstone, and elicitation fallback.
- [x] Scope check: no broad transcript summarization, no Web UI, no CLI approval primary path, no edit-before-promote.
- [x] Type consistency: `reviewHash`, `pendingReview`, `CodexPendingMemorySummary`, and MCP handler names are consistent across tasks.
- [x] TDD: runtime, propose metadata, continuity notice, MCP handlers, and skill guidance each have tests before implementation.
- [x] Verification: final task includes focused tests, full typecheck/test/doctor/diff-check.

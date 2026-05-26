# Phase C-D Auto-Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Phase C-D：Dream-gated repeated evidence auto-promotion、bounded active memory maintenance、`MODEL_PROFILE.md` projection、task-aware retrieval budget，并让 Codex continuity 能读到 global/project profile。

**Architecture:** `index.jsonl` 继续是 source of truth，`pending.jsonl` 继续是候选入口。Dream Deep stage 是唯一自动 promote 写 active memory 的路径；人工 approve 仍保留。`MODEL_PROFILE.md` 是唯一 Markdown projection 类型，由 active memory deterministic render，Codex runtime 组合 global profile、project profile 和 task-scoped retrieval。

**Tech Stack:** TypeScript, Vitest, Node fs/promises, existing Codex memory roots, existing memory validator/store/snapshot, MCP SDK.

---

## Assumptions

- 当前分支是 `codex/phase-c-d-auto-promotion`。
- 本 plan 执行范围在 Cyrene 主 repo 内；不拆独立 repo。
- 不引入 vector DB、embedding 或 Web review UI。
- 不让 Stop hook 同步跑长任务；hook 只写 pending、review summary、due marker，并保持 fail-open。
- `MODEL_PROFILE.md` 替换旧 generated Markdown projection；不长期双写 `MEMORY.md` / `projections/*.md`。
- `profileVisibility` 不用 sensitivity 做一刀切 gate；`safe_summary` 可进入 profile，但必须是抽象、可表面化表达。

## File Structure

- Modify: `src/memory/types.ts`
  - 增加 `MemoryProfileVisibility`。
  - 给 `MemoryEvidence` 增加 evidence grouping metadata。
  - 给 `PendingMemory` / `CyreneMemory` 增加 optional `profileVisibility`。
- Modify: `src/memory/memory-validator.ts`
  - 保留现有 validator。
  - 增加 Dream promotion policy helper：distinct evidence、domain-adjusted thresholds、noise/sensitive gate。
- Modify: `src/memory/memory-store.ts`
  - 暴露 JSONL size / write helper 需要的 root-level API。
  - 保持 atomic write。
- Modify: `src/memory/memory-exporter.ts`
  - 改为只写 `MODEL_PROFILE.md`。
  - 保留 `renderMemoryProjections*` 函数名作为兼容 API，但语义变成 render model profile。
  - 安全删除旧 generated projection files。
- Create: `src/memory/memory-maintenance.ts`
  - root-level maintenance：snapshot、expire、dedupe、trim、archive、render profile。
- Modify: `src/memory/memory-snapshot.ts`
  - 增加 `createMemorySnapshotFromRoot`，供 Codex global/project root 使用。
- Modify: `src/memory/memory-retriever.ts`
  - 使用 `estimateTokens`。
  - 增加 task-aware budget helper 和 optional debug reasons。
- Modify: `src/config.ts`
  - 增加 Phase C-D memory budgets 和 Dream config defaults。
- Create: `src/codex/memory-dream-state.ts`
  - 管理 `dream-state.json` 和 due marker。
- Create: `src/codex/memory-dream.ts`
  - 实现 Light / REM / Deep stages、lock、manual run。
- Modify: `src/codex/continuity-context.ts`
  - 返回 effective profile。
  - 使用 task-aware retrieval budget。
  - 做 lightweight overdue check / due marker，不同步跑 Deep。
- Modify: `src/codex/memory-review.ts`
  - 人工 promote 后运行 maintenance 并重新 render profile。
- Modify: `src/codex/codex-hook-stop.ts`
  - pending upsert 后 mark Dream due，失败 fail-open。
- Modify: `src/codex/codex-doctor.ts`
  - 报告 Dream state、profile presence、budget summary。
- Modify: `src/codex/codex-cli.ts`
  - 增加 `cyrene codex memory dream|profile|maintenance` debug/manual commands。
- Modify: `src/mcp/mcp-server.ts`
  - 注册 `cyrene_memory_dream_run` 和 `cyrene_memory_profile_get`。
- Create: `src/mcp/tools/memory-dream.ts`
  - MCP wrapper for manual Dream run and profile get。
- Tests:
  - Create/modify tests listed per task below.

## Baseline

- [x] **Step 1: Verify current branch**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/phase-c-d-auto-promotion`, with only this plan file before the plan commit.

- [x] **Step 2: Verify baseline tests**

Run:

```bash
npm test
npm run typecheck
```

Expected: `61 passed (61)` test files, `462 passed (462)` tests, and `tsc --noEmit` exits 0.

---

### Task 1: Schema And Promotion Policy

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-validator.ts`
- Modify: `tests/personal-memory-validator.test.ts`
- Create: `tests/codex-memory-promotion-policy.test.ts`

- [ ] **Step 1: Add schema fields**

Modify `src/memory/types.ts` with these additions:

```ts
export type MemoryProfileVisibility = 'always' | 'safe_summary' | 'retrieval_only' | 'never'

export interface MemoryEvidence {
  runId?: string
  messageIds?: string[]
  traceRefs?: string[]
  quote?: string
  summary?: string
  evidenceGroupId?: string
  sessionId?: string
  taskHash?: string
  quoteHash?: string
  sourceKind?: MemorySource
}
```

Add this field to both `CyreneMemory` and `PendingMemory`:

```ts
profileVisibility?: MemoryProfileVisibility
```

- [ ] **Step 2: Preserve profile visibility on activation**

Modify `activateCandidate` in `src/memory/memory-validator.ts` so promoted memory preserves the candidate field:

```ts
profileVisibility: candidate.profileVisibility,
```

Use a conditional spread if TypeScript complains about optional exactness:

```ts
...(candidate.profileVisibility === undefined ? {} : { profileVisibility: candidate.profileVisibility }),
```

- [ ] **Step 3: Add deterministic policy helpers**

In `src/memory/memory-validator.ts`, export:

```ts
export interface PendingPromotionPolicyResult {
  promotable: boolean
  reason: string
  distinctEvidenceCount: number
}

export function distinctEvidenceCount(candidate: PendingMemory): number
export function deriveProfileVisibility(memory: Pick<PendingMemory, 'domain' | 'type' | 'strength' | 'source' | 'scores' | 'content' | 'userConfirmed' | 'profileVisibility'>): MemoryProfileVisibility
export function evaluatePendingPromotion(candidate: PendingMemory, now?: string): PendingPromotionPolicyResult
```

Behavior:

- `distinctEvidenceCount` groups evidence by `evidenceGroupId` when present, else `sessionId`, else `runId`, else hash of `summary|quote`.
- Same hook/run repeated evidence counts once.
- `userConfirmed === true` can satisfy distinct evidence count but not safety/sensitivity/tombstone/diagnostic gates.
- `evaluatePendingPromotion` rejects low-value noise:
  - `OK`, `确认`, `可以`, `继续` by themselves.
  - tool-call logs like `Ran npm test`, `read file`, `hook returned`.
  - transient status like `merged and pushed`, current branch, one-time CI/test result.
  - assistant-derived silence phrases already covered by `hasAssistantDerivedEvidence`.
- Thresholds:
  - `project` / `procedural` / `system`: `seenCount >= 2`, `distinctEvidenceCount >= 2` or `userConfirmed`, `evidenceStrength >= 0.75`, `stability >= 0.70`, `usefulness >= 0.60`, `safety >= 0.80`, `sensitivity <= 0.60`.
  - `personal` / `relationship`: `seenCount >= 3`, `distinctEvidenceCount >= 3` or `userConfirmed`, `evidenceStrength >= 0.80`, `stability >= 0.75`, `usefulness >= 0.65`, `safety >= 0.85`, `sensitivity <= 0.45`.
  - `affective`: `seenCount >= 3`, `distinctEvidenceCount >= 3` or `userConfirmed`, `evidenceStrength >= 0.85`, `stability >= 0.80`, `usefulness >= 0.65`, `safety >= 0.90`, `sensitivity <= 0.30`, no diagnostic claim.
- `deriveProfileVisibility`:
  - explicit `profileVisibility` wins.
  - secret/credential/diagnostic/private raw detail returns `never`.
  - hard procedural/project/system with `safety >= 0.8` returns `always`.
  - personal/relationship/affective with `safety >= 0.85` returns `safe_summary` unless sensitivity is too high.
  - otherwise `retrieval_only`.

Update `isPromotablePending` to call `evaluatePendingPromotion(candidate).promotable`. Do not remove existing `validateMemoryCandidate` behavior.

- [ ] **Step 4: Write failing policy tests**

Create `tests/codex-memory-promotion-policy.test.ts` with tests for:

```ts
import { describe, expect, it } from 'vitest'
import {
  deriveProfileVisibility,
  distinctEvidenceCount,
  evaluatePendingPromotion
} from '../src/memory/memory-validator.js'
import type { PendingMemory } from '../src/memory/types.js'

describe('Codex repeated evidence promotion policy', () => {
  it('counts repeated same run evidence once', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', summary: 'First', evidenceGroupId: 'same' },
        { runId: 'run-1', summary: 'Second duplicate', evidenceGroupId: 'same' }
      ]
    })

    expect(distinctEvidenceCount(candidate)).toBe(1)
    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('promotes project/procedural memory after independent repeated evidence', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', summary: 'First observation.' },
        { runId: 'run-2', summary: 'Second observation.' }
      ]
    })

    const result = evaluatePendingPromotion(candidate)
    expect(result).toMatchObject({ promotable: true, distinctEvidenceCount: 2 })
  })

  it('does not promote low-value confirmation noise', () => {
    const candidate = createPending({
      content: '确认',
      normalizedKey: 'confirm',
      seenCount: 5,
      evidence: [
        { runId: 'run-1', quote: '确认' },
        { runId: 'run-2', quote: '确认' }
      ]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('allows user-confirmed hard procedural memory to satisfy evidence count', () => {
    const candidate = createPending({
      userConfirmed: true,
      seenCount: 1,
      evidence: [{ runId: 'run-1', quote: '记住：以后 spec 和 plan 默认用中文写。' }]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(true)
  })

  it('derives safe profile visibility without treating sensitivity as the only gate', () => {
    expect(deriveProfileVisibility(createPending({ strength: 'hard' }))).toBe('always')
    expect(deriveProfileVisibility(createPending({
      domain: 'personal',
      type: 'interaction_style',
      strength: 'soft',
      scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.9, safety: 0.9, sensitivity: 0.4 }
    }))).toBe('safe_summary')
  })
})

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Specs and plans default to Chinese.',
    normalizedKey: 'spec-plan-chinese',
    evidence: [{ runId: 'run-1', summary: 'User asked for Chinese specs and plans.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-26T00:00:00.000Z',
    lastSeenAt: '2026-05-26T00:00:00.000Z',
    expiresAt: '2026-06-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}
```

- [ ] **Step 5: Run task tests**

Run:

```bash
npm test -- tests/codex-memory-promotion-policy.test.ts tests/personal-memory-validator.test.ts
npm run typecheck
```

Expected: all selected tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/memory/types.ts src/memory/memory-validator.ts tests/codex-memory-promotion-policy.test.ts tests/personal-memory-validator.test.ts
git commit -m "feat: add codex memory promotion policy"
```

---

### Task 2: MODEL_PROFILE.md Renderer

**Files:**
- Modify: `src/memory/memory-exporter.ts`
- Modify: `tests/personal-memory-retriever.test.ts`
- Modify: `tests/codex-memory-review.test.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Update renderer target constants**

In `src/memory/memory-exporter.ts`, replace old projection constants with:

```ts
const GENERATED_HEADER = '<!-- Generated from index.jsonl. Do not edit manually. -->'
const MODEL_PROFILE_FILE = 'MODEL_PROFILE.md'
const LEGACY_PROJECTION_FILES = [
  'MEMORY.md',
  'projections/MEMORY.md',
  'projections/PROJECT.md',
  'projections/PERSONAL.md',
  'projections/AFFECT.md'
] as const
```

- [ ] **Step 2: Keep public API but write only MODEL_PROFILE.md**

Keep these exports:

```ts
export async function renderMemoryProjections(cwd: string): Promise<void>
export async function renderMemoryProjectionsFromRoot(memoryRoot: string): Promise<void>
export async function assertMemoryProjectionTargetsSafe(memoryRoot: string): Promise<string>
export function formatMemoryProjection(memories: CyreneMemory[], kind?: 'model_profile'): string
```

Implementation requirements:

- `renderMemoryProjections*` writes only `<memoryRoot>/MODEL_PROFILE.md`.
- `assertMemoryProjectionTargetsSafe` verifies root and `MODEL_PROFILE.md` target only.
- Do not create `projections/`.
- Delete legacy generated files only when safe:
  - target exists,
  - target is a regular file,
  - target content starts with old generated header or new generated header.
  - never follow symlinks.
- If `projections/` becomes empty, remove it. If not empty, leave it.

- [ ] **Step 3: Implement deterministic profile format**

`formatMemoryProjection` should produce:

```md
<!-- Generated from index.jsonl. Do not edit manually. -->

# Cyrene Model Profile

## Always Apply
- ...

## Project Context
- ...

## Interaction Preferences
- ...

## Response Policy
- ...

## Restricted Notes
- ...
```

Rules:

- Only active memory can appear.
- Use `deriveProfileVisibility`.
- Exclude `retrieval_only` and `never`.
- `safe_summary` entries must pass through a deterministic `profileSafeContent(memory)`:
  - remove obvious secret-like values.
  - reject diagnostic affective content.
  - for personal/relationship/affective, output concise behavioral guidance, not raw sensitive detail.
- Sorting priority:
  1. `always`
  2. `strength === 'hard'`
  3. `scope === 'global'`
  4. `source === 'user_explicit'` or `userConfirmed`
  5. usefulness
  6. evidenceStrength
  7. safety
  8. `safe_summary`
  9. updatedAt
- Default `maxProfileChars` can be a module constant `DEFAULT_MODEL_PROFILE_MAX_CHARS = 6000`.
- If over budget, keep `Always Apply` first.

- [ ] **Step 4: Update tests**

Update assertions that currently read:

```ts
join(memoryRoot, 'MEMORY.md')
join(cwd, '.cyrene', 'memory', 'MEMORY.md')
join(cwd, '.cyrene', 'memory', 'projections', 'MEMORY.md')
```

to read:

```ts
join(memoryRoot, 'MODEL_PROFILE.md')
join(cwd, '.cyrene', 'memory', 'MODEL_PROFILE.md')
```

Add tests:

- profile contains hard procedural/project memory.
- profile excludes `profileVisibility: 'retrieval_only'`.
- profile excludes diagnostic affective content.
- legacy generated `MEMORY.md` / `projections/*.md` are removed if generated.
- symlinked `MODEL_PROFILE.md` is rejected before mutation.

- [ ] **Step 5: Run task tests**

Run:

```bash
npm test -- tests/personal-memory-retriever.test.ts tests/codex-memory-review.test.ts tests/web-server.test.ts
npm run typecheck
```

Expected: selected tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add src/memory/memory-exporter.ts tests/personal-memory-retriever.test.ts tests/codex-memory-review.test.ts tests/web-server.test.ts
git commit -m "feat: render model profile projection"
```

---

### Task 3: Retrieval Budget And Continuity Profile

**Files:**
- Modify: `src/config.ts`
- Modify: `src/memory/memory-retriever.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/web/prompt-context.ts`
- Modify: `tests/personal-memory-retriever.test.ts`
- Modify: `tests/codex-continuity-context.test.ts`
- Modify: `tests/web-prompt-context.test.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add config fields**

Extend `AppConfig` with:

```ts
memoryAutoPromoteEnabled: boolean
memoryActiveMaxItems: number
memoryActiveContentMaxChars: number
memoryIndexFileMaxChars: number
memorySingleContentMaxChars: number
memorySingleEvidenceMaxChars: number
memoryPendingMaxItems: number
memoryProfileMaxChars: number
memoryProfileAlwaysOnEnabled: boolean
memoryMaintenanceSnapshotsMax: number
memoryDreamEnabled: boolean
memoryDreamIntervalHours: number
memoryDreamCatchUpEnabled: boolean
memoryDreamLockTtlMs: number
memoryDreamMaxRuntimeMs: number
memoryDreamModel?: string
```

Add defaults in `createDefaultConfig`:

```ts
memoryAutoPromoteEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE'), true),
memoryActiveMaxItems: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_ACTIVE_MAX_ITEMS'), 300),
memoryActiveContentMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_ACTIVE_CONTENT_MAX_CHARS'), 50_000),
memoryIndexFileMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_INDEX_FILE_MAX_CHARS'), 250_000),
memorySingleContentMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_SINGLE_CONTENT_MAX_CHARS'), 300),
memorySingleEvidenceMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_SINGLE_EVIDENCE_MAX_CHARS'), 1_000),
memoryPendingMaxItems: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_PENDING_MAX_ITEMS'), 100),
memoryProfileMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_PROFILE_MAX_CHARS'), 6_000),
memoryProfileAlwaysOnEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_PROFILE_ALWAYS_ON'), true),
memoryMaintenanceSnapshotsMax: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_MAINTENANCE_SNAPSHOTS_MAX'), 20),
memoryDreamEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_ENABLED'), true),
memoryDreamIntervalHours: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_INTERVAL_HOURS'), 24),
memoryDreamCatchUpEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_CATCH_UP'), true),
memoryDreamLockTtlMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_LOCK_TTL_MS'), 15 * 60 * 1000),
memoryDreamMaxRuntimeMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_MAX_RUNTIME_MS'), 60_000),
memoryDreamModel: optionalEnvValue(dotEnv, 'CYRENE_MEMORY_DREAM_MODEL')
```

- [ ] **Step 2: Use shared CJK-aware token estimator**

In `src/memory/memory-retriever.ts`, remove local `estimateTokens` and import:

```ts
import { estimateTokens } from '../token-counter.js'
```

Add:

```ts
export interface MemoryRetrievalBudget {
  maxItems: number
  maxTokens: number
}

export function memoryRetrievalBudgetForTask(task: NonNullable<RetrieveMemoriesInput['task']>): MemoryRetrievalBudget {
  if (task === 'coding' || task === 'debugging') return { maxItems: 12, maxTokens: 2_000 }
  if (task === 'planning') return { maxItems: 16, maxTokens: 3_000 }
  if (task === 'memory') return { maxItems: 24, maxTokens: 4_000 }
  return { maxItems: 10, maxTokens: 1_500 }
}
```

Callers may still override `maxItems` / `maxTokens`; Codex continuity should use the helper.

- [ ] **Step 3: Add effective profile loading**

In `src/codex/continuity-context.ts`, add profile output:

```ts
profile: {
  global?: string
  project?: string
  content: string
}
```

Load:

```ts
const globalProfile = await readProfileIfExists(codexGlobalMemoryRoot())
const projectProfile = await readProfileIfExists(codexProjectMemoryRoot(project.projectId))
const profileContent = [globalProfile, projectProfile].filter(Boolean).join('\n\n')
```

Return `profile.content`, but do not include pending memories.

- [ ] **Step 4: Include profile in local agent runtime**

In `src/web/prompt-context.ts`, load local `<memoryRoot>/MODEL_PROFILE.md` when `memoryProfileAlwaysOnEnabled` is true, and add it before `formatMemoryContext(memories)`:

```ts
const memoryProfile = config.memoryProfileAlwaysOnEnabled
  ? await loadMemoryProfile(config.memoryCwd)
  : ''
```

Use header:

```md
## Model Profile
...
```

If file is missing, return empty string.

- [ ] **Step 5: Update tests**

Add tests:

- `retrieveMemories` with Chinese content now respects CJK token budget more conservatively.
- `memoryRetrievalBudgetForTask('planning')` returns `{ maxItems: 16, maxTokens: 3000 }`.
- `getCodexContinuityContext` returns global + project profile content.
- pending content never appears in profile.
- `buildAgentRuntime` includes `MODEL_PROFILE.md` when present.
- `createDefaultConfig` exposes Phase C-D budget and Dream defaults.

- [ ] **Step 6: Run task tests**

Run:

```bash
npm test -- tests/token-counter.test.ts tests/personal-memory-retriever.test.ts tests/codex-continuity-context.test.ts tests/web-prompt-context.test.ts tests/config.test.ts
npm run typecheck
```

Expected: selected tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/memory/memory-retriever.ts src/codex/continuity-context.ts src/web/prompt-context.ts tests/token-counter.test.ts tests/personal-memory-retriever.test.ts tests/codex-continuity-context.test.ts tests/web-prompt-context.test.ts tests/config.test.ts
git commit -m "feat: add model profile continuity context"
```

---

### Task 4: Root-Level Maintenance

**Files:**
- Modify: `src/memory/memory-snapshot.ts`
- Create: `src/memory/memory-maintenance.ts`
- Modify: `src/codex/memory-review.ts`
- Modify: `tests/codex-memory-review.test.ts`
- Create: `tests/memory-maintenance.test.ts`

- [ ] **Step 1: Add root snapshot API**

In `src/memory/memory-snapshot.ts`, add:

```ts
export async function createMemorySnapshotFromRoot(memoryRoot: string, reason: string): Promise<MemorySnapshotSummary>
```

It should mirror `createMemorySnapshot(cwd, reason)` but read active/pending/tombstones from root-level store functions and write under `<memoryRoot>/snapshots`.

- [ ] **Step 2: Add maintenance runtime**

Create `src/memory/memory-maintenance.ts`:

```ts
export interface MemoryMaintenanceBudget {
  activeMaxItems: number
  activeContentMaxChars: number
  indexFileMaxChars: number
  singleMemoryContentMaxChars: number
  singleMemoryEvidenceMaxChars: number
  pendingMaxItems: number
}

export interface MemoryMaintenanceResult {
  memoryRoot: string
  snapshotId: string
  expired: number
  deduped: number
  archived: number
  trimmed: number
  activeCount: number
  pendingCount: number
}

export async function runMemoryMaintenanceFromRoot(input: {
  memoryRoot: string
  budget: MemoryMaintenanceBudget
  now?: string
  reason?: string
}): Promise<MemoryMaintenanceResult>
```

Behavior:

- Create snapshot first.
- Remove expired active memories and write `expired` tombstones/events.
- Merge active memories with same `normalizedKey`:
  - keep higher `scores.evidenceStrength`, then newer `updatedAt`.
  - merge evidence capped by budget.
  - merge tags and `supersedes`.
- Trim content to `singleMemoryContentMaxChars` with suffix `...`.
- Trim evidence quote/summary total to `singleMemoryEvidenceMaxChars`.
- If still over `activeMaxItems` or `activeContentMaxChars`, archive lowest usefulness/evidence/safety memories first, never archive hard global/procedural memory unless no other option.
- Write active, tombstones, events, then render `MODEL_PROFILE.md`.

- [ ] **Step 3: Run maintenance after manual promote**

In `src/codex/memory-review.ts`, after writing active/pending/event in `promoteCodexPendingMemory`, call `runMemoryMaintenanceFromRoot` using default budget from `createDefaultConfig(input.cwd)`.

Do not run maintenance before hash check or validator check.

- [ ] **Step 4: Write tests**

Create `tests/memory-maintenance.test.ts` with tests:

- creates snapshot before mutating.
- expires active memory and writes tombstone.
- dedupes same `normalizedKey`.
- trims overlong content/evidence.
- archives low usefulness memories when over item budget.
- renders `MODEL_PROFILE.md`.

Update `tests/codex-memory-review.test.ts`:

- manual promote still writes active and removes pending.
- manual promote now writes `MODEL_PROFILE.md`.
- maintenance snapshot exists after promote.

- [ ] **Step 5: Run task tests**

Run:

```bash
npm test -- tests/memory-maintenance.test.ts tests/codex-memory-review.test.ts tests/personal-memory-migration.test.ts
npm run typecheck
```

Expected: selected tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add src/memory/memory-snapshot.ts src/memory/memory-maintenance.ts src/codex/memory-review.ts tests/memory-maintenance.test.ts tests/codex-memory-review.test.ts
git commit -m "feat: add bounded memory maintenance"
```

---

### Task 5: Dream-Gated Auto Promotion

**Files:**
- Create: `src/codex/memory-dream-state.ts`
- Create: `src/codex/memory-dream.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/review-summary-runtime.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/mcp/mcp-server.ts`
- Create: `src/mcp/tools/memory-dream.ts`
- Create: `tests/codex-memory-dream.test.ts`
- Modify: `tests/codex-memory-propose.test.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Implement dream state**

Create `src/codex/memory-dream-state.ts`:

```ts
export interface CodexMemoryDreamState {
  lastDreamAt?: string
  nextDreamDueAt?: string
  dreamDue: boolean
  lastDreamStatus?: 'success' | 'skipped' | 'failed'
  lastDreamError?: string
}

export async function readCodexMemoryDreamState(memoryRoot: string): Promise<CodexMemoryDreamState>
export async function writeCodexMemoryDreamState(memoryRoot: string, state: CodexMemoryDreamState): Promise<void>
export async function markCodexMemoryDreamDue(memoryRoot: string, now?: string): Promise<void>
export function nextDreamDueAt(now: string, intervalHours: number): string
```

State file path: `<memoryRoot>/dream-state.json`. Use atomic write. Missing file returns `{ dreamDue: false }`.

- [ ] **Step 2: Implement Dream runtime**

Create `src/codex/memory-dream.ts`:

```ts
export type CodexMemoryDreamStage = 'light' | 'rem' | 'deep'

export interface CodexMemoryDreamResult {
  project: { projectId: string; displayName: string }
  roots: Array<{
    memoryRoot: string
    stage: CodexMemoryDreamStage
    promoted: number
    rejected: number
    keptPending: number
    maintenance?: MemoryMaintenanceResult
    skipped?: string
  }>
}

export async function runCodexMemoryDream(input: {
  cwd: string
  stage?: CodexMemoryDreamStage
  now?: string
}): Promise<CodexMemoryDreamResult>
```

Behavior:

- Roots: global root if readable/writable and current project root.
- Light:
  - read pending.
  - write merged pending by existing `upsertPendingMemoryFromRoot` behavior if duplicates are present.
  - write audit event.
  - no active writes.
- REM:
  - compute `distinctEvidenceCount`.
  - add event details with proposed action.
  - no active writes.
- Deep:
  - acquire `<memoryRoot>/.locks/dream.lock`.
  - if lock exists and not expired, skip root.
  - create snapshot through maintenance when mutation occurs.
  - for each pending candidate, call `evaluatePendingPromotion`.
  - if promotable, validate with `validateMemoryCandidate`; if accepted, activate candidate, remove from pending, write promote event.
  - if validator rejects unsafe/tombstone/diagnostic, remove from pending and write tombstone/event.
  - if evidence insufficient, keep pending.
  - run `runMemoryMaintenanceFromRoot`.
  - render `MODEL_PROFILE.md`.
  - update dream state.
  - release lock.
- All root writes use atomic store helpers. Deep errors update dream state as failed and rethrow for manual command; hook paths will catch.

- [ ] **Step 3: Mark due after proposing pending**

In `src/codex/memory-propose.ts`, after successful pending upsert, call `markCodexMemoryDreamDue(memoryRoot, now)`. Catch errors and continue; propose must remain pending-only and fail-open for due marker.

- [ ] **Step 4: Add evidence grouping to review-summary candidates**

In `src/codex/review-summary-runtime.ts`, update generated candidate evidence so every evidence item has:

```ts
{
  runId,
  sessionId: input.sessionId,
  evidenceGroupId: stableEvidenceGroupId({ runId, sessionId: input.sessionId, summary, quote }),
  sourceKind: candidate.source
}
```

Use deterministic hashing from `node:crypto`. Do not include raw transcript text in `evidenceGroupId`; hash only the already redacted summary/quote plus run/session identifiers.

In `src/codex/codex-hook-stop.ts`, update explicit durable instruction evidence to include:

```ts
sourceKind: 'user_explicit',
sessionId: asString(payload.session_id),
evidenceGroupId: stableEvidenceGroupId(...)
```

In `src/codex/memory-review.ts`, include `evidenceGroupId`, `sessionId`, `taskHash`, `quoteHash`, and `sourceKind` in `reviewHashForPendingMemory`. This intentionally makes evidence provenance review-significant. Existing pending candidates without those fields still hash normally because missing fields serialize as `null`.

- [ ] **Step 5: Add CLI and MCP tools**

In `src/codex/codex-cli.ts`, support:

```txt
cyrene codex memory dream [--stage light|rem|deep]
cyrene codex memory profile
```

`dream` prints JSON result from `runCodexMemoryDream`.

`profile` prints effective global + current project `MODEL_PROFILE.md`.

In `src/mcp/tools/memory-dream.ts`, add schemas and handlers:

```ts
cyrene_memory_dream_run: { cwd?: string; stage?: 'light' | 'rem' | 'deep' }
cyrene_memory_profile_get: { cwd?: string }
```

Register both in `src/mcp/mcp-server.ts`.

- [ ] **Step 6: Write tests**

Create `tests/codex-memory-dream.test.ts`:

- Light does not write `index.jsonl`.
- REM does not write `index.jsonl`.
- Deep promotes repeated independent procedural memory.
- Deep keeps insufficient evidence pending.
- Deep does not promote same-run duplicate evidence.
- Deep rejects diagnostic affective claim and writes tombstone.
- Deep writes `MODEL_PROFILE.md`.
- lock prevents concurrent Deep run.
- stale lock can be replaced.
- global-scope pending in global root promotes to global active root.

Update existing tests:

- `tests/codex-memory-propose.test.ts`: pending propose writes/updates `dream-state.json` due marker.
- `tests/codex-review-summary-runtime.test.ts`: generated candidates include stable `evidenceGroupId` and `sourceKind`.
- `tests/codex-hook-stop.test.ts`: explicit durable memory evidence includes stable grouping metadata.
- `tests/codex-memory-review.test.ts`: changing `evidenceGroupId` changes the review hash.
- `tests/mcp-server.test.ts`: tools are registered and return JSON text.
- `tests/codex-cli.test.ts`: CLI accepts `codex memory dream --stage deep` and `codex memory profile`.

- [ ] **Step 7: Run task tests**

Run:

```bash
npm test -- tests/codex-memory-dream.test.ts tests/codex-memory-propose.test.ts tests/codex-review-summary-runtime.test.ts tests/codex-hook-stop.test.ts tests/codex-memory-review.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts
npm run typecheck
```

Expected: selected tests and typecheck pass.

- [ ] **Step 8: Commit**

```bash
git add src/codex/memory-dream-state.ts src/codex/memory-dream.ts src/codex/memory-propose.ts src/codex/review-summary-runtime.ts src/codex/codex-hook-stop.ts src/codex/memory-review.ts src/codex/codex-cli.ts src/mcp/mcp-server.ts src/mcp/tools/memory-dream.ts tests/codex-memory-dream.test.ts tests/codex-memory-propose.test.ts tests/codex-review-summary-runtime.test.ts tests/codex-hook-stop.test.ts tests/codex-memory-review.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts
git commit -m "feat: add codex memory dream pass"
```

---

### Task 6: Hook, Doctor, Cleanup, And Final Verification

**Files:**
- Modify: `src/codex/codex-hook-stop.ts`
- Modify: `src/codex/codex-doctor.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
- Modify: tests impacted by `rg`.
- Modify: `docs/superpowers/plans/2026-05-26-phase-c-d-auto-promotion.md`

- [ ] **Step 1: Hook fail-open due marker**

In `src/codex/codex-hook-stop.ts`, ensure all due-marker or Dream-state failures are caught. `handleCodexStopHookCommand` must still output exactly:

```json
{"continue":true,"suppressOutput":true}
```

Add tests:

- invalid JSON stdin still returns valid hook JSON.
- due marker failure still returns valid hook JSON.
- Stop hook does not create `index.jsonl` directly.

- [ ] **Step 2: Doctor reports Phase C-D state**

In `src/codex/codex-doctor.ts`, add:

```txt
memory:
  global profile: present|missing
  project profile: present|missing
  dream due: yes|no
  last dream: <timestamp|never>
  auto promote: enabled|disabled
```

Do not make missing profile a readiness blocker.

- [ ] **Step 3: Continuity overdue check**

In `src/codex/continuity-context.ts`, if `memoryDreamCatchUpEnabled` is true and Dream state is overdue, mark `dreamDue: true` for the current project root. Do not run Deep in continuity get.

Add debug-safe output only if already present in profile/pending notice; default continuity output should not expose raw dream state details except profile and memory items.

- [ ] **Step 4: Skill doc update**

Update `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`:

- Explain pending review is still available.
- Explain repeated evidence may auto-promote only after Dream Deep.
- Explain `cyrene_memory_profile_get` and `cyrene_memory_dream_run`.
- Keep approve/reject rules unchanged for pending candidates shown in chat.

- [ ] **Step 5: Remove old projection assumptions**

Run:

```bash
rg -n "MEMORY\\.md|projections/PROJECT|projections/PERSONAL|projections/AFFECT|projections/MEMORY" src tests integrations docs/superpowers/plans/2026-05-26-phase-c-d-auto-promotion.md
```

Expected: only historical docs, migration comments, or explicit legacy cleanup tests remain. Runtime code should prefer `MODEL_PROFILE.md`.

- [ ] **Step 6: Full verification**

Run:

```bash
npm test
npm run typecheck
git diff --check
```

Expected:

- all Vitest test files pass.
- `tsc --noEmit` exits 0.
- `git diff --check` exits 0.

- [ ] **Step 7: Manual smoke**

Use a temporary HOME and project:

```bash
tmp_home="$(mktemp -d)"
tmp_repo="$(mktemp -d)"
HOME="$tmp_home" npx tsx src/main.ts --cwd "$tmp_repo" codex memory dream --stage deep
```

Expected: command prints JSON, does not throw, and creates no active memory when there is no pending memory.

Then seed two same-key pending candidates through `proposeCodexMemoryCandidate` or a small `npx tsx` script, run:

```bash
HOME="$tmp_home" npx tsx src/main.ts --cwd "$tmp_repo" codex memory dream --stage deep
```

Expected:

- candidate moves from `pending.jsonl` to `index.jsonl`.
- `MODEL_PROFILE.md` exists.
- old generated projections are not created.

- [ ] **Step 8: Commit final cleanup**

```bash
git add src tests integrations docs/superpowers/plans/2026-05-26-phase-c-d-auto-promotion.md
git commit -m "test: verify phase c-d memory workflow"
```

## Final Review Checklist

- [ ] `index.jsonl` remains source of truth.
- [ ] Stop hook never writes active memory.
- [ ] One weak candidate does not auto-promote.
- [ ] Same-run duplicate evidence does not auto-promote.
- [ ] Repeated independent evidence can promote through Dream Deep.
- [ ] Unsafe/diagnostic content does not promote.
- [ ] Manual approve/reject still works.
- [ ] Global memory root still works across projects.
- [ ] `MODEL_PROFILE.md` generated for global/project roots.
- [ ] `cyrene_continuity_get` returns profile + task retrieval.
- [ ] Old generated projections are no longer generated.
- [ ] Store maintenance creates snapshot before mutation.
- [ ] Full `npm test`, `npm run typecheck`, and `git diff --check` pass.

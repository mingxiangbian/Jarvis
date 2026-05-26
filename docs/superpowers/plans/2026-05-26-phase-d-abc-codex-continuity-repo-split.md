# Phase D ABC Codex Continuity Repo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Codex continuity bridge 从 Cyrene 主 repo 独立到 `cyrene-continuity` repo，同时修复 global pending review 可见性并完成本机 cutover。

**Architecture:** 先在当前 Cyrene repo 内完成 D-A regression tests 和最小修复，确保 global + project pending 的 MCP review 行为正确。随后创建 `/Users/phoenix/Assistant/cyrene-continuity`，只迁移 Codex bridge、MCP、memory runtime 和插件 skill 所需代码，不迁移 Cyrene Web UI / desktop / agent runtime。最后通过 installer 和 automation update 切换本机 Codex 配置；只有确认本机不再引用旧 bridge 后，才删除 Cyrene 主 repo 中的 Codex bridge 代码。

**Tech Stack:** TypeScript, Node.js 20+, `commander`, `@modelcontextprotocol/sdk`, `zod`, `vitest`, `tsx`, npm, GitHub CLI / `gh`, Codex automations.

---

## Assumptions

- 当前工作分支是 `/Users/phoenix/Assistant/Cyrene` 的 `codex/phase-d-a-repo-split-readiness`。
- 新 repo 固定为 `/Users/phoenix/Assistant/cyrene-continuity`，GitHub remote 固定为 `github.com/mingxiangbian/cyrene-continuity`。
- `~/.cyrene/codex/` 是用户现有数据根目录，Phase D 不迁移、不复制、不重写这些数据。
- `src/memory/` 在 Cyrene 主 repo 里也可能被主产品功能使用；D-C cleanup 只删除 Codex bridge 专属代码，不整目录删除 `src/memory/`。
- 删除旧 bridge 的 gate 是本机引用扫描通过：`~/.codex/config.toml`、`~/.codex/hooks.json`、`~/.agents/skills/cyrene-continuity`、`~/.codex/automations/*/automation.toml` 不再把 MCP / Skill / hook / Dream Deep command 指向 `/Users/phoenix/Assistant/Cyrene`。

## File Map

- Modify in current repo:
  - `tests/codex-memory-review.test.ts`: global + project pending root regression tests.
  - `tests/codex-continuity-context.test.ts`: `pendingReview` sees global pending without injecting pending as active memory.
  - `tests/mcp-server.test.ts`: MCP handler-level list/get/promote/reject coverage for global pending.
  - `tests/codex-cli.test.ts` or `tests/codex-doctor.test.ts`: doctor reports pending counts and command freshness.
  - `src/codex/memory-review.ts`: root-aware pending list/get/promote/reject implementation if tests expose a gap.
  - `src/codex/continuity-context.ts`: ensure pending review notice is root-aware if tests expose a gap.
  - `src/codex/codex-doctor.ts`: pending counts and stale command diagnostics.
  - `src/codex/codex-install.ts` / `src/codex/codex-hook-install.ts`: only if D-A tests show current installer output hides stale command risk.
- Create new repo:
  - `/Users/phoenix/Assistant/cyrene-continuity/package.json`
  - `/Users/phoenix/Assistant/cyrene-continuity/tsconfig.json`
  - `/Users/phoenix/Assistant/cyrene-continuity/vitest.config.ts`
  - `/Users/phoenix/Assistant/cyrene-continuity/README.md`
  - `/Users/phoenix/Assistant/cyrene-continuity/.gitignore`
  - `/Users/phoenix/Assistant/cyrene-continuity/src/main.ts`
  - `/Users/phoenix/Assistant/cyrene-continuity/src/config.ts`
  - `/Users/phoenix/Assistant/cyrene-continuity/src/llm-client.ts`
  - `/Users/phoenix/Assistant/cyrene-continuity/src/codex/**`
  - `/Users/phoenix/Assistant/cyrene-continuity/src/mcp/**`
  - `/Users/phoenix/Assistant/cyrene-continuity/src/memory/**`
  - `/Users/phoenix/Assistant/cyrene-continuity/plugin/skills/cyrene-continuity/SKILL.md`
  - `/Users/phoenix/Assistant/cyrene-continuity/plugin/.codex-plugin/plugin.json`
  - `/Users/phoenix/Assistant/cyrene-continuity/tests/**`
- Local cutover artifacts:
  - `~/.codex/config.toml`
  - `~/.codex/hooks.json`
  - `~/.agents/skills/cyrene-continuity`
  - `~/.codex/automations/cyrene-memory-dream-deep/automation.toml`

## Task 1: D-A Global Pending Regression Tests

**Files:**
- Modify: `tests/codex-memory-review.test.ts`
- Modify: `tests/codex-continuity-context.test.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] **Step 1: Consult codegraph for the pending review area**

Run codegraph context before editing:

```txt
task: Phase D-A global pending review visibility for list/get/promote/reject and continuity pendingReview
```

Expected: context identifies `src/codex/memory-review.ts`, `src/codex/continuity-context.ts`, and MCP memory review handlers.

- [ ] **Step 2: Add global pending helpers to `tests/codex-memory-review.test.ts`**

Patch the import:

```ts
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
```

Add this helper next to `seedPending`:

```ts
async function seedGlobalPending(pending: PendingMemory[]): Promise<string> {
  const memoryRoot = codexGlobalMemoryRoot()
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), pending.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return memoryRoot
}
```

- [ ] **Step 3: Add review root behavior tests**

Add these tests inside `describe('Codex pending memory review', () => { ... })`:

```ts
it('lists global pending memories when the current project has no pending file', async () => {
  const home = await createTempDir('cyrene-review-global-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-review-global-project-')
  const candidate = createPending({
    id: 'global-pending-1',
    scope: 'global',
    content: 'Global pending memory should be visible from any project.',
    lastSeenAt: '2026-05-25T02:00:00.000Z'
  })
  const globalRoot = await seedGlobalPending([candidate])

  const result = await listCodexPendingMemories({ cwd })

  expect(result.total).toBe(1)
  expect(result.memoryRoot).toBe(codexProjectMemoryRoot((await identifyCodexProject(cwd)).projectId))
  expect(result.pending[0]?.id).toBe(candidate.id)
  expect(await getCodexPendingMemory({ cwd, id: candidate.id })).toMatchObject({
    memoryRoot: globalRoot,
    result: { action: 'get' }
  })
})

it('lists global and project pending memories newest first', async () => {
  const home = await createTempDir('cyrene-review-global-project-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-review-global-project-')
  await seedGlobalPending([
    createPending({
      id: 'global-old',
      scope: 'global',
      content: 'Older global pending memory.',
      lastSeenAt: '2026-05-25T01:00:00.000Z'
    })
  ])
  await seedPending(cwd, [
    createPending({
      id: 'project-new',
      scope: 'project',
      content: 'Newer project pending memory.',
      lastSeenAt: '2026-05-25T03:00:00.000Z'
    })
  ])

  const result = await listCodexPendingMemories({ cwd })

  expect(result.total).toBe(2)
  expect(result.pending.map((item) => item.id)).toEqual(['project-new', 'global-old'])
})

it('promotes a global pending memory only in the global root', async () => {
  const home = await createTempDir('cyrene-review-promote-global-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-review-promote-global-project-')
  const candidate = createPending({
    id: 'global-promote',
    scope: 'global',
    content: 'Promoted global pending memory stays in global memory root.',
    normalizedKey: 'global-promote-root'
  })
  const globalRoot = await seedGlobalPending([candidate])
  const projectRoot = codexProjectMemoryRoot((await identifyCodexProject(cwd)).projectId)

  const result = await promoteCodexPendingMemory({
    cwd,
    id: candidate.id,
    reviewHash: reviewHashForPendingMemory(candidate),
    reason: 'User approved global memory.',
    now: '2026-05-25T04:00:00.000Z'
  })

  expect(result.result.action).toBe('promote')
  expect(result.memoryRoot).toBe(globalRoot)
  expect(await readFile(join(globalRoot, 'index.jsonl'), 'utf8')).toContain(candidate.content)
  await expect(readFile(join(projectRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a global pending memory only in the global root', async () => {
  const home = await createTempDir('cyrene-review-reject-global-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-review-reject-global-project-')
  const candidate = createPending({
    id: 'global-reject',
    scope: 'global',
    content: 'Rejected global pending memory writes global tombstone.',
    normalizedKey: 'global-reject-root'
  })
  const globalRoot = await seedGlobalPending([candidate])
  const projectRoot = codexProjectMemoryRoot((await identifyCodexProject(cwd)).projectId)

  const result = await rejectCodexPendingMemory({
    cwd,
    id: candidate.id,
    reviewHash: reviewHashForPendingMemory(candidate),
    reason: 'User rejected global memory.',
    now: '2026-05-25T05:00:00.000Z'
  })

  expect(result.result.action).toBe('reject')
  expect(result.memoryRoot).toBe(globalRoot)
  expect(await readFile(join(globalRoot, 'tombstones.jsonl'), 'utf8')).toContain(candidate.normalizedKey)
  await expect(readFile(join(projectRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})
```

- [ ] **Step 4: Add global pending continuity test**

Add this test to `tests/codex-continuity-context.test.ts`:

```ts
it('returns pending review notice for global pending without exposing it as active memory', async () => {
  const home = await createTempDir('cyrene-codex-continuity-global-pending-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-codex-continuity-global-pending-repo-')
  const globalMemoryRoot = codexGlobalMemoryRoot()
  const pending = {
    ...createPendingMemory(),
    id: 'global-pending-review',
    scope: 'global' as const,
    content: 'Global pending memory should show only as pending review notice.'
  }
  await mkdir(globalMemoryRoot, { recursive: true })
  await writeFile(join(globalMemoryRoot, 'pending.jsonl'), JSON.stringify(pending) + '\n')

  const context = await getCodexContinuityContext({
    cwd: repo,
    userMessage: 'Check pending review.',
    task: 'memory'
  })

  expect(context.pendingReview).toMatchObject({
    count: 1,
    hasItems: true,
    newestCandidateId: pending.id
  })
  expect(context.memory.items).toEqual([])
  expect(JSON.stringify(context.memory)).not.toContain(pending.content)
  expect(context.profile.content).not.toContain(pending.content)
})
```

Patch the import in that file:

```ts
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
```

- [ ] **Step 5: Add MCP handler global pending test**

Add this test to `tests/mcp-server.test.ts`:

```ts
it('handles global pending memory review MCP actions on the global root', async () => {
  const home = await createTempDir('cyrene-mcp-global-review-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-mcp-global-review-project-')

  const proposed = await handleMemoryPropose(
    {
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'global',
        strength: 'hard',
        content: 'Global pending MCP review must use the global memory root.',
        evidence: [{ runId: 'mcp-global-review-run-1', summary: 'MCP global review test.' }]
      }
    },
    process.cwd()
  )
  const proposedJson = JSON.parse(proposed.content[0]?.text ?? '{}')
  const candidateId = proposedJson.result.candidateId
  const reviewHash = proposedJson.result.review.reviewHash
  expect(String(proposedJson.memoryRoot)).toContain('/.cyrene/codex/global/memory')

  const listJson = JSON.parse((await handleMemoryPendingList({ cwd }, process.cwd())).content[0]?.text ?? '{}')
  expect(listJson.total).toBe(1)
  expect(listJson.pending[0].id).toBe(candidateId)

  const getJson = JSON.parse((await handleMemoryPendingGet({ cwd, id: candidateId }, process.cwd())).content[0]?.text ?? '{}')
  expect(getJson.result.action).toBe('get')
  expect(String(getJson.memoryRoot)).toContain('/.cyrene/codex/global/memory')

  const rejectJson = JSON.parse(
    (await handleMemoryReject({ cwd, id: candidateId, reviewHash, reason: 'Covered by MCP global test.' }, process.cwd()))
      .content[0]?.text ?? '{}'
  )
  expect(rejectJson.result.action).toBe('reject')
  expect(String(rejectJson.memoryRoot)).toContain('/.cyrene/codex/global/memory')
})
```

- [ ] **Step 6: Run focused D-A tests**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-continuity-context.test.ts tests/mcp-server.test.ts
```

Expected: either the new tests fail against current code, or they pass and prove the source already has global pending behavior while the observed bug is a stale installed MCP command/config issue. In both cases keep the tests.

- [ ] **Step 7: Commit D-A regression tests**

Run:

```bash
git add tests/codex-memory-review.test.ts tests/codex-continuity-context.test.ts tests/mcp-server.test.ts
git commit -m "test: cover global codex pending review"
```

## Task 2: D-A Implementation And Doctor Diagnostics

**Files:**
- Modify: `src/codex/memory-review.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/codex/codex-doctor.ts`
- Test: `tests/codex-memory-review.test.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/codex-cli.test.ts` or `tests/codex-doctor.test.ts`

- [ ] **Step 1: Fix root-aware pending behavior only if tests fail**

If Task 1 tests fail, make `src/codex/memory-review.ts` use this shape:

```ts
async function getProjectAndReadableMemoryRoots(cwd: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
  readableRoots: string[]
}> {
  const { project, memoryRoot } = await getProjectAndMemoryRoot(cwd)
  const globalRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  return {
    project,
    memoryRoot,
    readableRoots: uniqueInOrder([globalRoot, memoryRoot])
  }
}
```

And ensure `findPendingCandidateInCodexRoots` returns the candidate owner root:

```ts
for (const root of readableRoots) {
  const pending = await readPendingMemoriesFromRoot(root)
  const candidate = pending.find((memory) => memory.id === id)
  if (candidate !== undefined) {
    return { project, memoryRoot: root, pending, candidate }
  }
}
```

Do not put pending content into `context.memory.items` or `context.profile.content`.

- [ ] **Step 2: Add doctor pending counts**

Patch `src/codex/codex-doctor.ts` to import `readPendingMemoriesFromRoot`:

```ts
import { readPendingMemoriesFromRoot } from '../memory/memory-store.js'
```

Extend `DoctorMemoryState`:

```ts
interface DoctorMemoryState {
  globalProfilePresent: boolean
  projectProfilePresent: boolean
  globalPendingCount: number
  projectPendingCount: number
  dreamDue: boolean
  lastDreamAt?: string
}
```

In `readDoctorMemoryState`, use fallback roots so missing readable directories report `0` instead of hiding expected paths:

```ts
const globalRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
const projectRoot = (await getReadableCodexProjectMemoryRoot(projectId)) ?? codexProjectMemoryRoot(projectId)
const [globalProfilePresent, projectProfilePresent, globalPending, projectPending, dreamState] = await Promise.all([
  profilePresent(globalRoot),
  profilePresent(projectRoot),
  readPendingMemoriesFromRoot(globalRoot),
  readPendingMemoriesFromRoot(projectRoot),
  readCodexMemoryDreamState(projectRoot)
])
```

Add output lines under `memory:`:

```ts
`  global pending: ${memoryState.globalPendingCount}`,
`  project pending: ${memoryState.projectPendingCount}`,
```

- [ ] **Step 3: Add doctor stale command diagnostics**

In `src/codex/codex-doctor.ts`, add a small parser for the `[mcp_servers.cyrene]` block that extracts `command` and `args`. Report whether the block references the current repo root or a different repo path:

```ts
interface McpCommandState {
  configured: boolean
  command?: string
  args?: string
  referencesCurrentRepo: boolean
}
```

Expected doctor output shape:

```txt
codex:
  cyrene mcp: configured
  mcp command: npm --prefix /Users/phoenix/Assistant/Cyrene run --silent dev -- mcp-server --stdio
  mcp command freshness: current repo
```

If the command points somewhere else, output:

```txt
  mcp command freshness: stale or external
  action: rerun codex install --dev from the intended repo
```

- [ ] **Step 4: Add doctor test**

If no dedicated doctor test file exists, add assertions to `tests/codex-cli.test.ts`. Use a temporary HOME and a temp `config.toml` containing:

```toml
[mcp_servers.cyrene]
command = "npm"
args = ["--prefix", "/Users/phoenix/Assistant/Cyrene", "run", "--silent", "dev", "--", "mcp-server", "--stdio"]
enabled = true
```

Assert:

```ts
expect(output).toContain('global pending: 1')
expect(output).toContain('project pending: 0')
expect(output).toContain('mcp command:')
expect(output).toContain('mcp command freshness:')
```

- [ ] **Step 5: Run D-A verification**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-continuity-context.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts
npm run typecheck
git diff --check
```

Expected: all pass and `git diff --check` prints no output.

- [ ] **Step 6: Verify real global pending visibility from current repo command**

Run:

```bash
npm run dev -- codex doctor
npm run dev -- codex memory profile >/tmp/cyrene-profile-check.txt
```

Then inspect:

```bash
sed -n '1,120p' /tmp/cyrene-profile-check.txt
```

Expected: doctor reports real global/project pending counts. Do not promote or reject real pending candidates during this task.

- [ ] **Step 7: Commit D-A implementation**

Run:

```bash
git add src/codex tests
git commit -m "fix: expose global codex pending review"
```

## Task 3: D-B Create `cyrene-continuity` Repo Skeleton

**Files:**
- Create under `/Users/phoenix/Assistant/cyrene-continuity`

- [ ] **Step 1: Check target path without deleting it**

Run:

```bash
if [ -e /Users/phoenix/Assistant/cyrene-continuity ]; then
  git -C /Users/phoenix/Assistant/cyrene-continuity status --short --branch
  find /Users/phoenix/Assistant/cyrene-continuity -maxdepth 2 -type f | sed -n '1,120p'
else
  echo "target path is free"
fi
```

Expected: either the path is free, or it is an existing repo that can be reused without deleting user work. If it is non-git and non-empty, stop and ask the user.

- [ ] **Step 2: Create directories**

Run:

```bash
mkdir -p /Users/phoenix/Assistant/cyrene-continuity/src
mkdir -p /Users/phoenix/Assistant/cyrene-continuity/plugin/skills
mkdir -p /Users/phoenix/Assistant/cyrene-continuity/plugin/.codex-plugin
mkdir -p /Users/phoenix/Assistant/cyrene-continuity/tests
```

- [ ] **Step 3: Copy bridge source directories**

Run:

```bash
rsync -a /Users/phoenix/Assistant/Cyrene/src/codex /Users/phoenix/Assistant/cyrene-continuity/src/
rsync -a /Users/phoenix/Assistant/Cyrene/src/mcp /Users/phoenix/Assistant/cyrene-continuity/src/
rsync -a /Users/phoenix/Assistant/Cyrene/src/memory /Users/phoenix/Assistant/cyrene-continuity/src/
rsync -a /Users/phoenix/Assistant/Cyrene/integrations/codex/plugin/skills/cyrene-continuity /Users/phoenix/Assistant/cyrene-continuity/plugin/skills/
```

Expected: copied files preserve source content. This is a scaffold copy, not a user data migration.

- [ ] **Step 4: Copy focused tests**

Run:

```bash
for file in \
  tests/codex-cli.test.ts \
  tests/codex-continuity-context.test.ts \
  tests/codex-hook-install.test.ts \
  tests/codex-hook-stop.test.ts \
  tests/codex-memory-dream.test.ts \
  tests/codex-memory-propose.test.ts \
  tests/codex-memory-promotion-policy.test.ts \
  tests/codex-memory-review.test.ts \
  tests/codex-memory-root.test.ts \
  tests/codex-project-id.test.ts \
  tests/codex-review-redaction.test.ts \
  tests/codex-review-summary-runtime.test.ts \
  tests/codex-review-summary-store.test.ts \
  tests/codex-transcript.test.ts \
  tests/mcp-server.test.ts \
  tests/memory-maintenance.test.ts \
  tests/memory.test.ts
do
  cp "/Users/phoenix/Assistant/Cyrene/$file" "/Users/phoenix/Assistant/cyrene-continuity/$file"
done
```

Expected: only Codex/MCP/memory tests are copied; Web UI, Tauri, eval, agent-loop, provider-router tests stay in Cyrene repo.

- [ ] **Step 5: Add package metadata**

Create `/Users/phoenix/Assistant/cyrene-continuity/package.json`:

```json
{
  "name": "cyrene-continuity",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "cyrene-continuity": "src/main.ts"
  },
  "engines": {
    "node": ">=20",
    "npm": ">=10"
  },
  "scripts": {
    "dev": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "chalk": "^5.4.1",
    "commander": "^12.1.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 6: Add TypeScript and Vitest config**

Create `/Users/phoenix/Assistant/cyrene-continuity/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create `/Users/phoenix/Assistant/cyrene-continuity/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    restoreMocks: true
  }
})
```

- [ ] **Step 7: Add gitignore and plugin manifest**

Create `/Users/phoenix/Assistant/cyrene-continuity/.gitignore`:

```gitignore
node_modules/
dist/
.DS_Store
.env
.env.*
coverage/
```

Create `/Users/phoenix/Assistant/cyrene-continuity/plugin/.codex-plugin/plugin.json`:

```json
{
  "schema_version": "1.0",
  "name": "cyrene-continuity",
  "version": "0.1.0",
  "description": "Cyrene continuity MCP, Codex skill, and local memory bridge.",
  "skills": [
    {
      "name": "cyrene-continuity",
      "path": "../skills/cyrene-continuity/SKILL.md"
    }
  ]
}
```

- [ ] **Step 8: Create minimal README**

Create `/Users/phoenix/Assistant/cyrene-continuity/README.md`:

````md
# cyrene-continuity

Local-first continuity bridge for Codex.

## Commands

```bash
npm run dev -- mcp-server --stdio
npm run dev -- codex doctor
npm run dev -- codex install --dev
npm run dev -- codex install-hook --stop
npm run dev -- codex hook stop
npm run dev -- codex memory dream --stage deep
npm run dev -- codex memory profile
```

## Data

This repo reads and writes existing local data under:

```txt
~/.cyrene/codex/global/memory/
~/.cyrene/codex/projects/<projectId>/memory/
```

It does not migrate or copy user memory data during install.

## Review Policy

Pending memory candidates are not active memory. Promotion requires explicit user approval and a matching review hash.
````

- [ ] **Step 9: Initialize git after skeleton exists**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
git init
```

Expected: new repo initialized without touching `/Users/phoenix/Assistant/Cyrene`.

## Task 4: D-B Adapt New Repo Runtime

**Files:**
- Modify: `/Users/phoenix/Assistant/cyrene-continuity/src/main.ts`
- Create: `/Users/phoenix/Assistant/cyrene-continuity/src/config.ts`
- Create: `/Users/phoenix/Assistant/cyrene-continuity/src/llm-client.ts`
- Modify: `/Users/phoenix/Assistant/cyrene-continuity/src/codex/codex-install.ts`
- Modify: `/Users/phoenix/Assistant/cyrene-continuity/src/codex/codex-hook-install.ts`
- Modify tests under `/Users/phoenix/Assistant/cyrene-continuity/tests`

- [ ] **Step 1: Replace `src/main.ts` with a bridge-only CLI**

Create `/Users/phoenix/Assistant/cyrene-continuity/src/main.ts`:

```ts
#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { handleCodexCommand } from './codex/codex-cli.js'
import { startCyreneMcpServer } from './mcp/mcp-server.js'

const program = new Command()

async function main(): Promise<void> {
  program
    .name('cyrene-continuity')
    .description('Cyrene continuity MCP and Codex bridge.')
    .argument('[command...]')
    .option('--cwd <path>', 'working directory', process.cwd())
    .allowUnknownOption()

  program.parse()

  const options = program.opts<{ cwd: string }>()
  const command = program.args[0]

  if (command === 'codex') {
    await handleCodexCommand({
      cwd: options.cwd,
      args: program.args.slice(1)
    })
    return
  }

  if (command === 'mcp-server') {
    if (program.args.length > 2 || (program.args[1] !== undefined && program.args[1] !== '--stdio')) {
      console.error('Usage: cyrene-continuity mcp-server --stdio')
      process.exit(1)
    }
    await startCyreneMcpServer({ cwd: options.cwd, transport: 'stdio' })
    return
  }

  console.error('Usage: cyrene-continuity <mcp-server --stdio|codex ...>')
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

- [ ] **Step 2: Create minimal config without Cyrene agent runtime imports**

Create `/Users/phoenix/Assistant/cyrene-continuity/src/config.ts` with the fields used by Codex memory, hook, review summary, and dream:

```ts
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface ModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature: number
  strongModel: string
  cheapModel: string
}

export interface AppConfig {
  cwd: string
  memoryCwd: string
  model: ModelConfig
  userCyreneDir: string
  memoryAutoExtractEnabled: boolean
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
  llmRequestTimeoutMs: number
  llmRetryMaxAttempts: number
  llmRetryBaseDelayMs: number
}

export function createDefaultConfig(cwd: string): AppConfig {
  const dotEnv = loadDotEnv(cwd)
  const baseUrl = envValue(dotEnv, 'CYRENE_BASE_URL') ?? ''
  const model = envValue(dotEnv, 'CYRENE_MODEL') ?? ''
  const strongModel = optionalEnvValue(dotEnv, 'CYRENE_STRONG_MODEL') ?? model
  const cheapModel = optionalEnvValue(dotEnv, 'CYRENE_CHEAP_MODEL') ?? strongModel
  return {
    cwd,
    memoryCwd: cwd,
    model: {
      baseUrl,
      model,
      apiKey: optionalEnvValue(dotEnv, 'CYRENE_API_KEY'),
      temperature: 0,
      strongModel,
      cheapModel
    },
    userCyreneDir: join(homedir(), '.cyrene'),
    memoryAutoExtractEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_AUTO_EXTRACT'), true),
    memoryAutoPromoteEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE'), true),
    memoryActiveMaxItems: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_ACTIVE_MAX_ITEMS'), 300),
    memoryActiveContentMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_ACTIVE_CONTENT_MAX_CHARS'), 50000),
    memoryIndexFileMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_INDEX_FILE_MAX_CHARS'), 250000),
    memorySingleContentMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_SINGLE_CONTENT_MAX_CHARS'), 300),
    memorySingleEvidenceMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_SINGLE_EVIDENCE_MAX_CHARS'), 1000),
    memoryPendingMaxItems: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_PENDING_MAX_ITEMS'), 100),
    memoryProfileMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_PROFILE_MAX_CHARS'), 6000),
    memoryProfileAlwaysOnEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_PROFILE_ALWAYS_ON'), true),
    memoryMaintenanceSnapshotsMax: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_MAINTENANCE_SNAPSHOTS_MAX'), 20),
    memoryDreamEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_ENABLED'), true),
    memoryDreamIntervalHours: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_INTERVAL_HOURS'), 24),
    memoryDreamCatchUpEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_CATCH_UP'), true),
    memoryDreamLockTtlMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_LOCK_TTL_MS'), 15 * 60 * 1000),
    memoryDreamMaxRuntimeMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_MAX_RUNTIME_MS'), 60000),
    memoryDreamModel: optionalEnvValue(dotEnv, 'CYRENE_MEMORY_DREAM_MODEL'),
    llmRequestTimeoutMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_LLM_REQUEST_TIMEOUT_MS'), 180000),
    llmRetryMaxAttempts: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_LLM_RETRY_MAX_ATTEMPTS'), 3),
    llmRetryBaseDelayMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_LLM_RETRY_BASE_DELAY_MS'), 1000)
  }
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

function parsePositiveIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function loadDotEnv(cwd: string): Record<string, string> {
  let currentDir = resolve(cwd)
  while (true) {
    try {
      return parseDotEnv(readFileSync(join(currentDir, '.env'), 'utf8'))
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) return {}
    currentDir = parentDir
  }
}

function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (match !== null) values[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return values
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function envValue(dotEnv: Record<string, string>, name: string): string | undefined {
  return process.env[name] ?? dotEnv[name]
}

function optionalEnvValue(dotEnv: Record<string, string>, name: string): string | undefined {
  const value = envValue(dotEnv, name)
  return value?.trim() === '' ? undefined : value
}
```

- [ ] **Step 3: Create minimal OpenAI-compatible LLM client**

Create `/Users/phoenix/Assistant/cyrene-continuity/src/llm-client.ts`:

```ts
import type { AppConfig } from './config.js'

export type ModelUseCase = 'chat' | 'planning' | 'coding' | 'summarization' | 'memory_extraction' | 'affect_analysis' | 'reflection'
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ModelToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  tool_calls?: ModelToolCall[]
}

export interface CallModelInput {
  config: AppConfig
  messages: ChatMessage[]
  tools: unknown[]
  useCase?: ModelUseCase
  signal?: AbortSignal
}

export interface ModelResponse {
  content: string
  toolCalls: ModelToolCall[]
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: ModelToolCall[]
    }
  }>
}

export async function callModel(input: CallModelInput): Promise<ModelResponse> {
  const model = modelForUseCase(input.config, input.useCase ?? 'chat')
  validateModelConfig(input.config, model)
  const response = await fetch(`${input.config.model.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(input.config),
    signal: mergeAbortSignals(AbortSignal.timeout(input.config.llmRequestTimeoutMs), input.signal),
    body: JSON.stringify({
      model,
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      temperature: input.config.model.temperature
    })
  })
  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}: ${await response.text()}`)
  }
  const data = await response.json() as ChatCompletionResponse
  const message = data.choices?.[0]?.message
  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls ?? []
  }
}

function modelForUseCase(config: AppConfig, useCase: ModelUseCase): string {
  return ['summarization', 'memory_extraction', 'affect_analysis'].includes(useCase)
    ? config.model.cheapModel || config.model.strongModel || config.model.model
    : config.model.strongModel || config.model.model
}

function requestHeaders(config: AppConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.model.apiKey?.trim()) headers.authorization = `Bearer ${config.model.apiKey}`
  return headers
}

function validateModelConfig(config: AppConfig, routeModel: string): void {
  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') missing.push('CYRENE_BASE_URL')
  if (config.model.model.trim() === '' || routeModel.trim() === '') missing.push('CYRENE_MODEL')
  if (missing.length > 0) throw new Error(`Model config is incomplete: set ${missing.join(' and ')}.`)
}

function mergeAbortSignals(timeoutSignal: AbortSignal, inputSignal?: AbortSignal): AbortSignal {
  return inputSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, inputSignal])
}
```

- [ ] **Step 4: Adapt installer paths and commands**

In `/Users/phoenix/Assistant/cyrene-continuity/src/codex/codex-install.ts`, point the skill source to:

```ts
const skillSource = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'plugin',
  'skills',
  'cyrene-continuity'
)
```

Update printed MCP command to:

```toml
[mcp_servers.cyrene]
command = "cyrene-continuity"
args = ["mcp-server", "--stdio"]
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 60
```

In `/Users/phoenix/Assistant/cyrene-continuity/src/codex/codex-hook-install.ts`, make the Stop hook command:

```ts
export function codexStopHookCommand(): string {
  return 'cyrene-continuity codex hook stop'
}
```

- [ ] **Step 5: Update copied tests for new repo names and paths**

Patch copied tests so assertions expect:

```txt
cyrene-continuity
plugin/skills/cyrene-continuity/SKILL.md
Usage: cyrene-continuity mcp-server --stdio
```

The tests must not reference `src/agent-loop.ts`, `src/web`, `src/models`, or Cyrene desktop files.

- [ ] **Step 6: Install dependencies**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm install
```

Expected: `package-lock.json` is created in the new repo and `node_modules/` is ignored.

- [ ] **Step 7: Run new repo focused tests and typecheck**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm test
npm run typecheck
```

Expected: all copied tests pass after import/path adaptation.

- [ ] **Step 8: Commit new repo initial runtime**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
git add .
git commit -m "feat: create cyrene continuity bridge"
```

## Task 5: D-B GitHub Remote And Command Verification

**Files:**
- Modify only new repo git metadata and README if verification reveals command docs mismatch.

- [ ] **Step 1: Verify bridge commands locally**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm run dev -- codex doctor
npm run dev -- codex memory profile >/tmp/cyrene-continuity-profile-check.txt
timeout 5 npm run dev -- mcp-server --stdio </dev/null >/tmp/cyrene-continuity-mcp-smoke.txt 2>/tmp/cyrene-continuity-mcp-smoke.err || true
npm run dev -- codex memory dream --stage light
```

Expected:

- `codex doctor` prints runtime, Codex config status, pending counts, project id, and display name.
- `codex memory profile` exits successfully.
- MCP smoke exits without a TypeScript import error; timeout is acceptable because stdio server waits for MCP traffic.
- `dream --stage light` succeeds and does not promote pending memory.

- [ ] **Step 2: Create GitHub remote if absent**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create mingxiangbian/cyrene-continuity --private --source . --remote origin
fi
git remote -v
```

Expected: `origin` points to `github.com/mingxiangbian/cyrene-continuity`. If `gh` reports the repo already exists, set origin manually:

```bash
git remote add origin git@github.com:mingxiangbian/cyrene-continuity.git
```

- [ ] **Step 3: Push new repo**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
git push -u origin HEAD
```

Expected: initial branch is pushed successfully.

## Task 6: D-C Local Codex Cutover

**Files / Artifacts:**
- Modify via installer or automation tool:
  - `~/.codex/config.toml`
  - `~/.codex/hooks.json`
  - `~/.agents/skills/cyrene-continuity`
  - `~/.codex/automations/cyrene-memory-dream-deep/automation.toml`

- [ ] **Step 1: Capture rollback snapshot**

Run:

```bash
mkdir -p /tmp/cyrene-continuity-cutover
cp ~/.codex/config.toml /tmp/cyrene-continuity-cutover/config.toml.before
cp ~/.codex/hooks.json /tmp/cyrene-continuity-cutover/hooks.json.before
if [ -L ~/.agents/skills/cyrene-continuity ]; then readlink ~/.agents/skills/cyrene-continuity > /tmp/cyrene-continuity-cutover/skill-link.before; fi
find ~/.codex/automations -name automation.toml -maxdepth 2 -print0 | xargs -0 grep -l "/Users/phoenix/Assistant/Cyrene" > /tmp/cyrene-continuity-cutover/automation-oldrefs.before || true
```

Expected: rollback files exist under `/tmp/cyrene-continuity-cutover`.

- [ ] **Step 2: Link the new CLI**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm link
which cyrene-continuity
cyrene-continuity codex doctor
```

Expected: `cyrene-continuity` resolves on PATH and doctor runs.

- [ ] **Step 3: Install skill from the new repo**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm run dev -- codex install --dev
readlink ~/.agents/skills/cyrene-continuity
```

Expected: the symlink target is:

```txt
/Users/phoenix/Assistant/cyrene-continuity/plugin/skills/cyrene-continuity
```

- [ ] **Step 4: Install Stop hook from the new repo**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm run dev -- codex install-hook --stop
jq '.hooks.Stop' ~/.codex/hooks.json
```

Expected: unrelated hooks remain present, and one Stop hook command is:

```txt
cyrene-continuity codex hook stop
```

- [ ] **Step 5: Update Codex MCP config through structured installer or controlled config patch**

Preferred path: if `cyrene-continuity codex install --dev` has been extended to update `~/.codex/config.toml`, run it and inspect the result.

Required final TOML block:

```toml
[mcp_servers.cyrene]
command = "cyrene-continuity"
args = ["mcp-server", "--stdio"]
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Run:

```bash
cyrene-continuity codex doctor
```

Expected: doctor reports `cyrene mcp: configured` and `mcp command freshness: current repo`.

- [ ] **Step 6: Update Dream Deep automation to new repo**

Use `codex_app.automation_update` for automation id `cyrene-memory-dream-deep`. Preserve schedule/model/status, update:

```txt
cwds: /Users/phoenix/Assistant/cyrene-continuity
prompt: Run the Cyrene Continuity deep memory pass from the cyrene-continuity repo. Use the local cyrene-continuity command/MCP bridge and report promoted/rejected/keptPending counts for global and project roots. Do not promote pending candidates outside the established Dream Deep policy.
```

Expected: automation remains ACTIVE and no duplicate automation is created.

- [ ] **Step 7: Verify self-interview automation does not need a business-logic change**

Inspect `~/.codex/automations/automation/automation.toml`.

Expected: if it only calls MCP tools and references the continuity skill, no business logic change is needed. If its `cwds` still points at `/Users/phoenix/Assistant/Cyrene`, update `cwds` to `/Users/phoenix/Assistant/cyrene-continuity` while preserving the interview prompt.

- [ ] **Step 8: Run cutover verification**

Run:

```bash
cyrene-continuity codex doctor
cyrene-continuity codex memory profile >/tmp/cyrene-continuity-cutover-profile.txt
cyrene-continuity codex memory dream --stage light
```

Expected:

- doctor shows the current project id and display name.
- profile reads global + project profile content from existing `~/.cyrene/codex/`.
- global pending count is visible if global pending exists.
- `dream --stage light` does not promote pending memory.

## Task 7: D-C Old Bridge Cleanup After Reference Scan

**Files:**
- Modify in current repo only after cutover verification:
  - `src/main.ts`
  - `package.json`
  - `tests/main-cli.test.ts`
  - `tests/mcp-server.test.ts`
  - `tests/codex-*.test.ts`
  - `integrations/codex/plugin/skills/cyrene-continuity/SKILL.md`
  - `src/codex/**`
  - `src/mcp/**`
- Do not delete:
  - `src/memory/**`
  - Cyrene Web UI / desktop / agent runtime files.

- [ ] **Step 1: Scan local references to old bridge**

Run:

```bash
grep -R "/Users/phoenix/Assistant/Cyrene" ~/.codex/config.toml ~/.codex/hooks.json ~/.codex/automations/*/automation.toml 2>/dev/null || true
if [ -L ~/.agents/skills/cyrene-continuity ]; then readlink ~/.agents/skills/cyrene-continuity; fi
```

Expected: no MCP / Skill / hook / Dream Deep command reference to `/Users/phoenix/Assistant/Cyrene`. If any remain, fix cutover and do not delete old bridge yet.

- [ ] **Step 2: Remove Codex/MCP command branches from Cyrene main CLI**

Patch `/Users/phoenix/Assistant/Cyrene/src/main.ts`:

- Remove imports:

```ts
import { handleCodexCommand } from './codex/codex-cli.js'
import { startCyreneMcpServer } from './mcp/mcp-server.js'
```

- Remove `mcp-server` and `codex` from `isLocalCommandArgv(...)`.
- Remove the `if (program.args[0] === 'codex')` branch.
- Remove the `if (program.args[0] === 'mcp-server')` branch.

Expected: main Cyrene CLI still supports its non-bridge commands.

- [ ] **Step 3: Delete old bridge-only files**

Run:

```bash
rm -rf /Users/phoenix/Assistant/Cyrene/src/codex
rm -rf /Users/phoenix/Assistant/Cyrene/src/mcp
rm -rf /Users/phoenix/Assistant/Cyrene/integrations/codex/plugin/skills/cyrene-continuity
rm -f /Users/phoenix/Assistant/Cyrene/tests/codex-*.test.ts
rm -f /Users/phoenix/Assistant/Cyrene/tests/mcp-server.test.ts
```

Expected: only bridge-specific code/tests are removed from Cyrene main repo. Keep `src/memory/**`.

- [ ] **Step 4: Remove bridge-only dependency if unused**

Run:

```bash
cd /Users/phoenix/Assistant/Cyrene
rg "@modelcontextprotocol/sdk|zod" src tests package.json
```

If `@modelcontextprotocol/sdk` is only used by the removed bridge code, remove it:

```bash
npm uninstall @modelcontextprotocol/sdk
```

If `zod` is still used outside removed bridge code, keep it. If not used, remove it:

```bash
npm uninstall zod
```

- [ ] **Step 5: Run current repo verification**

Run:

```bash
cd /Users/phoenix/Assistant/Cyrene
npm test
npm run typecheck
git diff --check
```

Expected: current repo tests/typecheck pass after bridge extraction.

- [ ] **Step 6: Commit current repo cleanup**

Run:

```bash
cd /Users/phoenix/Assistant/Cyrene
git add .
git commit -m "refactor: move codex continuity bridge to standalone repo"
```

## Task 8: Final End-To-End Verification

**Files:**
- No planned source changes unless verification exposes a defect.

- [ ] **Step 1: Verify new repo**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
npm test
npm run typecheck
git status --short
```

Expected: tests/typecheck pass; working tree clean.

- [ ] **Step 2: Verify current repo**

Run:

```bash
cd /Users/phoenix/Assistant/Cyrene
npm test
npm run typecheck
git status --short
```

Expected: tests/typecheck pass; only intentional plan/spec branch commits exist.

- [ ] **Step 3: Verify MCP behavior with real global pending visibility**

Run from `/Users/phoenix/Assistant/cyrene-continuity`:

```bash
npm run dev -- codex doctor
```

Expected: doctor reports global and project pending counts. If real global pending exists under `~/.cyrene/codex/global/memory/pending.jsonl`, the global pending count is greater than `0`.

- [ ] **Step 4: Verify no unintended promotion**

Run:

```bash
find ~/.cyrene/codex -path '*/memory/pending.jsonl' -print -exec wc -l {} \;
find ~/.cyrene/codex -path '*/memory/index.jsonl' -print -exec tail -n 3 {} \;
```

Expected: no new active memory was promoted by Phase D verification unless the user explicitly approved it.

- [ ] **Step 5: Push both repos**

Run:

```bash
cd /Users/phoenix/Assistant/cyrene-continuity
git push
cd /Users/phoenix/Assistant/Cyrene
git push
```

Expected: both pushes succeed.

- [ ] **Step 6: Merge current branch and delete local branch if user asks for merge cleanup**

When the user asks for merge/push/branch cleanup, run the established repo merge flow from the current repo:

```bash
cd /Users/phoenix/Assistant/Cyrene
git status --short
git checkout main
git pull --ff-only
git merge --ff-only codex/phase-d-a-repo-split-readiness
git push
git branch -d codex/phase-d-a-repo-split-readiness
```

Expected: merge is fast-forward. If it is not fast-forward, stop and report the exact branch state instead of forcing.

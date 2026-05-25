# Phase 8B Tauri Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已完成的 Phase 8A soft Web UI 作为 source of truth，补齐 8B 前置 UI 调整，并新增 Tauri desktop shell 的本地开发入口。

**Architecture:** Web UI 仍由 `src/web/static/*` 和 `src/web/server.ts` 提供。Node/TypeScript runtime 继续负责 agent、session、memory、trace、evolution 和 tool guard；Tauri 只负责桌面 shell、窗口、dev server lifecycle 入口和后续 native 行为承载。默认 Web 运行边界改为用户 home folder，session/memory/trace/evolution 存储仍留在启动 Cyrene 的 repo/storage root。

**Tech Stack:** TypeScript, Vitest, static HTML/CSS/vanilla JS, Node HTTP server, Tauri v2, Rust toolchain from `~/.cargo/bin`.

---

## File Map

- Modify: `src/web/static/index.html`
  - 移除空状态标题/说明。
  - 移除默认 `Trace` / `Evolution` tabs。
  - 移除默认 sidebar 底部 workspace selector markup。
  - 保留 composer、Think mode、context ring、send icon。
- Modify: `src/web/static/app.js`
  - 默认 inspector panel 只注册 `tools` / `memory` / `affect`。
  - `renderEmptyState()` 只渲染 avatar。
  - 保留 workspace state 和 `workspaceId` 请求字段，但不再依赖可见 selector。
  - 初始化时渲染 SVG send/cancel icon。
- Modify: `src/web/static/styles.css`
  - 删除空状态文案相关默认尺寸依赖。
  - 增强 send icon light/dark mode color。
  - 隐藏/清理默认 workspace selector 样式影响。
- Modify: `src/web/workspaces.ts`
  - 将 workspace root 从 `<cwd>/workspace` 改为 `cwd` 本身。
  - root workspace label 使用 root folder basename。
  - 继续只允许 root 或 root 的 direct child directory。
  - 继续拒绝 absolute path、`..`、nested path 和 symlink escape。
- Modify: `src/launch-cwd.ts`
  - Web 无显式 `--cwd` 时默认边界使用 `homedir()`。
  - 保留 helper 名称，避免扩大 CLI surface。
- Modify: `src/web/server.ts`
  - 增加 `workspaceCwd?: string`，默认等于 `cwd`。
  - `context.cwd` 继续代表 storage root。
  - workspace/Markdown/file preview routes 使用 `context.workspaceCwd`。
  - sessions、trace、memory、evolution 继续使用 storage root / memory root。
  - 增加 `GET /api/health`。
- Modify: `src/main.ts`
  - Web 默认无 `--cwd` 时：`workspaceCwd = homedir()`，`storageCwd = launchCwd`。
  - `--cwd` 显式传入时：保留显式 cwd 作为 workspace/storage root。
  - 启动 Web server 时传入 `workspaceCwd`。
- Create: `tests/launch-cwd.test.ts`
  - 覆盖默认 Web cwd 为 home folder。
- Modify: `tests/web-workspaces.test.ts`
  - 覆盖 root-as-boundary workspace helpers。
- Modify: `tests/web-server.test.ts`
  - 覆盖 UI HTML 删除项、health endpoint、workspace/storage split。
- Modify: `tests/web-static-helpers.test.mjs`
  - 覆盖 static UI contracts：无空状态 copy、无默认 Trace/Evolution tabs、send button 不再使用文字 `Send`。
- Modify: `tests/web-soft-ui-css.test.ts`
  - 覆盖 dark mode send icon readable。
- Modify: `package.json`
  - 增加 `@tauri-apps/cli` dev dependency。
  - 增加 `desktop:dev` / `desktop:web` scripts。
- Modify: `package-lock.json`
  - 由 `npm install -D @tauri-apps/cli@2.11.2` 更新。
- Create: `src-tauri/*`
  - 使用 Tauri v2 scaffold。
  - v0 以 dev shell 为主，加载本地 Web server URL。
- Create or modify: `src-tauri/README.md`
  - 记录 Rust PATH 和 dev verification 命令。

---

## Task 0: Baseline

**Files:**
- Read: `package.json`
- Read: `src/web/static/index.html`
- Read: `src/web/server.ts`
- Read: `src/web/workspaces.ts`

- [x] **Step 1: Verify current branch and clean state**

Run:

```bash
git status --short --branch
```

Expected:

```txt
## codex/phase-8a-soft-ui
```

- [x] **Step 2: Verify baseline TypeScript**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

- [x] **Step 3: Verify baseline tests**

Run:

```bash
npm test
```

Expected: exit code `0`.

---

## Task 1: 8A Follow-Up UI Contract

**Files:**
- Modify: `tests/web-server.test.ts`
- Modify: `tests/web-static-helpers.test.mjs`
- Modify: `tests/web-soft-ui-css.test.ts`
- Modify: `src/web/static/index.html`
- Modify: `src/web/static/app.js`
- Modify: `src/web/static/styles.css`

- [x] **Step 1: Write failing static HTML tests**

In `tests/web-server.test.ts`, update the `serves the static shell from GET /` assertions:

```ts
expect(body).not.toContain('id="workspacePanel"')
expect(body).not.toContain('id="workspaceChangeButton"')
expect(body).not.toContain('aria-label="Select workspace"')
expect(body).not.toContain('aria-controls="workspacePicker"')
expect(body).not.toContain('id="workspacePicker"')
expect(body).toContain('<button class="tab" type="button" data-tab="memory">Memory</button>')
expect(body).toContain('<button class="tab" type="button" data-tab="affect">Affect</button>')
expect(body).not.toContain('data-tab="trace"')
expect(body).not.toContain('data-tab="evolution"')
expect(body).toContain('class="empty-avatar"')
expect(body).toContain('class="empty-avatar-image"')
expect(body).not.toContain('Ask Cyrene to work through a local task.')
expect(body).not.toContain('Run status and tool activity will stream here as the agent responds.')
expect(body).toContain('id="sendButton"')
expect(body).toContain('send-button-icon')
expect(body).not.toContain('>Send</button>')
```

- [x] **Step 2: Write failing static JS/CSS contract tests**

In `tests/web-static-helpers.test.mjs`, add:

```js
it('keeps the empty state avatar-only and removes default trace/evolution UI tabs', () => {
  const html = readFileSync(new URL('../src/web/static/index.html', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/web/static/app.js', import.meta.url), 'utf8')

  expect(html).toContain('class="empty-avatar"')
  expect(html).not.toContain('Ask Cyrene to work through a local task.')
  expect(html).not.toContain('Run status and tool activity will stream here as the agent responds.')
  expect(html).not.toContain('data-tab="trace"')
  expect(html).not.toContain('data-tab="evolution"')
  expect(app).not.toContain("import { renderTracePanel }")
  expect(app).not.toContain("import { renderEvolutionPanel }")
  expect(app).not.toContain('trace: renderTracePanel')
  expect(app).not.toContain('evolution: renderEvolutionPanel')
  expect(app).not.toContain('<h3>Ask Cyrene to work through a local task.</h3>')
  expect(app).not.toContain('<p>Run status and tool activity will stream here as the agent responds.</p>')
})
```

In `tests/web-soft-ui-css.test.ts`, add:

```ts
it('keeps send icon readable in light and dark mode', () => {
  expect(css).toMatch(/--send-icon:\s*#243044;/)
  expect(css).toMatch(/\.send-button\s*\{[\s\S]*?color:\s*var\(--send-icon\);/)
  expect(css).toMatch(/body\.theme-dark\s*\{[\s\S]*?--send-icon:\s*#f7fbff;/)
  expect(css).toMatch(/\.send-button-icon\s*\{[\s\S]*?stroke-width:\s*2;/)
})
```

- [x] **Step 3: Verify RED**

Run:

```bash
npm test -- tests/web-server.test.ts tests/web-static-helpers.test.mjs tests/web-soft-ui-css.test.ts
```

Expected: FAIL because the current UI still renders workspace selector, empty-state copy, Trace/Evolution tabs, and old send icon color contract.

- [x] **Step 4: Implement minimal UI changes**

In `src/web/static/index.html`:

```html
<div class="nav-list" aria-label="Primary">
  <button id="newChatButton" class="nav-action" type="button">New chat</button>
  <div id="sessionHistory" class="session-history" aria-label="Session history"></div>
</div>
```

Delete the `section id="workspacePanel"` block.

Change the empty state to:

```html
<div class="empty-state">
  <div class="empty-avatar" aria-hidden="true">
    <img class="empty-avatar-image" src="/static/assets/cyrene-cartoon-avatar.png" alt="" decoding="async">
  </div>
</div>
```

Change tabs to:

```html
<button class="tab" type="button" data-tab="context">Context</button>
<button class="tab is-active" type="button" data-tab="tools">Tools</button>
<button class="tab" type="button" data-tab="memory">Memory</button>
<button class="tab" type="button" data-tab="affect">Affect</button>
```

In `src/web/static/app.js`, remove trace/evolution imports and panel registration:

```js
const inspectorPanels = registerInspectorPanels({
  tools: renderToolsPanel,
  memory: renderMemoryPanel,
  affect: renderAffectPanel
})
```

Update `renderEmptyState()`:

```js
function renderEmptyState() {
  messages?.replaceChildren()
  const node = document.createElement('div')
  node.className = 'empty-state'
  node.innerHTML = '<div class="empty-avatar" aria-hidden="true"><img class="empty-avatar-image" src="/static/assets/cyrene-cartoon-avatar.png" alt="" decoding="async"></div>'
  messages?.append(node)
}
```

Add send icons to `createIcon()`:

```js
case 'arrow-up':
  add('path', { d: 'M12 19V5' })
  add('path', { d: 'M6 11l6-6 6 6' })
  break
case 'square':
  add('rect', { x: '8', y: '8', width: '8', height: '8', rx: '1.5' })
  break
```

Update `renderSendButton()`:

```js
const icon = createIcon(isSending ? 'square' : 'arrow-up')
icon.classList.add('send-button-icon')
sendButton.append(icon)
```

Call `renderSendButton(false)` during startup after `renderThinkingModeControl()`.

In `src/web/static/styles.css`, introduce:

```css
--send-icon: #243044;
```

and in `body.theme-dark`:

```css
--send-icon: #f7fbff;
```

Use:

```css
.send-button {
  color: var(--send-icon);
}

.send-button-icon {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}
```

- [x] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/web-server.test.ts tests/web-static-helpers.test.mjs tests/web-soft-ui-css.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit UI follow-up**

Run:

```bash
git add src/web/static/index.html src/web/static/app.js src/web/static/styles.css tests/web-server.test.ts tests/web-static-helpers.test.mjs tests/web-soft-ui-css.test.ts
git commit -m "refactor: simplify desktop shell ui"
```

---

## Task 2: Default Phoenix Boundary With Stable Storage Root

**Files:**
- Create: `tests/launch-cwd.test.ts`
- Modify: `tests/web-workspaces.test.ts`
- Modify: `tests/web-server.test.ts`
- Modify: `src/launch-cwd.ts`
- Modify: `src/web/workspaces.ts`
- Modify: `src/web/server.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing launch cwd test**

Create `tests/launch-cwd.test.ts`:

```ts
import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { resolveDefaultWebCwd } from '../src/launch-cwd.js'

describe('resolveDefaultWebCwd', () => {
  it('uses the user home folder as the default Web boundary', () => {
    expect(resolveDefaultWebCwd('/tmp/cyrene-project')).toBe(homedir())
  })
})
```

- [ ] **Step 2: Write failing workspace helper tests**

Update `tests/web-workspaces.test.ts` expected behavior:

```ts
it('lists the root boundary and direct child directories only', async () => {
  const root = await createTempRepo()
  await mkdir(join(root, 'project-a', 'nested'), { recursive: true })
  await mkdir(join(root, 'project-b'), { recursive: true })
  await mkdir(join(root, 'project..a'), { recursive: true })
  await writeFile(join(root, 'note.md'), '# root\n', 'utf8')

  await expect(listWorkspaces(root)).resolves.toEqual([
    { id: '', label: basename(root), relativePath: '.' },
    { id: 'project-a', label: `${basename(root)}/project-a`, relativePath: 'project-a' },
    { id: 'project-b', label: `${basename(root)}/project-b`, relativePath: 'project-b' }
  ])
})
```

Also update root/child path setup in the remaining workspace tests so files live under `root` and `root/project-a`, not `root/workspace`.

- [ ] **Step 3: Write failing server storage split tests**

In `tests/web-server.test.ts`, add a focused test:

```ts
it('uses workspaceCwd for file boundary while keeping sessions in storage cwd', async () => {
  const storageCwd = await createTempCwdWithoutWorkspace()
  const workspaceCwd = await createTempCwdWithoutWorkspace()
  await writeFile(join(workspaceCwd, 'README.md'), '# Phoenix Root\n')
  const server = await startWebServer({
    cwd: storageCwd,
    workspaceCwd,
    host: '127.0.0.1',
    port: 0,
    callModel: async (): Promise<ModelResponse> => ({ content: 'answer', toolCalls: [] })
  })
  servers.push(server)

  const workspaceResponse = await fetch(`${server.url}/api/workspaces`)
  expect(workspaceResponse.status).toBe(200)
  await expect(workspaceResponse.json()).resolves.toEqual({
    workspaces: [{ id: '', label: basename(workspaceCwd), relativePath: '.' }]
  })

  const createResponse = await fetch(`${server.url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello' })
  })
  expect(createResponse.status).toBe(202)
  const createBody = (await createResponse.json()) as { runId: string; sessionId: string }
  await readRunEventStream(`${server.url}/api/runs/${createBody.runId}/events`)

  await expect(readFile(join(storageCwd, '.cyrene', 'sessions', 'index.json'), 'utf8')).resolves.toContain(createBody.sessionId)
  await expect(readFile(join(workspaceCwd, '.cyrene', 'sessions', 'index.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})
```

Add `basename` to the `node:path` import.

- [ ] **Step 4: Verify RED**

Run:

```bash
npm test -- tests/launch-cwd.test.ts tests/web-workspaces.test.ts tests/web-server.test.ts
```

Expected: FAIL because cwd still resolves through `<cwd>/workspace` and `startWebServer` has no `workspaceCwd`.

- [ ] **Step 5: Implement boundary and storage split**

In `src/launch-cwd.ts`, replace the current logic with:

```ts
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function resolveDefaultWebCwd(_launchCwd: string): string {
  return resolve(homedir())
}
```

In `src/web/workspaces.ts`:

```ts
async function canonicalWorkspaceRoot(repoCwd: string): Promise<string> {
  const workspaceRoot = resolve(repoCwd)
  try {
    const stats = await lstat(workspaceRoot)
    if (!stats.isDirectory()) {
      throw new Error(`workspace root is not a directory: ${workspaceRoot}`)
    }
    return await realpath(workspaceRoot)
  } catch (error) {
    if (error instanceof Error && error.message.includes('workspace root is not a directory')) {
      throw error
    }
    throw new Error(`workspace root does not exist: ${workspaceRoot}`)
  }
}
```

Return labels with `basename(canonicalRoot)`:

```ts
const rootLabel = basename(canonicalRoot)
return {
  id,
  label: id === '' ? rootLabel : `${rootLabel}/${id}`,
  relativePath: id === '' ? '.' : id,
  absolutePath: canonicalWorkspace
}
```

In `src/web/server.ts`, extend input/context:

```ts
export interface StartWebServerInput {
  cwd: string
  workspaceCwd?: string
  memoryCwd?: string
  host: string
  port: number
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}
```

Add `workspaceCwd` to `WebServerContext`, set it in `startWebServer`, and update workspace routes/createRun:

```ts
const workspaceCwd = input.workspaceCwd ?? input.cwd
...
workspace = await resolveWorkspace(context.workspaceCwd, parsed.workspaceId)
...
writeJson(response, 200, { workspaces: await listWorkspaces(context.workspaceCwd) })
```

Keep session/trace/evolution calls on `context.cwd`.

In `src/main.ts`, split default web values:

```ts
const defaultWebCwd =
  parsedOptions.web === true && !hasExplicitCwd
    ? resolveDefaultWebCwd(launchCwd)
    : parsedOptions.cwd
const options = { ...parsedOptions, cwd: defaultWebCwd }
const webStorageCwd =
  parsedOptions.web === true && !hasExplicitCwd
    ? launchCwd
    : options.cwd
const runtimeMemoryCwd =
  parsedOptions.web === true && !hasExplicitCwd
    ? webStorageCwd
    : launchCwd
...
const server = await startWebServer({
  cwd: webStorageCwd,
  workspaceCwd: config.cwd,
  memoryCwd: config.memoryCwd,
  host: options.host,
  port
})
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- tests/launch-cwd.test.ts tests/web-workspaces.test.ts tests/web-server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit boundary/storage split**

Run:

```bash
git add src/launch-cwd.ts src/web/workspaces.ts src/web/server.ts src/main.ts tests/launch-cwd.test.ts tests/web-workspaces.test.ts tests/web-server.test.ts
git commit -m "feat: default web boundary to home"
```

---

## Task 3: Web Health And Desktop Server Scripts

**Files:**
- Modify: `tests/web-server.test.ts`
- Modify: `tests/main-cli.test.ts`
- Modify: `src/web/server.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing health endpoint test**

In `tests/web-server.test.ts`, add:

```ts
it('reports health for desktop readiness polling', async () => {
  const server = await startServer()

  const response = await fetch(`${server.url}/api/health`)

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({
    ok: true,
    service: 'cyrene-web'
  })
})
```

- [ ] **Step 2: Write failing desktop script contract test**

In `tests/main-cli.test.ts`, add a script contract test:

```ts
it('declares desktop Web and Tauri scripts', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>
    devDependencies?: Record<string, string>
  }

  expect(manifest.scripts['desktop:web']).toBe('tsx src/main.ts --web --host 127.0.0.1')
  expect(manifest.scripts['desktop:dev']).toContain('tauri dev')
  expect(manifest.devDependencies?.['@tauri-apps/cli']).toBe('^2.11.2')
})
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- tests/web-server.test.ts tests/main-cli.test.ts
```

Expected: FAIL because `/api/health` and desktop scripts do not exist.

- [ ] **Step 4: Implement health route and scripts**

In `src/web/server.ts`, add before other API routes:

```ts
if (request.method === 'GET' && url.pathname === '/api/health') {
  writeJson(response, 200, { ok: true, service: 'cyrene-web' })
  return
}
```

In `package.json`:

```json
"desktop:web": "tsx src/main.ts --web --host 127.0.0.1",
"desktop:dev": "PATH=\"$HOME/.cargo/bin:$PATH\" tauri dev"
```

Install CLI:

```bash
npm install -D @tauri-apps/cli@2.11.2
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/web-server.test.ts tests/main-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit health/scripts**

Run:

```bash
git add src/web/server.ts package.json package-lock.json tests/web-server.test.ts tests/main-cli.test.ts
git commit -m "feat: add desktop web readiness endpoint"
```

---

## Task 4: Tauri v2 Dev Shell Scaffold

**Files:**
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/icons/*` if generated by Tauri CLI
- Create: `src-tauri/README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Generate scaffold through official CLI**

Run:

```bash
npm exec tauri init -- --ci --app-name Cyrene --window-title Cyrene --frontend-dist ../src/web/static --dev-url http://127.0.0.1:4317 --before-dev-command "npm run desktop:web -- --port 4317"
```

Expected: `src-tauri/` is created.

- [ ] **Step 2: Normalize Tauri config**

Edit `src-tauri/tauri.conf.json` so the dev URL and before command are explicit:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Cyrene",
  "version": "0.1.0",
  "identifier": "local.cyrene.app",
  "build": {
    "beforeDevCommand": "npm run desktop:web -- --port 4317",
    "devUrl": "http://127.0.0.1:4317",
    "frontendDist": "../src/web/static"
  },
  "app": {
    "windows": [
      {
        "title": "Cyrene",
        "width": 1280,
        "height": 820,
        "minWidth": 1180,
        "minHeight": 720,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": false,
    "targets": "all",
    "icon": []
  }
}
```

- [ ] **Step 3: Add scaffold README**

Create `src-tauri/README.md`:

```md
# Cyrene Tauri Shell

Phase 8B v0 keeps the Web UI as the source of truth.

Run from the repo root:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run desktop:dev
```

The Tauri dev shell starts:

```bash
npm run desktop:web -- --port 4317
```

and loads:

```txt
http://127.0.0.1:4317
```

Current boundary:

- Web run boundary defaults to the user home folder when `cyrene --web` is launched without `--cwd`.
- Session, memory, trace, and evolution storage remain under the launch/storage root.
- Signing, notarization, auto-update, packaged Node runtime, tray lifecycle, and close-to-tray behavior are later desktop hardening steps.
```

- [ ] **Step 4: Verify Tauri config is parseable**

Run:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm exec tauri -- info
```

Expected: command exits `0` and reports Tauri environment info.

- [ ] **Step 5: Commit scaffold**

Run:

```bash
git add package.json package-lock.json src-tauri
git commit -m "feat: add tauri desktop shell scaffold"
```

---

## Task 5: Full Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Start Web app for Browser QA**

Run:

```bash
npm run desktop:web -- --port 4317
```

Expected output:

```txt
cyrene web listening at http://127.0.0.1:4317
```

Browser checks:

- Empty state shows avatar + composer only.
- No heading/body copy under the avatar.
- Sidebar shows brand, new chat, session history; no bottom workspace selector.
- Inspector tabs show `Context`, `Tools`, `Memory`, `Affect`; no `Trace` or `Evolution`.
- Send button icon is readable in light mode.
- Send button icon is readable in dark mode.

- [ ] **Step 4: Start Tauri dev shell**

Run:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run desktop:dev
```

Expected:

- Tauri opens a desktop window titled `Cyrene`.
- Window loads `http://127.0.0.1:4317`.
- Tauri dev command starts the Web server through `desktop:web`.

- [ ] **Step 5: Computer Use desktop smoke**

Computer Use checks:

- Desktop window is visible.
- Web UI style matches Browser Web UI.
- Dark mode send icon remains readable.
- Closing the dev shell terminates the local Web process.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on `codex/phase-8a-soft-ui`.

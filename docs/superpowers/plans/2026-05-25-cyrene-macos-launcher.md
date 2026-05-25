# Cyrene macOS Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一个可双击打开的 `/Users/phoenix/Applications/Cyrene.app`，让用户不需要 terminal 就能启动当前 Cyrene Tauri dev shell。

**Architecture:** Repo 内新增一个可复用 Node 脚本 `scripts/create-macos-launcher.mjs`，负责生成 AppleScript app bundle、patch `Info.plist`、从现有头像生成 `.icns`。实际桌面入口写到 `/Users/phoenix/Applications/Cyrene.app`，运行时后台执行当前 repo 的 `npm run desktop:dev`，日志写入 `~/Library/Logs/Cyrene-launcher.log`。

**Tech Stack:** Node.js ESM script, Vitest, AppleScript `osacompile`, macOS `sips` / `iconutil` / `PlistBuddy`, Tauri dev script.

---

## File Map

- Create: `scripts/create-macos-launcher.mjs`
  - 导出纯函数用于测试 AppleScript / plist patch / iconset plan。
  - CLI 主流程生成 `/Users/phoenix/Applications/Cyrene.app`。
- Create: `tests/macos-launcher.test.mjs`
  - TDD 覆盖 launcher script 的关键 contract。
- Modify: `package.json`
  - 增加 `launcher:create` script，便于以后重新生成 app。
- Create: `/Users/phoenix/Applications/Cyrene.app`
  - 本地生成，不进入 git。

## Task 1: Script Contract Tests

**Files:**
- Create: `tests/macos-launcher.test.mjs`
- Create: `scripts/create-macos-launcher.mjs`

- [x] **Step 1: Write failing tests**

Create `tests/macos-launcher.test.mjs` with tests that import:

```ts
import {
  buildAppleScript,
  buildIconsetEntries,
  buildPlistBuddyCommands,
  resolveLauncherPaths
} from '../scripts/create-macos-launcher.mjs'
```

Assertions:

```ts
expect(resolveLauncherPaths('/repo')).toMatchObject({
  appPath: '/Users/phoenix/Applications/Cyrene.app',
  iconSource: '/repo/src/web/static/assets/cyrene-cartoon-avatar.png',
  iconName: 'Cyrene.icns',
  logPath: '/Users/phoenix/Library/Logs/Cyrene-launcher.log'
})
expect(buildAppleScript({ repoPath: '/repo', logPath: '/tmp/Cyrene.log' })).toContain('npm run desktop:dev')
expect(buildAppleScript({ repoPath: '/repo', logPath: '/tmp/Cyrene.log' })).toContain('nohup')
expect(buildAppleScript({ repoPath: '/repo', logPath: '/tmp/Cyrene.log' })).toContain('/repo')
expect(buildPlistBuddyCommands('Cyrene', 'local.cyrene.launcher', 'Cyrene')).toContainEqual(['Set', ':CFBundleDisplayName', 'Cyrene'])
expect(buildIconsetEntries()).toContainEqual({ name: 'icon_512x512@2x.png', pixels: 1024 })
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/macos-launcher.test.mjs
```

Expected: FAIL because `scripts/create-macos-launcher.mjs` does not exist.

- [x] **Step 3: Add minimal script exports**

Create `scripts/create-macos-launcher.mjs` with exported pure helpers:

```js
export function resolveLauncherPaths(repoPath = process.cwd()) { ... }
export function buildAppleScript({ repoPath, logPath }) { ... }
export function buildPlistBuddyCommands(appName, bundleIdentifier, iconBaseName) { ... }
export function buildIconsetEntries() { ... }
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/macos-launcher.test.mjs
```

Expected: PASS.

## Task 2: Launcher Generation CLI

**Files:**
- Modify: `scripts/create-macos-launcher.mjs`
- Modify: `package.json`

- [x] **Step 1: Write failing CLI/package tests**

Extend `tests/macos-launcher.test.mjs`:

```ts
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
expect(pkg.scripts['launcher:create']).toBe('node scripts/create-macos-launcher.mjs')
expect(buildAppleScript({ repoPath: '/repo', logPath: '/tmp/Cyrene.log' })).toContain('Cyrene repo not found')
expect(buildAppleScript({ repoPath: '/repo', logPath: '/tmp/Cyrene.log' })).toContain('/tmp/Cyrene.log')
```

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/macos-launcher.test.mjs
```

Expected: FAIL because `launcher:create` is missing and AppleScript does not yet include all runtime checks.

- [x] **Step 3: Implement CLI generation**

In `scripts/create-macos-launcher.mjs`, add `createLauncher()` and direct-run detection:

```js
export function createLauncher({ repoPath = process.cwd(), appPath, logPath, iconSource } = {}) { ... }

if (isDirectRun(import.meta.url, process.argv[1])) {
  createLauncher()
}
```

CLI behavior:

- Remove and recreate the target app bundle with `osacompile`.
- Generate iconset PNGs with `sips`.
- Generate `.icns` with `iconutil`.
- Copy `.icns` into `Contents/Resources/Cyrene.icns`.
- Patch `Info.plist` with `PlistBuddy`.
- Print the generated app path.

In `package.json`, add:

```json
"launcher:create": "node scripts/create-macos-launcher.mjs"
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/macos-launcher.test.mjs
```

Expected: PASS.

## Task 3: Generate Local App Bundle

**Files:**
- Generate: `/Users/phoenix/Applications/Cyrene.app`

- [x] **Step 1: Generate app**

Run:

```bash
npm run launcher:create
```

Expected output includes:

```txt
Created /Users/phoenix/Applications/Cyrene.app
```

- [x] **Step 2: Verify app bundle structure**

Run:

```bash
plutil -lint /Users/phoenix/Applications/Cyrene.app/Contents/Info.plist
file /Users/phoenix/Applications/Cyrene.app/Contents/Resources/Scripts/main.scpt
file /Users/phoenix/Applications/Cyrene.app/Contents/Resources/Cyrene.icns
```

Expected:

- `Info.plist: OK`
- `main.scpt` exists as compiled AppleScript.
- `Cyrene.icns` exists as Mac OS X icon.

## Task 4: Launch Verification

**Files:**
- Verify: `/Users/phoenix/Applications/Cyrene.app`
- Verify: `~/Library/Logs/Cyrene-launcher.log`

- [x] **Step 1: Ensure clean port**

Run:

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN || true
```

Expected: no listener before opening the app.

- [x] **Step 2: Open app**

Run:

```bash
open /Users/phoenix/Applications/Cyrene.app
```

Expected: launches background `npm run desktop:dev`.

- [x] **Step 3: Verify server and window**

Run:

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

Expected: node process listening on `127.0.0.1:4317`.

Run a macOS window list query and confirm:

```txt
owner=cyrene title=Cyrene
```

- [x] **Step 4: Verify log**

Run:

```bash
tail -40 ~/Library/Logs/Cyrene-launcher.log
```

Expected: includes `Launch requested` and `cyrene web listening at http://127.0.0.1:4317`.

- [x] **Step 5: Stop verification processes**

Stop repo-specific `tauri dev`, `desktop:web`, and `target/debug/cyrene` processes, then verify:

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN || true
```

Expected: no listener.

## Task 5: Final Verification And Commit

**Files:**
- Verify: all modified repo files

- [x] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 2: Full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [x] **Step 3: Commit**

Run:

```bash
git add -f docs/superpowers/plans/2026-05-25-cyrene-macos-launcher.md
git add package.json scripts/create-macos-launcher.mjs tests/macos-launcher.test.mjs
git commit -m "feat: add cyrene macos launcher"
```

- [x] **Step 4: Final status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on `codex/phase-8a-soft-ui`.

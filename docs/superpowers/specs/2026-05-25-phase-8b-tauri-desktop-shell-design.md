# Phase 8B Tauri Desktop Product Shell Design

## 状态

Draft for user review.

本 spec 定义 Phase 8B：

```txt
Tauri Desktop Product Shell
```

Phase 8B 不重写 Cyrene Web UI，也不把 agent runtime 搬进前端。它把 Phase 8A 整理后的 Web shell 包装成真正可用的桌面 App：Tauri 负责 native window、tray、menu、本地 Node server lifecycle、外部链接和基础权限桥接；Cyrene 的 runtime、tools、memory、session、trace、affect 和 control API 继续留在 Node/TypeScript 后端。

## 背景

Phase 7 已经把 Web UI 升级为 agent control console。Phase 8A 的目标是把 Web UI polish 成 desktop-ready Hybrid App Shell，并保持视觉连续性：

```txt
Web UI 是 source of truth
Tauri 只是 shell
runtime 仍在 Node/TypeScript backend
```

Phase 8B 承接 Phase 8A，不再重新设计 UI。它选择 `Desktop Product Shell`，而不是只做最小窗口包装。原因是 Cyrene 面向长期本地使用，桌面 App 至少需要稳定启动、关闭、tray、menu、server health 和 quit cleanup，否则只是一个浏览器窗口。

## 前置 UI 条件

Phase 8B 开始前，Web UI 需要完成一组 8A follow-up 调整，避免把仍偏“项目控制台”的界面固化进桌面 App。

必须作为 8B 前置条件：

- 空状态只保留卡通头像、composer、Think mode、context ring 和 send icon。
- 删除空状态头像下方的标题和说明文案。
- 默认右侧 inspector 不再显示 `Trace` 和 `Evolution` tab。
- `Trace` / `Evolution` 后端 API、数据和 CLI 能力先保留，不在 8B 删除。
- Send button 使用简洁 icon，并适配 light / dark mode 的 icon color、hover、active 和 disabled state。
- Web 默认文件边界改为 `/Users/phoenix`，面向情感生活助手，而不是项目 workspace 助手。
- 左下角 `workspace` 边界选择 UI 从默认 shell 移除。
- Session、memory、trace store 和 run recorder 的存储位置保持现状，不迁移到 `/Users/phoenix`。
- 新 session 仍可记录内部 `workspaceId` 兼容字段，但用户不需要看到或选择它。

这个前置条件的产品意图是：

```txt
Cyrene 是个人情感生活助手，默认能理解 Phoenix 的本地生活上下文。
Cyrene 不是以项目 workspace 为第一入口的开发控制台。
```

## 目标

Phase 8B 覆盖：

- 添加 Tauri shell 工程结构。
- Tauri 启动本地 Cyrene Web server。
- Tauri window 加载 `http://127.0.0.1:<port>` 的现有 Web UI。
- Web UI 仍可通过 `npm run dev -- --web` 独立运行。
- 桌面 App 支持 close、quit、tray、menu、external link 行为。
- 桌面 App 能检测 server ready、server crash、port conflict 和 quit cleanup。
- 保持 session、memory、trace、affect、evolution 和 tools 的后端 source of truth。
- 用 Browser 验证 Web UI，用 Computer Use 验证 Tauri 桌面行为。

## 非目标

Phase 8B 不做：

- 不重写原生 Tauri UI。
- 不引入 Electron。
- 不迁移 React、Vite、Svelte 或其他前端框架。
- 不把 agent loop、tool execution、memory lifecycle 或 model routing 写进 Rust/前端。
- 不改变 Phase 0-7 建立的 API-first runtime 边界。
- 不删除 trace/evolution 后端能力。
- 不做自动更新、签名、公证、发布渠道。
- 不实现复杂权限策略 UI。
- 不改变 memory/session 存储格式。

## 产品决策

### 选择 Desktop Product Shell

Phase 8B 选择：

```txt
Desktop Product Shell
```

而不是：

```txt
Minimal Tauri Window
```

Minimal Tauri Window 只能证明 Web UI 能在 Tauri 中打开，但不能证明 Cyrene 能作为长期运行的本地 App 使用。Phase 8B 应该一次性定义桌面 shell 的产品边界，但实现仍然可以分步。

### Tauri 是 shell，不是 runtime

Tauri 负责：

- 创建 native window。
- 启动 / 停止 local Node server。
- 选择端口并等待 server ready。
- 承载 tray / menu / close behavior。
- 处理 external link。
- 暴露必要 native bridge。

Tauri 不负责：

- model call。
- tool execution。
- memory 写入。
- session resume。
- trace 记录。
- affect correction。
- evolution proposal apply。

### Web UI 继续独立

Phase 8B 不能让 Web UI 只能从 Tauri 启动。以下入口必须继续有效：

```bash
npm run dev -- --web
```

Tauri 只是新增桌面入口，不替代 Web dev/debug 入口。

## Architecture

### Runtime Shape

```txt
Tauri App
  -> starts bundled or local Node process
  -> Node process starts Cyrene Web server on 127.0.0.1:<port>
  -> Tauri waits for / health-ready signal
  -> Tauri window loads local Web URL
  -> Web UI talks to existing HTTP/SSE APIs
```

### Ownership

```txt
src/web/*                  Web UI and Web API
src/*                      Cyrene Node/TypeScript runtime
src-tauri/*                Native shell, lifecycle, tray, menu
package scripts            Web server build/start entrypoints
```

`src-tauri/*` must call existing Node entrypoints rather than duplicating agent behavior.

## Server Lifecycle

Tauri startup should follow a deterministic lifecycle:

1. Choose a loopback host and port.
2. Start Node server with explicit host/port env or CLI args.
3. Stream server stdout/stderr into a local log file.
4. Poll a health target until ready or timeout.
5. Load the Web UI URL only after ready.
6. If server fails before ready, show a native error state or reloadable failure view.
7. On app quit, terminate the child process and wait for cleanup.

Required behavior:

- Host is loopback only: `127.0.0.1`.
- Port can be configured, but default should choose an available local port.
- Port conflicts must not silently open the wrong server.
- If Node server exits unexpectedly, the UI should show a recoverable error state.
- Quit must clean up the child process.

## Window Behavior

Required desktop behavior:

- Main window title is `Cyrene`.
- Window opens to a desktop-sized default matching Phase 8A layout.
- Window remembers size and position if Tauri support is straightforward.
- Close behavior is explicit:
  - default close may hide to tray if tray is enabled;
  - menu `Quit` fully exits and stops server.
- External links open in the system browser, not inside Cyrene's app window.
- Reload is available from menu during development or troubleshooting.

## Tray Behavior

Tray is part of Desktop Product Shell.

Tray menu should include:

```txt
Show Cyrene
New chat
Restart local server
Quit
```

Tray behavior:

- Closing the main window can keep Cyrene available from tray.
- `Quit` terminates both Tauri and the Node server.
- `Restart local server` is allowed only when no run is active, or it must warn before interrupting.

## Menu Behavior

Native menu should include minimal app-level actions:

```txt
Cyrene
  About Cyrene
  Settings...       // may be disabled in 8B v0
  Quit Cyrene

View
  Reload
  Toggle Developer Tools   // development builds only

Window
  Show Cyrene
  Minimize
```

8B 不需要实现完整 settings page。Settings 可以先保留为 disabled menu item 或指向未来 Phase。

## Permission Bridge

Phase 8B 只定义 shell-level bridge，不实现复杂权限系统。

允许的 bridge：

- external link open。
- native file reveal / open path，必须由后端提供 safe path。
- server restart / quit command。
- future high-risk approval native dialog hook。

不允许的 bridge：

- 前端直接读写任意文件。
- 前端绕过 backend tool permissions。
- 前端直接写 `.cyrene/*`。
- Tauri command 直接执行 shell/tool call。

所有高风险 agent 行为仍走后端 guard。

## Config

Tauri 启动 Node server 时需要传递或继承现有配置：

```txt
CYRENE_PROFILE
CYRENE_MODEL_PROVIDER
CYRENE_BASE_URL
CYRENE_MODEL
CYRENE_CHEAP_MODEL
CYRENE_SUMMARY_MODEL
CYRENE_AFFECT_MODEL
CYRENE_ENABLE_BASH
CYRENE_ENABLE_WEB_SEARCH
CYRENE_TRACE_ENABLED
CYRENE_REQUIRE_APPROVAL_FOR_HIGH_RISK_TOOLS
```

8B 不新增 API key 管理 UI。环境变量和现有 config 仍是 source of truth。

## Build And Packaging Boundary

Phase 8B 的实现应先支持 development packaging：

```txt
npm run typecheck
npm test
npm run build
Tauri dev command
Tauri app launch smoke
```

正式发布能力后置：

- code signing
- notarization
- auto update
- DMG branding
- installer UX

这些不属于 8B v0。

## Verification Workflow

### Browser

Browser 继续用于 Web UI 验证：

- 空状态只显示 avatar + composer。
- 右侧默认 tabs 不显示 Trace/Evolution。
- Send icon 在 light/dark mode 均可读。
- 默认边界 UI 不显示 workspace selector。
- Web 独立运行仍可用。

### Computer Use

Computer Use 用于 Tauri 桌面验收：

- App 可以从桌面启动。
- 本地 server 自动启动。
- Window 加载 Cyrene Web UI。
- Close 行为符合定义。
- Tray 能 show / new chat / restart server / quit。
- Quit 后 Node server 不残留。
- External link 打开系统浏览器。
- 深色模式和发送 icon 在桌面窗口中正常。

## Acceptance Criteria

8A follow-up UI acceptance:

```txt
[ ] Empty state no longer shows heading/body copy under the avatar.
[ ] Trace and Evolution tabs are removed from default Web inspector UI.
[ ] Trace/Evolution backend APIs remain available unless a later phase removes them.
[ ] Send icon color is readable in light mode.
[ ] Send icon color is readable in dark mode.
[ ] Workspace selector is removed from default sidebar UI.
[ ] Default Web run boundary is /Users/phoenix.
[ ] Session and memory storage remain in the existing Cyrene storage location.
```

8B desktop shell acceptance:

```txt
[ ] Web UI remains independently runnable.
[ ] Tauri app starts local Node server on loopback.
[ ] Tauri waits for server readiness before loading the window.
[ ] Tauri window loads existing Web shell.
[ ] Tauri close / show / quit behavior is defined and verified.
[ ] Tray menu exposes Show, New chat, Restart local server, Quit.
[ ] Quit terminates the Node server.
[ ] Server crash or startup failure has a visible recoverable state.
[ ] External links open in the system browser.
[ ] Computer Use verifies real desktop behavior.
```

## Risks

Risk: Tauri introduces a second UI surface.

Mitigation: Tauri only loads the Web shell. Any native surface must be app-level only: window, tray, menu, external link, lifecycle.

Risk: Server lifecycle becomes flaky.

Mitigation: Use explicit host/port, readiness polling, timeout, crash handling and child-process cleanup. Do not rely on arbitrary sleep.

Risk: Default `/Users/phoenix` boundary is too broad.

Mitigation: Keep backend guardrails, safe path checks and tool permissions. UI hides project workspace selector, but runtime still uses explicit cwd and session metadata.

Risk: Close-to-tray hides an active run.

Mitigation: Closing the window may hide it, but quitting or restarting server must account for active run state. In v0, prefer warning or blocking restart during active run.

Risk: Packaging work pulls focus from runtime quality.

Mitigation: 8B v0 stops at local desktop shell and smoke verification. Signing, update and distribution are later phases.

## Next Step

After this spec is reviewed, write an implementation plan for Phase 8B. The plan should sequence:

1. Complete 8A follow-up UI adjustments.
2. Add minimal Tauri project scaffolding.
3. Add Node server lifecycle management.
4. Add window/tray/menu behavior.
5. Run Browser checks for Web UI.
6. Run Computer Use checks for desktop behavior.

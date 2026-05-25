# Cyrene macOS Launcher Design

## Goal

做一个本地 `Cyrene.app` 启动器，让用户不需要打开 terminal，也能双击启动当前 repo 的 Tauri desktop dev shell。

这个启动器是 Phase 8B 的便利入口，不是正式发布版安装包。它依赖当前 repo 路径、`node_modules`、Rust/Tauri 工具链和现有 `npm run desktop:dev` 脚本。

## User Experience

- 用户双击 `/Users/phoenix/Applications/Cyrene.app`。
- 系统打开一个名为 `Cyrene` 的 app。
- app 后台执行 `/Users/phoenix/Assistant/Cyrene` 下的 `npm run desktop:dev`。
- Tauri 打开桌面窗口，继续加载 `http://127.0.0.1:4317`。
- 用户可以把 `Cyrene.app` 拖到 Dock，以后从 Dock 启动。

## App Name And Icon

- App bundle 名称使用 `Cyrene.app`，不带 `Launcher` 后缀。
- 图标先复用现有 Web/App 卡通头像资产：`src/web/static/assets/cyrene-cartoon-avatar.png`。
- 生成 macOS `.icns` 并放进 app bundle 的 `Contents/Resources/Cyrene.icns`。
- 暂不重新设计 icon，避免在 Phase 8B 引入新的视觉方向。正式发布前可以单独做一版 macOS-ready icon。

## Architecture

使用 AppleScript app bundle 作为轻量启动器：

- `Contents/Info.plist` 定义 bundle metadata、display name、icon。
- `Contents/Resources/Scripts/main.scpt` 负责启动命令。
- `main.scpt` 使用 `do shell script` 进入 repo，并执行一个 detached shell：
  - 设置 `PATH`，确保能找到 `npm`、`node`、`cargo`、`tauri`。
  - 执行 `npm run desktop:dev`。
  - 将 stdout/stderr 写入 `~/Library/Logs/Cyrene-launcher.log`。
- 为了避免双击后 AppleScript 一直占用前台，命令以后台方式启动。

## Process Behavior

启动器只负责启动，不负责长期管理 Tauri 进程。

约束：

- 如果 `4317` 已有 Cyrene Web server 在监听，`desktop:dev` 可能因端口占用失败；错误写入 log。
- 启动器不自动 kill 旧进程，避免误杀用户手动运行的 dev server。
- 关闭 Tauri 窗口后的进程生命周期继续由 `tauri dev` / 当前 Tauri 行为决定。

后续如果需要更像正式 app，可以增加一个 shell wrapper：

- 启动前检测旧 `cyrene` / `desktop:web` 进程。
- 提供 `Cyrene Quit.app` 或 menu bar helper。
- 将 Node backend 迁移为 Tauri sidecar。

这些都不放进当前版本。

## Error Handling

当前版本只做最小可诊断错误处理：

- 启动失败写入 `~/Library/Logs/Cyrene-launcher.log`。
- 如果 repo 路径不存在，log 明确记录 `Cyrene repo not found`。
- 如果 `npm` 或 `cargo` 找不到，log 保留 shell error。

不弹系统 alert。原因是这个 app 是开发便利入口，减少弹窗比完整用户错误恢复更重要。

## Testing

实现后做这些验证：

- `file` / `plutil` 验证 app bundle 基本结构和 `Info.plist`。
- `iconutil` 生成 `.icns` 成功。
- `open /Users/phoenix/Applications/Cyrene.app` 能启动 Tauri desktop window。
- macOS window list 能看到 owner/title 为 `cyrene` / `Cyrene`。
- `lsof -nP -iTCP:4317 -sTCP:LISTEN` 能看到本地 Web server。
- `~/Library/Logs/Cyrene-launcher.log` 有启动记录。

## Non-Goals

- 不做正式 `.dmg` 或 signed release。
- 不引入完整 Xcode 依赖。
- 不修改 Tauri app 的正式 bundle config。
- 不改变 Web UI、session、memory、workspace boundary。
- 不做新 icon 视觉设计。

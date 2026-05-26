# Phase D ABC Codex Continuity Repo Split Design

Ready for user review.

## 背景

Phase A 到 Phase C-D 已经让 Cyrene Codex bridge 具备完整的本机 memory 管线：

```txt
Codex
  -> cyrene-continuity skill
  -> Cyrene MCP tools
  -> pending.jsonl
  -> Codex review / Dream Deep
  -> index.jsonl
  -> MODEL_PROFILE.md
  -> continuity context
```

当前能力已经接近可以独立成插件 / MCP / Skill repo。用户建议 Phase D-A、D-B、D-C 一起做。这个判断是合理的：现在单独做 D-A 会修好边界，但还不能验证新 repo cutover；单独做 D-B/C 又依赖 D-A 的正确性。因此 Phase D 应作为一次连续交付推进。

关键约束是：ABC 可以同一条分支连续执行，但不能取消 gate。每个 gate 都必须有明确验收和可停止点。

## 决策

Phase D 采用 integrated ABC delivery：

```txt
D-A Repo split readiness + global pending MCP visibility fix
D-B New repo scaffold + code extraction
D-C Local Codex cutover + compatibility cleanup
```

执行方式：

- 在当前 Cyrene repo 中先完成 D-A 修复和测试。
- 新建一个独立本地 repo，承载 Codex continuity bridge。
- 本机 Codex MCP / Skill / automation 切换到新 repo。
- 保留可回滚路径，直到新 repo 通过真实使用验证。

不把三个阶段压成一个不可回滚的大改。D-A、D-B、D-C 在同一 Phase 内连续做，但必须顺序验收。

## Goals

- 修复 MCP review 视图不能暴露 global pending 的问题。
- 让 `cyrene_continuity_get.pendingReview` 正确统计 global root + 当前 project root 的 pending candidates。
- 让 `cyrene_memory_pending_list/get/promote/reject` 能正确操作 global pending candidates。
- 新建独立 repo，承载 Codex continuity MCP / Skill / hook / memory runtime。
- 独立 repo 继续读写现有 `~/.cyrene/codex/` 数据，不迁移用户 memory。
- 本机 Codex 从 Cyrene 主 repo bridge 切换到独立 repo bridge。
- 更新 `cyrene-memory-dream-deep` automation，让它调用新 repo command。
- 保留旧 Cyrene repo 的兼容 shim 或明确回滚命令，直到 cutover 验证通过。
- 文档化新 repo 的安装、doctor、MCP、hook、Dream Deep、数据路径和故障排查方式。

## Non-Goals

- 不发布 public plugin marketplace。
- 不把新 repo 推到远端，除非用户之后明确要求。
- 不迁移 `~/.cyrene/codex/` 下的用户数据。
- 不改变 `index.jsonl`、`pending.jsonl`、`events.jsonl`、`tombstones.jsonl`、`MODEL_PROFILE.md` 的文件格式。
- 不改变 Dream Deep promotion 阈值。
- 不把 pending memory 默认注入 active continuity context。
- 不实现 Web review UI。
- 不实现 Codex native permission-style approve/reject popup。
- 不把 Cyrene Web UI、Tauri desktop、experimental agent loop、evolution system 拆入独立 repo。
- 不删除 Cyrene 主 repo 中的 bridge 代码，直到新 repo cutover 被验证并由用户确认。

## Phase D-A: Readiness And Global Pending Fix

### 当前问题

直接读取全局 pending 文件可见候选：

```txt
/Users/phoenix/.cyrene/codex/global/memory/pending.jsonl
```

但 MCP 视图返回：

```json
{
  "pendingReview": {
    "count": 0,
    "hasItems": false
  }
}
```

`cyrene_memory_pending_list` 同样可能返回 0。

### D-A Target Behavior

`cyrene_continuity_get` 应返回 global + 当前 project 的 pending summary：

```json
{
  "pendingReview": {
    "count": 2,
    "hasItems": true,
    "newestCandidateId": "...",
    "newestPreview": "..."
  }
}
```

`pendingReview` 只是 review notice，不是 active memory。pending content 不能作为事实上下文进入 ordinary continuity memory。

`cyrene_memory_pending_list` 应默认列出：

```txt
global pending + current project pending
```

排序仍按 `lastSeenAt` newest-first。

`cyrene_memory_pending_get/promote/reject` 必须在 candidate 所在 root 上操作：

```txt
global candidate
  -> global pending.jsonl
  -> global index.jsonl / tombstones.jsonl / events.jsonl
  -> global MODEL_PROFILE.md

project candidate
  -> project pending.jsonl
  -> project index.jsonl / tombstones.jsonl / events.jsonl
  -> project MODEL_PROFILE.md
```

不允许把 global candidate promote 到 project root，也不允许把 project candidate promote 到 global root。

### D-A Tests

- global root 有 pending、project root 为空时，MCP pending count 为 1。
- global root 和 project root 各有 pending 时，MCP pending count 为 2。
- `pending_get(globalId)` 返回 global root。
- `pending_get(projectId)` 返回 project root。
- promote global candidate 只改 global root。
- reject global candidate 只改 global root。
- MCP handler 层覆盖 list/get/promote/reject/continuity-get，不只测底层函数。
- doctor 能报告 global pending count 和 project pending count，帮助定位旧 MCP server / 旧 command。

## Phase D-B: New Repo Scaffold

### Repo Name

默认新 repo 名称：

```txt
cyrene-continuity
```

理由：

- 比 `cyrene-codex-memory` 更宽，未来可接 Claude Code / OpenClaw adapter。
- 仍保留 Cyrene identity。
- 核心能力是 continuity，不只是 memory 文件读写。

如果后续要强调 Codex-only，可在 package description 中写明第一 adapter 是 Codex。

### Initial Location

本机默认位置：

```txt
/Users/phoenix/Assistant/cyrene-continuity
```

Phase D-B 只创建本地 git repo，不 push 远端。

### Package Shape

```txt
package: cyrene-continuity
bin: cyrene-continuity
```

目标 commands：

```bash
cyrene-continuity mcp-server --stdio
cyrene-continuity codex doctor
cyrene-continuity codex install --dev
cyrene-continuity codex install-hook --stop
cyrene-continuity codex hook stop
cyrene-continuity codex memory dream --stage deep
cyrene-continuity codex memory profile
```

### Repo Structure

```txt
src/
  codex/
  mcp/
  memory/
  config.ts
  main.ts

plugin/
  skills/
    cyrene-continuity/
      SKILL.md
  .codex-plugin/
    plugin.json

tests/
docs/
package.json
tsconfig.json
README.md
```

### Migrated Modules

迁移核心：

```txt
src/mcp/
src/mcp/tools/
src/codex/
src/memory/
integrations/codex/plugin/skills/cyrene-continuity/
```

最小化迁移：

```txt
src/config.ts
```

只保留 memory / MCP / Codex bridge 需要的 config。不要把主 Cyrene agent runtime、provider router、Web UI 或 eval system 带入新 repo。

### Excluded Modules

不迁移：

```txt
src/web/
src/desktop/
src/agent-loop.ts
src/evolution/
src/evals/
Tauri app shell
Cyrene Web UI
experimental provider/runtime features
```

### Data Compatibility

新 repo 继续使用现有路径：

```txt
~/.cyrene/codex/global/memory/
~/.cyrene/codex/projects/<projectId>/memory/
```

Phase D-B 不复制、不移动、不改写用户 memory 数据。任何 migration 都必须是显式 command，且不属于本阶段。

## Phase D-C: Local Cutover

### Codex MCP Cutover

本机 Codex MCP command 从旧 repo 切到新 repo：

```txt
old: /Users/phoenix/Assistant/Cyrene ...
new: /Users/phoenix/Assistant/cyrene-continuity ...
```

具体 config 修改必须由 `cyrene-continuity codex install --dev` 或明确的 structured installer 完成，不手写易错片段。

### Skill Cutover

`cyrene-continuity` skill 来源切到新 repo：

```txt
~/.agents/skills/cyrene-continuity
  -> /Users/phoenix/Assistant/cyrene-continuity/plugin/skills/cyrene-continuity
```

Skill 内容继续要求：

- substantial planning / debugging / Cyrene memory work 时调用 `cyrene_continuity_get`。
- pending review 必须显式 approve/reject。
- pending 不是 active memory。
- promote/reject 必须 hash checked。
- 不写诊断式 affective memory。

### Hook Cutover

Stop hook command 切到新 repo bin：

```bash
cyrene-continuity codex hook stop
```

Installer 必须 preserve 用户已有 hooks，不覆盖 unrelated hooks。

### Automation Cutover

`cyrene-memory-dream-deep` automation 切到新 repo command：

```bash
cyrene-continuity codex memory dream --stage deep
```

自我访谈 automation 不需要改业务逻辑；它通过 MCP tool 和 skill 工作。只有当 MCP command / skill path 已切换后，它自然使用新 repo bridge。

### Rollback

Cutover 后必须保留回滚说明：

- 恢复 MCP command 到 Cyrene 主 repo。
- 恢复 skill symlink 到 Cyrene 主 repo。
- 恢复 Stop hook command 到 Cyrene 主 repo。
- 恢复 Dream Deep automation command 到 Cyrene 主 repo。

不删除旧 bridge 代码，直到用户确认新 repo 运行稳定。

## Verification

Phase D 完成前必须通过：

### Current repo D-A verification

```bash
npm test
npm run typecheck
git diff --check
```

并手动验证当前真实 global pending 能被 MCP list 看到。

### New repo D-B verification

在 `/Users/phoenix/Assistant/cyrene-continuity` 中运行：

```bash
npm test
npm run typecheck
```

验证新 repo command：

```bash
npm run dev -- codex doctor
npm run dev -- mcp-server --stdio
npm run dev -- codex memory dream --stage deep
```

### Cutover D-C verification

从 Codex 当前环境验证：

- `cyrene_project_identify` 返回正确 project。
- `cyrene_continuity_get` 能读 active memory。
- `cyrene_memory_pending_list` 能看到 global pending。
- `cyrene_memory_pending_get` 能读取 global pending。
- 不 promote pending，除非用户明确批准。
- Dream Deep automation dry run 或手动 run 使用新 repo command。

## Acceptance Criteria

Phase D ABC 完成时必须满足：

- 当前 Cyrene repo 的 D-A 修复已测试通过。
- 新 repo 已创建为本地 git repo。
- 新 repo 可以独立安装依赖、typecheck、test。
- 新 repo 可以启动 MCP server。
- 新 repo 可以读写现有 `~/.cyrene/codex/` memory roots。
- 本机 Codex MCP / Skill / Stop hook / Dream Deep automation 已切到新 repo。
- 真实 global pending 在新 repo MCP 视图中可见。
- project pending 和 global pending 不会写错 root。
- 旧 Cyrene repo 保留可回滚路径。
- 不发布远端，不删除旧代码，除非用户另行确认。

## Risks

### 一次做 ABC 的风险

- 新 repo scaffold 暴露更多 package / path / bin 问题。
- Cutover 可能让本机 Codex 使用旧 server、旧 skill 或旧 hook。
- 如果 D-A bug 没先修好，D-B/C 会复制错误行为。

### 风险控制

- D-A 先测试通过，再复制代码。
- 新 repo 不迁移用户数据，只读写现有 `~/.cyrene/codex/`。
- Cutover 前后都跑 doctor。
- automation 最后改，避免新 command 未验证时影响每日任务。
- 保留旧 repo bridge 作为 rollback。

## Open Questions

1. 新 repo 名称是否确定为 `cyrene-continuity`？
2. 新 repo 是否需要立刻创建 GitHub remote，还是先只保留本地 repo？
3. Phase D-C cutover 后，旧 Cyrene repo 的 Codex bridge 代码是保留 shim，还是后续 Phase D-D 再删除？

这些问题中，只有第 1 个会影响 D-B scaffold 的路径和 package 名。默认答案是 `cyrene-continuity`。

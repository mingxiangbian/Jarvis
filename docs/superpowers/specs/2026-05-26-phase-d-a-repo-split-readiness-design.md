# Phase D-A Repo Split Readiness Design

Ready for user review.

## 背景

Phase A 到 Phase C-D 已经让 Cyrene Codex bridge 具备一条完整的本机 memory 管线：

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

当前能力已经接近可以独立成插件 / MCP / Skill repo，但还没有达到直接拆仓库的成熟度。主要原因是 MCP review 视图和底层文件状态之间出现了一个关键不一致：

```txt
/Users/phoenix/.cyrene/codex/global/memory/pending.jsonl
  -> 实际存在 2 条 global pending candidate

cyrene_continuity_get.pendingReview
cyrene_memory_pending_list
  -> 返回 0 条 pending
```

这说明独立 repo 前必须先固化 root 读取边界、MCP tool contract 和端到端测试。否则拆出新 repo 后，bug 会变成分发包的默认行为。

## 决策

Phase D-A 先在 Cyrene 主 repo 内完成：

```txt
Repo split readiness + global pending MCP visibility fix
```

本阶段不创建新 repo，不迁移用户数据，不切换本机 Codex 配置。Phase D-A 的目标是让现有代码达到“可以被复制 / 提取到新 repo”的状态。

真正的新 repo scaffold 放到 Phase D-B。

## Goals

- 修复 MCP review 视图不能暴露 global pending 的问题。
- 让 `cyrene_continuity_get.pendingReview` 正确统计 global root + 当前 project root 的 pending candidates。
- 让 `cyrene_memory_pending_list/get/promote/reject` 能正确操作 global pending candidates。
- 明确 Codex bridge 独立 repo 的模块边界。
- 明确哪些代码可以迁移，哪些代码必须留在 Cyrene 主 repo。
- 增加 repo split readiness 文档和测试，作为 Phase D-B 新 repo scaffold 的输入。
- 保持现有本机安装路径和 automation 不变。

## Non-Goals

- 不新建独立 git repo。
- 不发布 Codex plugin。
- 不修改 `~/.codex/config.toml`。
- 不迁移 `~/.cyrene/codex/` 下的用户数据。
- 不改变 `index.jsonl`、`pending.jsonl`、`events.jsonl`、`tombstones.jsonl`、`MODEL_PROFILE.md` 的文件格式。
- 不改变 Dream Deep promotion 阈值。
- 不把 pending memory 默认注入 active continuity context。
- 不实现 Web review UI。
- 不实现 Codex native permission-style approve/reject popup。
- 不把 Cyrene Web UI、Tauri desktop、experimental agent loop、evolution system 拆入独立 repo。

## 当前问题

### 症状

直接读取全局 pending 文件可见 2 条候选：

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

`cyrene_memory_pending_list` 同样返回 0。

### 影响

这个问题会导致：

- Codex 不会主动提示用户 review global pending。
- 用户说“查看 pending memory”时可能误以为没有候选。
- global pending 只能通过手动读文件发现。
- 自我访谈 automation 虽然写入了 global pending，但后续 review UX 断裂。
- 如果直接拆 repo，新 repo 的首个版本会带着错误的 pending review 行为。

### 初步判断

代码上 `src/codex/memory-review.ts` 已经有读取 global + project roots 的意图：

```txt
getProjectAndReadableMemoryRoots(cwd)
  -> globalRoot
  -> projectRoot
```

但运行中的 MCP tool 返回结果与当前源码预期不一致。Phase D-A 不预设根因，必须通过测试确认：

- MCP server 是否加载了当前源码。
- global root 是否被 `getReadableCodexGlobalMemoryRoot()` 正确识别。
- tool handler 是否使用了正确的 cwd。
- list/get/promote/reject 是否在不同 root 上返回了正确 `memoryRoot`。
- 是否存在旧构建、旧 MCP server、路径缓存或 root helper 行为差异。

## Target Behavior

### Pending notice

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

这里的 `pendingReview` 只是 review notice，不是 active memory。pending content 不能作为事实上下文进入 ordinary continuity memory。

### Pending list

`cyrene_memory_pending_list` 应默认列出：

```txt
global pending first
current project pending second
```

排序仍按 `lastSeenAt` newest-first。

返回项必须保留：

```txt
id
domain
type
strength
scope
content
normalizedKey
source
seenCount
firstSeenAt
lastSeenAt
expiresAt
reviewHash
evidenceSummary
scores
```

### Pending get/promote/reject

`cyrene_memory_pending_get` 应能按 id 在 global root 和当前 project root 中查找 candidate。

`cyrene_memory_promote` 和 `cyrene_memory_reject` 必须在 candidate 所在 root 上操作：

```txt
global candidate
  -> promote/reject global pending.jsonl
  -> write global index.jsonl / tombstones.jsonl / events.jsonl
  -> render global MODEL_PROFILE.md

project candidate
  -> promote/reject project pending.jsonl
  -> write project index.jsonl / tombstones.jsonl / events.jsonl
  -> render project MODEL_PROFILE.md
```

不允许把 global candidate promote 到 project root，也不允许把 project candidate promote 到 global root。

## Repo Split Boundary

Phase D-B 独立 repo 应只迁移 Codex continuity bridge 的可分发核心。

### 应迁移

```txt
src/mcp/
src/mcp/tools/
src/codex/
src/memory/
integrations/codex/plugin/skills/cyrene-continuity/
```

迁移时需要把 package 名和 bin 名独立化，例如：

```txt
package: cyrene-continuity
bin: cyrene-continuity
```

### 可迁移但需降耦合

```txt
src/config.ts
src/context.ts
src/model-router.ts
```

如果这些文件只为 memory / MCP 所需，应提取最小 config 子集。不要把主 Cyrene agent runtime 一起搬过去。

### 不应迁移

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

这些属于 Cyrene 主项目，不属于可分发 Codex memory bridge。

## Installation Boundary

Phase D-A 不修改安装，但要把未来安装边界写清楚。

Phase D-B 后，目标安装形态是：

```bash
cyrene-continuity codex doctor
cyrene-continuity codex install --dev
cyrene-continuity codex install-hook --stop
cyrene-continuity mcp-server --stdio
cyrene-continuity codex memory dream --stage deep
```

数据路径保持：

```txt
~/.cyrene/codex/global/memory/
~/.cyrene/codex/projects/<projectId>/memory/
```

独立 repo 不迁移用户数据，不改变现有 memory root。

## Testing

Phase D-A 必须补齐这些测试。

### Global pending visibility

创建 global root pending candidate，project root 为空：

```txt
cyrene_continuity_get.pendingReview.count === 1
cyrene_memory_pending_list.total === 1
pending[0].scope === "global"
```

### Mixed global + project pending

global root 和 project root 各有一条 pending：

```txt
pending list total === 2
get(globalId).memoryRoot === global root
get(projectId).memoryRoot === project root
```

### Promote global candidate

批准 global pending：

```txt
global pending.jsonl removes candidate
global index.jsonl contains active memory
global MODEL_PROFILE.md rerendered when profile-visible
project index.jsonl unchanged
```

### Reject global candidate

拒绝 global pending：

```txt
global pending.jsonl removes candidate
global tombstones.jsonl contains tombstone
global events.jsonl contains reject event
project memory root unchanged
```

### MCP server path

通过 MCP handler 层测试，而不只测底层函数：

```txt
handle cyrene_memory_pending_list
handle cyrene_memory_pending_get
handle cyrene_memory_promote
handle cyrene_memory_reject
handle cyrene_continuity_get
```

### Doctor / runtime freshness

增加或明确 doctor 输出，帮助定位 Codex 是否使用旧 MCP server：

```txt
binary path
repo path
package version
skill path
MCP command
global memory root readable
project memory root readable
global pending count
project pending count
```

## Acceptance Criteria

Phase D-A 完成时必须满足：

- `npm test` 通过。
- `npm run typecheck` 通过。
- 手动验证当前真实 global pending 能被 MCP list 看到。
- `cyrene_continuity_get.pendingReview` 能报告真实 global pending count。
- global pending 的 get/promote/reject 不会写错 root。
- spec 中的 repo split boundary 已经和当前文件结构对齐。
- 不改变现有 automation 行为。
- 不创建独立 repo。

## Phase D-B Readiness

只有 Phase D-A 完成后，才进入 Phase D-B：

```txt
new repo scaffold + local cutover
```

Phase D-B 的输入是：

- 已修复的 MCP global pending behavior。
- 已稳定的 `src/codex/`、`src/mcp/`、`src/memory/` 边界。
- 已验证的 install / doctor / hook / dream commands。
- 当前 `~/.cyrene/codex/` 数据格式继续可读。

## Open Questions

1. 独立 repo 名称暂定 `cyrene-continuity` 还是 `cyrene-codex-memory`？
2. Phase D-B 是否保留 `cyrene` bin shim，还是直接改为新 bin？
3. 独立 repo 是否只支持 Codex，还是预留 Claude Code / OpenClaw adapter 边界？
4. `Dream Deep` automation 在 Phase D-B cutover 时是否自动改 command，还是由用户手动确认后修改？

这些问题不阻塞 Phase D-A。Phase D-A 只修复当前 repo 内的可拆边界和 global pending MCP 行为。

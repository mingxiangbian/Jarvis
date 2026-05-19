# Session History 与 Memory 融合机制对比

## 范围与结论

本文比较 OpenAI Codex、Claude Code、Gemini CLI 如何把 session/history 融入短期上下文与长期 memory。这里的 `session/history` 指完整历史对话、工具调用、文件读写输出等运行日志；`memory` 指跨会话复用的稳定事实、偏好、项目约束、流程和踩坑记录。

核心结论：

1. 三者都把“继续当前对话”和“沉淀长期记忆”分成两套机制。
2. session resume 通常重载原始 transcript，不等同于 memory。
3. context compaction 是会话内保活机制，目标是省 token，不应直接当长期记忆。
4. 长期 memory 的共性做法是：从空闲历史会话中异步提取候选内容，经过筛选、脱敏、人工或策略门禁后，再进入后续会话的启动上下文或按需检索层。

## 横向对比

| 系统 | 会话续跑 | 会话内压缩 | 长期 memory 来源 | 写入门禁 | 注入方式 |
|------|----------|------------|------------------|----------|----------|
| Codex | `codex resume` / `/resume` 重载本地 transcript | `/compact` 用摘要替换早期 turns | eligible prior threads | 跳过 active/short-lived sessions，后台生成，脱敏，线程级开关 | `memories.use_memories` 控制注入未来 session |
| Claude Code | `/resume` / `/continue` 回到历史 conversation | `/compact`，并重新注入项目根 `CLAUDE.md` | `CLAUDE.md` + auto memory | Auto memory 由 Claude 判断是否值得保存 | `CLAUDE.md` 和 `MEMORY.md` 启动加载，topic files 按需读取 |
| Gemini CLI | `/resume` / `/chat` 浏览自动保存 session 或 tagged checkpoints | `/compress` 用摘要替换 chat context | `GEMINI.md`、`save_memory`、实验 Auto Memory | Auto Memory 只产出 inbox 候选，用户批准后应用 | 层级 `GEMINI.md` 每次 prompt 加载，候选 memory 可 reload |

## OpenAI Codex

Codex 官方文档把记忆描述为“把早期 thread 中有用上下文带到未来工作”。它默认关闭，需要在设置里开启，或在 `~/.codex/config.toml` 的 `[features]` 下设置 `memories = true`。官方还明确建议：必须稳定遵守的团队规则应放在 `AGENTS.md` 或仓库文档，memory 只是本地回忆层。

与 session 相关的链路分三层：

1. **Transcript resume**：Codex 本地保存 transcript。`codex resume` 可从当前目录、全部目录、最近 session 或指定 `SESSION_ID` 恢复；恢复后保留原始 transcript、plan history 和 approvals。
2. **Context compaction**：`/compact` 在长对话后把早期 turns 替换为摘要，释放上下文窗口，但保留关键细节。这是会话内上下文管理，不是长期 memory 写入。
3. **Memory generation**：开启 memories 后，Codex 可以把 eligible prior threads 转成 local memory files。官方文档说明它会跳过 active 或 short-lived sessions、对生成字段脱敏、后台更新，且不会在线程结束时立刻同步更新。

可控开关：

- `/memories`：当前 thread 是否使用已有 memories，以及当前 thread 是否可作为未来 memory 输入。
- `memories.generate_memories`：新建 thread 是否允许成为 memory generation 输入。
- `memories.use_memories`：未来 session 是否注入已有 memories。
- `memories.disable_on_external_context`：使用 MCP/web/tool search 等外部上下文的 thread 是否排除出 memory generation。
- `memories.extract_model` / `memories.consolidation_model`：提取和合并模型。

对当前 agent 的启发：

- 把 resume、compact、memory extraction 分开实现，避免“历史对话摘要污染长期记忆”。
- memory 生成应在 thread idle 后异步执行，不应阻塞交互。
- 为每个 thread 提供两个独立布尔开关：`use_memory` 和 `generate_memory`。
- required rules 仍放在 `AGENTS.md`，memory 只作为辅助召回。

## Claude Code

Claude Code 官方文档明确说：每个 session 都从 fresh context window 开始，跨会话知识由两套机制承载：

1. `CLAUDE.md`：用户写的持久说明，项目、用户、组织等不同作用域。
2. Auto memory：Claude 根据你的纠正、偏好和工作中发现的模式自动写给自己的 notes。

Claude Code 的关键边界：

- `CLAUDE.md` 和 auto memory 都在每次 conversation 启动时加载，但它们是 context，不是强制配置。
- Auto memory 不会每个 session 都保存；它判断内容是否对未来 conversation 有价值。
- 每个项目的 auto memory 目录在 `~/.claude/projects/<project>/memory/`，其中 `MEMORY.md` 是入口索引。
- `MEMORY.md` 启动时只加载前 200 行或 25KB，详细 topic files 不启动加载，而是在需要时用文件工具读取。
- `/memory` 可查看已加载的 memory/rules 文件、切换 auto memory、打开 auto memory 目录。

Claude Code 也把 compaction 和 memory 分开。`/compact` 用来释放 context；如果某条指令只在对话里说过，压缩后可能丢失。项目根 `CLAUDE.md` 会在 `/compact` 后重新读取并注入，但嵌套的 `CLAUDE.md` 只有在再次读取对应目录文件时才重载。

对当前 agent 的启发：

- 设计一个小型 `MEMORY.md` 索引，启动必加载；详细 memory 文件按需读取。
- 长期规则、workflow 和“用户纠正过的偏好”可以进入 memory；一次性任务状态不要进入 memory。
- compact prompt 应读取一个 `Compact Instructions` 区域，告诉模型哪些内容压缩时必须保留。
- 如果支持 sub-agent，子 agent 应有独立或隔离的 memory 视图，避免主 session 的噪声泄漏。

## Gemini CLI

Gemini CLI 当前有三条相关路径：

1. **层级 `GEMINI.md` memory**：CLI 从全局 `~/.gemini/GEMINI.md`、项目/父目录、子目录加载 context files，拼接后随 prompt 发送给模型。`/memory show` 可显示当前加载内容，`/memory refresh` 可重扫，`/memory add <text>` 可追加到全局 memory。
2. **显式 `save_memory` tool**：把单条 `fact` 写入特殊 `GEMINI.md` 的 `## Gemini Added Memories` 段，后续 session 加载。官方说明它适合简短重要事实，不适合保存大量数据或完整 conversation history。
3. **实验 Auto Memory**：扫描本地历史 transcript，从 session 中提取 durable facts、preferences、workflow constraints、procedural patterns，并生成 reviewable patches 或 `SKILL.md` drafts。候选项进入项目本地 inbox，必须经用户批准才会应用。

Gemini Auto Memory 的具体门禁很适合参考：

- 只处理本地已有 session files。
- session 必须 idle 至少 3 小时，且至少 10 条 user messages。
- 跳过 active、trivial 和 sub-agent sessions。
- 后台任务在 session startup 执行，不阻塞 UI。
- 使用 lock file 和 state file，避免多个 CLI 实例重复处理。
- 候选写入 review inbox，不能直接修改 active memory files、settings、credentials 或项目 `GEMINI.md`。
- patch 要解析、dry-run、target allowlist 后，批准时原子应用。
- Auto Memory 不处理当前 session，只处理已经空闲的历史 session。

Gemini 的 session 续跑也独立存在：`/resume` 或 `/chat` 可浏览自动保存的 conversation sessions，也可管理手动 chat checkpoints；`/compress` 是把当前 chat context 替换为摘要以节省 token。

对当前 agent 的启发：

- `save_memory(fact)` 这种显式工具适合作为第一版，成本低、行为可控。
- Auto extraction 应先产出待审 patch/inbox，而不是直接写长期 memory。
- 历史 transcript 可做 skill 提取，不只做 fact memory。例如反复出现的测试流程、修复流程、部署流程，应该沉淀为 skill。

## 推荐给当前 Agent 的实现架构

### 1. 本地 transcript 层

每个 session 持久化为 append-only JSONL：

```text
memory/
  sessions/
    <project-hash>/
      <session-id>.jsonl
      index.json
```

事件类型建议最少包含：

- `user_message`
- `assistant_message`
- `tool_call`
- `tool_result`
- `file_patch`
- `compact_summary`
- `session_meta`

用途：

- `/resume` 精确恢复上下文。
- `/search-history` 搜索历史 session。
- 后台 memory extraction 的原始证据。

### 2. 会话内 context manager

不要把所有历史无条件塞进 prompt。建议组装顺序：

1. system prompt
2. `AGENTS.md` / 项目规则
3. small memory index
4. 当前任务相关 memory snippets
5. 当前 session 最近 N 轮原文
6. older turns compact summary
7. 当前 user message

触发压缩条件：

- token usage 超过 70%-80% 时自动 compact。
- 用户可手动 `/compact [focus]`。
- 压缩产物只进入当前 session transcript 的 `compact_summary`，默认不进入长期 memory。

### 3. 长期 memory extraction worker

后台扫描 eligible sessions：

```text
eligible if:
  idle >= 3h
  user_messages >= 10
  not subagent
  not explicitly disabled
  not contains external-sensitive context unless allowed
```

提取目标：

- durable user preferences
- project conventions
- repeated workflows
- known pitfalls and fixes
- verification commands
- external system pointers

强制 no-op gate：

> Future agent 是否会因为这条记录而表现更好？如果答案不明显，就不要写。

输出不要直接写 active memory，先写 inbox：

```text
memory/
  inbox/
    <candidate-id>.json
  private/
    MEMORY.md
    project.md
    workflows.md
  skills/
    <skill-name>/SKILL.md
```

候选字段：

- `type`: `fact | preference | workflow | pitfall | skill`
- `scope`: `global | project | local`
- `evidence_session_ids`
- `proposed_patch`
- `risk`: `low | medium | high`
- `redaction_notes`

### 4. Memory 注入与检索

采用“索引必加载，详情按需读”的方式：

- `MEMORY.md` 只保留短索引，每条一行，目标 < 200 行。
- 详细内容分 topic file，例如 `debugging.md`、`project-conventions.md`、`workflows.md`。
- 当前 task 启动时，先用关键词/路径/最近项目上下文选出最多 3-5 个 topic files。
- 如果本地模型较小，优先用 BM25/grep + 路径规则，少用复杂 embedding。

线程级开关：

```json
{
  "use_memory": true,
  "generate_memory": true,
  "external_context_memory_policy": "exclude"
}
```

### 5. 安全与隐私边界

- 默认不把 secrets、tokens、API keys、私人路径、完整 logs 写入 memory。
- 外部网页、MCP、邮件等第三方内容默认不进入长期 memory，除非用户明确允许。
- Auto extraction 只写 inbox，不直接改 active memory。
- 所有 patches dry-run，目标路径 allowlist，应用时原子写入。
- 提供 `/memory inspect`、`/memory approve`、`/memory discard`、`/memory disable-current-session`。

## 最小可行版本

第一阶段只做四件事：

1. 保存 session JSONL，支持 `/resume`。
2. 实现 `/compact`，把旧 turns 替换为摘要。
3. 实现 `save_memory(fact, scope)`，显式写入 `MEMORY.md`。
4. 启动时加载 `AGENTS.md + MEMORY.md`。

第二阶段再加：

1. idle session extractor。
2. inbox + patch approval。
3. topic memory files。
4. workflow -> skill 的自动候选生成。

这样能避免第一版过度复杂，同时给未来自动记忆留出干净边界。

## 资料来源

- OpenAI Codex Memories: https://developers.openai.com/codex/memories
- OpenAI Codex CLI features / resume: https://developers.openai.com/codex/cli/features
- OpenAI Codex CLI slash commands: https://developers.openai.com/codex/cli/slash-commands
- Claude Code memory: https://code.claude.com/docs/en/memory
- Claude Code commands: https://code.claude.com/docs/en/commands
- Claude Code how it works / context notes: https://code.claude.com/docs/en/how-claude-code-works
- Gemini CLI `GEMINI.md`: https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
- Gemini CLI memory tool: https://google-gemini.github.io/gemini-cli/docs/tools/memory.html
- Gemini CLI Auto Memory: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/auto-memory.md
- Gemini CLI commands: https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md

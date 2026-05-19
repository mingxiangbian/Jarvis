# Session History + Resume v1 设计

## 目标

给 cc-local 增加项目本地历史对话能力，覆盖 REPL 和 Web UI。第一版只做可靠的 transcript 持久化、历史列表、加载历史和继续对话，不做自动长期记忆、不做跨项目全局历史、不做模型生成标题。

成功标准：

- Web 左侧栏像 ChatGPT/Gemini 一样列出历史对话标题和最近预览，不显示 session id。
- 点击历史对话后能恢复完整可见聊天记录，并继续发送新消息。
- REPL 能通过 session id 恢复并继续同一段历史。
- REPL 和 Web 共用同一套项目本地 session store。
- 历史对话不写入 `.cc-local/memory/`，避免把 transcript 和长期记忆混在一起。

## 非目标

| 不做什么 | 原因 |
|----------|------|
| 自动从历史对话提取长期 memory | 对本地小模型太重，且容易污染 memory |
| 模型生成会话标题/摘要 | 第一版避免额外延迟和失败面 |
| 全局 `~/.cc-local/sessions/` | 项目隔离更安全，符合 coding agent 场景 |
| 语义搜索历史 | 先保证 list/get/resume 的基本体验 |
| 完整工具事件 UI 回放 | 第一版工具事件只做持久化审计，聊天区先恢复 user/assistant |

## 存储位置

每个项目维护自己的历史：

```text
<project>/.cc-local/sessions/
  index.json
  <session-id>.jsonl
```

`.cc-local/sessions/` 是可恢复 transcript store。`.cc-local/memory/` 仍然只用于长期记忆、daily memory 和项目知识。

## 数据模型

### `index.json`

左侧栏和 session 列表 API 只读轻量 index：

```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "实现 session resume",
      "preview": "继续设计 memory 系统集成...",
      "createdAt": "2026-05-20T07:40:00.000Z",
      "updatedAt": "2026-05-20T08:10:00.000Z",
      "messageCount": 12,
      "mode": "web",
      "model": "Qwen3.5-9B-MLX-4bit"
    }
  ]
}
```

`id` 是内部稳定 key，不直接展示。左侧栏展示 `title`、`preview`、`updatedAt`。

标题生成规则：

1. 创建 session 时，从第一条 user message 生成 `title`。
2. 取第一行，合并连续空白。
3. 截断到 40 个字符。
4. 空标题 fallback 为 `New chat`。

预览生成规则：

1. 每次 user 或 assistant 消息落盘后更新 `preview`。
2. 使用最后一条 user/assistant 文本的第一行。
3. 截断到 80 个字符。

### `<session-id>.jsonl`

session 文件 append-only，每行一个事件。第一版需要支持这些事件：

```json
{"type":"session_meta","id":"uuid","createdAt":"...","cwd":"...","mode":"web","model":"..."}
{"type":"user_message","message":{"role":"user","content":"..."},"createdAt":"..."}
{"type":"assistant_message","message":{"role":"assistant","content":"..."},"createdAt":"..."}
{"type":"tool_call","toolCall":{"id":"...","function":{"name":"grep","arguments":"{}"}},"createdAt":"..."}
{"type":"tool_result","toolCallId":"...","content":"...","ok":true,"createdAt":"..."}
{"type":"error","message":"...","createdAt":"..."}
{"type":"compact_summary","message":{"role":"user","content":"..."},"createdAt":"..."}
```

第一版 resume 只需要从 `user_message`、`assistant_message`、`compact_summary` 还原模型上下文。工具事件先保留为审计数据，后续再用于调试 UI。

## 模块设计

新增 `src/session-store.ts`，集中处理所有 session 文件 IO。

职责：

- 创建 session：生成 id、写 `session_meta`、更新 `index.json`。
- 追加事件：append JSONL，更新 index 元数据。
- 列出 session：读取并按 `updatedAt` 倒序返回。
- 读取 session：解析 JSONL，返回完整可见消息和可喂给模型的消息。
- 安全边界：拒绝 symlink、拒绝 path traversal、所有写入限制在 `<project>/.cc-local/sessions/`。

核心接口草案：

```typescript
interface SessionIndexItem {
  id: string
  title: string
  preview: string
  createdAt: string
  updatedAt: string
  messageCount: number
  mode: 'repl' | 'web' | 'cli'
  model: string
}

interface LoadedSession {
  item: SessionIndexItem
  visibleMessages: ChatMessage[]
  modelMessages: ChatMessage[]
}
```

## Web UI 设计

新增 API：

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/sessions` | 返回左侧栏 session 列表 |
| `GET` | `/api/sessions/:id` | 返回某条 session 的可见消息 |
| `POST` | `/api/runs` | 已有接口，继续接受 `sessionId` |

Web server 的内存 `sessions: Map<string, SessionRecord>` 只作为运行时缓存。服务启动时不需要预加载所有 session；左侧栏直接读 `session-store` 的 index。

创建 run 时：

1. 如果 body 没有 `sessionId`，创建新 session。
2. 如果有 `sessionId`，从 session store 加载历史。
3. 追加当前 user message。
4. 调用 `runAgentLoop`。
5. final 后追加 assistant message。
6. 更新 index 的 `preview`、`updatedAt`、`messageCount`。

左侧栏 UI：

- 列出 `title`、`preview`、更新时间。
- 不显示 session id。
- 当前 session 高亮。
- `New Chat` 清空当前状态，不立即创建文件；第一次发送后才创建 session。

## REPL 设计

CLI 新增参数：

```text
cc-local --repl --resume <session-id>
```

行为：

1. 启动时读取 `<session-id>.jsonl`。
2. 把可恢复消息注入 REPL 的 `messages`。
3. 首条消息仍然使用当前最新 system prompt。
4. 用户继续输入后追加到同一 session。

第一版不做交互式 `/resume` 列表，避免扩大范围。后续可以增加 `/sessions` 和 `/resume <id>`。

## Context Loading

UI 可以展示完整历史，但模型上下文不能无上限加载。

第一版规则：

- `visibleMessages`：全部 user/assistant 消息，用于 Web 渲染。
- `modelMessages`：最近 `sessionResumeRecentMessages` 条 user/assistant/compact_summary 消息。
- system prompt 不存入 transcript，resume 时总是使用当前启动生成的新 system prompt。
- 现有 auto-compact 继续处理长上下文。

新增配置项：

```typescript
sessionResumeRecentMessages: 40
```

这个默认值让本地 256K 上下文模型有足够连续性，也避免极长历史拖慢启动和首轮推理。

## 与 Memory 系统的关系

session history 和 memory 明确分层：

| 层 | 路径 | 用途 |
|----|------|------|
| transcript | `.cc-local/sessions/` | 恢复对话、Web 左侧栏、审计 |
| memory | `.cc-local/memory/` | 长期项目知识、daily memory、可复用事实 |

本设计不从 session 自动写 memory。未来如果要做 auto memory extraction，应从 `.cc-local/sessions/*.jsonl` 读取空闲历史，先生成 inbox 候选，再由用户批准。

## 错误处理

- `GET /api/sessions/:id` 找不到 session 时返回 404。
- JSONL 中坏行不导致整个 session 失败；跳过坏行并返回可恢复部分。
- index 丢失但 JSONL 存在时，后续版本可重建；第一版只保证正常路径。
- session 文件写入失败时，run 创建失败并返回错误，不静默丢历史。
- path traversal、symlink、非普通文件路径一律拒绝。

## 测试计划

| 测试 | 内容 |
|------|------|
| 创建 session | 写入 `index.json` 和 `<id>.jsonl` |
| 标题生成 | 第一条 user message 截断为 40 字符，空内容 fallback |
| 预览更新 | user/assistant 落盘后更新 `preview` 和 `updatedAt` |
| 列表排序 | `GET /api/sessions` 按 `updatedAt` 倒序 |
| 读取 session | `GET /api/sessions/:id` 返回完整可见 user/assistant |
| Web 继续对话 | 带 `sessionId` 的 run append 到同一 JSONL |
| REPL resume | `--resume <id>` 恢复最近消息并继续追加 |
| 上下文限制 | `modelMessages` 只取最近 `sessionResumeRecentMessages` 条 |
| 安全边界 | symlink/path traversal/非普通文件被拒绝 |

## 后续可选升级

1. 左侧栏支持重命名和删除 session。
2. 会话结束后异步模型生成更好的 `title` 和 `summary`。
3. 全局 `~/.cc-local/session-index.json` 只存项目 session 指针。
4. 历史搜索。
5. 从空闲 sessions 生成待审批 memory inbox。

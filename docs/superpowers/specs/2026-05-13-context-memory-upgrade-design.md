# Context & Memory 升级设计

## 目标

按照 Claude Code 的 Context Management（05）和 Memory System（05）架构，为 cc-local 实现两级能力：
1. 完整记忆系统（长期持久化）
2. Auto-Compact 上下文压缩（中期自动压缩）

## 范围

### 做

| 能力 | 描述 |
|------|------|
| 记忆索引 | MEMORY.md 格式的解析和更新 |
| 4 种记忆类型 | user / feedback / project / reference，YAML Frontmatter + Markdown |
| 会话摘要 | 退出 REPL 时自动生成结构化摘要，保存到 `sessions/YYYY-MM-DD.md` |
| 启动记忆注入 | 启动时加载记忆文件 + 最近 3 次会话摘要，注入 System Prompt |
| Auto-Compact | Token 超过窗口 70% 时，LLM 生成摘要替换旧消息 |
| 用户显式记忆 | 用户说"记住：xxx"时，Agent 通过 file_write 写入 memory/ |

### 不做

| 不做 | 原因 |
|------|------|
| Agent 自发创建记忆 | 9B 模型无元认知，误创建风险高 |
| 向量检索 / Embedding | 对标 CC，纯文件系统 grep 够用 |
| 4 级 CLAUDE.md 层级 | 单用户单项目，1 层 .cc-local 够用 |
| 压缩时并发调用 LLM | 压缩本身成本应尽量低，单次调用即可 |

## 架构

### 目录结构

```
.cc-local/
├── instructions.md                  ← 已有
├── memory/
│   ├── MEMORY.md                    ← 新增：记忆索引
│   ├── user-preferences.md          ← 新增示例
│   ├── project-decisions.md         ← 新增示例
│   └── sessions/
│       └── 2026-05-13.md            ← 新增：会话摘要
```

### MEMORY.md 格式

```markdown
- [User coding style](user-preferences.md) — TypeScript strict mode, single quotes, no semicolons
- [Rate limiting design](project-decisions.md) — express-rate-limit with configurable window/max
```

每行一条记忆指针：`- [标题](文件名.md) — 一句话摘要`。与 CC 的 MEMORY.md 格式一致。

### 记忆文件格式

```markdown
---
name: user-coding-style
description: The user's coding style preferences
type: user
---

User prefers TypeScript strict mode, single quotes, no semicolons, functions over classes.

**Why:** User rejected class-based approaches in three previous PRs.
**How to apply:** Default to functional style for new code.
```

### 会话摘要格式

与已验证的测试模板一致（5 段结构）：

```markdown
## Intent
[用户目标]

## Decisions Made
- [决策及原因]

## Files Modified
- [文件及改动]

## Test Results
[通过/失败统计]

## Pending
- [未完成任务]
```

### 启动时 System Prompt 组装

```
[System Prompt Core        ~2K]    ← Agent 身份、行为准则
[instructions.md            ~1K]    ← 项目特定指令
[Memory 摘要                ~2K]    ← 从 MEMORY.md + memory/*.md 拼接
[最近 3 次会话摘要          ~3K]    ← sessions/ 下最近 3 个文件
[工具定义                   ~3K]    ← 8 个工具（OpenAI tools 参数）
────────────────────────────────
固定前缀总计                ~11K
```

## 数据流

### 启动流程

```
main.ts
  ├── loadInstructions(cwd)              → string | ''       已有
  ├── loadMemories(cwd)                  → string | ''       新增
  │     ├── 读取 MEMORY.md
  │     ├── 解析每行链接
  │     └── 逐文件读取内容，拼接
  ├── loadRecentSessionSummaries(cwd, 3) → string | ''       新增
  │     ├── 列出 sessions/*.md
  │     ├── 按日期排序，取最近 3 个
  │     └── 拼接内容
  └── buildInitialMessages({instructions, memories, summaries})
        → [{ role: 'system', content: systemPrompt + 上述内容 }]
```

### 会话结束流程

```
repl.ts: exit
  ├── 组装对话摘要请求（不含工具定义）
  ├── 调 LLM 生成 5 段结构化摘要
  ├── saveSessionSummary(cwd, summary)    → 写到 sessions/YYYY-MM-DD.md
  └── 如有新记忆写入，updateMemoryIndex() → 追加行到 MEMORY.md
```

### Auto-Compact 流程

```
agent-loop.ts: 每次 LLM 调用前
  ├── estimateTokensForMessages(messages)
  ├── < 70% × contextWindowTokens → 正常调用
  └── ≥ 70% →
        ├── 切分: 最近 8 轮保留为原文，其余标记为旧消息
        ├── 调 LLM（不带 tools，不带工具定义，temperature=0）
        ├── 旧消息 → 替换为 { role: 'user', content: '[压缩摘要]\n...' }
        └── 继续正常调用
```

## 模块职责

### memory.ts（扩展）

| 函数 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `loadInstructions(cwd)` | string | Promise\<string\> | 已有，不变 |
| `loadMemories(cwd)` | string | Promise\<string\> | 新增：解析 MEMORY.md，加载所有记忆文件 |
| `loadRecentSummaries(cwd, n)` | string, number | Promise\<string\> | 新增：加载最近 n 次会话摘要 |
| `saveSessionSummary(cwd, content)` | string, string | Promise\<void\> | 新增：写入 sessions/ |
| `updateMemoryIndex(cwd, entry)` | string, {title, file, summary} | Promise\<void\> | 新增：追加一行到 MEMORY.md |

### context.ts（扩展）

| 函数 | 变更 |
|------|------|
| `buildInitialMessages()` | 改为 `async`，注入记忆和会话摘要 |
| `compactHistory(messages, threshold)` | 新增：判断阈值 → 切分 → 调 LLM → 替换 |

### agent-loop.ts（扩展）

LLM 调用前插入 token 检查和压缩分支。

### repl.ts（扩展）

exit 前：调 LLM 生成会话摘要 → 保存 → 更新索引。

### config.ts（扩展）

```typescript
interface AppConfig {
  // ... 已有字段
  contextWindowTokens: number      // 新增: 默认 256_000
  autoCompactThreshold: number      // 新增: 默认 0.7
}
```

## 测试计划

### 单元测试

| 测试 | 内容 |
|------|------|
| `loadMemories` 解析 MEMORY.md | 正常路径、空文件、缺失文件、格式异常行 |
| `loadRecentSummaries` | 正常路径、空目录、文件数不足 n |
| `updateMemoryIndex` | 新建 MEMORY.md、追加到已有文件 |
| `saveSessionSummary` | 正常写入、目录不存在时自动创建 |
| `buildInitialMessages` 记忆注入 | 有/无记忆时 System Prompt 内容正确 |

### 集成测试

| 测试 | 内容 |
|------|------|
| 会话摘要生成 | 模拟对话历史 → 调模型生成摘要 → 格式验证（5 段齐全） |
| Auto-Compact 触发 | 构造超阈值消息 → 验证压缩后消息数减少、摘要被注入 |
| 端到端 | REPL 完整会话 → exit → 验证 sessions/ 文件已创建 |

### 已有测试

`tests/summarization-quality.test.ts` — 已验证模型摘要质量。保留作为回归测试。

## 与 Claude Code 的对标

| CC 特性 | cc-local 实现 | 差异 |
|---------|-------------|------|
| 5 阶段压缩管道 | 1 阶段（Auto-Compact） | 当前窗口充裕，不需 Budget Reduction/Snip/Microcompact/Collapse |
| 92% 触发阈值 | 70% 触发阈值 | 保守策略，给压缩操作留余量 |
| MEMORY.md 索引 | 同格式 | 完全对标 |
| 4 级 CLAUDE.md | 1 级 .cc-local | 单用户单项目不需要层级 |
| 会话摘要 | 退出时生成 | CC 是 87% 阈值中途压缩 + 会话结束自然清理 |
| 记忆自动创建 | 不实现 | 9B 无元认知 |

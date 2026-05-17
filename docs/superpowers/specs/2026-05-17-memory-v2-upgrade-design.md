# Memory System v2 升级设计

## 目标

将 cc-local 记忆系统从"被动手动 + 独立会话摘要"升级为"自动记录 + 统一记忆管道"，对标 Hermes/OpenClaw/CC 的关键机制。

## 5 项升级

### 1. soul.md — 角色设定

新增 `.cc-local/soul.md`，启动时最先读取，拼到 system prompt 最前面。文件不存在则跳过。

**对标：** Hermes 的 SOUL.md、OpenClaw 的 IDENTITY.md

### 2. 向上递归 CLAUDE.md

从项目根向上递归到 `~/.cc-local/CLAUDE.md`，每层读取 `CLAUDE.md` 拼入 system prompt。停止条件：到达 `~` 或找不到文件。

**对标：** CC 的 4 级 CLAUDE.md 层级

### 3. 日记忆替代会话摘要

```
当前流程：
  会话中: 无记录
  退出: LLM 摘要 → sessions/YYYY-MM-DD.md (5 段格式)
  启动: loadRecentSummaries(cwd, 3)

新流程：
  会话中: regex 提取 + PostToolUse hook → memory/daily.md (追加式原始记录)
  退出: daily.md ≥ compactDailyThreshold → LLM 整理 → 晋升到 MEMORY.md
        daily.md < compactDailyThreshold → 跳过 LLM，原样保留
  启动: 加载 daily.md 最近 200 行 + MEMORY.md
        sessions/ 不再需要
```

**对标：** Hermes 的 daily notes + findings_to_wiki、OpenClaw 的 Daily Logs

### 4. 容量限制 + 强制整理

- MEMORY.md 上限 200 行，每行 ≤ 150 字符
- 超限时记忆写入工具返回错误，列出当前所有条目
- agent 必须执行 `replace`/`remove` 来腾出空间
- 空间不足 → agent 被迫反思和整理

**对标：** Hermes 的硬容量限制 (2200/1375 字符) + 超限反思机制

### 5. 用户级作用域（跨项目记忆）

```
~/.cc-local/
  soul.md                       ← 角色设定
  CLAUDE.md                     ← 全局规则
  memory/
    MEMORY.md                   ← 全局记忆索引
    daily.md                    ← 全局日记忆
    *.md                        ← 跨项目记忆

项目级:
  project/.cc-local/
    instructions.md             ← 项目指令
    memory/
      MEMORY.md                 ← 项目记忆索引
      daily.md                  ← 项目日记忆
      *.md                      ← 项目特定记忆
```

启动时加载顺序：soul → 全局 CLAUDE → 递归 CLAUDE → 项目 instructions → 项目 memory → 全局 memory

**对标：** CC 的 3 层作用域 (user/project/local)

## 不做

| 不做什么 | 原因 |
|---------|------|
| Agent 主动记忆写入 (Auto Memory) | 9B 无元认知 |
| Dreaming / 梦境系统 | 需多轮 LLM 调用，太重 |
| 6 维评分 / 晋升闸门 | 依赖强模型 |
| 向量搜索 / embedding | 无外部依赖原则 |
| encrypted_content | 需 API 支持 |
| KAIROS 守护进程 | 架构复杂度过度 |

## 架构变更

### 文件结构

```
.cc-local/
├── soul.md                      ← 新增
├── instructions.md              ← 已有
├── memory/
│   ├── MEMORY.md                ← 已有，新增容量限制
│   ├── daily.md                 ← 新增，替代 sessions/
│   └── *.md                     ← 已有
└── memory/sessions/             ← 废弃 (不再生成新文件)
```

### 数据流

```
启动:
  loadSoul(cwd)
  → loadUpwardClaude(cwd, homeDir)
  → loadInstructions(cwd)
  → loadMemories(cwd, userMemoriesDir)  (双作用域)
  → loadDaily(cwd, 200)
  → buildInitialMessages()

会话中 (每轮后):
  PostToolUse 触发
  → extractFactFromToolCall()  (regex)
  → appendDaily(cwd, entry)

会话退出 (REPL exit):
  daily.md 行数 ≥ compactDailyThreshold
    → LLM 整理 daily.md
    → 晋升重要事实到 MEMORY.md
    → 清理 daily.md 噪声
  daily.md < 阈值
    → 跳过，原样保留
```

### 模块职责

| 模块 | 新增 | 修改 |
|------|------|------|
| `config.ts` | `memoryMaxLines`, `memoryMaxLineLength`, `dailyCompactThreshold` | — |
| `memory.ts` | `loadSoul`, `loadUpwardClaude`, `loadDaily`, `appendDaily`, `compactMemories` | `loadMemories` 支持双作用域 |
| `daily-logger.ts` | 新文件：regex 提取 + daily.md 写入 | — |
| `context.ts` | — | `buildInitialMessages` 新增参数 |
| `agent-loop.ts` | — | PostToolUse 后调 `appendDaily` |
| `repl.ts` | — | 退出流程改为日记忆整理 |

### 新增配置项

```typescript
memoryMaxLines: 200              // MEMORY.md 行数上限
memoryMaxLineLength: 150         // MEMORY.md 每行字符上限
dailyCompactThreshold: 500       // daily.md 触发整理的阈值 (行数)
```

## 测试计划

| 测试 | 内容 |
|------|------|
| `loadSoul` 文件存在/不存在 | 正常加载、跳过 |
| `loadUpwardClaude` 递归 | 多层目录、停于 ~、无文件时静默 |
| `extractFactFromToolCall` regex | 不同工具类型、成功/失败结果 |
| `appendDaily` 追加 | 目录不存在时自动创建 |
| `loadDaily` 最近 N 行 | 文件存在/不存在、少于 N 行时 |
| `compactMemories` 整理 | 达到阈值触发、未达阈值跳过 |
| 容量限制写入 | 达到上限时返回错误并列出条目 |
| 双作用域加载 | 项目+全局记忆合并正确 |
| `buildInitialMessages` 参数 | 新参数正确注入 system prompt |
| 集成：完整 REPL 生命周期 | 日记忆记录 → 整理 → MEMORY.md 更新 |

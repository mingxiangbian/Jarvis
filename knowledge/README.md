# Claude Code Agent 知识库

从 Twitter、Reddit、知乎、GitHub 收集的 Claude Code Agent 实现背景知识 + 本地模型适配专题。

## Part 1: Claude Code 架构分析（01-10）

| 编号 | 文件 | 内容 |
|------|------|------|
| 01 | [architecture-overview](01-architecture-overview.md) | 架构总览 — 6层分层、技术栈、设计哲学 |
| 02 | [agent-loop](02-agent-loop.md) | Agent Loop — 核心调度引擎、9步Pipeline |
| 03 | [tool-system](03-tool-system.md) | 工具系统 — 66+工具、三层架构、8阶段生命周期 |
| 04 | [subagent-system](04-subagent-system.md) | Sub-Agent — 上下文隔离、6种类型 |
| 05 | [context-management](05-context-management.md) | 上下文管理 — 三级记忆、5阶段压缩 |
| 06 | [permission-security](06-permission-security.md) | 权限安全 — 7层防护、Deny-First引擎 |
| 07 | [extension-mechanisms](07-extension-mechanisms.md) | 扩展机制 — MCP/Hooks/Skills/Plugins |
| 08 | [agent-teams](08-agent-teams.md) | Agent Teams — P2P协作、$20K编译器实验 |
| 09 | [reverse-engineering](09-reverse-engineering.md) | 逆向工程 — 5万行代码、5层子系统 |
| 10 | [community-practices](10-community-practices.md) | 社区实践 — 生产模式、开源参考 |

## Part 2: 本地模型适配专题（11-16）

| 编号 | 文件 | 内容 |
|------|------|------|
| 11 | [system-prompts](11-system-prompts.md) | System Prompts — 42个组件、Prompt架构、tweakcc |
| 12 | [tool-prompt-engineering](12-tool-prompt-engineering.md) | 工具Prompt工程 — Bash/Edit/Task具体文本、设计模式 |
| 13 | [local-model-tool-calling](13-local-model-tool-calling.md) | 本地模型Tool Calling — 三种适配路径、Qwen/DeepSeek实践 |
| 14 | [small-context-strategies](14-small-context-strategies.md) | 小窗口策略 — AFM/CSO/ReSum、32K/8K方案 |
| 15 | [local-prefix-caching](15-local-prefix-caching.md) | 本地KV缓存 — vLLM vs SGLang、分层缓存 |
| 16 | [local-agent-benchmarks](16-local-agent-benchmarks.md) | 基准测试 — BFCL V4/SWE-rebench、选模型决策树 |

## Part 3: 记忆系统对比研究（17-21）

| 编号 | 文件 | 内容 |
|------|------|------|
| 17 | [agentmemory-system](17-agentmemory-system.md) | agentmemory — 独立记忆服务器、三流检索(BM25+Vector+KG)、12 Hook自动捕获、4层合并管道 |
| 18 | [codex-memory](18-codex-memory.md) | OpenAI Codex — 两阶段管道、encrypted_content压缩、no-op闸门、git式增量更新 |
| 19 | [openclaw-memory](19-openclaw-memory.md) | OpenClaw — Dreaming梦境系统(3阶段)、6维评分、3道晋升闸门、压缩前抢救 |
| 20 | [hermes-memory](20-hermes-memory.md) | Hermes — 冻结快照、硬容量限制(2200字符)、Periodic Nudge、on_pre_compress Hook |
| 21 | [cc-memory-deep](21-claude-code-memory-deep.md) | Claude Code 深度 — KAIROS守护进程、Auto Dream(3操作)、3层作用域、200行索引上限 |
| 22 | [session-history-memory-integration](22-session-history-memory-integration.md) | Session History 融入 Memory — Codex/Claude Code/Gemini CLI 对比、resume/compact/memory extraction 边界、当前 agent 实现建议 |

## 推荐阅读顺序

### 理解 Claude Code 架构 → 1, 2, 3, 4, 11, 12
### 为本地模型做技术选型 → 13, 16, 14, 15
### 开始实现 → 12 (核心), 2 (Agent Loop), 3 (最少工具集), 14 (上下文策略)

## 关键发现

1. **System Prompt 不是一段文字，是 42 个动态组装的组件**
2. **工具描述直接决定 Agent 行为** — 同样的代码，不同 Prompt → 不同行为
3. **Qwen3-32B Prompt 模式是本地 Agent 的最佳基座** — BFCL 单轮 90%+
4. **SGLang 是 Agent 多轮对话的最佳推理引擎** — RadixAttention 自动复用
5. **小窗口下的上下文管理是最大工程挑战** — 需要 75% 触发压缩 + 结构化摘要
6. **本地模型的 KV Cache 复用 = Anthropic 的 90% 折扣，但免费**

---

## Qwen3.5-9B-MLX-4bit 实测数据（2026-05-11）

```
模型: Qwen3.5-9B (4-bit MLX) | 硬件: Apple M3 16GB | 上下文: 256K
推理引擎: MLX (Apple Silicon 原生) | 温度: 0.0 | 工具数: 8

  单工具选择:  9/10  (90%)   avg 8.8s/call
  参数提取:    8/10  (80%)   avg 11.1s/call
  边缘场景:    3/5   (60%)   avg 10.8s/call
  ─────────────────────────────────────
  综合:       20/25  (80%)   total 252s  avg 10.1s/call
```

### 实测发现

| 能力 | 评分 | 说明 |
|------|------|------|
| 文件操作（read/write/edit） | 优秀 | 接近 100% 准确，参数提取完整 |
| Shell 命令执行 | 优秀 | 命令格式正确，描述字段稳定 |
| 代码搜索（grep/glob） | 良好 | grep vs glob 偶有混淆（~10%） |
| Web 搜索触发 | 优秀 | 需要外部知识时判断准确 |
| Sub-Agent 委派 | 不可用 | 9B 模型没有"委派任务"的元认知 |
| 模糊指令处理 | 差 | 缺少上下文时不做工具调用，靠猜测 |
| 多轮 Tool Calling | 未测 | 理论可行但 10s/轮延迟是瓶颈 |

### 基于实测的 Agent 设计约束

**必须遵守：**
1. **工具数 ≤ 8** — 超过 8 个工具选择准确率下降明显
2. **不要暴露 task 工具** — 9B 模型不会用 sub-agent，砍掉它
3. **参数校验加 Zod** — 80% 的参数准确率意味着 1/5 的调用参数有瑕疵
4. **强制 Read-before-Edit** — 在 System Prompt 里写死，不要依赖模型自觉
5. **每个工具描述 ≤ 300 tokens** — 更长的 Prompt 不会提升准确率，只增加延迟
6. **温度用 0.0** — Tool Calling 场景下非零温度 = 随机选工具

**可选优化：**
- Speculative decoding 加速（10s → 3-5s 目标）
- 用 `enable_thinking=false`（实测已关闭，效果稳定）
- 256K 上下文意味着不需要激进压缩策略（14 号文档可跳过大部分内容）

**升级路径：**
- 正确率目标 >90% → Qwen3.5-32B 或 Qwen3-Coder-30B
- 需要 Sub-Agent → 至少 32B，且需要不同的 Prompt 工程
- 延迟目标 <3s → 需要更小 draft model 或 NPU 推理

---

## 实现计划: cc-local

### 技术方案: B — Python MLX Server + TypeScript Agent

```
┌─────────────────────────────────────────────┐
│  TypeScript (Agent 层)                       │
│  CLI → Agent Loop → Tools → Context Manager │
│       ↓ HTTP (localhost:8080)                │
│  Python (推理层)                              │
│  mlx_lm serve Qwen3.5-9B-MLX-4bit           │
└─────────────────────────────────────────────┘
```

**为什么 TS + Python 分离：**
- TypeScript 写 Agent Loop，和 Claude Code 技术栈一致
- Python 只管模型推理，MLX 原生支持 server 模式（`mlx_lm serve`）
- 换模型时只改 server 端，Agent 代码不动

### 目录结构

```
cc_local/
├── server/
│   └── start.sh              # mlx_lm serve Qwen3.5-9B-MLX-4bit --port 8080
├── src/
│   ├── main.ts               # CLI 入口 (Commander.js)
│   ├── agent-loop.ts         # while 循环: LLM 调用 → 解析 → 工具分发 → 回填
│   ├── llm-client.ts         # OpenAI 兼容: POST /v1/chat/completions (tools 参数)
│   ├── token-counter.ts      # Token 计数 (tiktoken / 字符估算)
│   ├── tools/
│   │   ├── types.ts          # Tool<T> 接口 + 安全属性声明
│   │   ├── index.ts          # 工具注册 + 4 阶段执行 (Validate→Check→Exec→Emit)
│   │   ├── bash.ts           # Shell 命令执行 (含超时 + deny-list)
│   │   ├── file-read.ts      # 读文件
│   │   ├── file-write.ts     # 写/覆写文件
│   │   ├── file-edit.ts      # 精确字符串替换 (Read-before-Edit 硬约束)
│   │   ├── grep.ts           # 正则搜索
│   │   ├── glob.ts           # 文件模式匹配
│   │   ├── web-search.ts     # 网络搜索
│   │   └── ask-user.ts       # 向用户提问
│   ├── prompts/
│   │   ├── system.md         # System Prompt 主模板
│   │   ├── session-summary.md # 会话摘要专用 Prompt
│   │   └── tools/            # 每个工具的 Prompt (可编辑 .md)
│   │       ├── bash.md
│   │       ├── file-read.md
│   │       ├── file-write.md
│   │       ├── file-edit.md
│   │       ├── grep.md
│   │       ├── glob.md
│   │       ├── web-search.md
│   │       └── ask-user.md
│   ├── context.ts            # 消息组装 + Microcompact + 滑动窗口 + 内存指针
│   ├── memory.ts             # 记忆读写 (user/feedback/project/reference) + 会话摘要
│   └── config.ts             # 模型端点、工具开关、温度、限制
├── tests/
│   ├── test_tool_calling.sh  # 工具调用基准（复用已有数据）
│   └── test_agent_loop.ts    # Agent Loop 集成测试
├── package.json
└── tsconfig.json
```

### 8 个工具对标 Claude Code

| cc-local | Claude Code 对应 | 用途 |
|----------|-----------------|------|
| bash | Bash | Shell 命令 |
| file-read | Read | 读文件 |
| file-write | Write | 创建/覆写文件 |
| file-edit | Edit | 精确字符串替换 |
| grep | Grep | 正则内容搜索 |
| glob | Glob | 文件模式匹配 |
| web-search | WebSearch | 网页搜索 |
| ask-user | AskUserQuestion | 向用户确认/澄清 |

### Agent Loop 流程（7 阶段）

对标 Claude Code 的 9 步 Pipeline，简化为 7 阶段：

```
用户输入: "删除 src/auth.ts 中的 console.log"
  ↓
[1] 预处理      processInput(): 去首尾空格、检测空输入、注入会话历史
[2] Microcompact 清理上轮旧工具结果（不调 LLM，纯程序化） → 释放 ~2-5K
[3] Token 计数   估算当前上下文大小，若 >128K 触发 Auto-Compact
[4] 组装上下文   System Prompt + Memory + 工具定义 + 对话历史 + 当前轮
[5] LLM 调用     POST /v1/chat/completions (OpenAI 兼容，tools 参数)
               ├── 成功 → 解析响应
               └── 失败 → 指数退避重试 (1s/2s/4s, 最多 3 次)
[6] 工具分发     解析 tool_calls → 4 阶段执行:
               Validate (Zod) → Check (安全属性 + deny-list) → Exec → Emit
               每轮最多 10 次工具调用 (max_tool_calls_per_turn)
[7] 回填 + 循环   工具结果注入消息历史 → 回到 [2]
               直到: 模型返回纯文本 (无 tool_call) → 输出给用户 → 等待下轮
```

### 关键设计决策（审计后补入）

**1. OpenAI 兼容 API 原生 Tool Calling（Gap 35）**
```
❌ 旧方案: 手动在 System Prompt 里拼 XML Schema
✅ 新方案: POST /v1/chat/completions + tools 参数
          mlx_lm serve 已暴露此端点，原生支持 tool_choice
```
**2. 工具安全属性声明（Gap 13, 25）**

每个工具实现 `Tool<T>` 接口，声明 4 个属性：

| 属性 | 类型 | 作用 |
|------|------|------|
| isReadonly | boolean | true → 跳过 confirm_destructive 检查 |
| isDestructive | boolean | true → 弹出确认 |
| isConcurrencySafe | boolean | v1 全 false（顺序执行） |
| needsUserInteraction | boolean | true → 需要用户输入才能继续 |

**3. Read-before-Edit 系统级硬约束（Gap 16）**

```
file-edit 执行前检查:
  trackedFiles.has(file_path) → 是 → 继续执行
                              → 否 → 拒绝 + 返回错误:
  "必须先 Read 该文件。当前会话尚未读取过 {file_path}。"
```

**4. Bash 安全边界（Gap 24, 31）**

```
Deny-list (正则匹配，命中则拒绝):
  rm\s+-rf\s+/
  mkfs\.
  dd\s+if=
  >\s*/dev/sd
  curl.*\|.*sh
  :(){ :|:& };:    (fork bomb)

Timeout:
  默认 120s, 最大 600s
  超时 → SIGTERM → 5s → SIGKILL

CWD 提示:
  每次 Bash prompt 包含 "Working directory: {cwd}"
  告知模型: 工作目录持久、Shell 状态不持久
```

**5. 本地模型专属 Prompt 工程（Gap 33, 34）**

| Claude 的做法 | cc-local 的做法 |
|-------------|---------------|
| `IMPORTANT: Avoid using...` | `<critical>不要使用...</critical>` |
| 工具 Prompt 200-2000 tokens | 工具 Prompt 200-400 tokens |
| 纯指令 | 指令 + 1 个 few-shot 示例 |
| 否定式约束 (~45%) | 正向引导为主 (70%+ 正向) |
| 大写强调 | 结构化标签 `<critical>`, `<hint>`, `<example>` |

**6. Agent Loop 健壮性（Gap 7, 9, 37）**

```
Microcompact:  每轮结束后程序化清理旧工具结果，不调 LLM
Retry:         LLM API 失败 → 1s / 2s / 4s 退避 (最多 3 次)
Per-turn cap:  每轮最多 10 次工具调用，超限 → 强制终止 + 报告
```

**7. 会话摘要结构化格式（Gap 28, 41）**

使用 Factory AI 验证过的格式：
```markdown
## Intent
用户想要达成的目标

## Decisions Made
关键决策及原因

## Files Modified
- file.ts (+N/-M)

## Test Results
通过/失败统计

## Pending
未完成的任务
```

**8. 记忆类型扩展（Gap 18）**

```
原计划: user, project 两种
补入:   feedback (行为纠正), reference (外部资源引用)
       每种类型有独立的 YAML Frontmatter 模板
```

### 记忆系统设计

对标 Claude Code 的三级记忆，但简化适配本地模型：

```
┌──────────────────────────────────────────────────────┐
│                记忆系统 (对标 Claude Code)              │
│                                                      │
│  .cc-local/                    Claude Code 对应       │
│  ├── instructions.md           CLAUDE.md             │
│  ├── memory/                                         │
│  │   ├── MEMORY.md             MEMORY.md (索引)       │
│  │   ├── user.md               memory/user_*.md      │
│  │   ├── project.md            memory/project_*.md   │
│  │   └── sessions/                                   │
│  │       └── 2026-05-11.md     会话摘要 (auto-compact) │
│  └── config.json               settings.json          │
└──────────────────────────────────────────────────────┘
```

**三层记忆映射：**

| 层级 | Claude Code 的做法 | cc-local 的做法 |
|------|-------------------|----------------|
| 短期 | 当前会话消息流 (~200K) | Agent Loop 内的消息历史 (256K 窗口) |
| 中期 | 92% 阈值 Auto-Compact | 会话结束时自动生成结构化摘要 |
| 长期 | CLAUDE.md + memory/*.md | `.cc-local/` 下的 instructions + memory 文件 |

**记忆生命周期：**

```
会话启动
  ├── [1] 读取 .cc-local/instructions.md → 注入 System Prompt
  ├── [2] 读取 .cc-local/memory/MEMORY.md → 获取记忆索引
  ├── [3] 读取 .cc-local/memory/user.md + project.md → 注入上下文
  └── [4] 读取最近 3 次会话摘要 → 注入"上次做了什么"

会话进行中
  ├── Agent 可通过 file-read/file-write 读写 memory/ 目录
  └── 关键事件触发即时记忆存储 (用户说"记住：xxx")

会话结束
  ├── [1] LLM 生成本次会话的结构化摘要
  ├── [2] 保存到 .cc-local/memory/sessions/2026-05-11.md
  └── [3] 更新 MEMORY.md 索引（如有新记忆条目）
```

**记忆文件格式（对标 Claude Code 的 Markdown + YAML Frontmatter）：**

```markdown
---
name: user-coding-style
description: 用户的编码风格偏好
type: user
---

用户偏好:
- 使用 TypeScript strict mode
- 单引号，无分号
- 函数优先于类
**Why:** 用户之前在三个项目中都拒绝了 class-based 写法
**How to apply:** 写新代码时默认用函数式风格
```

**记忆注入 System Prompt 的位置：**

```
[System Prompt Core     ~2K]   ← Agent 身份、行为准则
[instructions.md        ~1K]   ← 项目特定指令
[Memory 摘要            ~1K]   ← 用户偏好 + 项目知识
[最近会话摘要            ~2K]   ← 上几次做了什么
[工具定义               ~3K]   ← 8 个工具的 schema
────────────────────────────
固定前缀总计            ~9K    ← 远低于 256K，不用省
```

**和 Claude Code 的关键差异：**

| 差异 | Claude Code | cc-local | 原因 |
|------|-----------|----------|------|
| CLAUDE.md 层级 | 4 级 (用户→父目录→项目→.claude) | 1 级 (.cc-local/instructions.md) | 单用户单项目，不需要层级 |
| Memory 自动创建 | Agent 自发决定何时存 | 会话结束时自动摘要 + 用户显式触发 | 9B 模型不会主动管理记忆 |
| 向量检索 | 无（纯文件系统） | 无（保持一致） | 文件系统 grep 够用 |
| MEMORY.md 索引 | Agent 维护 | Agent 维护 + 会话结束自动更新 | 数据完整性兜底 |

### 上下文管理策略

```
256K 窗口 — 短期记忆（会话内）:

滑动窗口运行时布局:
  [System Prompt + 记忆   ~9K]   ← 固定前缀 (每次 LLM 调用都带上)
  [工具定义               ~3K]   ← 固定前缀 (原生 tool calling 下此块可选)
  [对话历史              ~15K]   ← 保留最近 15 轮原文
  [工具调用结果           ~10K]   ← 大输出: 内存指针外部化
  [当前轮                 ~3K]
  ──────────────────────────
  Total                  ~40K   ← 远低于 256K

触发策略 (多级, Gap 42):
  40K 以下   → 无需任何压缩
  128K (50%) → 触发 Auto-Compact (LLM 生成结构化摘要)
  200K (80%) → 激进压缩 + 警告用户
  256K (100%)→ 硬截断 (FIFO 移除最旧轮次)

Microcompact (每轮自动, Gap 7):
  清理上一轮的工具调用结果 (保留决定/文件变更等关键信息)
  合并连续相同工具的结果 (3 次 grep → 1 条合并结果)
  零成本: 不调用 LLM

内存指针外部化 (Gap 40):
  文件读取 >500 行 → 写 /tmp/cc-local-{uuid}.txt → 上下文只保留:
    "[文件已保存到 /tmp/cc-local-xxx.txt, 2342 行。用 Read 查看特定行。]"
  Bash 输出 >200 行 → 同样策略
```

**工具输出截断规则：**
```
read_file:  ≤500 行原文保留; >500 行 → 头 100 + 尾 50 + 外部化指针
bash:       stdout 头 80 行 + stderr 全部; >200 行 → 外部化指针
grep:       最多 30 条匹配结果
```

### Token 计数（Gap 10）

```
方案: tiktoken (o200k_base 编码器，Qwen tokenizer 近似)
精度: ±15% (够用于触发压缩决策)

每轮 LLM 调用前:
  estimated = count(systemPrompt) + count(tools) + count(messages) + margin(500)
  if estimated > 128K: 触发 Auto-Compact
  if estimated > 200K: 警告 + 激进截断
```

### 不做的事情（v1 明确边界）

| 不做 | 原因 |
|------|------|
| Sub-Agent / Task 工具 | 9B 模型不会委派，实测准确率 20% |
| MCP 服务器集成 | v1 用内置工具覆盖核心场景 |
| Agent Teams / 并行 | 单机单模型无并行优势 |
| Hook 系统 | v1 没有需要确定性拦截的场景 |
| Plan Mode / Plan-Act 双阶段 | 直接执行，减少轮次 |
| Permission 7 层系统 | 本地单用户，一个 confirm_destructive() 够用 |
| React + Ink 终端 UI | v1 纯文本 + 工具调用日志 |
| 前缀缓存优化 | MLX server 模式不支持自定义 cache_control |
| 向量数据库 / Embedding | 对标 Claude Code，纯文件系统 grep 够用 |

### 依赖

```
TypeScript 侧:
  commander          CLI 参数解析
  zod                工具参数校验
  chalk              终端彩色输出
  node-fetch         调 LLM API（Node 18+ 可用内置 fetch）

Python 侧:
  mlx-lm             MLX model serving (已安装)
  mlx                Apple Silicon 推理 (已安装)
```

### 代码量预估

```
main.ts            ~ 80 行
agent-loop.ts      ~ 180 行  (+30: Microcompact + retry + per-turn cap)
llm-client.ts      ~ 60 行   (+10: OpenAI-compatible format)
token-counter.ts   ~ 40 行   (新增: tiktoken 集成)
context.ts         ~ 120 行  (+20: 内存指针外部化)
memory.ts          ~ 140 行  (+20: feedback/reference 类型 + 结构化摘要)
config.ts          ~ 40 行   (+10: 模型端点 + deny-list + 限制参数)
tools/types.ts     ~ 40 行   (新增: Tool<T> 接口 + 安全属性)
tools/index.ts     ~ 80 行   (+30: 4 阶段执行 + trackedFiles)
tools/bash.ts      ~ 80 行   (+30: 超时 + deny-list + cwd 提示)
tools/file-edit.ts ~ 60 行   (+20: Read-before-Edit 硬约束)
tools/file-read.ts ~ 40 行
tools/file-write.ts~ 30 行
tools/grep.ts      ~ 50 行
tools/glob.ts      ~ 40 行
tools/web-search.ts~ 50 行
tools/ask-user.ts  ~ 40 行
prompts/*.md       ~ 300 行  (新增: 9 个外部化 Prompt 文件)
────────────────
Total              ~ 870 行 TypeScript + 300 行 Markdown + 1 行 shell
```

### 进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 知识收集 | ✅ 完成 |
| 2 | 模型基准测试 | ✅ 完成 |
| 3 | 实现计划 | ✅ 当前 |
| 4 | 编码实现 | 待开始 |
| 5 | 集成测试 | 待开始 |
| 6 | 端到端验证 | 待开始 |

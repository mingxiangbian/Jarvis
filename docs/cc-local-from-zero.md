# cc-local 从 0 构建指南

## 1. 这个项目在做什么

cc-local 不是训练一个新模型，而是把本地大模型包装成一个 Claude Code 风格的 coding agent。

核心思想：

1. 本地模型负责推理和选择工具。
2. TypeScript 程序负责执行工具、校验参数、控制安全边界。
3. 工具结果回填给模型，模型继续决定下一步。
4. 没有工具调用时，模型输出最终回答。

这里的“agent”本质上不是神秘能力，而是一个循环：

```text
用户任务 -> 模型判断下一步 -> 程序执行工具 -> 工具结果返回给模型 -> 模型继续判断
```

## 2. 为什么分成 TypeScript Agent 和 Python MLX Server

Python/MLX 适合 Apple Silicon 本地推理；TypeScript 适合实现 CLI、工具系统、文件操作和工程化测试。

两者通过 OpenAI-compatible HTTP API 解耦：

```text
用户输入
  -> TypeScript Agent Loop
  -> POST http://127.0.0.1:8080/v1/chat/completions
  -> MLX/Qwen 模型
  -> tool_calls 或 assistant text
  -> TypeScript 执行工具
  -> 工具结果回填给模型
```

这个拆分带来一个重要好处：以后换本地模型或推理引擎，只要它提供兼容 `/v1/chat/completions` 的接口，Agent 层代码就不需要大改。

## 3. 从 0 到可运行的模块顺序

### 第一步：项目脚手架

`package.json`、`tsconfig.json`、`vitest.config.ts` 提供最小 TypeScript 工程。

原则：先有可重复的测试和类型检查，再写 agent 行为。

验证：

```bash
npm test
npm run typecheck
```

> **Q: package.json、tsconfig.json、vitest.config.ts 分别干什么？**
>
> `package.json` — 声明项目名、入口类型 (`"type":"module"`)、依赖 (zod/chalk/commander)、脚本 (dev/test/typecheck)。
>
> `tsconfig.json` — 告诉 TypeScript 编译器：目标 ES2022、NodeNext 模块、严格模式、源文件在哪 (`include: ["src/**/*.ts"]`)。
>
> `vitest.config.ts` — 告诉 Vitest 测试运行器：用 Node 环境跑、全局暴露 `describe`/`expect`/`it`。

### 第二步：配置和工具类型

`src/config.ts` 定义模型端点、温度、工具调用上限、bash 超时、可写目录和危险命令 deny-list。

`src/tools/types.ts` 定义所有工具必须遵守的统一接口：

```text
name + description + JSON schema + Zod schema + safety flags + execute()
```

原则：模型输出不可信，程序必须校验后再执行。

> **Q: Zod 校验是什么？**
>
> 模型返回的工具参数是 JSON 字符串。JSON.parse 只能保证它是合法 JSON，不保证字段类型正确、不缺必填项。
>
> Zod 是 TypeScript 的运行时校验库。你定义一个 schema（如 `{ command: z.string().min(1) }`），然后 `schema.safeParse(data)` 就能在运行时拦住错误参数，并给出明确错误信息。Zod schema 同时自动推导出 TypeScript 类型，一份定义同时获得编译期类型检查和运行时校验。

### 第三步：工具注册和执行

`src/tools/index.ts` 做四件事：

1. 把工具转成 OpenAI-compatible `tools` 定义。
2. 根据模型返回的工具名找到实现。
3. 解析 JSON arguments。
4. 用 Zod 校验后执行工具。

原则：模型只能“请求工具调用”，不能绕过程直接操作系统。

### 第四步：文件工具

当前 v1 有三个文件工具：

1. `file_read`：读取 UTF-8 文件，加行号，并记录真实路径。
2. `file_write`：只允许写入配置的 writable roots。
3. `file_edit`：只允许对读过的文件做精确字符串替换。

> **Q: file_read 对超过 500 行的文件截断（头 100 + 尾 50），会不会影响模型理解？**
>
> 会。但这是刻意取舍：
>
> 模型处理代码时，真正需要"看全"的场景很少——通常是找某个函数定义（grep 定位行号后读到就行）或理解文件结构（头 100 行基本覆盖了 import 和顶层声明）。大多数超大文件是自动生成的、数据文件、或锁文件，模型不需要看全。
>
> 如果模型真的需要更多内容，截断标记 `[output compacted]` 会告诉它文件不完整。它可以调用 `grep` 搜索特定位置，或者用户手动让它读特定行范围（当前 v1 未实现行范围参数，但架构上 file_read 返回了行号，模型可以基于行号做推理）。
>
> 底线：500 行够覆盖绝大多数真实需求，丢了中间行对理解项目结构的影响通常可忽略。但如果你发现实际使用中模型频繁因为截断而误解文件，上调 `readMaxInlineLines` 即可——它在 config 里是明确的配置项，不是 magic number。

`file_edit` 的 read-before-edit 约束很重要：

```text
file_read 成功 -> trackedFiles.add(realpath)
file_edit 执行 -> 检查 trackedFiles.has(realpath)
没有读过 -> 拒绝编辑
```

原则：小模型容易凭记忆猜文件内容。强制先读再改，可以把风险从“猜错后写坏文件”变成“工具拒绝执行”。

### 第五步：搜索工具

`grep` 用正则查内容，`glob` 用模式找文件。

两者都限制在当前工作目录内，并过滤指向目录外的符号链接结果。

原则：搜索是让模型建立项目上下文的入口，但不能让搜索路径逃出项目边界。

### 第六步：bash 和 ask_user

`bash` 负责执行 shell 命令，带有：

1. deny-list。
2. 超时。
3. 输出截断。
4. 工作目录提示。

`ask_user` 负责在信息不足时让模型明确提问。

原则：bash 是高能力工具，也是高风险工具；v1 先用简单安全边界控制最危险的情况。

### 第七步：LLM Client

`src/llm-client.ts` 向本地服务发送：

```text
POST /v1/chat/completions
model
temperature
messages
tools
tool_choice: auto
```

模型返回两类结果：

1. `content`：普通最终回答或中间说明。
2. `tool_calls`：请求程序执行工具。

原则：使用原生 tool calling，而不是让模型在普通文本里伪造工具调用格式。

### 第八步：上下文和系统提示词

`src/context.ts` 做两件事：

1. `buildInitialMessages()`：把 system prompt 放在用户输入之前。
2. `compactToolResult()`：长工具输出只保留头尾，避免消息无限增长。

`src/prompts/system.md` 放稳定规则，例如：

1. 需要文件内容、搜索、shell 输出或澄清时使用工具。
2. 修改文件前必须先读。
3. 做最小可行修改。
4. 最终回答要说明验证命令。

原则：固定的短 system prompt 比临时拼很长的 prompt 更适合本地小模型。

### 第九步：Agent Loop

`src/agent-loop.ts` 是核心循环：

1. 组装 system prompt 和用户输入。
2. 调用模型。
3. 如果没有 tool calls，返回最终文本。
4. 如果有 tool calls，把 assistant 消息加入历史。
5. 顺序执行每个工具。
6. 把工具结果作为 tool message 加入历史。
7. 继续调用模型。
8. 超过 `maxToolCallsPerTurn` 就停止，避免死循环。

原则：agent loop 不是复杂框架，核心就是“模型决策 + 程序执行 + 结果回填”的受控 while 循环。

### 第十步：CLI

`src/main.ts` 保持很薄：

1. 读取命令行 prompt。
2. 读取 `src/prompts/system.md`。
3. 创建 config。
4. 注册核心工具。
5. 调用 `runAgentLoop()`。
6. 打印最终回答和工具调用次数。

原则：CLI 不放复杂业务逻辑，只负责把输入接到 agent loop。

### 第十一步：MLX Server

`server/start.sh` 启动本地模型服务：

```bash
./server/start.sh
```

它实际执行：

```text
python -m mlx_lm serve --model ./Qwen3.5-9B-MLX-4bit --host 127.0.0.1 --port 8080
```

原则：推理服务独立于 agent 进程。TypeScript 不关心模型如何加载，只关心 HTTP API 是否兼容。

## 4. 为什么 v1 只有 7 个工具

`knowledge/README.md` 记录的 Qwen3.5-9B-MLX-4bit 实测数据是：

```text
工具数: 8
综合: 20/25 (80%)
参数提取: 8/10 (80%)
Sub-Agent 委派: 不可用
```

所以 v1 的设计约束是：

1. 工具数不超过 8。
2. 不暴露 `task` 或 sub-agent 工具。
3. 所有参数必须经过 Zod 校验。
4. 温度固定为 0。
5. 文件修改必须 read-before-edit。

当前核心工具列表（8 个）：

```text
bash           — shell 命令
file_read      — 读文件
file_write     — 创建/覆写文件
file_edit      — 精确字符串替换
grep           — 正则内容搜索
glob           — 文件模式匹配
web_search     — 联网搜索（DuckDuckGo）
ask_user       — 向用户提问
```

## 5. 如何运行

先安装依赖：

```bash
npm install
```

启动模型：

```bash
./server/start.sh
```

另开一个终端运行 agent（一次性任务）：

```bash
npm run dev -- "read package.json"
```

或者进入交互模式（多轮对话）：

```bash
npm run dev -- --repl
```

交互模式下消息历史跨轮保留，输入 `exit` 退出。

验证代码：

```bash
npm test
npm run typecheck
bash -n server/start.sh
```

## 6. 学习顺序

建议按这个顺序读源码：

1. `src/tools/types.ts`：理解工具接口。
2. `src/config.ts`：理解默认模型和安全边界。
3. `src/tools/index.ts`：理解工具注册和执行。
4. `src/tools/file-read.ts`：理解读文件和 trackedFiles。
5. `src/tools/file-edit.ts`：理解 read-before-edit。
6. `src/tools/web-search.ts`：理解联网搜索和 HTML 解析。
7. `src/llm-client.ts`：理解 OpenAI-compatible 请求和重试。
8. `src/token-counter.ts`：理解 token 估算。
9. `src/context.ts`：理解消息组装和工具输出压缩。
10. `src/memory.ts`：理解 instructions.md 加载。
11. `src/agent-loop.ts`：理解循环控制和离线检测。
12. `src/repl.ts`：理解交互模式。
13. `src/main.ts`：理解 CLI 如何把所有模块接起来。

> **Q: 每个文件做什么，为什么是这个顺序？**
>
> **1. `src/tools/types.ts`** — 定义 `Tool<TArgs>` 统一接口。所有工具共有的结构：名称、描述、JSON Schema、Zod Schema、4 个安全属性、`execute()` 函数。放在第一是因为后面所有文件都依赖这个接口。
>
> **2. `src/config.ts`** — 集中管理所有可配置项：模型 URL、温度、工具调用上限、bash 超时、bash deny-list、可写目录、LLM 重试参数。`createDefaultConfig()` 用一个函数返回完整默认配置。放第二是因为config是第二基础——每个工具执行时都要读取它。
>
> **3. `src/tools/index.ts`** — 工具注册中心和执行分发器。`createCoreTools()` 返回 8 个工具实例；`toolDefinitions()` 把它们转成 OpenAI API 需要的格式；`executeToolCall()` 做查找→JSON 解析→Zod 校验→执行。放第三说明工具怎么从"定义"变成"可调用"。
>
> **4. `src/tools/file-read.ts`** — 读文件 + 加行号 + 把真实路径写入 `trackedFiles`。大文件自动截断（头100行+尾50行）。放第四因为它是最简单的一个具体工具，同时引入了 `trackedFiles` 机制。
>
> **5. `src/tools/file-edit.ts`** — 精确字符串替换 + read-before-edit 硬约束 + old_string 唯一性检查 + writable root 边界。放第五因为它依赖第 4 步的 `trackedFiles`，把"模型不可信"变成了系统级硬约束。
>
> **6. `src/tools/web-search.ts`** — 向 DuckDuckGo 发查询，正则解析 HTML 结果页，返回前 5 条标题/链接/摘要。内置 15s 超时、challenge 页面检测、无效链接自动跳过。放第六因为它是一个新的独立工具，不依赖前面任何文件。
>
> **7. `src/llm-client.ts`** — 向 `POST /v1/chat/completions` 发请求。带指数退避重试（5xx 重试、4xx 不重试、网络异常重试）、请求超时保护。放第七说明 Agent 怎么和模型通信以及怎么容错。
>
> **8. `src/token-counter.ts`** — 用字符分类估算 token 数（CJK ≈ 1 token/字，ASCII ≈ 1 token/4 字符）。不放任何外部依赖，精度 ±20%，足够驱动压缩决策。放第八因为它是一个纯工具函数，被其他地方调用。
>
> **9. `src/context.ts`** — `buildInitialMessages()` 把 system prompt 放第一条消息。`compactToolResult()` 对超长工具输出保留头尾。放第九说明消息如何被整理成模型能消费的格式。
>
> **10. `src/memory.ts`** — 启动时读取 `<cwd>/.cc-local/instructions.md`，存在就追加到 system prompt 后面。文件不存在时返回空字符串不报错。放第十因为它修改了 main.ts 中 system prompt 的组装方式。
>
> **11. `src/agent-loop.ts`** — 核心循环：调模型 → 没 tool call 就返回文本 → 有 tool call 就执行工具 → 结果回填 → 继续循环。加上空响应重试、`maxToolCallsPerTurn` 保护、web_search 连续 2 次失败自动标记不可用。放第十一因为它是把前面所有模块串起来的调度引擎。
>
> **12. `src/repl.ts`** — `--repl` 模式入口。用 `readline` 循环读取用户输入，每轮调 `runAgentLoop` 执行，显示结果后等下一轮。消息历史跨轮保留（system prompt + 累积的 user/assistant/tool 消息）。输入 `exit`/`quit`/`q` 退出。放第十二因为它调用 agent-loop，同时也是 main.ts 的一个分支。
>
> **13. `src/main.ts`** — CLI 入口。读取命令行 prompt + 读取 system.md + 加载 instructions.md + 创建 config + 注册 8 个工具 + 调 `runAgentLoop()`（或 `runRepl()`）+ 打印结果。放最后因为它只是接线，没有业务逻辑。

## 7. 下一步可以扩展什么

先不要急着加功能。v1 稳定后，再考虑：

1. 更好的权限确认机制。
2. 更细的 bash 命令风险分级。
3. 基于 daily.md 记忆的上下文恢复与压缩。
4. 本地模型可用性检测。
5. 更完整的端到端 CLI 测试。
6. 完整记忆系统（memory/*.md 多文件 + daily.md 会话历史）。

每加一个能力，都应该先回答两个问题：

1. 这个能力是否真的解决当前用户任务？
2. 本地 9B 模型是否能稳定选择和填写这个工具？

## 8. 已修复缺陷

以下 v1 早期缺陷已在首次升级中修复：

| 缺陷 | 修复方式 |
|------|---------|
| grep `g` 标志漏匹配 | `regex.lastIndex = 0` 每行重置 |
| llm-client 无请求超时 | `AbortSignal.timeout(180_000)` |
| main.ts 无异常处理 | `main().catch(...)` 包裹 |

`maxToolCallsPerTurn` 命名问题在当前单次 CLI = 单任务的产品形态下语义正确。交互式 session 时再考虑改名。

## 9. 首次升级详解

升级新增了 5 项能力。每项都来自对 Claude Code 架构知识的简化和适配。

### 9.1 LLM 重试（指数退避）

**为什么加：** MLX Server 是本地进程，模型加载可能抖动。TCP 连接可能瞬断。10s/轮的延迟下，一次网络瞬断就杀整个会话太脆弱。

**原理：** 在 `callModel()` 外包裹重试循环。区分可重试错误和不可重试错误：

```
可重试（自动重试）          不可重试（立即失败）
─────────────────────       ──────────────────
网络超时 / ECONNREFUSED      HTTP 4xx（客户端错误）
HTTP 5xx（服务端错误）       格式化的 LLM 错误
fetch 异常                   
```

退避时间：1s → 2s → 4s（指数增长，最多 3 次）。`maxAttempts` 和 `baseDelayMs` 在 config 中可配。

**对应 Claude Code 知识：** `02-agent-loop.md` — Claude Code 有自动重试 + 指数退避，且不重复被拒绝的调用。我们的简化：4xx 不重试（对应"不重复被拒绝的调用"原则）。

### 9.2 web_search 工具

**为什么加：** 当前模型最大的能力盲区是"不知道外部世界"。报错信息、新版本 API、库文档——这些只能从网络获取。本地 grep/glob 覆盖不了。

**原理：** 用 DuckDuckGo 的 HTML 版（免 API key）。流程：

```
模型调用 web_search("TypeScript error TS2345")
  → GET https://html.duckduckgo.com/html/?q=...
  → 正则解析 HTML，提取 <div class="result"> 块
  → 每块提取标题（result__a）、链接、摘要（result__snippet）
  → 返回前 5 条 JSON
```

链接处理：DDG 的 `uddg` 参数里包着真实 URL（`//duckduckgo.com/l/?uddg=https%3A...`），需要 `new URL()` 解析 + `searchParams.get('uddg')` 展开。

**安全边界：**
- 工具描述和参数描述都写了隐私提醒（`Do not include file paths, credentials, or personal data in queries`）
- 15s 超时防卡死
- 网络错误返回 `ok: false`，模型能看到错误并调整
- 解析异常的链接自动跳过，不影响其他结果

**隐私：** 查询词经 HTTPS 发送到 DuckDuckGo。DDG 不记录用户身份，但查询内容本身（技术栈、库名、报错信息）会暴露。工具不会自动打开任何搜索结果网页。

**对应 Claude Code 知识：** `03-tool-system.md` — Claude Code 有 sandbox 层让 Agent 在 Bash 里调外部程序。本地模型缺乏这种灵活组合能力，所以把 web_search 封装成独立工具。

### 9.3 交互式 REPL

**为什么加：** 一次性 CLI 每次都要重建上下文。交互模式让模型能"记住刚才在做什么"，用户追加指令不需要重新解释背景。

**原理：** `cc-local --repl` 进入 `readline` 循环：

```
messages = [{ role: 'system', content: systemPrompt }]

while true:
    line = await rl.question('> ')
    
    if line == 'exit': break
    
    messages.push({ role: 'user', content: line })
    result = runAgentLoop({ config, messages, tools })
    
    显示 result.finalText
    // messages 已被 runAgentLoop 内部追加了 assistant + tool 消息
    // 下一轮循环时模型能看到完整历史
```

**关键设计：** `runReplTurn` 直接 mutate 传入的 `messages` 数组。这是故意的——调用者持有同一个数组引用，跨轮状态自然累积，不需要返回值来传递。

`toolContext` 同样跨轮保留——`trackedFiles`（读过哪些文件）和 `unavailableTools`（web_search 是否不可用）不会丢。

**对应 Claude Code 知识：** `02-agent-loop.md` — Claude Code 的 Agent Loop 是 AsyncGenerator，支持中断/恢复。我们的 REPL 在更粗粒度上实现同样效果：每轮用户输入驱动一次 Loop 执行，消息历史跨轮存活。

### 9.4 Token 计数

**为什么加：** 计数是压缩的前提。256K 窗口目前充裕，但未来要做"超阈值自动压缩"时，第一件事就是知道当前用了多少 token。

**原理：** 字符分类估算，不依赖外部 tokenizer：

```
CJK 字符（中日韩统一表意文字） → 1 token/字
ASCII 字符                      → 1 token/4 字符
其他 Unicode                     → 1 token/2 字符
```

同时提供 `estimateTokensForMessages()` 便利函数，对消息内容求和（会包含 tool_call_id 和 tool_calls JSON）。

**精度：** ±20%。不是用来算账单的，是用来判断"快满了"的。Qwen 的 tokenizer 和 OpenAI 不完全一致，引入 tiktoken 反而多一个出错源。

**对应 Claude Code 知识：** `05-context-management.md` — Claude Code 实时监控 token 消耗，87% 阈值触发 Auto-Compact。计是压的前提。

### 9.5 instructions.md 加载

**为什么加：** 用户需要一个"给 Agent 持久化偏好的地方"，不需要每次都重复说"用单引号"、"先跑测试再提交"。

**原理：** 启动时检查 `<cwd>/.cc-local/instructions.md`，存在就追加到 system prompt 后面：

```
systemPrompt = baseSystemPrompt + '\n\n' + '## Project Instructions\n\n' + instructionsContent
```

文件不存在时返回空字符串，不影响正常运行。文件权限错误时抛异常（合理——如果存在但读不了，应该让用户知道）。

**这是完整记忆系统的最小子集。** 先有 instructions.md 这个入口，以后扩展时在 `memory.ts` 里加更多功能即可。

**为什么不用 Claude Code 的 4 级 CLAUDE.md 层级：** 单用户单项目不需要 `~/.claude/` → `../.claude/` → `./.claude/` 的层级。一层够用。

**对应 Claude Code 知识：** `05-context-management.md` + `11-system-prompts.md` — Claude Code 有 4 级 CLAUDE.md + 9 个有序上下文源。取最小集：项目级 1 层，注入到 System Prompt 固定前缀位置。

### 9.6 离线检测（web_search 不可用处理）

**为什么加：** web_search 是联网工具。不联网时模型不知道网络不可用，会反复尝试调用，浪费 token 和 15s 超时等待。

**原理：** 不做启动检查（覆盖不了运行中断网），改为运行时连续失败检测：

```
web_search 执行 → 返回 ok:false → 计数器 +1
                → 又失败        → 计数器 +1 → 达到 2 次阈值
                → 标记 unavailableTools.add('web_search')
                → 注入提示消息到对话中
                → 后续 web_search 调用直接返回预置错误，不真实请求
                
如果后续又成功了 → 计数器清零 → 自动恢复
```

**为什么是 2 次而非 1 次：** 一次失败可能是瞬断（网络抖动），连续两次说明网络确实不可用。2 次是一个便宜的阈值——一次误判多等 15s，两次够确定。

**对应 Claude Code 知识：** 这是基于实测的原创设计——Claude Code 的设计文档里没有明确的"工具不可用自动降级"机制。这是本地模型才需要的东西（云端 API 的网络可靠性远高于本地服务）。

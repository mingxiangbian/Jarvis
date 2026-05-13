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

当前核心工具列表：

```text
bash
file_read
file_write
file_edit
grep
glob
ask_user
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

另开一个终端运行 agent：

```bash
npm run dev -- "read package.json"
```

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
6. `src/llm-client.ts`：理解 OpenAI-compatible 请求。
7. `src/context.ts`：理解消息组装和工具输出压缩。
8. `src/agent-loop.ts`：理解循环控制。
9. `src/main.ts`：理解 CLI 如何把所有模块接起来。

> **Q: 每个文件做什么，为什么是这个顺序？**
>
> **1. `src/tools/types.ts`** — 定义 `Tool<TArgs>` 统一接口。所有工具共有的结构：名称、描述、JSON Schema、Zod Schema、4 个安全属性、`execute()` 函数。放在第一是因为后面所有文件都依赖这个接口。
>
> **2. `src/config.ts`** — 集中管理所有可配置项：模型 URL、温度、工具调用上限、bash 超时、bash deny-list、可写目录。`createDefaultConfig()` 用一个函数返回完整默认配置。放第二是因为config是第二基础——每个工具执行时都要读取它。
>
> **3. `src/tools/index.ts`** — 工具注册中心和执行分发器。`createCoreTools()` 返回 7 个工具实例；`toolDefinitions()` 把它们转成 OpenAI API 需要的格式；`executeToolCall()` 做查找→JSON 解析→Zod 校验→执行。放第三说明工具怎么从"定义"变成"可调用"。
>
> **4. `src/tools/file-read.ts`** — 读文件 + 加行号 + 把真实路径写入 `trackedFiles`。大文件自动截断（头100行+尾50行）。放第四因为它是最简单的一个具体工具，同时引入了 `trackedFiles` 机制。
>
> **5. `src/tools/file-edit.ts`** — 精确字符串替换 + read-before-edit 硬约束 + old_string 唯一性检查 + writable root 边界。放第五因为它依赖第 4 步的 `trackedFiles`，把"模型不可信"变成了系统级硬约束。
>
> **6. `src/llm-client.ts`** — 向 `POST /v1/chat/completions` 发请求，带上 `messages` + `tools` + `tool_choice: auto`。返回 content 和 tool_calls。放第六说明 Agent 怎么和模型通信。
>
> **7. `src/context.ts`** — `buildInitialMessages()` 把 system prompt 放第一条消息。`compactToolResult()` 对超长工具输出保留头尾。放第七说明消息如何被整理成模型能消费的格式。
>
> **8. `src/agent-loop.ts`** — 核心循环：调模型 → 没 tool call 就返回文本 → 有 tool call 就执行工具 → 结果回填 → 继续循环。加上空响应重试和 `maxToolCallsPerTurn` 保护。放第八因为它是把前面 1-7 全部串起来的调度引擎。
>
> **9. `src/main.ts`** — CLI 入口，最薄的一层。读取命令行 prompt + 读取 system.md + 创建 config + 注册 7 个工具 + 调 `runAgentLoop()` + 打印结果。放最后因为它只是接线，没有业务逻辑。

## 7. 下一步可以扩展什么

先不要急着加功能。v1 稳定后，再考虑：

1. 更好的权限确认机制。
2. 更细的 bash 命令风险分级。
3. 会话摘要和上下文压缩。
4. 本地模型可用性检测。
5. 更完整的端到端 CLI 测试。

每加一个能力，都应该先回答两个问题：

1. 这个能力是否真的解决当前用户任务？
2. 本地 9B 模型是否能稳定选择和填写这个工具？

## 8. 已知缺陷

**Bug：grep 带 `g` 标志的正则会漏匹配**

`src/tools/grep.ts:73` 用同一个 `RegExp` 实例在多行上调用 `.test()`。如果用户传入带 `g` 标志的正则（如 `pattern: "foo/g"`），`.test()` 是有状态的——匹配成功后 `lastIndex` 会前移，下一行测试时从错误位置开始，导致漏掉后续匹配。解法：每次循环前重置 `lastIndex = 0`，或改用 `lines[index].match(regex)`。

**设计问题：`maxToolCallsPerTurn` 实际是全局上限**

配置名叫 `maxToolCallsPerTurn`（每轮上限），但 `agent-loop.ts` 的 while 条件用同一个计数器累计整个会话的所有工具调用。实际行为：会话总计 10 次工具调用就停。对简单任务没问题，但如果用户一轮里反复追加指令（"再跑一下测试""再改个地方"），累计到 10 次就停了。需要决定：要么改名 `maxToolCallsPerSession`，要么改为真正每轮重置。

**llm-client 没有请求超时**

`fetch()` 未传 `AbortSignal`。如果 MLX Server 卡住（模型加载失败但端口已开），Agent 会无限等待。应加 180s 超时。

**main.ts 没有顶层 try-catch**

`runAgentLoop()` 抛出的异常会变成未处理的 Promise rejection，CLI 直接崩溃而不是打印可读的错误信息。

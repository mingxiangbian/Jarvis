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

### 第二步：配置和工具类型

`src/config.ts` 定义模型端点、温度、工具调用上限、bash 超时、可写目录和危险命令 deny-list。

`src/tools/types.ts` 定义所有工具必须遵守的统一接口：

```text
name + description + JSON schema + Zod schema + safety flags + execute()
```

原则：模型输出不可信，程序必须校验后再执行。

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

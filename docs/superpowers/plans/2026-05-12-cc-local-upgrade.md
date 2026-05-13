# cc-local 升级实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 cc-local v1 增加 5 项升级：LLM 重试、web-search 工具、交互式 REPL、Token 计数、instructions.md 加载。

**架构：** 在现有单层 Agent Loop 上增量叠加。不改动工具接口、安全模型或 CLI 骨架。

**技术栈：** TypeScript (tsx 运行时)、Vitest、Commander.js、Zod、Node.js 内置 fetch/readline

---

## 范围与优先级

| 优先级 | 功能 | 理由 |
|--------|------|------|
| P0 | LLM 重试 | MLX Server 瞬断就杀会话，收益/成本比最高 |
| P1 | web-search 工具 | 模型无外部知识是目前最大能力盲区 |
| P1 | 交互式 REPL | 从一次性命令变成真正对话工具 |
| P2 | Token 计数 | 256K 窗口充裕，但计数是未来压缩的基础 |
| P2 | instructions.md 加载 | 记忆系统的最简单入口，零依赖 |

---

### 任务 1：LLM 重试 (指数退避)

**文件：** `src/llm-client.ts`、`src/config.ts`

**思路：** 在 `callModel` 外包裹重试循环。可重试错误（网络超时、5xx、fetch 异常）按 1s / 2s / 4s 退避，最多 3 次。不可重试错误（4xx）立即抛。在 config 新增 `llmRetryMaxAttempts` 和 `llmRetryBaseDelayMs` 两个配置项。

**测试：** mock `globalThis.fetch` 分别模拟"连续失败 2 次后成功"和"4xx 不重试"两种场景，验证调用次数。

- [ ] **步骤 1：config 新增重试参数**
- [ ] **步骤 2：编写重试行为测试（mock fetch）**
- [ ] **步骤 3：运行确认新测试失败**
- [ ] **步骤 4：实现重试循环**
- [ ] **步骤 5：运行确认新测试通过**
- [ ] **步骤 6：全量测试无回归**
- [ ] **步骤 7：Commit**

---

### 任务 2：web-search 工具

**文件：** `src/tools/web-search.ts`、`src/tools/index.ts`

**思路：** 新增第 8 个工具 `web_search`，参数 `query: string`。用 DuckDuckGo 的 HTML 版 (`html.duckduckgo.com/html/?q=...`) 抓取结果，正则提取前 5 条的标题/链接/摘要。无需 API key。设定 15s 超时、失败返回 `ok: false` 而不是抛异常——这样模型能看到错误并调整策略。

**测试：** mock fetch 返回 DuckDuckGo HTML 片段，验证解析出标题和链接；空 query 被 Zod 拒绝；网络错误返回 ok:false。

- [ ] **步骤 1：编写工具测试（3 个场景）**
- [ ] **步骤 2：运行确认新测试失败**
- [ ] **步骤 3：实现 web_search 工具**
- [ ] **步骤 4：在 createCoreTools 中注册**
- [ ] **步骤 5：运行确认新测试通过**
- [ ] **步骤 6：全量测试无回归**
- [ ] **步骤 7：Commit**

---

### 任务 3：交互式 REPL 模式

**文件：** `src/repl.ts`、`src/main.ts`

**思路：** `cc-local --repl` 进入交互循环。用 Node.js 内置 `readline` 模块逐行读取用户输入。每轮输入调 `runAgentLoop` 执行，结果显示后等待下一轮。消息历史跨轮保留（system prompt 固定前缀 + 已累积的 user/assistant/tool 消息）。输入 `exit`/`quit`/`q` 退出。

**关键设计决策：** REPL 模式下 system prompt 已在消息历史的 role=system 里，不需要每轮重传。`runAgentLoop` 内部每次 from scratch 构建消息，REPL 拿到结果后自己管理消息历史追加。

**测试：** 用 mock callModel 测试 `runReplTurn` 函数——验证返回文本、消息历史更新、exit 关键词触发退出意图。

- [ ] **步骤 1：编写 runReplTurn 测试（含 exit）**
- [ ] **步骤 2：运行确认新测试失败**
- [ ] **步骤 3：实现 runReplTurn + startRepl**
- [ ] **步骤 4：main.ts 加 --repl option**
- [ ] **步骤 5：运行确认新测试通过**
- [ ] **步骤 6：全量测试无回归**
- [ ] **步骤 7：Commit**

---

### 任务 4：Token 计数

**文件：** `src/token-counter.ts`

**思路：** 提供 `estimateTokens(text)`，用字符分类估算。CJK 字符约 1 token/字，ASCII 约 1 token/4 字符。精度 ±20%，足以驱动压缩触发决策。无需额外依赖（不加 tiktoken）。同时提供 `estimateTokensForMessages(messages)` 便利函数。

**为什么不用 tiktoken：** Qwen 的 tokenizer 和 OpenAI 的 o200k_base 不完全一致，引入依赖多一个出错源。±20% 精度足够——我们不追求精确账单，只判断"快满了"。

**测试：** 空输入、纯 ASCII、中文文本的估计在合理范围内，长文本估计 > 短文本估计。

- [ ] **步骤 1：编写 estimateTokens 测试（4 个场景）**
- [ ] **步骤 2：运行确认新测试失败**
- [ ] **步骤 3：实现字符分类估算**
- [ ] **步骤 4：运行确认新测试通过**
- [ ] **步骤 5：Commit**

---

### 任务 5：instructions.md 加载

**文件：** `src/memory.ts`、`src/main.ts`

**思路：** 启动时检查 `<cwd>/.cc-local/instructions.md` 是否存在。存在则追加到 System Prompt 后面，格式为 `## Project Instructions\n\n{content}`。不存在则不做任何事。

**这是完整记忆系统的最小子集：** 先让用户有一个"给 Agent 持久化偏好的地方"，不需要 memory/ 多文件结构、不需要会话摘要、不需要 Agent 自己写记忆。以后需要更复杂的记忆系统时，`memory.ts` 里扩展即可。

**测试：** 文件不存在时返回空字符串，文件存在时返回带标题的格式化内容。用 /tmp 临时目录做集成测试。

- [ ] **步骤 1：编写 loadInstructionsIfExists 测试（2 个场景）**
- [ ] **步骤 2：运行确认新测试失败**
- [ ] **步骤 3：实现 loadInstructionsIfExists**
- [ ] **步骤 4：集成到 main.ts 的 systemPrompt 组装**
- [ ] **步骤 5：运行确认新测试通过**
- [ ] **步骤 6：全量测试无回归**
- [ ] **步骤 7：Commit**

---

## 不纳入本次的范围

| 不做 | 原因 |
|------|------|
| 完整 memory 系统 | memory/*.md + session summary 需更多设计，本次只做入口 |
| `maxToolCallsPerTurn` 改名 | 当前产品形态下单次 CLI = 一个任务，语义正确；交互式 session 时再改 |
| Token 计数与压缩联动 | 先有计数能力，下次升级做"超阈值自动压缩" |
| 内存指针外部化 | 256K 窗口充裕，暂无需求 |

---

## 离线检测改进

**问题：** web_search 是联网工具，不联网时模型不知道网络不可用，会反复尝试调用，浪费时间和 token。而且不只启动时可能无网，会话中途也可能断网。

**为什么不用"启动时一次性检查"：** 只能覆盖"一开始就没网"，覆盖不了"中间断网"。中间断网后模型一样会反复试 web_search。

**思路：** 不做启动检查，改为运行时连续失败检测。`agent-loop.ts` 中记录连续 web_search 失败次数。连续 2 次失败后，在下一轮的消息里追加一条 system 级提示：

```
Web search has failed twice consecutively and appears unavailable.
Use grep, glob, and file_read for local-only work. Do not call
web_search again in this session.
```

如果后续某个 web_search 调用又成功了（网络恢复），自动移除该提示。

**优势：** 同时覆盖"启动时无网"和"中间断网"两种场景；不白白做启动检查（无网时 HEAD 也要超时 3s）；网络恢复后自动解除限制。

**实现位置：** `agent-loop.ts` — 回填工具结果后检查是否为 web_search 失败，累计计数。

**测试：** mock callModel 模拟模型反复调 web_search；验证连续 2 次失败后消息历史中出现了提示文本。

---

## web_search 隐私边界

**会泄露什么：** 模型调用 web_search 时，查询词会通过 HTTPS 发送到 DuckDuckGo 的服务器。DuckDuckGo 不记录用户身份，但查询内容本身（如报错信息、技术栈、库名）会暴露。如果模型错误地把文件路径、密钥、用户名等写进 query，这些内容就离开本机了。

**和 Claude Code WebSearch 的区别：** Claude Code 的搜索走 Anthropic 的 API 服务器，Anthropic 的服务条款覆盖了数据使用。我们的直接调 DuckDuckGo，没有中间代理。

**能访问哪些网站：** DuckDuckGo 的搜索结果覆盖所有公开索引的网页。工具只返回标题 + 链接 + 摘要，不会自动打开任何网页。模型看到链接后如果想看全文，需要额外调 `file_read` 或 `bash curl` 才能拿到——这两个都受现有安全边界约束（writable root、deny-list）。

**减轻措施：** 在 web_search 的描述 prompt 中加一句：`Do not include file paths, credentials, or personal data in queries.` 模型理解这条约束的概率远高于理解隐私概念。

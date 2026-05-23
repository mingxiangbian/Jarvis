# Phase 1 Model Router DeepSeek Design

## 背景

Phase 0 已把 Cyrene 收敛到 `API-first` 基线：模型端点通过 `CYRENE_BASE_URL` / `CYRENE_MODEL` 配置，`CYRENE_API_KEY` 可选，T2I 从 runtime 移除，工具注册由 config 驱动。

Phase 1 的目标是把当前单一 `src/llm-client.ts` 升级为 `Model Router`。本次设计以 DeepSeek 作为第一个真实 provider profile，但核心接口必须保持 provider-neutral，避免把 `reasoning_content`、`thinking`、缓存 token 字段等 DeepSeek 细节扩散到 agent loop。

## 范围

本次覆盖：

- `ModelProvider` 接口和 route policy
- DeepSeek V4 Pro / V4 Flash 的 route 配置
- `reasoning_content` 的保存和 replay
- thinking mode 的 `auto | on | off` 策略
- 简单任务切换到 `deepseek-v4-flash` 且关闭 thinking
- Web UI 的 thinking indicator 动效
- context window 使用 provider capability 覆盖当前硬编码值
- provider-level usage / cost metadata 归一化

本次不覆盖：

- Anthropic Messages API provider
- OpenAI Responses API provider
- stream token 级 reasoning 展示
- trace store / replay UI
- eval harness
- 多 provider 自动 benchmark

## 设计原则

1. `agent-loop` 只处理通用 `ChatMessage`、tool calls、tool results 和 observer event。
2. provider-specific request transform 只存在于 provider 层。
3. provider-specific response metadata 可存入 session history，但只有对应 provider 能决定是否 replay。
4. thinking 是 capability 和 route policy，不是 DeepSeek 全局开关。
5. UI 只展示 thinking 状态，不展示 raw `reasoning_content`。

## 目录结构

```txt
src/models/
  types.ts
  provider-router.ts
  openai-compatible.ts
  deepseek.ts
  model-capabilities.ts
  cost-tracker.ts
```

`src/llm-client.ts` 保留为兼容入口，内部委托给 `ModelRouter`，减少一次性改动范围。

## 类型设计

```ts
export type ModelUseCase =
  | 'chat'
  | 'planning'
  | 'coding'
  | 'summarization'
  | 'memory_extraction'
  | 'affect_analysis'
  | 'reflection';

export type ThinkingMode = 'auto' | 'on' | 'off';

export interface ModelRoute {
  useCase: ModelUseCase;
  provider: string;
  model: string;
  maxOutputTokens: number;
  temperature: number;
  thinkingMode: ThinkingMode;
}

export interface ModelCapabilities {
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsToolCalls: boolean;
  supportsJsonOutput: boolean;
  supportsThinking: boolean;
  supportsReasoningReplay: boolean;
}

export interface ProviderMetadata {
  provider: string;
  model: string;
  thinking?: {
    enabled: boolean;
    reasoningContent?: string;
  };
  usage?: NormalizedUsage;
}
```

`ProviderMetadata` 不直接进入 tool schema，也不由 `agent-loop` 解释业务含义。它只用于 session persistence、trace、cost tracking 和下一次 provider request transform。

## DeepSeek 路由策略

默认配置：

```txt
chat             -> deepseek-v4-pro,   thinking auto
coding           -> deepseek-v4-pro,   thinking auto
planning         -> deepseek-v4-pro,   thinking auto
reflection       -> deepseek-v4-pro,   thinking auto
summarization    -> deepseek-v4-flash, thinking off, temperature 0
memory_extraction-> deepseek-v4-flash, thinking off, temperature 0
affect_analysis  -> deepseek-v4-flash, thinking off, temperature 0
```

原因：

- `deepseek-v4-pro` 负责复杂 agent / coding / planning，需要强模型和长上下文。
- `deepseek-v4-flash` 负责摘要、记忆提取、情绪分析，成本更低、延迟更低。
- 简单结构化任务默认关闭 thinking，避免额外推理 token 和协议复杂度。

## DeepSeek Thinking 和 `reasoning_content`

DeepSeek V4 thinking 默认开启。若 thinking mode 下发生 tool call，后续请求必须把该 assistant turn 的 `reasoning_content` 原样带回，否则 DeepSeek API 会拒绝请求。

DeepSeek provider 的责任：

1. 根据 route 和 session override 计算最终 thinking mode。
2. thinking off 时，在 request body 写入：

```json
{ "thinking": { "type": "disabled" } }
```

3. thinking on / auto 生效时，从 response 中读取 `message.reasoning_content`。
4. 如果 response 含 tool calls，则把 `reasoning_content` 写入该 assistant message 的 provider metadata。
5. 下一次 DeepSeek request transform 时，把属于 DeepSeek 的 replayed assistant message 还原为 DeepSeek 需要的 payload。
6. 非 DeepSeek provider 忽略该 metadata，不向自身 API 发送未知字段。

## Thinking Switch

配置层支持：

```bash
CYRENE_THINKING_MODE=auto
CYRENE_STRONG_MODEL=deepseek-v4-pro
CYRENE_CHEAP_MODEL=deepseek-v4-flash
```

Web UI 支持 session-level override：

```txt
Think: Auto | On | Off
```

优先级：

```txt
session override > env config > route default
```

语义：

- `auto`: route policy 决定是否开启。
- `on`: 当前 session 对支持 thinking 的 route 强制开启。
- `off`: 当前 session 对支持 thinking 的 route 强制关闭。

如果 provider 不支持 thinking，则 UI 显示不可用状态，provider request 不发送 thinking 字段。

## Context Window

当前 `contextWindowTokens` 是 `256_000` 硬编码。Phase 1 应改为：

```txt
effectiveContextWindow = route.model.capabilities.contextWindowTokens
  ?? config.contextWindowTokens
```

DeepSeek V4 Pro capability：

```txt
contextWindowTokens: 1_048_576
```

DeepSeek 文档中的 `deepseek-v4-pro[1m]` 是 Claude Code / Anthropic-format 集成使用的模型别名；Cyrene 的 OpenAI-compatible provider 使用 `deepseek-v4-pro`，并通过 capability 表达 1M context。

## Web UI Thinking Indicator

Cyrene 已有 `thinking_start` / `thinking_stop` observer event。Phase 1 在 UI 上做轻量增强：

- assistant avatar 或 spark icon 在 thinking 时轻微跳动 / breathing。
- 显示 route label，例如 `deepseek-v4-pro · thinking auto` 或 `deepseek-v4-flash · thinking off`。
- 不展示 raw `reasoning_content`。
- thinking stop 后保留简短 metadata，例如 duration、model、tool call count。

这属于状态展示，不改变 agent loop 行为。

## Web UI Context Usage Meter

当前 Web UI 的 context usage 估算默认使用 `256_000`。Phase 1 引入 model capability 后，Web UI 不能继续使用固定窗口，否则 `deepseek-v4-pro` 的 1M context 会被显示成接近 4 倍的用量。

后端应向 Web UI 暴露当前 interactive route 的 context metadata：

```ts
export interface WebModelContextInfo {
  provider: string;
  model: string;
  useCase: 'chat' | 'coding' | 'planning';
  contextWindowTokens: number;
  thinkingMode: ThinkingMode;
}
```

Web UI 的 context meter 使用：

```txt
contextUsagePercent(messages, draft, modelContext.contextWindowTokens)
```

显示策略：

- composer 旁的 ring 仍显示百分比。
- `aria-label` / `title` 包含 model 和 context window，例如 `Context usage 18% of deepseek-v4-pro 1M`。
- inspector context panel 可显示 `tokens used / context window / auto-compact threshold`。
- 主聊天 meter 只跟随 interactive route，不跟随 `summarization`、`memory_extraction`、`affect_analysis` 等后台 cheap route，避免用户看到 meter 因后台任务切换模型而跳动。
- 如果 provider capability 不可用，回退到 `config.contextWindowTokens`，并在 `config doctor` 或 Web metadata 中标记 fallback。

这项变更和 thinking indicator 一样属于 Web 状态展示，但它必须使用 router 的 effective route metadata，否则 UI 与 runtime 压缩策略会不一致。

## Cost 和 Usage

Provider response 归一化为：

```ts
export interface NormalizedUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  estimatedCostUsd?: number;
}
```

DeepSeek provider 可读取 provider 原始 `usage` 字段，并保留原始 metadata 供 trace store 后续使用。

Phase 1 的 cost tracker 只做估算，不做账单级精确统计。

## 数据流

```txt
agent-loop
  -> callModel({ useCase, messages, tools })
  -> provider-router selects route
  -> DeepSeekProvider.transformRequest()
  -> DeepSeek API
  -> DeepSeekProvider.normalizeResponse()
  -> agent-loop handles content/toolCalls
  -> session-store persists assistant message + providerMetadata
```

摘要和记忆任务使用：

```txt
compactHistory / daily-summary / memory extraction
  -> callModel({ useCase: 'summarization' | 'memory_extraction', tools: [] })
  -> deepseek-v4-flash, thinking off
```

## 错误处理

- provider 不支持 selected route capability：启动时或 `config doctor` 报 warning。
- DeepSeek thinking replay 缺失：provider 抛出清晰错误，提示 session history 中缺少 required `reasoning_content`。
- 非 DeepSeek provider 遇到 DeepSeek metadata：忽略，不报错。
- remote HTTPS endpoint 未配置 `CYRENE_API_KEY`：沿用 Phase 0 doctor warning，不作为 fatal。

## 测试计划

新增或更新：

```txt
tests/model-router.test.ts
  - routes chat/coding/planning to strong model
  - routes summarization/memory_extraction/affect_analysis to cheap model
  - session thinking override wins over route default

tests/deepseek-provider.test.ts
  - sends thinking disabled for cheap routes
  - captures reasoning_content from tool-call response
  - replays reasoning_content on the next DeepSeek request
  - strips DeepSeek metadata when thinking disabled
  - normalizes usage and cache token fields

tests/agent-loop.test.ts
  - passes summarization useCase into compaction calls
  - persists provider metadata only on assistant messages

tests/web-static-helpers.test.mjs
  - renders thinking indicator state
  - renders route label without exposing reasoning_content
  - computes context usage with backend-provided contextWindowTokens
  - labels context usage with model and context window
```

验证命令：

```bash
npm run typecheck
npm test
npm run dev -- config doctor
```

如果用户提供 DeepSeek API key，再做一个手动 smoke test：

```bash
CYRENE_BASE_URL=https://api.deepseek.com \
CYRENE_MODEL=deepseek-v4-pro \
CYRENE_API_KEY=... \
npm run dev -- "用一句话回复 ok"
```

## 验收标准

- 不同 `ModelUseCase` 可走不同 model。
- `summarization`、`memory_extraction`、`affect_analysis` 默认使用 `deepseek-v4-flash` 且关闭 thinking。
- DeepSeek thinking + tool calls 的 `reasoning_content` 可正确保存和 replay。
- `agent-loop` 不包含 DeepSeek 专属字段。
- Web UI thinking indicator 有状态动效，但不展示 raw `reasoning_content`。
- Web UI context usage 使用 interactive route 的 effective context window，不再固定 `256_000`。
- `deepseek-v4-pro` capability 使 Cyrene 能使用 1M context window，而不是继续被 `256_000` 硬编码提前压缩。
- `npm run typecheck` 和 `npm test` 通过。

## 参考

- DeepSeek Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing/
- DeepSeek Thinking Mode: https://api-docs.deepseek.com/guides/thinking_mode/
- DeepSeek Claude Code Integration: https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/
- OpenClaw DeepSeek Provider: https://docs.openclaw.ai/providers/deepseek
- Anthropic Extended Thinking: https://platform.claude.com/docs/en/build-with-claude/extended-thinking

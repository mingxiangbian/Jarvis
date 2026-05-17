# Context Compression 升级设计

## 目标

对标 Claude Code 的 5 阶段压缩管道，为 cc-local 增加 3 个程序化预处理阶段（Snip / Microcompact / Context Collapse），在 LLM 参与之前大幅减少上下文体积，缓解本地模型长对话摘要慢的问题。

## 背景

当前 cc-local 只有一步压缩：70% 阈值触发 Auto-Compact（LLM 生成摘要）。长对话时全部旧消息（含大量工具输出）原样发给模型，远超 60s REPL 超时或导致长时间阻塞。

CC 在 LLM 摘要之前有 4 个程序化步骤（零模型调用、零延迟），到 Auto-Compact 时文本已被大幅精简。

## 范围

### 做

| 能力 | 描述 |
|------|------|
| Snip | 40% 阈值时裁掉旧的非关键消息（纯 tool 消息、无 content 的 assistant 消息） |
| Microcompact | 50% 阈值时截断旧轮次的工具输出为一句话索引 |
| Context Collapse | 60% 阈值时合并连续同类型工具调用结果 |
| Auto-Compact | 已有，70% 阈值触发。因前置阶段缩减了文本，完成更快 |
| REPL 退出摘要复用 | 退出前依次运行三阶段清理，再调 LLM 生成摘要 |

### 不做

| 不做 | 原因 |
|------|------|
| Budget Reduction | 已有 `estimateTokensForMessages` |
| CSO / LoRA | 9B 模型无训练能力 |
| 内存指针外部化 | 已有 `compactToolResult`（头尾截断），当前阶段够用 |

## 架构

### 4 阶段管道

```
当前:                          目标:
  70% → Auto-Compact              40% → Snip          (程序化，O(n))
  (LLM 调用，30-60s)              50% → Microcompact  (程序化，O(n))
                                   60% → Context Collapse (程序化，O(n))
                                   70% → Auto-Compact  (LLM，但文本已大幅缩减)
                                  ────────────────────────────
                                  前三个阶段合计 <50ms
```

### 阶段 1：Snip（40% 阈值 = ~102K tokens）

裁掉最旧的非关键消息。判断准则：

| 消息类型 | 处理 |
|---------|------|
| `role: 'tool'` 且所在轮次 < 保留范围 | 删除 |
| `role: 'assistant'` 且无 `content`（仅有 tool_calls）且所在轮次 < 保留范围 | 删除 |
| `role: 'user'` | 保留 |
| `role: 'assistant'` 且有 text content | 保留 |
| `role: 'system'` | 保留 |

保留最近 15 轮原文不动，只裁更早的消息。"轮"从 user 消息开始。

### 阶段 2：Microcompact（50% 阈值 = ~128K tokens）

对保留范围内但超过 5 轮的 tool 消息做截断：

- 当前轮 + 最近 5 轮的 tool 消息 → 保持原文
- 更早轮次的 tool 消息 → 替换为一行索引：
  ```
  [tool: {name} — result truncated ({N} chars). ok={true/false}]
  ```

不删除消息（保持 `tool_call_id` 对应的 message 完整性），只替换 `content` 为一行摘要。

### 阶段 3：Context Collapse（60% 阈值 = ~154K tokens）

合并连续同类型工具调用的结果：

| 合并规则 | 触发条件 |
|---------|---------|
| 3+ 次连续 `grep` | 合并为 1 条 |
| 2+ 次连续 `bash` | 合并为 1 条 |
| 同名的连续调用 | 合并为 1 条 |

合并后保留：命令列表、exit code、输出前 N 行和后 N 行摘要。

不同工具间的连续调用不合并（保持语义边界）。有 `role: 'user'` 或 `role: 'assistant'` 消息插入的不连续调用也不合并。

## 数据流

### Auto-Compact 路径（agent-loop.ts）

```
while 循环每次迭代，LLM 调用前：
  
  estimateTokens(messages)
    → ≥40%? → messages = snip(messages, keepRecentRounds=15)
    → ≥50%? → messages = microcompact(messages, keepRecentRounds=5)
    → ≥60%? → messages = collapse(messages)
    → ≥70%? → compactHistory(messages)  (已有)
    → callModel(messages)
```

### REPL 退出摘要路径（repl.ts）

```
退出前:
  cleaned = buildSessionSummaryPrompt(messages) 中:
    1. snip(messages, 15) → 副本
    2. microcompact(副本, 5) → 副本  
    3. collapse(副本) → 副本
    4. 用副本构建 prompt → 发给 LLM
```

注意：这里用纯函数返回副本，不影响 Auto-Compact 维护的原始消息数组。

## 模块职责

### context.ts（扩展）

| 函数 | 签名 | 说明 |
|------|------|------|
| `snipMessages` | `(messages, {keepRecentRounds}) => ChatMessage[]` | 新增：裁掉旧非关键消息，返回副本 |
| `microcompactToolResults` | `(messages, {keepRecentRounds}) => ChatMessage[]` | 新增：截断旧 tool 输出，返回副本 |
| `collapseConsecutiveCalls` | `(messages, {thresholds}) => ChatMessage[]` | 新增：合并连续同类型调用，返回副本 |
| `compactHistory` | 已有，不变 | — |
| `compactToolResult` | 已有，不变 | — |

三个新函数都是纯函数：输入 `ChatMessage[]`，返回 `ChatMessage[]`。不修改入参。单测友好。

### agent-loop.ts（扩展）

LLM 调用前按阈值依次执行三阶段：

```
if (estimated >= 40% threshold) messages = snipMessages(messages, ...)
if (estimated >= 50% threshold) messages = microcompactToolResults(messages, ...)
if (estimated >= 60% threshold) messages = collapseConsecutiveCalls(messages, ...)
if (estimated >= 70% threshold) compactHistory(...)
```

### repl.ts（扩展）

`buildSessionSummaryPrompt` 内部按相同顺序对副本执行三阶段清理，再拼接 prompt。

### config.ts（扩展）

```typescript
interface AppConfig {
  // 已有
  contextWindowTokens: number        // 256_000
  autoCompactThreshold: number        // 0.7
  // 新增
  snipThreshold: number              // 0.4
  microcompactThreshold: number      // 0.5
  collapseThreshold: number           // 0.6
  snipKeepRounds: number             // 15
  microcompactKeepRecentRounds: number // 5
}
```

## 测试计划

| 测试 | 内容 |
|------|------|
| `snipMessages` 正确裁掉旧 tool/空 assistant 消息 | user/assistant 关键消息保留 |
| `snipMessages` 不裁系统消息 | system 始终保留 |
| `snipMessages` 最近 N 轮不裁 | 阈值边界行为 |
| `microcompactToolResults` 截断旧轮次 tool 输出 | 新轮保持原文 |
| `microcompactToolResults` 保留 tool_call_id | 消息完整性 |
| `collapseConsecutiveCalls` 合并连续 grep | 合并后内容包含命令和结果 |
| `collapseConsecutiveCalls` 不合并被 user 消息隔断的调用 | 边界不跨越 |
| `collapseConsecutiveCalls` 不合并不同类型的工具 | grep 和 bash 分开 |
| 三阶段组合：消息数随阶段递减 | token 数持续下降 |
| REPL 退出摘要：清理后 prompt 明显变小 | 模型能在 60s 内完成 |

## 与 Claude Code 的对标

| CC 阶段 | cc-local 对应 | 差异 |
|---------|-------------|------|
| Snip | ✅ `snipMessages` | 完全对标 |
| Microcompact | ✅ `microcompactToolResults` | 完全对标 |
| Context Collapse | ✅ `collapseConsecutiveCalls` | 完全对标 |
| Auto-Compact | ✅ `compactHistory`（已有） | 完全对标 |
| Budget Reduction | ✅ `estimateTokensForMessages`（已有） | 完全对标 |

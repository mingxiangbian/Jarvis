# Phase C-D Dream-Gated Repeated Evidence Auto-Promotion Design

Ready for user review.

## 背景

Phase A 已完成本机 Codex global bridge。Codex 可以通过 Cyrene MCP 识别 project identity，并读取 compact continuity context。

Phase B 已完成 pending-only memory propose。候选写入 Codex project memory root 下的 `pending.jsonl`，不会直接进入 active memory。

Phase C-A 已完成 Codex-native chat review。Codex 可以通过 `cyrene_memory_pending_list/get/promote/reject` 展示 pending memory，并在用户明确 approve/reject 后 promote 或 reject。

Phase C-B 已完成 Stop hook redacted review summary。Codex 每轮可以生成 review-safe summary，并在检测到长期记忆价值时写入 pending candidate。

之后验证过 Codex app 当前的 MCP form elicitation：协议层存在，但实际调用会立即返回 `decline`，没有可用的 native approve/reject UI。因此 Phase C-C 暂不作为主路径。

Phase C-D 的目标是解决这个缺口：在没有原生审批弹窗的情况下，让低噪声、重复出现、有足够证据的 pending memory 自动进入 active memory，同时避免 active store 和 prompt context 被无限膨胀的记忆污染。

## 决策

本阶段选择：

```txt
Dream-gated repeated evidence auto-promotion + bounded active memory + single MODEL_PROFILE projection
```

含义：

- `index.jsonl` 仍是唯一 source of truth。
- `pending.jsonl` 仍是自动总结和候选生成的入口。
- 同一 `normalizedKey` 的 pending candidate 多次出现并达到 evidence/safety/stability 阈值后，可以进入 Dream pass；只有 Deep stage 可以自动 promote。
- 自动 promote 不按 domain 一刀切禁止。domain 只影响阈值和写入形式。
- Stop hook 只捕获 review-safe material 和 pending candidate，不直接写 active memory，也不直接渲染 `MODEL_PROFILE.md`。
- `index.jsonl` 增加 active store 容量上限。超限后运行 maintenance，自动合并、替换、归档和写 tombstone。
- `MODEL_PROFILE.md` 成为唯一 Markdown projection 类型，同时给模型每轮读取和给人类审计。
- 旧的多 projection 文件 `MEMORY.md`、`projections/PROJECT.md`、`projections/PERSONAL.md`、`projections/AFFECT.md` 如果确认没有外部依赖，就不再保留。
- Codex 每轮上下文由两部分组成：always-on `MODEL_PROFILE.md` 和 task-scoped retrieval from `index.jsonl`。
- 未来独立 plugin/MCP/Skill repo 的边界在本 spec 中明确，但本阶段仍在 Cyrene 主 repo 内实现。

## Goals

- 让 repeated evidence pending memory 可以通过 Dream Deep stage 自动 promote 到 active memory。
- 引入 Dream-gated promotion，避免 hook 或单轮总结把流水账、工具噪声、临时状态写入 active memory。
- 保留人工 approve/reject tools，作为高风险、冲突、调试和用户主动 review 的路径。
- 为 active `index.jsonl` 增加硬容量预算和维护流程。
- 增加 memory maintenance：去重、supersede、consolidate、archive、expire、tombstone。
- 将 `MODEL_PROFILE.md` 设计为唯一 Markdown projection 类型。
- 每轮默认注入 `MODEL_PROFILE.md`，让模型稳定理解用户习惯、项目规则和交互偏好。
- 每轮仍从 `index.jsonl` 检索当前任务相关的具体 memory，避免只靠 profile 丢失细节。
- 将 retrieval budget 从固定 `8 items / 1200 tokens` 升级为 task-aware 动态预算。
- 替换当前不适合中文的空白分词 token estimator。
- 删除或迁移旧 projection 依赖，避免维护多份语义相近的 Markdown 输出。
- 在 spec 中定义未来拆分独立 repo 的模块边界和成熟条件。

## Non-Goals

- 不实现 Codex native permission-style popup。
- 不把 pending candidate 无条件写入 active memory。
- 不让 hook 直接编辑 `index.jsonl` 或 `MODEL_PROFILE.md`。
- 不把 `MODEL_PROFILE.md` 作为 source of truth。
- 不默认把整个 `index.jsonl` 注入模型上下文。
- 不引入向量数据库或 embedding 检索作为本阶段依赖。
- 不实现完整 Web review UI。
- 不把 Cyrene 主项目中的 experimental agent loop、Web console、affect research 内核拆入独立 repo。
- 不支持用户直接编辑 generated projection 后反向同步到 `index.jsonl`。

## Memory 分层

Phase C-D 后的 Codex memory root 主要文件：

```txt
~/.cyrene/codex/global/memory/
  index.jsonl          global active memory source of truth
  pending.jsonl        global pending candidates
  events.jsonl         global audit events
  tombstones.jsonl     global rejected/archived/superseded fingerprints
  MODEL_PROFILE.md     generated global projection

~/.cyrene/codex/projects/<projectId>/memory/
  index.jsonl          project active memory source of truth
  pending.jsonl        project pending candidates
  events.jsonl         project audit events
  tombstones.jsonl     project rejected/archived/superseded fingerprints
  review-summaries.jsonl
  MODEL_PROFILE.md     generated project projection for model + human audit
```

`scope: global` 的 memory 必须存入 `~/.cyrene/codex/global/memory/`，不能只存在某个 project namespace 下。`scope: project` 和 `scope: session` 仍存入当前 project memory root。

`cyrene_continuity_get` 默认读取 global root + 当前 project root，再做 task-scoped retrieval。为兼容 Phase C-A/C-B 期间已经写入 project root 的历史数据，第一版还会扫描已有 project roots 中 `scope: global` 的 active memory，并在 doctor/maintenance 中迁移到 global root。

`MODEL_PROFILE.md` 在 global root 和 project root 分开生成。global profile 只包含全局规则和全局偏好；project profile 只包含当前项目规则和项目偏好，不复制 global 内容。运行时组合为：

```txt
effective profile = global MODEL_PROFILE.md + current project MODEL_PROFILE.md + task retrieval
```

Phase C-D 不新增完整 session transcript store。Codex app 已经保存 session，Cyrene 只保存 Dream pass 需要的轻量、可审计材料：

- `events.jsonl` 保存 action、hash、source refs、时间和 outcome。
- `review-summaries.jsonl` 保存 redacted、review-safe summary。
- `pending.jsonl` 保存结构化 memory candidate。
- 大段工具输出、完整 transcript、raw stack trace、完整文件内容不复制进 Cyrene memory root。

`index.jsonl` 存结构化事实和审计字段。`MODEL_PROFILE.md` 存模型每轮可读的短画像。二者关系是单向派生：

```txt
pending.jsonl
  -> Dream Deep repeated evidence / user approval / validator
  -> index.jsonl
  -> render MODEL_PROFILE.md
```

任何 durable memory 更新都必须先影响 `index.jsonl`，再重新渲染 `MODEL_PROFILE.md`。不允许直接编辑 `MODEL_PROFILE.md` 来改变记忆。

## 自动 Promote Policy

### 低价值重复和噪声过滤

重复出现不等于值得记。以下内容即使频繁出现，也默认不能进入 active memory：

- 工具调用流水：运行了哪些命令、读了哪些文件、某轮用了哪个 tool、hook 原始输入输出。
- 会话进度账：`已完成 X`、`接下来做 Y`、`merge/push 完了`、当前分支、当前端口。
- 口头确认：`OK`、`确认`、`可以`、`继续`，除非它明确确认一条 durable rule。
- 临时状态：一次测试结果、一次 CI 失败、一次 hook bad JSON、一次网络/API 故障。
- 中间方案：被放弃的设计、未定稿 tradeoff、临时猜测、用户只在本轮选择的选项。
- 大段原始材料：logs、stack traces、full transcript、长代码片段、完整配置文件。
- 过期外部事实：版本号、新闻、价格、当前 API 限制，除非带来源、时间和再验证策略。
- assistant 推断：从用户沉默、未反驳、一次性互动风格推导出的长期偏好。

这些内容可以留在 Codex session、`events.jsonl` 或 `review-summaries.jsonl` 中供审计和排错使用，但不能直接成为 active memory。只有当它们被抽象成未来可行动的稳定规则，并通过证据和敏感度 gate，才允许进入 promotion candidate。

### 基础原则

自动 promote 由以下因素共同决定：

- `normalizedKey`
- `seenCount`
- distinct `evidenceGroupId` / evidence source count
- `source`
- `userConfirmed`
- `domain`
- `type`
- `strength`
- `scope`
- `scores.evidenceStrength`
- `scores.stability`
- `scores.usefulness`
- `scores.safety`
- `scores.sensitivity`
- tombstone / conflict check
- content safety check

domain 不作为单独禁止条件。domain 只调整阈值和 profile 表达方式。

### Promote 候选条件

候选进入自动 promote 前必须满足：

- `status === 'pending'`。
- `normalizedKey` 稳定，且没有 active tombstone 命中。
- 至少有可审计 evidence。
- evidence 来自至少两个独立 `evidenceGroupId`，或一个明确 `user_explicit` durable instruction。
- 没有 unresolved conflict。
- 没有 secret、credential、private key、完整 `.env` 值等高风险内容。
- 没有诊断性 affective claim。
- 没有把 assistant 建议、用户沉默、用户未反驳当作用户偏好。
- 通过当前 validator 的安全检查。

### 证据独立

`seenCount` 只能表示同一 normalized key 被观察到的次数，不能直接等同于独立证据。Phase C-D 必须额外计算 `distinctEvidenceCount`。

独立证据的基本规则：

- 不同 `sessionId`、`runId`、日期窗口或 task context 才可能形成不同 `evidenceGroupId`。
- 同一个 hook 在同一轮里重复输出相同 candidate，只计为一个 evidence group。
- 同一个 assistant summary 复制到多个文件，不增加独立证据。
- 用户在不同会话里重复表达同一 durable instruction，算更强证据。
- 用户明确说“记住”、“以后默认”、“from now on”、“please remember”时，可以设置 `userConfirmed: true`，但仍要通过 safety、sensitivity、conflict 和 tombstone 检查。

建议 metadata：

```ts
{
  sessionId?: string,
  runId?: string,
  taskHash?: string,
  quoteHash?: string,
  evidenceGroupId: string,
  sourceKind: 'user_explicit' | 'user_implicit' | 'assistant_observed' | 'tool_trace' | 'file' | 'legacy_markdown'
}
```

`evidenceGroupId` 可以由 `sessionId + runId + sourceKind + quoteHash/dayBucket/taskHash` 派生。promotion gate 使用 `distinctEvidenceCount`，不是简单使用 raw evidence array length。

### 敏感度判断

`scores.sensitivity` 不能只靠模型直觉。第一版使用 deterministic classifier + redaction + model rubric 的组合：

- deterministic classifier 先识别 secret、token、private key、完整 `.env` 值、联系方式、账户标识、健康/财务/关系等敏感类别。
- redaction 先移除或泛化可识别细节，再让模型判断剩余内容是否适合长期记忆。
- 模型只输出结构化分数和理由，不直接决定 promote。
- sensitivity 不能作为唯一 promote 或 profile gate。高敏内容如果确实有长期协作价值，必须先经过 redaction 和抽象化；secret、credential、诊断性判断仍直接拒绝。

粗略分层：

```txt
低敏:
  项目规则、spec/plan 语言偏好、常用工作流、代码风格、工具偏好

中敏:
  个人偏好、协作风格、非公开项目背景、私有路径的抽象描述

高敏:
  secrets、凭据、完整路径中的身份信息、联系方式、健康/财务/关系原始细节、心理诊断
```

高敏原文可以影响本轮 response safety，但不能原样写入 active memory 或 `MODEL_PROFILE.md`。经过 redaction/抽象化后，如果变成稳定、可表面化的协作策略，可以作为 `safe_summary` 进入 profile。

### 默认阈值

第一版使用保守阈值，但不做 domain 永久禁用：

```txt
project / procedural / system:
  seenCount >= 2
  distinctEvidenceCount >= 2, or userConfirmed === true
  evidenceStrength >= 0.75
  stability >= 0.70
  usefulness >= 0.60
  safety >= 0.80
  sensitivity <= 0.60

personal / relationship:
  seenCount >= 3, or userConfirmed === true
  distinctEvidenceCount >= 3, or userConfirmed === true
  evidenceStrength >= 0.80
  stability >= 0.75
  usefulness >= 0.65
  safety >= 0.85
  sensitivity <= 0.45

affective:
  seenCount >= 3, or userConfirmed === true
  distinctEvidenceCount >= 3, or userConfirmed === true
  evidenceStrength >= 0.85
  stability >= 0.80
  usefulness >= 0.65
  safety >= 0.90
  sensitivity <= 0.30
  content must describe response strategy, not psychological diagnosis
```

如果用户明确说“记住”、“以后默认”、“from now on”、“please remember”，候选可以视为 `userConfirmed: true`，但仍必须经过 safety、sensitivity、tombstone 和 conflict 检查。

### Promote 后行为

自动 promote 成功后：

- 将 pending candidate 转为 active memory。
- 从 `pending.jsonl` 移除对应候选。
- 写入 `events.jsonl`：

```ts
{
  action: 'promote',
  reason: 'Pending memory gathered repeated evidence',
  memoryId: string,
  candidateId: string
}
```

- 运行 active store maintenance。
- 重新渲染 `MODEL_PROFILE.md`。

如果 promote 被 validator 拒绝：

- 从 pending 移除或保留取决于拒绝原因。
- 明确 unsafe / diagnostic / tombstone 命中的候选写 tombstone。
- 证据不足但未来可能成立的候选继续 pending，等待后续 evidence。

## Dream Pass

Dream pass 是 Phase C-D 的自动整理和自动 promotion 边界。它不替代 pending review，也不读取完整 Codex session transcript 作为默认输入。

输入：

- `pending.jsonl`
- `review-summaries.jsonl`
- `events.jsonl`
- active `index.jsonl`
- `tombstones.jsonl`

输出：

- promote / reject / archive / merge / supersede events
- active `index.jsonl` 更新
- regenerated `MODEL_PROFILE.md`
- optional debug report in `events.jsonl`

### Stages

Dream pass 分三段。只有 Deep stage 可以写 active memory。

```txt
Light:
  dedupe pending candidates
  merge same normalizedKey evidence
  classify low-value noise
  write audit events
  no active writes

REM:
  cluster related candidates
  detect conflicts and tombstone matches
  compute distinctEvidenceCount
  propose consolidate / reject / promote actions
  no active writes

Deep:
  run validator and safety gates
  promote qualified candidates
  archive or tombstone rejected unsafe candidates
  run active store maintenance
  render MODEL_PROFILE.md
```

Light 和 REM 可以失败而不影响 Codex 主流程。Deep 在写入前必须创建 snapshot；Deep 失败时不能留下半写状态。

### Periodic Scheduling

周期运行目标是 eventual consistency，不是精确到点必跑。电脑关机、Codex 未启动、网络不可用、API 不可用时，Dream pass 可能错过计划时间。

第一版使用组合触发：

- local `launchd` / cron / Codex automation 每天尝试运行一次。
- MCP server startup 检查 `lastDreamAt`。
- `cyrene_continuity_get` 可做轻量 overdue check。
- Stop hook 只做轻量 due marker，不同步跑长时间 model dream。
- `cyrene_memory_doctor` 可以手动运行 Dream pass。

运行状态存储：

```ts
{
  lastDreamAt: string,
  nextDreamDueAt: string,
  dreamDue: boolean,
  lastDreamStatus: 'success' | 'skipped' | 'failed',
  lastDreamError?: string
}
```

如果发现 overdue：

1. 尝试获取 lock。
2. 如果已有 Dream 正在运行，跳过。
3. 如果电脑离线或 model API 不可用，记录 `dreamDue: true` 和失败原因，不写 active memory。
4. 下一次 startup、continuity read、doctor 或 scheduled run 再 catch up。
5. 最多补跑一次，不因关机三天而连续跑三次。

### Lock 和 Fail-Open

Dream pass 必须有 project-level lock：

```txt
memory/.locks/dream.lock
```

lock 内容包含 pid、startedAt、expiresAt 和 dreamRunId。超过 `memoryDreamLockTtlMs` 后 doctor 可以清理 stale lock。

所有 hook 路径都必须 fail-open：

- Dream pass 失败不能阻塞 Codex。
- hook stdout 仍必须是合法 Codex hook JSON。
- partial write 必须通过 temp file + atomic rename 避免损坏 store。
- profile render 失败时保留旧 `MODEL_PROFILE.md`，并写 audit event。

## Active Store Budget

`index.jsonl` 不能无限增长。Phase C-D 增加两类预算。

### Store Budget

Store budget 控制 memory root 中 active store 的长期大小：

```txt
activeMaxItems: 300
activeContentMaxChars: 50_000
indexFileMaxChars: 250_000
singleMemoryContentMaxChars: 300
singleMemoryEvidenceMaxChars: 1_000
pendingMaxItems: 100
```

解释：

- `activeContentMaxChars` 统计 active memories 的 `content` 总字符数。
- `indexFileMaxChars` 统计 minified `index.jsonl` 文件字符数，覆盖 evidence 和 metadata 膨胀。
- `singleMemoryContentMaxChars` 防止单条 memory 过长。
- `singleMemoryEvidenceMaxChars` 防止 evidence quote 把审计字段撑爆。
- 如果超过预算，不能继续盲目 promote，必须先运行 maintenance。

这些默认值应放进 config，后续可以通过 env 或 config file 调整。

### Prompt Budget

Prompt budget 控制每轮给模型看的 memory context。即使 `index.jsonl` 被限制，也不能每轮全量注入。默认策略：

```txt
MODEL_PROFILE.md:
  always-on
  maxProfileChars: 6_000

retrieval from index.jsonl:
  coding/debugging: maxItems 12, maxTokens 2_000
  planning:        maxItems 16, maxTokens 3_000
  memory/review:   maxItems 24, maxTokens 4_000
  conversation:    maxItems 10, maxTokens 1_500

combined memory context hard cap:
  maxTokens 6_000
```

这样做的原因：

- Store budget 解决“长期记忆库不要无限膨胀”。
- Prompt budget 解决“当前任务不要被无关记忆稀释”。
- `MODEL_PROFILE.md` 负责稳定画像。
- retrieval 负责当前任务相关事实。

## Token Estimator

当前 `memory-retriever` 用空白分词估算 token，对中文会严重低估。Phase C-D 应新增共享 estimator：

```txt
CJK char:       1 token
ASCII chars:    4 chars ~= 1 token
other Unicode:  2 chars ~= 1 token
newline/punct:  conservative overhead
```

该 estimator 不追求账单精度，只用于预算和截断决策。目标是比空白分词更保守，避免中文 memory 超预算。

## MODEL_PROFILE.md

### 定位

`MODEL_PROFILE.md` 是唯一 Markdown projection 类型，但不是唯一物理文件。global root 和每个 project root 都可以各自生成一个 `MODEL_PROFILE.md`：

- 给模型每轮默认读取。
- 给人类快速审计。
- global `MODEL_PROFILE.md` 从 global active `index.jsonl` 自动生成。
- project `MODEL_PROFILE.md` 从当前 project active `index.jsonl` 自动生成。
- `cyrene_continuity_get` 运行时组合 global profile 和当前 project profile。
- 不直接编辑。
- 不保存 pending、rejected、expired、superseded memory。
- 不保证包含所有 active memory；是否进入 profile 由 `profileVisibility` 决定。

文件头：

```md
<!-- Generated from index.jsonl. Do not edit manually. -->
```

### 格式

第一版使用 deterministic renderer，不使用 LLM 生成 profile，避免 projection 自己产生幻觉。

建议结构：

```md
# Cyrene Model Profile

## Always Apply
- ...

## Project Context
- ...

## Interaction Preferences
- ...

## Response Policy
- ...

## Restricted Notes
- ...
```

### Section 规则

`Always Apply`：

- global / hard / procedural / system memory。
- 用户明确确认的长期工作规则。
- 必须非常短。

`Project Context`：

- 当前 project scope 的 active project facts。
- 架构边界、长期决策、当前 memory workflow。

`Interaction Preferences`：

- 低敏 personal preference。
- 用户对 spec、plan、review、语言、执行方式的偏好。

`Response Policy`：

- 从 procedural、relationship、interaction_style memory 派生的回答策略。
- 例如“先给工程判断，再给实现细节”。

`Restricted Notes`：

- 只放 profile-safe 的抽象提醒。
- personal、relationship、affective 内容不能写原始隐私细节，只能写成可表面化的协作策略。
- 不写诊断性心理判断。

### Profile Visibility

不要用 sensitivity score 做一刀切 profile gate。`MODEL_PROFILE.md` 的价值是让模型稳定理解用户习惯；如果中高敏但有长期协作价值的内容全部被挡掉，profile 会失去一部分核心功能。

Phase C-D 增加 `profileVisibility`，由 deterministic classifier、redaction 和 model rubric 共同产生：

```txt
always:
  低敏、明确、稳定、可直接表面化的规则。
  例如 spec/plan 默认中文、常用工作流、项目编码约定。

safe_summary:
  对协作有用，但原文不适合每轮暴露。
  renderer 必须写成抽象行为规则，不保留隐私细节或原始描述。

retrieval_only:
  不进入 always-on profile。
  只有当前任务相关且通过 safety policy 时，才通过 retrieval 使用。

never:
  secrets、credentials、诊断性心理判断、原始隐私细节。
  不进入 profile，也不应作为普通 retrieval memory 暴露。
```

如果 memory item 暂时没有 `profileVisibility` 字段，renderer 可用以下默认推导：

- `scores.sensitivity <= 0.6` 且 `scores.safety >= 0.8`：允许进入 `always` 或 `safe_summary`。
- procedural/project/system hard rule：优先 `always`。
- personal/relationship/affective：默认 `safe_summary` 或 `retrieval_only`，不得保留原始敏感细节。
- secret、credential、diagnostic affective claim：`never`。

因此，sensitivity 仍参与安全判断，但不作为单独的硬过滤器。真正决定 profile 可见性的是 `profileVisibility` 和 renderer 的 safe-summary 规则。

### Renderer 排序

Profile renderer 选择 active memory 时按以下优先级：

1. `profileVisibility === 'always'`
2. `strength === 'hard'`
3. `scope === 'global'`
4. `source === 'user_explicit'` 或 `userConfirmed === true`
5. `scores.usefulness`
6. `scores.evidenceStrength`
7. `scores.safety`
8. `profileVisibility === 'safe_summary'`
9. recent `updatedAt`

如果 profile 超过 `maxProfileChars`：

- 先保留 `Always Apply`。
- 再保留 project/procedural hard rules。
- 再保留高 usefulness interaction preferences。
- 最后截断或省略低优先级 sections。

profile renderer 不直接输出 `retrieval_only` 或 `never` memory。`safe_summary` memory 只能输出抽象后的 profile-safe 表达。

## Retrieval 改进

当前 retrieval 主要依赖 `userMessage` 的 lexical matching，不能保证每次读到正确 memory。Phase C-D 应改成多信号 retrieval。

### 输入信号

Retrieval query 应包含：

- 当前 `userMessage`。
- `task`：`coding` / `planning` / `debugging` / `conversation` / `memory`。
- `projectId` 和 `cwd`。
- 当前 git branch。
- changed files。
- 最近 read/edit/write 的 file paths。
- Stop hook review summary tags。
- memory 的 `domain`、`type`、`strength`、`scope`、`tags`。
- 最近使用次数和用户纠错记录。

### Ranking

第一版仍可用 deterministic scoring，但要扩展打分：

```txt
score =
  queryRelevance * 0.30
  + taskDomainFit * 0.20
  + usefulness * 0.15
  + evidenceStrength * 0.15
  + sourceTrust * 0.10
  + recencyOrUsage * 0.10
  - sensitivityPenalty
  - conflictPenalty
```

### Diversity

为了避免 retrieval 全被同一类 memory 占满，选择结果时使用 bucket diversity：

- coding/debugging 至少优先考虑 project/procedural/system。
- planning 可加入 personal/relationship 中低敏偏好。
- conversation 可加入 interaction preferences 和低敏 relationship memory。
- memory/review 可读取所有 active domains，但仍受 safety/sensitivity policy。

### Explainability

`cyrene_continuity_get` 可在 debug mode 返回 retrieval reason：

```ts
{
  id: string,
  content: string,
  score: number,
  reason: [
    'matched task=planning',
    'matched tag=spec',
    'source=user_explicit',
    'included by profile hard rule'
  ]
}
```

这不是默认用户输出，但用于测试和 doctor 调试。

## Memory Maintenance

Maintenance 在以下时机触发：

- Dream Deep stage 自动 promote 后。
- 人工 promote 后。
- active store 超过 `activeMaxItems`、`activeContentMaxChars` 或 `indexFileMaxChars`。
- pending store 超过 `pendingMaxItems`。
- 定期 doctor / repair / Dream pass 命令。

### 步骤

1. 创建 snapshot。
2. 删除 expired active memory，写 `expired` tombstone。
3. 合并相同 `normalizedKey` 的 active memory。
4. 用新事实 supersede 旧事实。
5. 对近似重复 memory 做 deterministic clustering。
6. 对超长或碎片化 cluster 做 consolidation。
7. archive 低 usefulness、低 evidenceStrength、长期未使用 memory。
8. 如果仍超预算，新 promote 回退为 pending，不强行写 active。
9. 写 audit events。
10. 重新渲染 `MODEL_PROFILE.md`。

### Consolidation

第一版优先 deterministic consolidation：

- 相同 `normalizedKey`：合并 evidence、保留最新 content 或更高 confidence content。
- 相同 domain/type/tag 且文本相似：生成 supersede proposal。
- 过期或被新事实覆盖：archive old memory。

如果仍超过预算，可以使用 cheap model 做 consolidation proposal，但模型输出不能直接写 profile。模型只能输出 structured candidate：

```ts
{
  action: 'replace' | 'archive' | 'merge',
  targetMemoryIds: string[],
  replacementCandidate?: PendingMemory,
  reason: string
}
```

replacement candidate 必须重新跑 validator。高敏或不确定 consolidation 进入 pending，不直接 active。

### Snapshot

Maintenance 前必须创建 snapshot，避免自动整理不可逆。

Snapshot 保留策略：

```txt
maxSnapshots: 20
```

Restore 本阶段只需要 CLI/debug 路径，不做 Web UI。

## 旧 Projections 迁移

当前存在：

```txt
memory/MEMORY.md
memory/projections/MEMORY.md
memory/projections/PROJECT.md
memory/projections/PERSONAL.md
memory/projections/AFFECT.md
```

Phase C-D 不保留没有消费方的 projection 文件。

迁移步骤：

1. 用 `rg` 检查 repo 内是否引用旧 projection paths。
2. 检查 Codex plugin skill、hook、MCP tools 是否读取旧 projection paths。
3. 检查 tests 是否依赖旧 projection 文件。
4. 如果没有外部依赖，删除旧 projection 生成逻辑。
5. 将 renderer 改为只写 `MODEL_PROFILE.md`。
6. 对已有 memory root，doctor/maintenance 可以删除旧 generated files。
7. 如果发现外部依赖，先迁移该依赖到 `MODEL_PROFILE.md`，再删除旧 projections。

不做长期双写。双写会制造两套语义相近但可能不同步的 Markdown 输出。

## Hook 和 MCP 行为

### Stop Hook

Stop hook 继续负责：

- redacted review summary。
- memory candidate extraction。
- pending candidate upsert。
- 不直接写 active memory。
- 轻量检查 Dream pass 是否 overdue，并标记 `dreamDue`。

Phase C-D 增加：

- upsert pending 后更新 candidate 的 evidence metadata。
- `scope: global` candidate 写入 global pending store；pending list/get/promote/reject 同时检查 global root 和当前 project root。
- 如果发现 overdue，只写 due marker 或短 audit event，不在 hook 同步运行长时间 Dream pass。
- hook stdout 仍必须返回合法 Codex hook JSON。
- Dream scheduling / due marker 失败必须 fail-open，不阻塞 Codex。

### MCP Tools

现有 tools 保留：

```txt
cyrene_memory_pending_list
cyrene_memory_pending_get
cyrene_memory_promote
cyrene_memory_reject
cyrene_memory_propose
cyrene_continuity_get
cyrene_project_identify
```

新增或扩展：

```txt
cyrene_memory_maintenance_run
cyrene_memory_dream_run
cyrene_memory_profile_get
cyrene_memory_doctor
```

第一版也可以不暴露 `maintenance_run` / `dream_run` 为普通 Codex tool，只作为 CLI/doctor 内部命令。若暴露给 Codex，必须只操作当前 project memory root，并写 snapshot。

### Continuity Get

`cyrene_continuity_get` 应返回：

- project identity。
- profile summary 或 profile content。
- global + 当前 project 的 task retrieval memories。
- pending review notice。
- response strategy。
- debug mode 下返回 retrieval reasons。

默认不返回整个 `index.jsonl`。

## 安全和隐私

- 所有 hook 输入和模型输出继续经过 redaction。
- `MODEL_PROFILE.md` 只包含可表面化内容。
- secrets、tokens、private keys、完整 `.env` values 永不进入 active memory 或 profile。
- affective memory 不可包含诊断性内容。
- assistant-derived inference 不能靠用户沉默自动 promote。
- tombstone 防止 rejected candidate 反复出现。
- maintenance 前创建 snapshot。
- generated files 不能跟随 symlink 写出 memory root。

## 配置

新增配置建议：

```ts
memoryAutoPromoteEnabled: boolean
memoryAutoPromoteMinDistinctRuns: number
memoryActiveMaxItems: number
memoryActiveContentMaxChars: number
memoryIndexFileMaxChars: number
memorySingleContentMaxChars: number
memorySingleEvidenceMaxChars: number
memoryPendingMaxItems: number
memoryProfileMaxChars: number
memoryProfileAlwaysOnEnabled: boolean
memoryRetrievalBudgetByTask: Record<Task, { maxItems: number, maxTokens: number }>
memoryMaintenanceSnapshotsMax: number
memoryDreamEnabled: boolean
memoryDreamIntervalHours: number
memoryDreamCatchUpEnabled: boolean
memoryDreamLockTtlMs: number
memoryDreamMaxRuntimeMs: number
memoryDreamModel?: string
```

默认启用 `memoryProfileAlwaysOnEnabled`。`memoryAutoPromoteEnabled` 可以默认启用，但含义是允许 Dream Deep stage 自动 promote；必须有 doctor 命令能报告当前策略和最近自动 promote events。

默认启用 `memoryDreamEnabled` 和 `memoryDreamCatchUpEnabled`。`memoryDreamModel` 可以使用当前 API 中便宜、稳定、适合结构化总结的模型；模型不可用时 Dream pass 只记录失败并延后，不写 active memory。

## 测试策略

### Unit Tests

- repeated evidence 合并同一 `normalizedKey`。
- distinct `runId` / `evidenceGroupId` 计数正确。
- Dream Deep stage 达到阈值后自动 promote。
- 未达到阈值继续 pending。
- 同一 hook 同轮重复 candidate 只算一个独立证据。
- 低价值重复内容不会进入 promotion candidate。
- tombstone 命中拒绝 promote。
- assistant-derived evidence 不因用户沉默 promote。
- 高敏内容不会自动 promote。
- personal/relationship/affective 使用更高阈值但不是 domain hard ban。
- diagnostic affective claim 被 reject。
- Dream Light / REM 不写 active memory。
- Dream Deep 写入前创建 snapshot。
- overdue Dream catch-up 只补跑一次。
- Dream lock 防止并发运行。
- store budget 超限触发 maintenance。
- maintenance 合并 duplicate active memory。
- maintenance supersede 旧事实。
- maintenance archive 低价值 memory。
- maintenance 前创建 snapshot。
- CJK token estimator 比空白分词更保守。
- profile renderer 生成 `MODEL_PROFILE.md`。
- profile renderer 不包含 pending/rejected/expired memory。
- profile renderer 超预算时保留 `Always Apply`。
- old projections 不再生成。

### Integration Tests

- Stop hook summary -> pending -> repeated evidence -> Dream Deep -> active -> profile render。
- Stop hook 只写 pending 和 due marker，不直接写 active。
- Scheduled Dream / doctor Dream -> pending -> Deep promote -> profile render。
- MCP propose 多次同 key -> pending evidence merge -> Dream Deep auto promote。
- `cyrene_continuity_get` 同时返回 profile 和 task retrieval memory。
- MCP startup / continuity read 发现 overdue 后可触发 catch-up。
- Codex project memory root 不读取旧 projections。
- generated file symlink guard 生效。
- maintenance 失败时 hook fail-open。
- Dream pass 失败时 hook fail-open。

### Manual Verification

1. 清空测试 project memory root。
2. 连续两轮产生相同 project/procedural memory candidate。
3. 确认第二轮后 candidate 仍在 pending，且 evidence metadata 合并正确。
4. 手动运行 `cyrene_memory_dream_run` 或 doctor Dream。
5. 确认 Deep stage 后 candidate 自动进入 `index.jsonl`。
6. 确认 `pending.jsonl` 中对应 candidate 被移除。
7. 确认 `MODEL_PROFILE.md` 被生成并包含该规则。
8. 确认旧 projection 文件不再生成。
9. 调用 `cyrene_continuity_get`，确认返回 profile + relevant task memories。
10. 制造 overdue 状态，确认 startup / continuity read / doctor 会 catch up。
11. 制造超预算 active store，运行 maintenance，确认 snapshot、archive/tombstone 和 profile 更新。

## Rollout

### Step 1: Profile Projection

- 新增 `MODEL_PROFILE.md` renderer。
- 先从 active memory deterministic render。
- 将 `cyrene_continuity_get` 接入 always-on profile。
- 保持 task retrieval 逻辑不变。

### Step 2: Token Estimator 和 Retrieval Budget

- 新增 CJK-aware estimator。
- 将 fixed `8 / 1200` 改为 task-aware budgets。
- 为 retrieval reason 增加 debug path。

### Step 3: Dream-Gated Repeated Evidence Auto-Promotion

- 抽出 Dream pass runtime。
- 实现 Light / REM / Deep stages。
- 复用 validator。
- Stop hook / MCP propose 后只更新 pending evidence 和 due marker。
- Deep stage 检查 promote policy 并写 active memory。
- 写 events 和 profile render。

### Step 4: Scheduling、Catch-Up 和 Lock

- 新增 `lastDreamAt` / `dreamDue` 状态。
- 新增 project-level Dream lock。
- 新增 scheduled run、startup overdue check、doctor manual run。
- 确保离线/API 不可用时 fail-open，只延后不写 active。

### Step 5: Store Budget 和 Maintenance

- 新增 active/pending budget。
- 新增 snapshot。
- 新增 maintenance pipeline。
- 超预算时合并、替换、归档。

### Step 6: Delete Old Projections

- 检查依赖。
- 删除旧 projection renderer 或改为只生成 `MODEL_PROFILE.md`。
- 更新 tests、docs、skill 文档。

### Step 7: Future Repo Boundary

- 写清楚独立 repo 结构，但不立即拆。
- 等 schema 和 runtime 稳定后再迁移。

## 未来独立 Repo 边界

未来可以拆成：

```txt
cyrene-continuity-mcp
```

该 repo 应包含：

- MCP server。
- Codex/Claude hook scripts。
- memory storage layout。
- pending/review/promote runtime。
- Dream pass runtime。
- `MODEL_PROFILE.md` renderer。
- install / uninstall / doctor。
- Codex skill。
- Claude-compatible docs。
- tests。

不应包含：

- Cyrene 主项目 experimental agent loop。
- Web console。
- Tauri shell。
- affect research 原型。
- eval/evolution 实验系统。
- 非 continuity 必需的 model/router 实验。

拆 repo 成熟条件：

- `index.jsonl` schema 稳定。
- MCP tool schema 稳定。
- Stop hook fail-open 行为稳定。
- Dream-gated auto-promotion policy 有测试覆盖。
- maintenance 有 snapshot/restore 路径。
- `MODEL_PROFILE.md` 作为唯一 projection 类型已稳定。
- agentmemory 冲突检测和停用流程明确。
- 插件能在本机 Codex global 环境独立 install/doctor/uninstall。

## 成功标准

- repeated evidence pending memory 能通过 Dream Deep stage 自动进入 active memory。
- 单次弱证据不会污染 active memory。
- 自动 promote 后 `MODEL_PROFILE.md` 更新。
- Stop hook 不直接写 active memory，hook 失败仍 fail-open。
- Codex 每轮能读取稳定 profile。
- Codex 仍能按 task 检索相关 active memory。
- `index.jsonl` 不会无限增长。
- 超预算 store 会自动维护，并保留 snapshot。
- 旧 projection 文件没有消费方时被删除。
- 用户能通过 global/project `MODEL_PROFILE.md` 审计 Cyrene 当前稳定画像。
- 未来拆独立 repo 的边界清楚，不和 Cyrene 主项目实验模块耦合。

## Spec 自审

- 无未完成条目。
- `index.jsonl` 是唯一 source of truth，`MODEL_PROFILE.md` 是派生 projection，没有矛盾。
- 自动 promote 不按 domain 一刀切禁止，但只允许 Dream Deep stage 执行，并保留 content safety 和 domain-adjusted thresholds。
- Store budget 和 prompt budget 分离。
- 旧 projections 的处理策略是确认无依赖后删除，不长期双写。
- 本 spec 只定义设计，不进入实现计划。

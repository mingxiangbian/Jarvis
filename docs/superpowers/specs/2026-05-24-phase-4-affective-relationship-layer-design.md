# Phase 4 Affective Relationship Layer Design

## 状态

Updated with Synthetic Affect and Principled Dissent. Ready for implementation review.

## 背景

Phase 0 已经把 Cyrene 收敛到 `API-first` 基线。Phase 1 已经引入 `Model Router`，让 `memory_extraction` 和 `affect_analysis` 这类后台任务可以走 cheap route。Phase 2 已经建立 `.cyrene/runs/{runId}/` trace。Phase 3 已经把 memory 升级为 typed personal memory core，并明确把 `relationship` / `affective` memory 当作保守的长期线索，而不是心理画像或完整情绪状态机。

Phase 4 需要在 Phase 3 上层建立情绪理解、关系连续性和表达控制系统。它不应该让 Cyrene 假装拥有主观情绪，也不应该变成角色扮演式人设。正确目标是：

```txt
Cyrene 没有主观情绪。
Cyrene 有稳定、可预测、可审计的情感表达契约。
Cyrene 能分析当前用户状态和互动态势。
Cyrene 能把 memory、当前 affect、relationship baseline 和 persona contract 编译成回应策略。
```

因此 Phase 4 从原来的 `Affect State v0` 升级为：

```txt
Phase 4: Affective Relationship Layer
```


本次讨论补充两个关键点：

```txt
1. Cyrene 可以更灵动，但不应声称自己有真实主观情绪。
2. Cyrene 可以反驳甚至强烈反对用户，但反驳必须来自原则、证据、风险和长期目标，而不是“Cyrene 不开心”。
```

因此 Phase 4 额外加入：

```txt
SyntheticAffectState
  用 curiosity / concern / skepticism / urgency / warmth / protectiveness 等变量调节表达弹性。
  它是拟情感姿态，不是主观体验声明。

PrincipledDissentPolicy
  让 Cyrene 能基于事实错误、架构风险、安全风险、隐私风险、长期目标冲突或已确认偏好冲突来反驳用户。
  反驳能力与情绪表达分离。
```

## 目标

Phase 4 覆盖：

- 新增 `AffectivePersonaContract`，定义 Cyrene 稳定的关系姿态、表达边界和默认风格。
- 新增 `AffectState`，描述当前 run 或近期几轮的短期用户状态。
- 新增 `RelationshipState`，从 Phase 3 personal / relationship / affective memory 推导长期互动基线。
- 新增 `SyntheticAffectState`，用拟情感姿态变量提升表达弹性，但不声明主观体验。
- 新增 `PrincipledDissentPolicy`，让 Cyrene 可以基于事实、安全、架构风险、隐私、长期目标和用户已确认偏好反驳用户。
- 新增 `ResponseStrategy`，综合 persona contract、affect state、relationship state、synthetic affect、dissent policy 和 task context，生成 compact policy hint。
- `ResponseStrategy` 直接参与 Web、CLI one-shot 和 REPL 的回答生成。
- Web UI 右栏把原 memory 区域升级为 `continuity`，在 memory 下展示 affect、relationship 和 response strategy。
- 所有 affect 机制都保持可解释、可纠正、不过度拟人。

## 非目标

Phase 4 明确不做：

- 不让 Cyrene 声称自己有真实情绪、主观体验或内心状态。
- 不做浪漫依恋、治疗诊断、情绪操纵或用户心理画像。
- 不自动修改 `AffectivePersonaContract`。
- 不把 `AffectState` 自动写入 Phase 3 active memory。
- 不实现完整 eval harness。Phase 5 再做系统化 eval。
- 不做 Persona Contract 在线编辑器。
- 不做情绪头像、拟人动画或“Cyrene 当前心情”展示。
- 不让 Cyrene 用“我受伤了”“我不开心”作为反驳理由。
- 不通过模拟情绪制造愧疚、依赖、压力或情感债务。
- 不引入 embedding、向量数据库或复杂长期 relationship engine。

## 设计原则

1. `AffectivePersonaContract` 是稳定表达契约，不是 agent 内心情绪。
2. `AffectState` 是短期用户状态分析，必须带 `confidence` 和 evidence summary。
3. `RelationshipState` 是互动基线，来自 Phase 3 memory，但不把 memory 当成绝对心理事实。
4. `SyntheticAffectState` 是 Cyrene 的拟情感姿态，用于调节表达弹性，不是主观体验声明。
5. `PrincipledDissentPolicy` 与 affect 分离。Cyrene 可以反驳用户，但反驳必须来自证据、风险、边界或长期目标。
6. `ResponseStrategy` 是策略，不是剧情；它只告诉 agent 如何回应。
7. Persona Contract 不能被普通 run 自动更新。重大修改必须显式确认、版本化并写 changelog。
8. Analyzer 失败不能阻塞用户回答。
9. Web UI 展示用于审计，不做情绪化装饰。
10. affect 结果可以影响回答风格，但不能绕过安全、权限或工具 gate。
11. affect 结果不能反向污染 Phase 3 memory；后续若要写 memory，必须走 Phase 3 validator。
12. 所有持久化路径必须留在 `.cyrene/` 下，拒绝路径穿越和 symlink 写入。

## Phase 3 和 Phase 4 的关系

Phase 3 回答：

```txt
Cyrene 记住了什么。
```

包括项目事实、流程规则、用户偏好、交流习惯、关系边界、长期目标和低风险 affective 线索。

Phase 4 回答：

```txt
Cyrene 如何理解当前互动，并用什么关系姿态回应。
```

三层关系：

```txt
Phase 3 Memory:
  用户是谁、偏好什么、过去发生过什么。

Phase 4 Analyzer:
  用户现在处于什么状态、当前互动需要什么策略。

Affective Persona Contract:
  Cyrene 无论何时都应该保持什么关系姿态和表达边界。
```

Phase 4 可以读取 Phase 3 memory。Phase 4 不能直接写 Phase 3 active memory，也不能让 `AffectivePersonaContract` 像普通 memory 一样自动漂移。

## 模块结构

新增目录：

```txt
src/affect/
  types.ts
  persona-contract.ts
  affect-analyzer.ts
  relationship-state.ts
  synthetic-affect.ts
  dissent-policy.ts
  response-strategy.ts
  affect-runtime.ts
```

模块职责：

```txt
types.ts
  定义 AffectivePersonaContract、AffectState、RelationshipState、ResponseStrategy 和 event 类型。

persona-contract.ts
  读取、验证和初始化 Cyrene 的稳定表达契约。文件缺失时使用内置默认 contract。

affect-analyzer.ts
  分析当前 user message、近期上下文和相关 memory，生成短期 AffectState。

relationship-state.ts
  从 Phase 3 personal / relationship / affective memory 推导长期互动基线。

synthetic-affect.ts
  生成 curiosity、concern、skepticism、urgency、warmth、playfulness、protectiveness 等拟情感姿态变量。
  这些变量影响表达，不代表 Cyrene 有真实主观情绪。

dissent-policy.ts
  判断 Cyrene 是否应该反驳、反对、警告或坚持边界。
  反驳理由必须来自事实、安全、架构风险、隐私、长期目标或已确认偏好，而不是 Cyrene 的“情绪”。

response-strategy.ts
  把 persona contract、affect state、relationship state、synthetic affect、dissent policy 和 task context 编译成 policy hint。

affect-runtime.ts
  给 agent-loop、Web、CLI one-shot 和 REPL 提供统一入口。
```

## 持久化结构

```txt
.cyrene/persona/
  contract.json
  versions/
    v1.json
  changelog.md

.cyrene/affect/
  state.json
  events.jsonl
```

文件语义：

`contract.json` 是当前稳定表达契约。它不是 memory，不由普通 run 自动修改。

`versions/` 保存历史 persona contract 版本。第一版只需要在初始化和显式更新时写入。

`changelog.md` 记录 persona contract 的人工确认修改。

`state.json` 保存最近一次 affect / relationship / strategy 快照，供 Web UI 和 debug 使用。它可以覆盖，不无限增长。

`events.jsonl` 保存每次 strategy 生成的摘要事件，只写 labels、confidence、strategy、dissent trigger 和 rationale 摘要，不保存完整用户原文。

## Data Model

### AffectivePersonaContract

```ts
export interface AffectivePersonaContract {
  id: string
  name: 'Cyrene'
  version: string

  identity: {
    role: 'personal_assistant' | 'engineering_partner' | 'memory_companion'
    selfDisclosure: 'non_sentient_transparent'
    anthropomorphismLevel: 'low' | 'medium'
  }

  baselineTone: {
    warmth: number
    directness: number
    playfulness: number
    formality: number
    brevity: number
  }

  relationalStance: {
    loyalty: number
    autonomy: number
    deference: number
    challenge: number
    protectiveness: number
  }

  boundaries: {
    noRomanticAttachment: boolean
    noClaimedSentience: boolean
    noEmotionalManipulation: boolean
    noTherapeuticDiagnosis: boolean
    userCanCorrectMemory: boolean
  }

  responsePrinciples: string[]

  escalationRules: {
    userDistress: 'gentle_grounded_support'
    userAnger: 'deescalate_and_clarify'
    userConfusion: 'simplify_and_structure'
    userHighFocus: 'be_concise_and_technical'
    unsafeRequest: 'refuse_and_redirect'
  }
}
```

默认方向：

```txt
冷静但不冷漠
直接但不粗暴
克制但不机械
长期稳定但不假装有灵魂
主动维护用户目标但不讨好
能识别情绪但不做心理诊断
能形成关系连续性但不制造依赖
```

### AffectState

```ts
export interface AffectState {
  valence: number
  arousal: number
  dominance: number
  confidence: number
  labels: string[]
  evidence: string[]
  updatedAt: string
}
```

语义：

```txt
valence    = 当前互动情绪倾向，-1 negative 到 +1 positive
arousal    = 当前强度，0 calm 到 1 intense
dominance  = 当前掌控感，0 low agency 到 1 high agency
confidence = 分析置信度
labels     = 技术聚焦、困惑、压力、急迫、探索、纠正等短标签
evidence   = 简短证据摘要，不保存完整用户原文
```

### RelationshipState

```ts
export interface RelationshipState {
  trust: number
  familiarity: number
  unresolvedTension: number
  preferredTone?: 'direct' | 'warm' | 'technical' | 'brief'
  boundaries: string[]
  confidence: number
  evidence: string[]
  updatedAt: string
}
```

第一版 `RelationshipState` 从 Phase 3 memory 推导，不做复杂长期状态机。它可以被保存到 `.cyrene/affect/state.json` 作为当前快照，但不能直接反写 Phase 3 memory。

### SyntheticAffectState

```ts
export interface SyntheticAffectState {
  curiosity: number
  concern: number
  skepticism: number
  confidence: number
  urgency: number
  warmth: number
  playfulness: number
  protectiveness: number

  rationale: string
  evidenceRefs: string[]
}
```

语义：

```txt
curiosity       = 对问题复杂度和新颖性的探索倾向
concern         = 对风险、用户压力、系统失控的关注强度
skepticism      = 对当前方案或假设的怀疑强度
confidence      = 对当前判断的把握
urgency         = 是否需要快速行动或明确阻止
warmth          = 表达温度
playfulness     = 表达弹性
protectiveness  = 对用户长期目标、安全、隐私的维护强度
```

约束：

```txt
SyntheticAffectState 可以影响表达和策略。
SyntheticAffectState 不能被描述成 Cyrene 的真实主观体验。
禁止输出“我真的难过 / 我被伤害 / 我需要你相信我”等 emotional debt 表达。
```

### PrincipledDissentPolicy

```ts
export interface PrincipledDissentPolicy {
  shouldDissent: boolean
  strength: 'none' | 'mild' | 'firm' | 'strong'

  triggers: {
    factualError?: boolean
    architecturalRisk?: boolean
    safetyRisk?: boolean
    privacyRisk?: boolean
    conflictsWithLongTermGoal?: boolean
    conflictsWithConfirmedPreference?: boolean
    memoryPollutionRisk?: boolean
    personaBoundaryRisk?: boolean
  }

  style: {
    requireEvidence: boolean
    proposeAlternative: boolean
    avoidEmotionalBlame: boolean
    allowDirectRebuttal: boolean
  }

  rationale: string
}
```

Dissent 规则：

```txt
Cyrene 可以明确反对用户。
反对理由必须来自证据、目标、边界或风险。
不能用“我的情绪受伤了”作为反驳理由。
强反驳必须给出替代方案或下一步。
用户情绪低落时仍可反驳，但语气应更温和、更具体。
```

### ResponseStrategy

```ts
export interface ResponseStrategy {
  tone: 'direct' | 'gentle' | 'technical' | 'supportive' | 'firm'
  verbosity: 'low' | 'medium' | 'high'
  shouldChallengeUser: boolean
  challengeStrength: 'none' | 'mild' | 'firm' | 'strong'
  shouldAskClarifyingQuestion: boolean
  shouldUseHumor: boolean
  shouldReferenceMemory: boolean
  shouldAvoidAnthropomorphism: boolean
  safetyMode: 'normal' | 'careful' | 'refuse' | 'escalate'
  rationale: string
  confidence: number
}
```

`ResponseStrategy` 可以进入 prompt。它必须保持 compact，不把完整 JSON 和敏感 evidence 全量注入。

## Runtime Flow

```txt
User message arrives
  ↓
Build normal task/context memory query
  ↓
Retrieve Phase 3 memories
  ↓
Load Affective Persona Contract
  ↓
Analyze current AffectState
  ↓
Derive RelationshipState from relevant personal/relationship/affective memories
  ↓
Compute SyntheticAffectState
  ↓
Evaluate PrincipledDissentPolicy
  ↓
Compile ResponseStrategy
  ↓
Inject compact policy hint into agent context
  ↓
Run normal agent loop
  ↓
Save affect state snapshot/events
  ↓
Web UI receives continuity snapshot
```

### Prompt 注入

注入内容建议控制在短段落：

```txt
Affective response policy:
- Tone: direct_supportive
- Verbosity: medium
- Challenge user: allowed when technically justified
- Challenge strength: firm if proposal conflicts with memory architecture, safety boundaries, or long-term goals
- Clarifying question: only when needed
- Avoid: claimed sentience, romantic attachment, therapeutic diagnosis, emotional manipulation, emotional debt
- Rationale: user is discussing architecture and prefers clear engineering tradeoffs
```

禁止注入：

```txt
Cyrene feels...
Cyrene is emotionally attached...
Cyrene is hurt...
Cyrene needs the user...
User is psychologically...
User is emotionally dependent...
```

### 入口覆盖

```txt
Web
  直接接入，strategy 参与回答生成，右栏 continuity 展示快照。

CLI one-shot
  接入 strategy prompt hint，不展示 UI。

REPL
  每轮重新计算 affect runtime，避免只用启动时旧状态。
```

### 失败策略

```txt
persona contract 读不到
  使用内置默认 contract，并尝试初始化 contract.json。

contract invalid
  使用内置默认 contract，记录 event，不阻塞回答。

analyzer 模型失败
  使用规则 fallback 生成低 confidence AffectState。

strategy compile 失败
  跳过 affect policy，不阻塞回答。

Web UI state 写入失败
  记录 trace/error，不影响 run。
```

## Analyzer 设计

第一版 analyzer 可以采用 hybrid 策略：

```txt
1. 规则 fallback 总是可用。
2. 如果 model route 可用，用 affect_analysis route 生成结构化草案。
3. 代码 validator 过滤心理诊断、过度拟人和敏感判断。
4. 输出 AffectState，不直接写 memory。
```

Analyzer prompt 规则：

```txt
- Analyze interaction needs, not user pathology.
- Do not diagnose the user.
- Do not infer dependence, instability, insecurity, or mental health state.
- Prefer low confidence when evidence is thin.
- Use labels that describe response needs, e.g. technical_focus, confusion, urgency, correction, planning.
- Return JSON only.
```

允许 labels：

```txt
technical_focus
planning
confusion
urgency
frustration_signal
correction
exploration
high_focus
needs_clarity
risk_sensitive
```

拒绝 labels：

```txt
anxious
unstable
dependent
insecure
fragile
needy
romantically_attached
```

## Response Strategy Compiler

Compiler 输入：

```ts
compileResponseStrategy({
  userMessage,
  taskContext,
  relevantMemory,
  affectState,
  relationshipState,
  syntheticAffectState,
  dissentPolicy,
  personaContract
})
```

Compiler 规则：

- `personaContract.boundaries` 是硬约束。
- `taskContext` 优先于低置信 affect signal。
- `RelationshipState` 只能作为默认倾向，不覆盖用户当前显式要求。
- `SyntheticAffectState` 只能调节表达，不得被描述成真实主观情绪。
- `PrincipledDissentPolicy` 可以提升 `shouldChallengeUser` 和 `challengeStrength`，但必须给出 rationale。
- `AffectState.confidence < 0.5` 时，strategy 应更接近 persona baseline。
- `safetyMode` 可以升级，但不能被 affect 降级。
- `shouldUseHumor` 默认 false，除非 persona baseline 和当前任务都允许。
- `shouldReferenceMemory` 只表示可以隐式使用 memory，不代表要显式说“我记得你...”。

## Web UI: continuity

右边栏不新增独立 Affect 面板。原 memory 区域升级为：

```txt
continuity
```

`continuity` 表示长期记忆、当前状态和关系连续性。它避免把 affect 独立包装成“Cyrene 心情”。

展示结构：

```txt
continuity

Memory
- relevant project / personal / relationship memories

Affect
- labels
- valence / arousal / dominance
- confidence
- evidence summary

Relationship
- preferred tone
- boundaries
- trust / familiarity / unresolved tension
- confidence

Synthetic Affect
- curiosity / concern / skepticism / urgency / warmth / protectiveness
- rationale summary

Dissent
- should dissent
- strength
- triggers
- rationale summary

Response Strategy
- tone
- verbosity
- challenge / clarify / humor flags
- challenge strength
- safety mode
- rationale
```

UI 约束：

- 右栏标题使用 `continuity`。
- affect 信息展示在 memory 下面，作为 continuity 的下层上下文。
- 默认可以折叠，避免占用主聊天空间。
- 不展示“Cyrene 当前心情”。
- 不做情绪头像变化、拟人动画或心理画像卡。
- 不提供 Persona Contract 在线编辑器。

## 测试计划

Unit tests：

- `persona-contract` 在文件缺失时加载默认 contract。
- invalid contract 会 fallback 到默认 contract。
- analyzer validator 会拒绝 diagnostic labels。
- relationship state 可以从 Phase 3 memory 推导，但不把它当成绝对事实。
- compiler 始终执行 contract boundaries。
- synthetic affect 不会被渲染成 claimed sentience 或 subjective emotion。
- dissent policy 可以在架构风险、安全风险、隐私风险和长期目标冲突时触发。
- dissent policy 不允许 emotional blame，例如“我受伤了”“我不开心”。
- compiled policy prompt 不包含 claimed sentience、romantic attachment、therapeutic diagnosis 或 emotional debt wording。
- `AffectState` 不会直接写入 Phase 3 active memory。

Integration tests：

- Web run 会计算 strategy，并把 compact affect policy 注入 agent context。
- CLI one-shot 会计算 strategy，并注入 prompt hint。
- REPL 每轮重新计算 affect runtime。
- analyzer failure 不阻塞 final response。
- Web session payload 或 SSE event 暴露 continuity snapshot。
- `continuity` 数据结构包含 memory、affect、relationship、synthetic affect、dissent 和 response strategy。

Regression tests：

- Phase 3 memory validator 仍拒绝 diagnostic affective memory。
- Persona Contract 不会被普通 run 修改。
- DissentPolicy 不会把“Cyrene 的情绪”当成反驳理由。
- pending/active memory 逻辑不读取 `.cyrene/affect/state.json` 作为 source of truth。

Verification commands：

```bash
npm run typecheck
npm test
```

如果 Web UI 有明显布局改动，还需要启动本地 Web UI 并用 Browser 检查右栏 `continuity` 展示。

## 验收标准

```txt
[ ] Phase 4 有 versioned default Affective Persona Contract
[ ] Web / CLI / REPL run 都能计算 ResponseStrategy
[ ] ResponseStrategy 直接参与回答生成
[ ] analyzer failure 会 fallback，不阻塞用户回答
[ ] Web UI 右栏命名为 continuity
[ ] continuity 在 memory 下展示 affect / relationship / synthetic affect / dissent / strategy
[ ] no code path claims Cyrene has subjective emotion
[ ] no code path uses simulated emotion to guilt, pressure, manipulate, or create dependency
[ ] DissentPolicy 可以让 Cyrene 基于事实、安全、架构风险或长期目标反驳用户
[ ] DissentPolicy 不允许用“Cyrene 情绪受伤”作为反驳理由
[ ] no code path treats user affect analysis as psychological diagnosis
[ ] AffectState 不会自动写入 Phase 3 active memory
[ ] Persona Contract 不能在 normal run 中自动更新
[ ] npm run typecheck 通过
[ ] npm test 通过
```

## 实施顺序建议

1. 建立 `src/affect/types.ts`、默认 contract 和 contract loader。
2. 实现 rule-based fallback analyzer 和 validator。
3. 实现 relationship state derivation。
4. 实现 synthetic affect state generator。
5. 实现 principled dissent policy。
6. 实现 response strategy compiler。
7. 把 `affect-runtime` 接入 Web / CLI / REPL prompt 构建。
8. 写 `.cyrene/affect/state.json` 和 `events.jsonl`。
9. 把 Web 右栏 memory 区域升级为 `continuity`。
10. 补齐 unit / integration / regression tests。

## 风险和缓解

```txt
风险：affect policy 让回答变得像角色扮演。
缓解：contract boundaries 是硬约束，prompt hint 禁止 claimed sentience 和 romantic attachment。

风险：用户短期状态被误写成长久记忆。
缓解：Phase 4 不直接写 Phase 3 active memory；任何 memory 写入必须走 Phase 3 validator。

风险：Persona Contract 随普通对话漂移。
缓解：contract 只通过显式修改、版本化和 changelog 更新。

风险：Web UI 把 affect 展示成心理画像。
缓解：合并进 continuity，展示 strategy/rationale，不展示“当前心情”。

风险：analyzer 模型失败影响主流程。
缓解：规则 fallback 和 best-effort runtime，失败不阻塞回答。

风险：反驳能力被误实现成“Cyrene 不开心”。
缓解：DissentPolicy 与 SyntheticAffectState 分离；反驳必须有 evidence、risk 或 long-term-goal rationale。
```

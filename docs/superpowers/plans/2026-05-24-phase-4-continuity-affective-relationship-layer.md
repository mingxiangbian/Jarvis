# Phase 4 Continuity Affective Relationship Layer Implementation Plan

> **For:** User / Cyrene
> **Feature:** Phase 4: Affective Relationship Layer, merged into `continuity`
> **Spec:** `docs/superpowers/specs/2026-05-24-phase-4-affective-relationship-layer-design.md`
> **Created:** 2026-05-24
> **Status:** Draft for immediate execution

## 目标

把 Phase 4 从文档设计落到最小可运行版本：

- 新增 `AffectivePersonaContract`，但不模拟 agent 的真实内心情绪。
- 新增用户状态分析、关系态势、合成 affect、原则性反驳和响应策略编译。
- 把 Phase 3 memory 与 Phase 4 affect 在运行时合成为 `continuity`。
- Web 右侧栏把原 `Memory` tab 改成 `continuity`，在 memory 下展示 affect/relationship/strategy。
- CLI、REPL、Web 在每次用户输入时都注入最新 continuity response policy。

## 非目标

- 不实现自动人格漂移。
- 不让 Cyrene 声称自己有主观情绪。
- 不做心理诊断或治疗建议。
- 不重构 agent loop、tool protocol 或 memory store 的既有职责。

## 约束与假设

- `Persona Contract` 默认从 `.cyrene/persona/contract.json` 读取；缺失时使用内置默认值。
- `Persona Contract` 默认不自动写回、不自动进化；后续版本化和 changelog 可以单独实现。
- Phase 4 的持久化只保存低敏摘要：`.cyrene/affect/state.json` 与 `.cyrene/affect/events.jsonl`，不保存原始用户消息。
- 第一版 analyzer 支持规则 fallback；如果注入 `callModel`，可走 `useCase: 'affect_analysis'` 并解析 JSON。
- Web SSE 新增 `continuity` event，前端展示最近一次 snapshot。

## 成功标准

- `npm test` 通过。
- `npm run typecheck` 通过。
- `buildAgentRuntime()` 生成的 system prompt 包含 `## Continuity Response Policy`。
- REPL 每轮用户输入都会刷新 continuity policy，且不会重复累加 policy section。
- Web run 会发出 `continuity` SSE event。
- Web 右侧栏 tab 文案为 `continuity`，并展示 memory + affect + strategy 的合并面板。

## Task 1: 添加 Phase 4 核心类型与默认 Persona Contract

**测试先行**

新增 `tests/affect-contract.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AFFECTIVE_PERSONA_CONTRACT,
  loadAffectivePersonaContract
} from '../src/affect/persona-contract.js'

describe('loadAffectivePersonaContract', () => {
  it('uses the default contract when no project contract exists', async () => {
    const contract = await loadAffectivePersonaContract('/tmp/missing-cyrene-root')

    expect(contract.name).toBe('Cyrene')
    expect(contract.identity.selfDisclosure).toBe('non_sentient_transparent')
    expect(contract.boundaries.noClaimedSentience).toBe(true)
    expect(contract.boundaries.noEmotionalManipulation).toBe(true)
  })
})
```

**实现**

新增：

- `src/affect/types.ts`
- `src/affect/persona-contract.ts`

关键类型：

```ts
export interface ContinuitySnapshot {
  contract: AffectivePersonaContract
  affect: AffectState
  relationship: RelationshipState
  syntheticAffect: SyntheticAffectState
  dissent: PrincipledDissentPolicy
  strategy: ResponseStrategy
  relevantMemoryCount: number
  generatedAt: string
}
```

**验证**

```bash
npm test -- tests/affect-contract.test.ts
```

## Task 2: 实现 analyzer、relationship、synthetic affect、dissent 和 strategy compiler

**测试先行**

新增 `tests/affect-strategy.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { analyzeUserAffect } from '../src/affect/user-affect-analyzer.js'
import { compileResponseStrategy } from '../src/affect/response-strategy.js'
import { DEFAULT_AFFECTIVE_PERSONA_CONTRACT } from '../src/affect/persona-contract.js'

describe('Phase 4 affect strategy', () => {
  it('does not emit diagnostic labels for distressed user text', async () => {
    const affect = await analyzeUserAffect({
      userMessage: '我现在有点崩，不知道下一步怎么做',
      task: 'planning'
    })

    expect(affect.labels).toContain('distressed')
    expect(affect.labels).not.toContain('depressed')
    expect(affect.responseNeed).toBe('lower_cognitive_load')
  })

  it('keeps persona boundaries while compiling response strategy', () => {
    const strategy = compileResponseStrategy({
      contract: DEFAULT_AFFECTIVE_PERSONA_CONTRACT,
      affect: {
        labels: ['focused'],
        intensity: 0.4,
        confidence: 0.8,
        responseNeed: 'technical_directness',
        risk: 'low',
        rationale: 'User is asking for implementation.'
      },
      relationship: {
        familiarity: 0.5,
        trust: 0.5,
        unresolvedFriction: false,
        boundarySensitivity: 'normal',
        communicationPreference: 'direct'
      },
      syntheticAffect: {
        curiosity: 0.5,
        skepticism: 0.4,
        concern: 0.2,
        patience: 0.7
      },
      dissent: {
        shouldChallenge: true,
        reason: 'Risky technical assumption.',
        mode: 'direct'
      }
    })

    expect(strategy.shouldChallengeUser).toBe(true)
    expect(strategy.shouldAvoidAnthropomorphism).toBe(true)
    expect(strategy.tone).toBe('technical')
  })
})
```

**实现**

新增：

- `src/affect/user-affect-analyzer.ts`
- `src/affect/relationship-state.ts`
- `src/affect/synthetic-affect.ts`
- `src/affect/dissent-policy.ts`
- `src/affect/response-strategy.ts`

规则：

- analyzer 输出行为标签，不输出诊断标签。
- synthetic affect 只表达处理倾向，不表达主观感受。
- dissent policy 输出是否应该反驳、为什么、用什么语气。
- response strategy 是最终唯一进入 prompt 的执行策略。

**验证**

```bash
npm test -- tests/affect-strategy.test.ts
```

## Task 3: 接入 `buildAgentRuntime()`，生成 Continuity Snapshot 与 Response Policy

**测试先行**

更新 `tests/web-prompt-context.test.ts`：

```ts
expect(runtime.systemPrompt).toContain('## Continuity Response Policy')
expect(runtime.systemPrompt).toContain('Avoid claiming subjective emotion.')
expect(runtime.continuitySnapshot?.strategy.shouldAvoidAnthropomorphism).toBe(true)
```

新增断言顺序：

```ts
'## Relevant Memory\n- Prefer small patches.',
'## Continuity Response Policy'
```

**实现**

新增 `src/affect/affect-runtime.ts`：

```ts
export async function buildContinuitySnapshot(input: BuildContinuitySnapshotInput): Promise<ContinuitySnapshot>
export function formatContinuityPolicy(snapshot: ContinuitySnapshot): string
export function replaceContinuityPolicy(systemPrompt: string, policy: string): string
export async function persistContinuitySnapshot(memoryCwd: string, snapshot: ContinuitySnapshot): Promise<void>
```

修改 `src/web/prompt-context.ts`：

- memory retrieval 后构建 `continuitySnapshot`
- 将 `formatContinuityPolicy(snapshot)` append 到 system prompt
- runtime return 增加 `continuitySnapshot`

**验证**

```bash
npm test -- tests/web-prompt-context.test.ts
```

## Task 4: 接入 CLI、REPL、Web runtime

**测试先行**

更新 `tests/repl.test.ts`：

```ts
expect(firstCallMessages[0]?.content).toContain('## Continuity Response Policy')
expect(secondCallMessages[0]?.content.match(/## Continuity Response Policy/g)).toHaveLength(1)
expect(secondCallMessages[0]?.content).toContain('Response need:')
```

更新 `tests/web-server.test.ts`：

```ts
expect(events.some((event) => event.type === 'continuity')).toBe(true)
```

**实现**

修改：

- `src/main.ts`：沿用 `buildAgentRuntime()` 生成的一次性 prompt。
- `src/repl.ts`：每轮根据当前 user input 重新构建 snapshot，并用 `replaceContinuityPolicy()` 更新 system message。
- `src/web/web-observer.ts`：`WebRunEvent` 增加 `continuity`。
- `src/web/server.ts`：run 开始后 emit `{ type: 'continuity', snapshot }`。

**验证**

```bash
npm test -- tests/repl.test.ts tests/web-server.test.ts
```

## Task 5: Web 右侧栏改为 `continuity`

**测试先行**

更新 `tests/web-server.test.ts` 静态资源断言：

```ts
expect(html).toContain('data-tab="continuity"')
expect(html).not.toContain('data-tab="memory"')
expect(app).toContain('renderContinuityPanel')
```

**实现**

修改：

- `src/web/static/index.html`
  - 把 `Memory` tab 改成 `continuity`
- `src/web/static/app.js`
  - 新增 `state.continuity`
  - 处理 `continuity` event
  - `renderContinuityPanel()` 展示 memory count、affect labels、relationship、strategy
- `src/web/static/styles.css`
  - 添加少量 continuity 面板样式，复用既有 inspector/card 风格

**验证**

```bash
npm test -- tests/web-server.test.ts
```

## Task 6: 全量验证与提交

**验证**

```bash
npm test
npm run typecheck
```

**提交**

```bash
git status --short
git add docs/superpowers/plans/2026-05-24-phase-4-continuity-affective-relationship-layer.md src tests
git commit -m "feat: add phase 4 continuity layer"
```


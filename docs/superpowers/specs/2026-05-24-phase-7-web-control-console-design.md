# Phase 7 Web Control Console Design

## 状态

Draft for user review.

本 spec 定义 Phase 7 v0：

```txt
Manual Control Console with Guarded Backend Actions
```

Web UI 不再只是聊天界面。它会成为 Cyrene 的主控制台，支持用户手动操作 tools、memory、affect、trace 和 evolution。所有写操作都必须走后端受控路径，不能由前端直接写 `.cyrene/*` 文件，也不能绕过 Phase 0-6 已建立的安全边界。

## 背景

Phase 0 已经完成 API-first 基线和 feature flags，工具注册由 config 决定。

Phase 1 已经引入 `Model Router`、provider metadata、thinking mode 和 context window metadata。

Phase 2 已经建立 `.cyrene/runs/{runId}/` trace store 和 summary-first replay。

Phase 3 已经把 memory 升级为 typed personal memory core。`index.jsonl` 是 active memory source of truth，memory 写入、归档、tombstone 和 projection 都必须走 memory store/lifecycle。

Phase 4 已经建立 affect / relationship / response strategy 层。Affect correction 可以影响策略，但长期保存必须受 Phase 3 validator 约束。

Phase 5+6 已经建立 deterministic eval harness、proposal store、promotion gate 和 CLI approval flow。Prompt proposal 是特殊高风险边界，不能和普通 low-risk proposal 一样自动应用。

当前 Web 已经有：

```txt
src/web/server.ts
src/web/static/index.html
src/web/static/app.js
src/web/static/app-helpers.js
src/web/static/styles.css

Context / Tools / Continuity inspector
SSE run events
session/workspace management
thinking mode control
run cancellation
trace persistence by Web run id
```

Phase 7 不从零重写 UI，也不先迁移 React/Vite。先把 backend API 和 state model 做稳，再考虑后续框架迁移。

## 目标

Phase 7 v0 覆盖：

- 把右侧 Inspector 升级成控制台。
- 新增 Tools、Memory、Affect、Trace、Evolution panels。
- Web 手动操作会真实改变后端状态。
- 所有写操作复用后端 validator、lifecycle、gate、hash 和 safe path checks。
- Tool toggle 是 session-level 临时开关，下一次 Web run 过滤 tool schema。
- Memory delete 是 archive delete，不做 hard delete。
- Memory downrank 是用户负反馈，由后端 lifecycle 调整 score 或归档。
- 不实现 memory pin，memory 排序继续由 retriever/validator/lifecycle 自动判断。
- Affect correction 写入 feedback candidate/event，交 Phase 3 validator 判断是否长期保存。
- Trace panel 只展示 summary，不保存或展示 raw model/tool payload。
- Evolution panel 支持 proposal list/detail/reject/approve/apply。
- 普通 proposal 的 Web approve 等于 approve + apply。
- Prompt proposal 的 Web approve 只写批准记录，必须单独 Apply prompt patch。
- 拆分 `src/web/api/*` backend handlers 和 `src/web/static/panels/*` frontend modules。

## 非目标

Phase 7 v0 不做：

- 不迁移 React、Vite、Svelte 或其他前端框架。
- 不新增独立 Console 页面或全屏路由系统。
- 不做全局 config 管理页。
- 不让 Web 修改 `.env`。
- 不显示 API key、完整 system prompt、raw model request 或 raw tool output。
- 不引入 trace full debug mode。
- 不支持 memory hard delete。
- 不支持 memory pin。
- 不让 affect correction 直接写 active relationship/affective memory。
- 不让 prompt proposal 的 Approve 自动 apply。
- 不支持 skill/code/permission/shell_policy proposal apply。
- 不把 Tauri 或桌面包装提前放入 Phase 7。

## 设计原则

1. Web 是主控制台，但前端不是 source of truth。
2. 手动操作必须真的执行，不能只是 UI 状态。
3. 手动操作也必须受后端 guard 约束。
4. Run-time SSE 和 control API 分离。
5. Summary-first trace 边界继续保留。
6. Memory 的长期保存和纠错仍然由 Phase 3 lifecycle 管理。
7. Affect correction 不能绕过 memory validator。
8. Evolution apply 必须重新校验 proposal hash、eval result、gate 和 path safety。
9. Prompt proposal 是特殊高风险类型，Approve 和 Apply 必须分开。
10. Phase 7 的 UI 复杂度通过 Adaptive Inspector 解决，不通过新增页面或框架迁移解决。

## 决策记录

### 控制台权限

采用 `Manual Control Console with Guarded Backend Actions`。

Web 的 approve、delete、downrank、apply 和 tool toggle 都是用户手动操作，与 CLI 手动操作同级。区别是后端必须在执行前复核规则，失败时返回明确阻止原因。

### Memory delete

Web `delete` 等价于 archive delete：

```txt
active/pending memory
  -> archive / remove from active prompt injection path
  -> write memory event
  -> write tombstone
  -> regenerate projections when needed
```

不做 hard delete。这样保留审计链和防重复写回机制。

### Memory pin

Phase 7 v0 不做 `pin`。

原因是用户希望 memory 顺序由 agent 自动判断。Web 只提供纠错、降权和删除能力，不提供人工置顶机制。

### Frontend framework

Phase 7 v0 不迁移框架。

继续使用 vanilla JS，但拆分模块，避免 `app.js` 继续膨胀。Phase 8 的 Tauri 包装只要求 Web UI 可独立运行，并不要求 React/Vite。

### Tool toggle

采用 session 临时开关：

```txt
Web session disabledTools
  -> POST /api/runs payload
  -> backend filters runtime.tools
  -> model receives filtered tool schema
  -> executeToolCall only sees allowed tools for this run
```

不写 `.env`，不影响 CLI、REPL 或其他 Web session。

### Evolution approve/apply

普通 proposal：

```txt
memory / procedural / tool_usage_note
  Web Approve
    -> verify hash/eval/gate
    -> write approval
    -> apply if allowed
```

Prompt proposal：

```txt
Web Approve
  -> verify hash/eval/gate
  -> write approval
  -> do not apply

Web Apply prompt patch
  -> verify already approved
  -> recompute hash
  -> verify eval report has no blocking failures
  -> verify patch only touches allowed prompt/persona files
  -> verify patch does not widen tool permission, shell policy, workspace boundary, or violate Phase 4 persona boundaries
  -> apply patch
```

这样 prompt 改动仍然是显式操作，但用户不必回到 CLI 才能 apply。

### Trace detail

Trace v0 is summary-only.

Web reads `metrics.json`, `model-calls.jsonl`, `tool-calls.jsonl`, `messages.jsonl` metadata and `final.md` summary. It must not require storing raw model request bodies, raw tool arguments, raw tool output, API key, Authorization header, or full system prompt.

### Layout

Use Adaptive Inspector.

Default Inspector is narrow and shows summaries. Detail mode expands the Inspector for complex objects. It automatically collapses the left sidebar when that is necessary to preserve enough space while keeping chat usable.

## Architecture

### Backend modules

Add:

```txt
src/web/api/
  types.ts
  tools.ts
  memory.ts
  affect.ts
  traces.ts
  evolution.ts
```

`src/web/server.ts` keeps:

- static file serving
- existing run/session/workspace routes
- SSE stream
- route dispatch to `src/web/api/*`

It does not absorb all control console logic.

### Frontend modules

Add:

```txt
src/web/static/api-client.js
src/web/static/state.js
src/web/static/inspector.js
src/web/static/panels/
  tools-panel.js
  memory-panel.js
  affect-panel.js
  trace-panel.js
  evolution-panel.js
```

`app.js` keeps app boot, event wiring and chat/run orchestration. Panel rendering and control API calls move into smaller modules.

### Shared response shape

Control API write operations return successful state or a guarded failure:

```ts
type ControlWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason?: string }
```

HTTP status reflects broad category:

```txt
200/202 success
400 invalid input or unsafe id
404 missing target
409 stale state, hash mismatch, already archived, or invalid status transition
422 gate rejected or validation failed
500 unexpected server error
```

Frontend must show `reason` when present.

## Control API

### Tools

```txt
GET   /api/control/tools
PATCH /api/control/sessions/:sessionId/tools
```

`GET /api/control/tools` returns a tool manifest:

```ts
interface WebToolManifestItem {
  name: string
  description: string
  risk: 'low' | 'medium' | 'high'
  cost: 'none' | 'low' | 'medium' | 'high'
  resourceLoad: 'low' | 'medium' | 'high'
  isReadonly: boolean
  isDestructive: boolean
  needsUserInteraction: boolean
  enabledByConfig: boolean
  disabledForSession: boolean
}
```

Phase 7 derives `risk` from existing tool metadata:

```txt
isDestructive true -> high
needsUserInteraction true -> medium
readonly false -> medium
otherwise -> low
```

`cost` and `resourceLoad` start with deterministic defaults by tool name and remain conservative. If a tool has no explicit mapping, use `cost: 'none'` for local read-only tools, `cost: 'low'` for local write/search tools, and `cost: 'medium'` for network tools; use `resourceLoad: 'low'` unless the tool is known to spawn long-running work.

`PATCH /api/control/sessions/:sessionId/tools` stores disabled tool names in Web session metadata. It must not enable tools disabled by config. If `CYRENE_ENABLE_WEB_SEARCH=0`, Web cannot re-enable `web_search`.

### Memory

```txt
GET  /api/control/memory
GET  /api/control/memory/:memoryId
POST /api/control/memory/:memoryId/archive
POST /api/control/memory/:memoryId/downrank
```

List response groups active and pending memory:

```ts
interface WebMemoryListResponse {
  active: WebMemorySummary[]
  pending: WebMemorySummary[]
}
```

Detail response includes:

```txt
id
domain
type
strength
scope
status
content
confidence/importance or scores
expiresAt
evidence summary
trace refs
createdAt/updatedAt
```

Archive:

- validates memory id
- removes from active/pending prompt path
- writes event
- writes tombstone
- regenerates projections
- returns updated memory list summary

Downrank:

- validates memory id
- records user feedback event
- lowers score or routes through lifecycle helper
- returns one backend decision: keep active with lower score, move to pending, or archive
- returns resulting action and updated summary

No `pin` endpoint in v0.

### Affect

```txt
POST /api/control/affect/corrections
```

Input:

```ts
interface AffectCorrectionInput {
  sessionId?: string
  runId?: string
  correction: string
  target?: 'affect' | 'relationship' | 'strategy'
}
```

Behavior:

- validates optional session/run ids
- writes a feedback candidate/event
- uses Phase 3 candidate/validator path for long-term retention
- updates current Web state for display only when the correction targets the current session/run
- does not directly write active relationship/affective memory

The UI phrases this as correcting Cyrene's interpretation, not diagnosing the user.

### Trace

```txt
GET /api/control/traces
GET /api/control/traces/:runId
```

List returns recent trace summaries from `.cyrene/runs`.

Detail returns:

```txt
input metadata without secrets
metrics
model call metadata
tool call summaries
final text
message transcript summary
```

Trace API must not return:

```txt
raw model request body
raw model response body
raw tool arguments
raw tool output
system prompt
API key or Authorization header
```

### Evolution

```txt
GET  /api/control/evolution/proposals
GET  /api/control/evolution/proposals/:proposalId
POST /api/control/evolution/proposals/:proposalId/reject
POST /api/control/evolution/proposals/:proposalId/approve
POST /api/control/evolution/proposals/:proposalId/apply
```

Proposal detail includes:

```txt
proposal.json
rationale.md
eval-results.json summary
approval.json if present
prompt.patch.diff if present
gate status
```

Reject:

- writes `approval.json` with rejected status and reason
- does not apply artifacts

Approve:

- recomputes proposal hash
- verifies eval report
- verifies proposal type is supported
- runs promotion gate
- writes `approval.json`
- for low-risk non-prompt proposal, applies allowed change
- for prompt proposal, does not apply

Apply:

- only applies already approved prompt proposal in v0
- rejects unsupported proposal types
- verifies hash/eval/gate again
- validates patch target and safety boundaries
- applies patch or returns guarded failure

## Adaptive Inspector UI

Tabs:

```txt
Context / Tools / Memory / Affect / Trace / Evolution
```

`Continuity` is removed as a tab and split into Memory/Affect/Trace.

### Default mode

Default Inspector width:

```txt
320-360px
```

Content:

- compact tab bar
- filters
- list rows
- status chips
- summary metrics
- lightweight buttons

### Detail mode

Detail Inspector width:

```txt
520-640px
```

Content:

- memory detail and evidence summary
- trace timeline
- proposal rationale
- eval report summary
- prompt patch diff
- apply/reject controls

If the layout cannot fit a 520px detail Inspector while keeping the chat column readable, entering detail mode automatically collapses the left sidebar to rail. Chat remains visible and usable.

### Panel behavior

Tools:

- Shows configured tools and current session disabled tools.
- Toggle immediately updates session disabled list.
- Recently called tools continue to stream from run events.

Memory:

- Shows active/pending lists.
- Detail mode shows evidence and scores.
- Archive and downrank are explicit user actions.
- No pin UI.

Affect:

- Shows affect labels, response need, relationship baseline and response strategy.
- Correction writes feedback candidate/event.
- UI copy must avoid psychological diagnosis language.

Trace:

- Shows current run when active.
- Shows recent run list when idle.
- Detail mode shows summary-only timeline.

Evolution:

- Shows proposal status groups.
- Detail mode shows rationale/eval/prompt diff.
- Non-prompt approve applies when the backend gate allows it.
- Prompt approve and prompt apply are separate buttons.

## Data Flow

### Run request with disabled tools

```txt
user toggles tool off
  -> frontend stores disabled tool name in session state
  -> PATCH /api/control/sessions/:sessionId/tools
  -> user sends next message
  -> POST /api/runs includes sessionId
  -> backend loads disabled tools for session
  -> runtime.tools filtered before runAgentLoop
  -> model receives filtered toolDefinitions
```

The tool must be absent from schema, not merely hidden in UI.

### Memory archive

```txt
Web archive click
  -> POST /api/control/memory/:memoryId/archive
  -> memory API validates id and current status
  -> memory lifecycle archives/removes active entry
  -> event + tombstone written
  -> projections regenerated
  -> UI refreshes list/detail
```

### Affect correction

```txt
Web correction submit
  -> POST /api/control/affect/corrections
  -> feedback candidate/event written
  -> Phase 3 validator decides long-term outcome
  -> UI shows correction recorded or failure reason
```

### Evolution prompt apply

```txt
Web Apply prompt patch
  -> POST /api/control/evolution/proposals/:proposalId/apply
  -> read proposal + approval + diff + eval
  -> recompute hash
  -> verify approved
  -> verify eval no blocking failures
  -> verify patch target allowlist
  -> verify Phase 4 boundaries
  -> apply patch
  -> return applied result
```

## Error Handling

All guarded write failures must be visible and specific:

```txt
Invalid memory id.
Memory is already archived.
Tool is disabled by config and cannot be enabled for this session.
Proposal hash changed since approval.
Proposal eval has blocking failures.
Prompt patch touches unsupported file.
Prompt patch violates persona boundary.
Trace run is no longer available.
```

Partial application is not allowed for evolution apply. If any gate fails, no prompt patch is applied.

Control API failures must not break chat run state.

## Testing

### Unit tests

- Tool disabled list filters tool schema.
- Tools disabled by config cannot be re-enabled by session toggle.
- Memory archive writes event/tombstone and removes memory from active prompt path.
- Memory downrank records user feedback and returns backend action.
- Affect correction creates feedback candidate/event and does not directly write active affective memory.
- Trace detail serializer excludes raw payload fields.
- Evolution approve recomputes proposal hash and checks eval/gate.
- Prompt approve does not apply patch.
- Prompt apply requires approved prompt proposal and rejects unsupported patch targets.

### Web server tests

- `GET /api/control/tools` returns manifest.
- `PATCH /api/control/sessions/:sessionId/tools` persists session disabled tools.
- `POST /api/runs` filters tools according to session disabled list.
- Memory archive/downrank endpoints validate ids and return updated state.
- Affect correction endpoint writes feedback candidate/event.
- Trace endpoints return summary-only data.
- Evolution proposal list/detail/reject/approve/apply endpoints enforce state transitions.
- Stale proposal hash returns conflict.

### Static frontend tests

- New tabs render.
- Adaptive Inspector enters/exits detail mode.
- Detail mode collapses the sidebar when width is needed.
- API client renders guarded failure reasons.
- Tool toggles update UI state and call API.
- Memory panel has archive/downrank but no pin.
- Prompt proposal shows separate Approve and Apply prompt patch actions.
- Trace panel does not render raw payload fields.

### Final verification

Implementation finishes with:

```bash
npm run typecheck
npm test
npm run dev -- --web
```

Then use browser verification for:

- Inspector tab switching.
- Adaptive detail mode.
- Tool toggle changes next run schema.
- Memory archive/downrank paths.
- Affect correction path.
- Trace summary display.
- Evolution approve/apply/reject paths.

## Rollout Order

1. Add backend control API handler structure and route dispatch.
2. Add session disabled tools storage and run-time tool filtering.
3. Add memory control endpoints and tests.
4. Add affect correction endpoint and tests.
5. Add trace summary endpoints and tests.
6. Add evolution control endpoints and tests.
7. Split frontend API client and panel modules.
8. Add Tools and Memory panels.
9. Add Affect and Trace panels.
10. Add Evolution panel.
11. Add Adaptive Inspector detail mode.
12. Run typecheck, test suite and browser verification.

## Acceptance Criteria

- Web has Context, Tools, Memory, Affect, Trace and Evolution tabs.
- Web tool toggle affects the next run's model-visible tool schema.
- Web memory delete archives memory and preserves event/tombstone audit.
- Web memory panel does not support pin.
- Web affect correction does not directly write active relationship/affective memory.
- Web trace panel remains summary-only.
- Web evolution approve applies low-risk non-prompt proposal only after hash/eval/gate checks.
- Web prompt proposal approve does not apply.
- Web prompt patch apply is a separate guarded action.
- Frontend remains vanilla JS but panel logic is split from `app.js`.
- `server.ts` dispatches to `src/web/api/*` instead of absorbing all control logic.
- `npm run typecheck` passes.
- `npm test` passes.

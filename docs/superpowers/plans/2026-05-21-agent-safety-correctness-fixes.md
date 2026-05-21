# Agent Safety and Correctness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved safety and correctness fixes for clarification flow, Web session workspace binding, local date formatting, file read boundaries, and Web request body limits.

**Architecture:** Keep the existing module layout. Add small helpers where behavior is shared, extend existing types conservatively for backward compatibility, and preserve current public result shapes. Do not change prompt composition.

**Tech Stack:** TypeScript ESM, Node.js, Vitest, static Web assets served by `src/web/server.ts`.

---

## File Structure

- Modify `src/agent-loop.ts`: stop after successful tools marked `needsUserInteraction`.
- Modify `tests/agent-loop.test.ts`: add clarification flow regression coverage.
- Modify `src/session-store.ts`: add optional `workspaceId` to session index items and creation.
- Modify `src/web/server.ts`: record workspace id on session creation, reject workspace mismatch on resume, cap JSON bodies.
- Modify `tests/session-store.test.ts`: cover `workspaceId` persistence and legacy loading.
- Modify `tests/web-server.test.ts`: cover workspace binding and request body limit.
- Create `src/time.ts`: local date/date-time formatting helpers.
- Modify `src/web/prompt-context.ts`: use local date helper.
- Modify `src/daily-summary.ts`: use local date-time helper.
- Modify `tests/web-prompt-context.test.ts` and `tests/daily-summary.test.ts`: cover local formatting.
- Modify `src/config.ts`: add `readableRoots`.
- Modify `src/tools/file-read.ts`: enforce `readableRoots`.
- Modify `tests/config.test.ts` and `tests/file-read.test.ts`: cover default config and read boundary.

## Task 1: Clarification Tool Flow

**Files:**
- Modify: `tests/agent-loop.test.ts`
- Modify: `src/agent-loop.ts`

- [ ] **Step 1: Write the failing test**

Add a test in `tests/agent-loop.test.ts` that defines a tool with `needsUserInteraction: true`, has the model call it once, and asserts:

```typescript
expect(result.finalText).toBe('Question for user: Which file should I edit?')
expect(modelCalls).toBe(1)
expect(dailySummary).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-loop.test.ts`

Expected: FAIL because `runAgentLoop` calls the model again after the tool result.

- [ ] **Step 3: Implement minimal code**

In `src/agent-loop.ts`, after a successful tool execution and after appending the tool message, if the tool definition has `needsUserInteraction`, notify response observers with the tool result content and return `{ finalText: result.content, toolCallCount }` without appending daily memory.

- [ ] **Step 4: Verify**

Run: `npm test -- tests/agent-loop.test.ts`

Expected: PASS.

## Task 2: Session Workspace Binding

**Files:**
- Modify: `tests/session-store.test.ts`
- Modify: `src/session-store.ts`
- Modify: `tests/web-server.test.ts`
- Modify: `src/web/server.ts`

- [ ] **Step 1: Write failing session store tests**

Add tests that create a session with `workspaceId: 'project-a'`, assert it is stored in `index.json`, and assert legacy index entries without `workspaceId` still load with `workspaceId === undefined`.

- [ ] **Step 2: Run store tests to verify failure**

Run: `npm test -- tests/session-store.test.ts`

Expected: FAIL because `createSession` does not accept or persist `workspaceId`.

- [ ] **Step 3: Implement session store support**

Add `workspaceId?: string` to `SessionIndexItem`, accept `workspaceId?: string` in `createSession`, persist it when provided, and allow it in `isSessionIndexItem`.

- [ ] **Step 4: Verify store tests**

Run: `npm test -- tests/session-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Web tests**

Add tests in `tests/web-server.test.ts` that:

- create a session in `project-a`, resume it in `project-a`, and expect 202;
- resume the same session in `project-b`, and expect 409;
- create a legacy session without `workspaceId`, resume it from `project-b`, and expect 409.

- [ ] **Step 6: Run Web tests to verify failure**

Run: `npm test -- tests/web-server.test.ts`

Expected: FAIL because Web resume does not check workspace ownership.

- [ ] **Step 7: Implement Web workspace binding**

In `createRun`, pass the validated workspace id to `createSession`. On resume, compare loaded session `workspaceId` to requested workspace id:

- matching id succeeds;
- existing id mismatch returns 409;
- missing id only succeeds when requested id is `''`.

- [ ] **Step 8: Verify Web tests**

Run: `npm test -- tests/web-server.test.ts`

Expected: PASS.

## Task 3: Local Time Formatting

**Files:**
- Create: `src/time.ts`
- Modify: `src/web/prompt-context.ts`
- Modify: `src/daily-summary.ts`
- Modify: `tests/web-prompt-context.test.ts`
- Modify: `tests/daily-summary.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that compare `buildAgentRuntime(root, localMidnightDate)` and daily summary entry formatting against local `Date#getFullYear`, `getMonth`, `getDate`, `getHours`, and `getMinutes` fields rather than UTC fields.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/web-prompt-context.test.ts tests/daily-summary.test.ts`

Expected: FAIL for dates where local day differs from UTC day in the current timezone.

- [ ] **Step 3: Implement local time helper**

Create `src/time.ts` with:

```typescript
export function formatLocalDate(date: Date): string
export function formatLocalDateTime(date: Date): string
```

Use those helpers in `buildAgentRuntime` and daily summary entry formatting.

- [ ] **Step 4: Verify**

Run: `npm test -- tests/web-prompt-context.test.ts tests/daily-summary.test.ts`

Expected: PASS.

## Task 4: File Read Boundary

**Files:**
- Modify: `src/config.ts`
- Modify: `src/tools/file-read.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/file-read.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert `createDefaultConfig('/tmp/project').readableRoots` equals `['/tmp/project']`, that `file_read` rejects an absolute path outside the readable root, and that a symlink resolving outside the readable root is rejected.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/config.test.ts tests/file-read.test.ts`

Expected: FAIL because `readableRoots` does not exist and outside reads currently succeed.

- [ ] **Step 3: Implement readable root support**

Add `readableRoots: string[]` to `AppConfig` and `createDefaultConfig`. In `file_read`, canonicalize configured readable roots, canonicalize the target path, and return a controlled failure when target is outside all readable roots.

- [ ] **Step 4: Verify**

Run: `npm test -- tests/config.test.ts tests/file-read.test.ts`

Expected: PASS.

## Task 5: Web Request Body Limit

**Files:**
- Modify: `tests/web-server.test.ts`
- Modify: `src/web/server.ts`

- [ ] **Step 1: Write failing tests**

Add Web server tests asserting:

- oversized `/api/runs` JSON body returns 413 with `Request body too large.`;
- invalid JSON still returns 400.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/web-server.test.ts`

Expected: FAIL because oversized bodies are currently buffered and parsed without a limit.

- [ ] **Step 3: Implement body limit**

Add `MAX_REQUEST_BODY_BYTES = 1_000_000`, throw a typed body-too-large error from `readRequestBody`, and map that error to HTTP 413 in JSON parsing routes.

- [ ] **Step 4: Verify**

Run: `npm test -- tests/web-server.test.ts`

Expected: PASS.

## Task 6: Full Verification

**Files:**
- No production files.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 3: Inspect diff**

Run: `git diff --stat`

Expected: only planned files plus already-existing UI spacing files are modified.

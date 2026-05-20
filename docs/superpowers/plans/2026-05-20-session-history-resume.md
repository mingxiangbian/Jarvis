# Session History + Resume Implementation Plan

> **For agentic workers:** implement task-by-task. Keep the checklist current. Do not mix this work with content-memory-summary changes.

**Goal:** Add project-local session history and resume for Web and REPL using `.cc-local/sessions/`, separate from `.cc-local/memory/`.

**Architecture:** Add `src/session-store.ts` as the storage boundary. Web and REPL call that boundary; neither writes transcript files directly. The Web server uses the store as canonical history and keeps its in-memory maps only for active runs.

**Tech Stack:** TypeScript, Node.js fs promises, JSONL, existing Web static frontend, Vitest.

---

## File Structure

- Create `src/session-store.ts`
  - Owns `.cc-local/sessions/` directory safety, `index.json`, JSONL append, list/load, title/preview generation, and resume trimming.
- Modify `src/config.ts`
  - Add `sessionResumeRecentMessages: 40`.
- Modify `src/web/server.ts`
  - Add session list/load APIs.
  - Persist Web runs through session store.
  - Use stored history when `sessionId` is supplied.
- Modify `src/web/static/index.html`
  - Add stable hooks for session history list items if missing.
- Modify `src/web/static/app.js`
  - Fetch, render, select, and continue stored sessions.
- Modify `src/web/static/styles.css`
  - Style compact history rows in the left sidebar.
- Modify `src/repl.ts`
  - Accept a loaded session seed and append future turns to the store.
- Modify `src/main.ts`
  - Add `--resume <session-id>` and reject it outside `--repl`.
- Create `tests/session-store.test.ts`
  - Unit coverage for storage behavior and safety.
- Modify `tests/web-server.test.ts`
  - API and persisted resume coverage.
- Modify `tests/repl.test.ts`
  - REPL resume and append coverage.
- Modify `tests/main-cli.test.ts`
  - CLI validation coverage.

---

## Task 1: Config for Resume Context Limit

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [x] **Step 1: Add failing config expectation**

In `tests/config.test.ts`, add:

```ts
expect(config.sessionResumeRecentMessages).toBe(40)
```

- [x] **Step 2: Run focused test**

```bash
npx vitest run tests/config.test.ts
```

Expected: fails because the config field does not exist.

- [x] **Step 3: Add config field**

In `AppConfig`:

```ts
sessionResumeRecentMessages: number
```

In `createDefaultConfig()`:

```ts
sessionResumeRecentMessages: 40,
```

- [x] **Step 4: Verify**

```bash
npx vitest run tests/config.test.ts
```

Expected: pass.

---

## Task 2: Session Store Core

**Files:**
- Create: `src/session-store.ts`
- Create: `tests/session-store.test.ts`

- [x] **Step 1: Write failing store tests**

Cover:

- creates `.cc-local/sessions/index.json` and `<id>.jsonl`.
- writes `session_meta`.
- appends `user_message` and `assistant_message`.
- title uses first user message, first line, whitespace collapsed, 40 char max, fallback `New chat`.
- preview uses latest user/assistant first line, 80 char max.
- `listSessions()` sorts by `updatedAt` descending.
- `loadSession()` returns all visible user/assistant messages.
- `loadSession()` returns only the last `sessionResumeRecentMessages` model messages.
- malformed JSONL lines are skipped.
- traversal ids and symlink files are rejected or ignored.

- [x] **Step 2: Run failing tests**

```bash
npx vitest run tests/session-store.test.ts
```

Expected: fails because `src/session-store.ts` does not exist.

- [x] **Step 3: Implement store types and helpers**

Implement:

```ts
type SessionMode = 'repl' | 'web' | 'cli'
interface SessionIndexItem
interface LoadedSession
type SessionEvent
```

Safety helpers:

- resolve project cwd with `realpath`.
- ensure `.cc-local/sessions/` is inside cwd.
- reject symlink dirs/files with `lstat`.
- validate id with a strict regex such as `/^[A-Za-z0-9_-]+$/`.
- use `O_NOFOLLOW` for append paths where practical.

- [x] **Step 4: Implement create/list/load/append**

Suggested exported functions:

```ts
createSession(input: {
  cwd: string
  mode: SessionMode
  model: string
  firstUserMessage?: ChatMessage
  now?: Date
  id?: string
}): Promise<SessionIndexItem>

appendSessionEvent(input: {
  cwd: string
  sessionId: string
  event: SessionEvent
}): Promise<void>

listSessions(cwd: string): Promise<SessionIndexItem[]>

loadSession(input: {
  cwd: string
  sessionId: string
  recentMessages: number
}): Promise<LoadedSession | null>
```

- [x] **Step 5: Verify**

```bash
npx vitest run tests/session-store.test.ts
```

Expected: pass.

---

## Task 3: Web Session APIs

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [x] **Step 1: Add failing API tests**

Add tests for:

- `GET /api/sessions` returns stored sessions sorted by `updatedAt`.
- `GET /api/sessions/:id` returns session metadata and visible messages.
- unknown session id returns 404.
- traversal-shaped id returns 404 or 400 without file access.

- [x] **Step 2: Run failing tests**

```bash
npx vitest run tests/web-server.test.ts
```

Expected: fails because routes do not exist.

- [x] **Step 3: Add routes**

In `routeRequest()`:

```ts
GET /api/sessions
GET /api/sessions/:id
```

Use `session-store` functions only; do not duplicate file IO in server.

- [x] **Step 4: Verify**

```bash
npx vitest run tests/web-server.test.ts tests/session-store.test.ts
```

Expected: pass.

---

## Task 4: Persist Web Runs

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [x] **Step 1: Add failing persistence tests**

Cover:

- run without `sessionId` creates a stored session and returns its id.
- current user message is appended before model call.
- assistant final answer is appended after success.
- run with existing `sessionId` loads stored history and appends to same JSONL.
- model receives current system prompt plus stored recent messages plus current user message.
- failed run appends an `error` event.

- [x] **Step 2: Run failing tests**

```bash
npx vitest run tests/web-server.test.ts
```

- [x] **Step 3: Replace canonical in-memory session behavior**

Keep `runs` in memory for active SSE streams. Treat stored sessions as canonical:

1. Parse request.
2. If `sessionId` exists, `loadSession()`.
3. Else `createSession()` with first user message.
4. Append current user event.
5. Build model messages from current system prompt + loaded recent model messages + user message.
6. Run agent.
7. Append assistant event on success or error event on failure.

- [x] **Step 4: Verify**

```bash
npx vitest run tests/web-server.test.ts tests/session-store.test.ts
```

Expected: pass.

---

## Task 5: Web Sidebar UI

**Files:**
- Modify: `src/web/static/index.html`
- Modify: `src/web/static/app.js`
- Modify: `src/web/static/styles.css`
- Modify: `tests/web-server.test.ts`

- [x] **Step 1: Add static contract tests**

Assert HTML/JS/CSS contain stable hooks and behavior terms:

- session list container.
- session item button class.
- `fetch('/api/sessions')`.
- `fetch('/api/sessions/' + ...)` or equivalent URL construction.
- active session id state.
- no visible rendering of raw session id.

- [x] **Step 2: Run failing tests**

```bash
npx vitest run tests/web-server.test.ts
```

- [x] **Step 3: Implement UI**

Behavior:

- On startup, load sessions and render left sidebar.
- New Chat clears messages and active session.
- Selecting a session loads visible messages and marks active row.
- Sending a prompt includes active `sessionId` when present.
- After run creation/final, refresh the session list.

- [x] **Step 4: Verify**

```bash
npx vitest run tests/web-server.test.ts
```

Expected: pass.

---

## Task 6: REPL Resume

**Files:**
- Modify: `src/repl.ts`
- Modify: `src/main.ts`
- Modify: `tests/repl.test.ts`
- Modify: `tests/main-cli.test.ts`

- [x] **Step 1: Add failing tests**

Cover:

- `--resume <id>` without `--repl` exits with a clear error.
- REPL with resume loads session model messages after current system prompt.
- resumed REPL appends user and assistant events to the same session.
- missing session id fails before entering the REPL loop.

- [x] **Step 2: Run failing tests**

```bash
npx vitest run tests/repl.test.ts tests/main-cli.test.ts
```

- [x] **Step 3: Implement CLI option**

In `main.ts`:

```text
--resume <session-id>
```

Validation:

- valid only with `--repl`.
- invalid with `--web`.
- invalid with one-shot prompt.

- [x] **Step 4: Implement REPL resume plumbing**

`runRepl()` should accept optional loaded session data or a `sessionId` plus store dependency.

Startup messages:

```ts
[{ role: 'system', content: systemPrompt }, ...loaded.modelMessages]
```

For each agent turn:

- append user event before running.
- append assistant event after success.
- append error event if the turn fails.

- [x] **Step 5: Verify**

```bash
npx vitest run tests/repl.test.ts tests/main-cli.test.ts tests/session-store.test.ts
```

Expected: pass.

---

## Task 7: Full Verification

- [x] **Step 1: Focused tests**

```bash
npx vitest run tests/session-store.test.ts tests/web-server.test.ts tests/repl.test.ts tests/main-cli.test.ts tests/config.test.ts
```

- [x] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [x] **Step 3: Full test suite**

```bash
npm test
```

- [x] **Step 4: Scope review**

Check:

```bash
git diff --stat
git diff -- src/session-store.ts src/web/server.ts src/repl.ts src/main.ts src/config.ts
git diff -- src/web/static/index.html src/web/static/app.js src/web/static/styles.css
```

Confirm:

- No transcript writes go to `.cc-local/memory/`.
- Store is the only module writing `.cc-local/sessions/`.
- Web visible history never displays raw session ids.
- System prompt is not stored in JSONL.
- Existing daily memory behavior is unchanged.

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-20-session-history-resume.md \
  docs/superpowers/specs/2026-05-20-session-history-resume-implementation.md \
  src tests
git commit -m "feat: add session history resume"
```

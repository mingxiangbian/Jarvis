# Session History + Resume Implementation

## Purpose

Implement the v1 session transcript store described in:

- `docs/superpowers/specs/2026-05-20-session-history-resume-design.md`

This implementation adds project-local conversation history for Web and REPL without mixing transcripts into `.cc-local/memory/`. It should make Web feel like a normal chat app with a history sidebar, and let REPL resume a known session id.

## Scope

Build:

- Project-local transcript store at `.cc-local/sessions/`.
- Session index for Web history list.
- JSONL event log for append-only transcript persistence.
- Web APIs to list and load sessions.
- Web run flow that persists user and assistant messages.
- Web UI history sidebar behavior.
- REPL `--resume <session-id>` support.
- Configurable resume context limit.

Do not build:

- Automatic long-term memory extraction from sessions.
- Model-generated titles.
- Global cross-project history.
- Semantic history search.
- Rename/delete session actions.
- Full visible tool-event replay in the Web chat area.

## Architecture

### Storage

Use:

```text
<project>/.cc-local/sessions/
  index.json
  <session-id>.jsonl
```

Keep this separate from:

```text
<project>/.cc-local/memory/
```

`sessions/` is transcript and audit history. `memory/` remains durable project memory.

### Session Store

Create `src/session-store.ts` as the only module that touches `.cc-local/sessions/`.

Core exports:

```ts
export interface SessionIndexItem {
  id: string
  title: string
  preview: string
  createdAt: string
  updatedAt: string
  messageCount: number
  mode: 'repl' | 'web' | 'cli'
  model: string
}

export interface LoadedSession {
  item: SessionIndexItem
  visibleMessages: ChatMessage[]
  modelMessages: ChatMessage[]
}

export type SessionEvent =
  | { type: 'session_meta'; id: string; createdAt: string; cwd: string; mode: SessionMode; model: string }
  | { type: 'user_message'; message: ChatMessage; createdAt: string }
  | { type: 'assistant_message'; message: ChatMessage; createdAt: string }
  | { type: 'tool_call'; toolCall: ModelToolCall; createdAt: string }
  | { type: 'tool_result'; toolCallId: string; content: string; ok: boolean; createdAt: string }
  | { type: 'error'; message: string; createdAt: string }
  | { type: 'compact_summary'; message: ChatMessage; createdAt: string }
```

Suggested functions:

```ts
createSession(input): Promise<SessionIndexItem>
appendSessionEvent(input): Promise<void>
listSessions(cwd): Promise<SessionIndexItem[]>
loadSession(input): Promise<LoadedSession | null>
```

The store owns:

- UUID generation.
- `index.json` creation and updates.
- JSONL append.
- Title generation from first user message.
- Preview update from latest user or assistant message.
- Message count updates.
- Resume context trimming.
- Symlink and path traversal protection.

### Config

Add:

```ts
sessionResumeRecentMessages: number
```

Default:

```ts
sessionResumeRecentMessages: 40
```

This controls how many recoverable messages are fed back to the model. Web may show full visible history, but model context stays bounded.

## Web Implementation

### APIs

Add:

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/sessions` | `{ sessions: SessionIndexItem[] }` |
| `GET` | `/api/sessions/:id` | `{ session: SessionIndexItem, messages: ChatMessage[] }` |
| `POST` | `/api/runs` | Existing shape, still returns `{ runId, sessionId }` |

Behavior:

1. `POST /api/runs` without `sessionId` creates a new stored session.
2. `POST /api/runs` with `sessionId` loads stored history and appends to that session.
3. Current user message is appended before the model run.
4. Final assistant message is appended after success.
5. Errors are appended as `error` events.
6. In-memory `sessions: Map` remains only a run-time cache; the store is canonical.

### UI

Update static Web UI to:

- Fetch `/api/sessions` on startup.
- Render history items with title, preview, and relative or formatted update time.
- Never display the session id.
- Highlight active session.
- Load visible messages via `/api/sessions/:id`.
- Use returned `sessionId` from `/api/runs` as active session.
- Let New Chat clear current messages and active session without creating a file until first send.

## REPL Implementation

Add CLI option:

```text
--resume <session-id>
```

Behavior:

1. `--resume` is only valid with `--repl`.
2. On startup, load the session from `session-store`.
3. Start REPL `messages` with the current system prompt plus loaded `modelMessages`.
4. Display a short restored-session notice with title, not id-heavy output.
5. New user input appends to the same stored session.
6. Final assistant answers append to the same stored session.

First version does not add `/sessions` or interactive `/resume`.

## Security Rules

The session store must:

- Create `.cc-local/sessions/` under the resolved project cwd.
- Reject session ids containing slashes, `..`, path separators, or unusual characters.
- Reject symlinked `sessions/`, `index.json`, and session files.
- Read only regular JSON/JSONL files.
- Skip malformed JSONL lines while loading.
- Never store the system prompt in transcript files.

## Testing Strategy

Add focused tests before implementation:

- `tests/session-store.test.ts`
  - creates session meta, index, and JSONL.
  - generates title and preview deterministically.
  - lists sessions by `updatedAt` descending.
  - loads visible messages and trimmed model messages.
  - skips malformed JSONL lines.
  - rejects traversal and symlink paths.
- `tests/web-server.test.ts`
  - `GET /api/sessions` lists stored sessions.
  - `GET /api/sessions/:id` returns visible messages.
  - Web run without `sessionId` creates a stored session.
  - Web run with `sessionId` appends and resumes canonical history.
  - missing session returns 404.
- `tests/repl.test.ts`
  - `--resume` setup loads recent model messages.
  - resumed REPL turn appends user and assistant events.
- `tests/main-cli.test.ts`
  - `--resume` without `--repl` is rejected.

## Acceptance Criteria

- Web history persists after server restart.
- Web sidebar shows title, preview, and updated time, not ids.
- Clicking a history item restores visible user/assistant messages.
- Sending after restore continues the same JSONL file.
- REPL can resume by session id and continue that transcript.
- Model context uses current system prompt plus recent resumed messages only.
- `.cc-local/memory/` is not used for transcript persistence.
- Full test suite and typecheck pass.

## Migration Notes

Existing in-memory Web sessions do not need migration. Existing `.cc-local/memory/sessions/*.md` summary files are legacy memory-summary artifacts and should not be read by this feature.

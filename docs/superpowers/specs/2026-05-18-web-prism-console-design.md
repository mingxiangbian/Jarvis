# Web Prism Console Design

## Goal

Add a first usable browser UI for `cc-local` without replacing the existing CLI or REPL.

The first version is a local Web Console: real agent execution in the browser, current-page multi-turn conversation, live tool status, and the approved Prism glass visual style. It should be useful quickly, while keeping the code structure ready for a future React/Vite or Figma-driven implementation.

## Non-Goals

- No Figma file generation in this phase.
- No React, Vite, Electron, or remote deployment.
- No cross-restart session persistence.
- No multi-agent board or multi-task workflow.
- No Live2D, complex mascot animation, or high-fidelity character rendering.
- No authentication or permission system beyond existing local tool behavior.

## Product Shape

The Web UI uses the selected A1 Operator Console structure:

- Center chat area is the primary workspace.
- Left sidebar is visible by default and resizable.
- Right inspector is hidden by default, opens manually, and is resizable.
- Tool state is visible without taking over the chat.
- Visual language follows the Prism style: soft glass, light neumorphism, pink/ice-blue/lavender glow, clean spacing, and restrained AI accents.

The Web UI should feel like a local professional tool, not a marketing page.

## Entry Point

Add a `--web` mode to the existing CLI:

```bash
cc-local --web --cwd <path>
```

Behavior:

- `--web`, `--repl`, and one-shot prompt mode are mutually exclusive.
- Default host is `127.0.0.1`.
- Default port is `4317`.
- Startup prints the local URL.
- `--cwd` controls the workspace root, as it does for CLI mode.

## Architecture

Use an embedded Node HTTP server and static frontend assets. Do not introduce a large frontend framework in this phase.

Planned files:

- `src/main.ts`
  - Adds `--web`.
  - Routes to Web, REPL, or one-shot mode.

- `src/web/server.ts`
  - Owns the local HTTP server.
  - Loads config, system prompt, rules, memories, and tools using the same logic as CLI mode.
  - Starts agent runs and exposes event streams.

- `src/web/web-observer.ts`
  - Implements `AgentObserver`.
  - Converts thinking/tool/final events into browser events.

- `src/web/static/index.html`
  - Static app shell.

- `src/web/static/styles.css`
  - Prism glass visual system.

- `src/web/static/app.js`
  - Client-side state, chat rendering, SSE handling, resizable panels, inspector toggles.

This keeps the first version simple, while isolating Web-specific code under `src/web/` so the frontend can later move to React/Vite without rewriting the agent loop.

## Data Flow

```text
Browser input
  -> POST /api/runs
  -> server creates a run
  -> runAgentLoop({ observer })
  -> web observer records events
  -> browser receives SSE events
  -> chat and tool timeline update
```

The browser sends user input with `POST /api/runs`. The server responds with a `runId`. The browser then opens `GET /api/runs/:runId/events` as an SSE stream for thinking, tool, final, and error events.

## API

### `GET /`

Returns the Web UI.

### `GET /static/*`

Returns static assets from `src/web/static/`.

### `POST /api/runs`

Starts one agent turn.

Request:

```json
{
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

Response:

```json
{
  "runId": "..."
}
```

The request includes the current page's conversation history. The server does not persist full sessions in this phase.

### `GET /api/runs/:runId/events`

SSE stream for a run.

Event types:

- `thinking_start`
- `thinking_stop`
- `tool_start`
- `tool_result`
- `final`
- `error`

Example event payload:

```json
{
  "type": "tool_result",
  "name": "glob",
  "ok": true,
  "durationMs": 143,
  "summary": "src/**/*.ts"
}
```

## Conversation Model

First version supports current-page multi-turn conversation:

- The browser keeps the visible message list in memory.
- Each turn sends the relevant messages to the server.
- `runAgentLoop` receives a `messages` array, so the agent can see previous turns during the active page session.

First version does not support persistent session recovery:

- Refreshing the page resets browser-held chat history.
- Restarting `cc-local --web` resets active runs.
- Historical session list, session naming, export, restore, and deletion are deferred.

This matches the current architecture: REPL already supports in-process multi-turn context, but the project does not yet have a persistent transcript/session subsystem.

## Layout

### Left Sidebar

Default state: open.

Contents:

- App identity and compact Prism mascot mark.
- Current workspace path.
- Current model name.
- Session status.
- Quick actions for new chat and clearing current page history.

Behavior:

- Resizable via drag handle.
- Has min and max widths.
- At minimum width, switches to icon-only labels.

### Center Chat

Default state: largest visible region.

Contents:

- User messages.
- Agent final answers.
- Inline thinking state.
- Compact tool timeline attached to each run.
- Input area fixed to bottom.

Behavior:

- Sending is disabled while a run is active.
- First version can omit cancel/stop if the existing agent loop lacks cancellation support.
- Empty state shows a small Prism mascot and short prompt suggestions.

### Right Inspector

Default state: hidden.

Open behavior: manual only.

Contents:

- `Context` tab: current workspace, approximate prompt/context summary, model/config facts.
- `Tools` tab: detailed current-run tool timeline.
- `Memory` tab: loaded memory sources and recent daily memory summary.

Behavior:

- Opened from a narrow right rail.
- Resizable when open.
- Does not auto-open on failures or memory changes.
- Tool failures are visible in the chat timeline; users can open the inspector for details.

## Visual Design

The visual direction follows the user's approved Prism style.

### Palette

- Background: fog white, ice white, pale cyan, soft pink, lavender.
- Primary accents: soft pink for active identity/mascot moments.
- Tool accents: ice cyan and glass blue.
- Context/AI accents: lavender.
- Text: deep gray-blue, not pure black.

### Surface Style

- Semi-transparent panels with subtle blur.
- Light neumorphic shadows.
- Thin translucent borders.
- Rounded panels around 18-24px.
- Buttons around 10-14px.
- Spacious grid alignment.

### Effects

- Soft global illumination.
- Slight glow around active states.
- Sparse particle/light-dot accents only in background regions.
- No noisy animation or decorative clutter.

### Mascot

First version uses a small Prism mascot presence:

- Empty chat state.
- Startup/welcome area.
- Optional compact identity mark in the sidebar.

The mascot must not dominate the chat area. High-fidelity image, Live2D, and complex animation are deferred.

## Event Rendering

The Web observer mirrors the terminal observer concept, but outputs structured events.

Expected UI behavior:

- Thinking state appears as a soft animated inline status.
- Tool starts append a timeline row with icon, name, and summary.
- Tool results update the row with success/failure and duration.
- Final answer appends to the chat.
- Errors append a visible but restrained error block.

Final answer text and UI status remain separate in the frontend state, matching the stdout/stderr separation already established in CLI mode.

## Error Handling

- Invalid JSON request returns `400`.
- Missing prompt/messages returns `400`.
- Unknown run ID returns `404`.
- Model/tool failures become `error` events where possible.
- Server startup port conflicts should produce a concise CLI error.

## Testing

Unit and integration coverage should focus on behavior, not screenshots.

Required tests:

- `--web` rejects conflicting prompt/REPL combinations.
- Web server serves the static shell.
- `POST /api/runs` creates a run.
- SSE stream emits thinking/tool/final events for a controlled fake model/tool path.
- Client-side JS can be kept simple enough for initial smoke coverage, or tested through server-level HTML/static assertions first.
- Existing CLI, REPL, and agent-loop tests continue to pass.

Manual visual QA:

- Open the local Web UI.
- Check desktop layout at wide and laptop-ish widths.
- Resize left sidebar.
- Open/close and resize right inspector.
- Run one no-tool prompt and one tool-using prompt.
- Confirm Prism style is clean, readable, and not cluttered.

## Deferred Work

- Persistent session storage.
- Session list, rename, delete, export.
- Full Figma design system.
- React/Vite migration.
- Better mascot asset or animation.
- Stop/cancel running agent turns.
- Remote access and authentication.
- Multi-agent or board workflows.

## Open Decisions Resolved

- Product direction: Web first, Figma later.
- First Web structure: A1 Operator Console.
- Side panels: left open by default, right hidden by default, both resizable.
- Right inspector behavior: manual only.
- Implementation strategy: embedded server with framework-free static frontend, organized for future migration.
- Scope level: minimum usable Web UI with real agent calls and enough Prism visual polish.

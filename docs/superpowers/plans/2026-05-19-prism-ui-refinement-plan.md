# Prism UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Prism web console into the approved compact-rail layout with a cleaner chat header, lightweight run status, Gemini-style composer, and Enter-to-send behavior.

**Architecture:** Keep the feature client-side. The server API and run model stay unchanged; HTML defines the new controls, JavaScript owns UI state and run-status routing, and CSS drives rail/inspector layout plus animation states through `.app-shell` classes.

**Tech Stack:** Static HTML/CSS/JavaScript served by the existing Node web server, Vitest for static/server regression checks, TypeScript typecheck for the repo.

---

## File Structure

- `src/web/static/index.html`: Move `New chat` into the sidebar, add sidebar rail controls, add right-edge Inspector opener, add header status region, and remove unused left nav items.
- `src/web/static/app.js`: Add sidebar collapsed state, right Inspector edge toggle state, header run-status updates, shared new-chat reset, and textarea keyboard handling.
- `src/web/static/styles.css`: Add compact rail layout, remove heavy panel shadows, hide redundant controls by state, add gradient run line, and restyle the composer as a rounded capsule.
- `tests/web-server.test.ts`: Extend existing static asset tests to pin the intended UI contract without introducing a browser test framework.

## Task 1: Static UI Contract Tests

**Files:**
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Extend the static shell test**

Add expectations to the existing `serves the static shell from GET /` test:

```ts
expect(body).toContain('id="sidebarToggle"')
expect(body).toContain('id="sidebarRail"')
expect(body).toContain('id="railNewChatButton"')
expect(body).toContain('id="headerStatus"')
expect(body).toContain('id="inspectorEdgeToggle"')
expect(body).not.toContain('href="#context"')
expect(body).not.toContain('href="#tools"')
```

- [ ] **Step 2: Extend the visual system CSS test**

Add expectations to `serves the Prism visual system from GET /static/styles.css`:

```ts
expect(body).toContain('.app-shell.sidebar-collapsed')
expect(body).toContain('.inspector-edge-toggle')
expect(body).toContain('.run-status-line')
expect(body).toContain('@keyframes prismFocus')
expect(body).toContain('@keyframes statusFlow')
expect(body).toContain('box-shadow: none')
```

- [ ] **Step 3: Add a static JavaScript behavior test**

Add a new test after the CSS test:

```ts
it('serves refined Web UI interaction code from GET /static/app.js', async () => {
  const server = await startServer()

  const response = await fetch(`${server.url}/static/app.js`)
  const body = await response.text()

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/javascript')
  expect(body).toContain('sidebarCollapsed')
  expect(body).toContain('setSidebarCollapsed')
  expect(body).toContain('headerStatus')
  expect(body).toContain('event.key === \\'Enter\\'')
  expect(body).toContain('event.shiftKey')
  expect(body).toContain('updateRunStatus(\\'Thinking...\\')')
})
```

- [ ] **Step 4: Run the focused failing tests**

Run:

```bash
npm test -- tests/web-server.test.ts
```

Expected before implementation: the new static assertions fail because the markup, CSS classes, and JavaScript state do not exist yet.

## Task 2: HTML Structure

**Files:**
- Modify: `src/web/static/index.html`

- [ ] **Step 1: Replace the sidebar content**

Change the sidebar so it contains a top bar with a collapse button, a `New chat` button above `Console`, and no `Context` or `Tools` links. Add a collapsed rail sibling inside the same sidebar.

The target structure inside `<aside id="sidebar" ...>` is:

```html
<div class="sidebar-full">
  <div class="brand-row">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true"></div>
      <div>
        <h1>Prism Console</h1>
        <p>Local agent runs</p>
      </div>
    </div>
    <button id="sidebarToggle" class="icon-button icon-only" type="button" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar">
      <span aria-hidden="true">‹</span>
    </button>
  </div>

  <nav class="nav-list" aria-label="Primary">
    <button id="newChatButton" class="nav-action" type="button">New chat</button>
    <a class="nav-item is-active" href="#chat">Console</a>
  </nav>

  <section class="sidebar-card" aria-label="Session">
    <p class="eyebrow">Current session</p>
    <h2>Page-local chat</h2>
    <p>Messages stay in this tab.</p>
  </section>
</div>

<div id="sidebarRail" class="sidebar-rail" aria-label="Collapsed workspace">
  <button id="railSidebarToggle" class="rail-button" type="button" aria-label="Expand sidebar" aria-expanded="false" title="Expand sidebar">
    <span aria-hidden="true">›</span>
  </button>
  <button id="railNewChatButton" class="rail-button" type="button" aria-label="New chat" title="New chat">
    <span aria-hidden="true">＋</span>
  </button>
  <a class="rail-button is-active" href="#chat" aria-label="Console" title="Console">
    <span aria-hidden="true">⌁</span>
  </a>
</div>
```

- [ ] **Step 2: Replace chat header actions and add status**

Remove `New chat` and `Inspector` buttons from `.chat-header`. Add a status region under the title:

```html
<div class="chat-title">
  <p class="eyebrow">Prism Web UI</p>
  <h2>Agent run console</h2>
  <div class="run-status-row" aria-live="polite">
    <span id="headerStatus" class="run-status-text">Ready</span>
  </div>
  <div class="run-status-line" aria-hidden="true"></div>
</div>
```

- [ ] **Step 3: Add right-edge Inspector opener**

Add this button between the chat section and Inspector aside:

```html
<button id="inspectorEdgeToggle" class="inspector-edge-toggle" type="button" aria-controls="inspector" aria-expanded="false" aria-label="Open inspector" title="Open inspector">
  <span aria-hidden="true">‹</span>
</button>
```

- [ ] **Step 4: Run the focused static test**

Run:

```bash
npm test -- tests/web-server.test.ts -t "serves the static shell"
```

Expected: static shell assertions pass; CSS and JavaScript assertions are handled by Tasks 3 and 4.

## Task 3: Client-Side Interaction

**Files:**
- Modify: `src/web/static/app.js`

- [ ] **Step 1: Add element references and state**

Add references:

```js
const sidebarToggle = document.querySelector('#sidebarToggle')
const railSidebarToggle = document.querySelector('#railSidebarToggle')
const railNewChatButton = document.querySelector('#railNewChatButton')
const inspectorEdgeToggle = document.querySelector('#inspectorEdgeToggle')
const headerStatus = document.querySelector('#headerStatus')
```

Add state fields:

```js
sidebarCollapsed: false,
inspectorOpen: false,
runStatus: 'Ready'
```

- [ ] **Step 2: Share new-chat reset behavior**

Create `resetChat()` and wire both new-chat buttons to it:

```js
newChatButton?.addEventListener('click', resetChat)
railNewChatButton?.addEventListener('click', resetChat)

function resetChat() {
  if (state.activeRun) {
    return
  }
  state.sessionId = null
  state.messages = []
  state.tools = []
  state.liveStatusNode = null
  updateRunStatus('Ready')
  setSending(false)
  renderEmptyState()
  renderInspector()
  if (promptInput) {
    promptInput.value = ''
    promptInput.focus()
  }
}
```

- [ ] **Step 3: Add sidebar and Inspector state functions**

Add:

```js
sidebarToggle?.addEventListener('click', () => setSidebarCollapsed(true))
railSidebarToggle?.addEventListener('click', () => setSidebarCollapsed(false))
inspectorEdgeToggle?.addEventListener('click', () => setInspectorOpen(true))
inspectorClose?.addEventListener('click', () => setInspectorOpen(false))

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed
  appShell?.classList.toggle('sidebar-collapsed', collapsed)
  sidebarToggle?.setAttribute('aria-expanded', String(!collapsed))
  sidebarToggle?.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
  railSidebarToggle?.setAttribute('aria-expanded', String(!collapsed))
}

function setInspectorOpen(open) {
  state.inspectorOpen = open
  appShell?.classList.toggle('inspector-open', open)
  inspector?.classList.toggle('is-open', open)
  inspector?.setAttribute('aria-hidden', String(!open))
  inspectorEdgeToggle?.setAttribute('aria-expanded', String(open))
}
```

- [ ] **Step 4: Move status updates out of message stream**

Replace `updateStatus(...)` calls in `handleRunEvent` with `updateRunStatus(...)`. Keep `finishWithError` as an error message in the chat stream.

Add:

```js
function updateRunStatus(text) {
  state.runStatus = text
  if (headerStatus) {
    headerStatus.textContent = text
  }
}
```

In `setSending`, toggle the animation class:

```js
appShell?.classList.toggle('run-active', isSending)
```

- [ ] **Step 5: Add Enter-to-send**

Add:

```js
promptInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendPrompt()
  }
})
```

- [ ] **Step 6: Run the focused JavaScript static test**

Run:

```bash
npm test -- tests/web-server.test.ts -t "interaction code"
```

Expected: interaction code assertions pass.

## Task 4: CSS Refinement

**Files:**
- Modify: `src/web/static/styles.css`

- [ ] **Step 1: Add layout variables and rail state**

Update root/app shell styles:

```css
:root {
  --sidebar-width: 280px;
  --sidebar-rail-width: 64px;
  --inspector-width: 320px;
}

.app-shell {
  grid-template-columns: var(--sidebar-width) 12px minmax(0, 1fr) 44px 0;
}

.app-shell.sidebar-collapsed {
  grid-template-columns: var(--sidebar-rail-width) 0 minmax(0, 1fr) 44px 0;
}

.app-shell.inspector-open {
  grid-template-columns: var(--sidebar-width) 12px minmax(0, 1fr) 0 var(--inspector-width);
}

.app-shell.sidebar-collapsed.inspector-open {
  grid-template-columns: var(--sidebar-rail-width) 0 minmax(0, 1fr) 0 var(--inspector-width);
}
```

- [ ] **Step 2: Remove heavy panel shadows**

Set panel shadow to none:

```css
.glass-panel {
  box-shadow: none;
}
```

Keep smaller control glows only where useful.

- [ ] **Step 3: Style expanded sidebar and rail**

Add styles for `.sidebar-full`, `.brand-row`, `.sidebar-rail`, `.rail-button`, `.nav-action`, and collapsed visibility:

```css
.sidebar-full {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 24px;
}

.sidebar-rail {
  display: none;
}

.app-shell.sidebar-collapsed .sidebar {
  padding: 12px;
}

.app-shell.sidebar-collapsed .sidebar-full {
  display: none;
}

.app-shell.sidebar-collapsed .sidebar-rail {
  display: grid;
}
```

- [ ] **Step 4: Hide resize handle and edge toggle by state**

Collapsed left rail hides the resize handle. Open Inspector hides the edge opener:

```css
.app-shell.sidebar-collapsed .left-resize-handle {
  visibility: hidden;
  pointer-events: none;
}

.app-shell.inspector-open .inspector-edge-toggle {
  display: none;
}
```

- [ ] **Step 5: Add run status line and composer animation**

Add `statusFlow` and `prismFocus` keyframes. Style `.run-status-line` so it animates only under `.run-active`. Restyle `.composer` and `#promptInput` as a borderless rounded capsule with focus animation.

- [ ] **Step 6: Run the focused CSS static test**

Run:

```bash
npm test -- tests/web-server.test.ts -t "visual system"
```

Expected: visual system assertions pass.

## Task 5: Full Verification And Browser QA

**Files:**
- No planned source edits unless verification finds issues.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm test
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 2: Start the web server**

Run:

```bash
npm run dev -- --web --port 4317
```

Expected: output contains `cc-local web listening at http://127.0.0.1:4317`.

- [ ] **Step 3: Browser QA**

Verify in the browser:

- Default layout shows expanded left sidebar and closed right Inspector edge button.
- Left collapse changes the sidebar to an icon rail and widens chat.
- Left expand restores the full sidebar.
- `New chat` works from full sidebar and rail.
- Right edge button opens Inspector; external edge button disappears.
- Inspector close returns the edge button.
- Composer focus glow animates subtly.
- `Enter` sends; `Shift + Enter` inserts newline.
- Run status appears in the header/status zone instead of as a chat status bubble.
- No console errors.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add tests/web-server.test.ts src/web/static/index.html src/web/static/app.js src/web/static/styles.css
git commit -m "feat: refine prism web ui"
```

Expected: commit succeeds.

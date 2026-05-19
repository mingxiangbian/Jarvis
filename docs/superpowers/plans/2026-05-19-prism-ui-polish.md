# Prism UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Prism web console UI so the left sidebar blocks are centered, the deeper prism background separates white glass panels, the Inspector opener lives inside the chat panel without cutting the status light band, and the composer send/focus treatment is visually balanced.

**Architecture:** This is a static web shell refinement. Keep backend API behavior unchanged; update the HTML contract, client-side selectors/state wiring, CSS layout/visual tokens, and existing static web server tests.

**Tech Stack:** TypeScript, Vitest, static HTML/CSS/JavaScript served by `src/web/server.ts`.

---

## File Structure

- Modify `tests/web-server.test.ts`: update static HTML/CSS/JS contract checks for the new layout.
- Modify `src/web/static/index.html`: remove redundant Console controls, move the Inspector opener into the chat header, and keep existing element ids where behavior depends on them.
- Read `src/web/static/app.js`: keep current behavior and existing ids so Inspector open/close, New chat, and keyboard send wiring continue to work without client-side behavior changes.
- Modify `src/web/static/styles.css`: implement deeper B-style prism background, centered sidebar blocks with left-aligned text, stronger panel contrast without heavy shadows, top-right Inspector opener placement, uninterrupted status line, and centered composer send button.

Do not modify backend run APIs or persistence behavior.

---

### Task 1: Update Static UI Contract Tests

**Files:**
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing HTML contract assertions**

In `tests/web-server.test.ts`, update the `serves the static shell from GET /` assertions so they require the new markup contract:

```ts
expect(body).toContain('id="sidebar"')
expect(body).toContain('id="messages"')
expect(body).toContain('id="inspector"')
expect(body).toContain('id="leftResizeHandle"')
expect(body).toContain('id="sidebarToggle"')
expect(body).toContain('id="sidebarRail"')
expect(body).toContain('id="railNewChatButton"')
expect(body).toContain('id="headerStatus"')
expect(body).toContain('id="inspectorEdgeToggle"')
expect(body).toContain('class="chat-actions"')
expect(body).not.toContain('href="#context"')
expect(body).not.toContain('href="#tools"')
expect(body).not.toContain('href="#chat">Console</a>')
expect(body).not.toContain('aria-label="Console"')
```

- [ ] **Step 2: Write failing CSS contract assertions**

In the `serves the Prism visual system from GET /static/styles.css` test, replace the old Inspector edge-column expectations with deeper-background and header-contained opener checks:

```ts
expect(body).toContain('--pink: #f7a8cf')
expect(body).toContain('--warm: #ffe082')
expect(body).toContain('backdrop-filter')
expect(body).toContain('min-width: 1180px')
expect(body).toContain('.left-resize-handle')
expect(body).toContain('.inspector.is-open')
expect(body).toContain('.app-shell.sidebar-collapsed')
expect(body).toContain('.chat-actions')
expect(body).toContain('.inspector-edge-toggle')
expect(body).toContain('.run-status-line')
expect(body).toContain('@keyframes prismFocus')
expect(body).toContain('@keyframes statusFlow')
expect(body).toContain('linear-gradient(135deg, #e2eef9 0%, #f0f7ff 45%, #ffeaf6 100%)')
expect(body).toContain('box-shadow: none')
```

- [ ] **Step 3: Write failing JS contract assertions**

In `serves refined Web UI interaction code from GET /static/app.js`, keep the current behavior checks and add the Inspector state check:

```ts
expect(body).toContain('sidebarCollapsed')
expect(body).toContain('setSidebarCollapsed')
expect(body).toContain('setInspectorOpen')
expect(body).toContain('headerStatus')
expect(body).toContain('event.key === \'Enter\'')
expect(body).toContain('event.shiftKey')
expect(body).toContain('updateRunStatus(\'Thinking...\')')
```

- [ ] **Step 4: Run the focused test to verify it fails**

Run:

```bash
mkdir -p /tmp/project
/Users/phoenix/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run tests/web-server.test.ts
```

Expected: FAIL because `class="chat-actions"` is missing, redundant Console controls still exist, and CSS has the old background/edge-grid contract.

- [ ] **Step 5: Commit the failing test contract**

```bash
git add tests/web-server.test.ts
git commit -m "test: update prism polish ui contract"
```

---

### Task 2: Update HTML Structure For Sidebar And Inspector Opener

**Files:**
- Modify: `src/web/static/index.html`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Remove redundant expanded sidebar Console nav**

In `src/web/static/index.html`, replace the current expanded sidebar nav:

```html
<nav class="nav-list" aria-label="Primary">
  <button id="newChatButton" class="nav-action" type="button">New chat</button>
  <a class="nav-item is-active" href="#chat">Console</a>
</nav>
```

with:

```html
<div class="nav-list" aria-label="Primary">
  <button id="newChatButton" class="nav-action" type="button">New chat</button>
</div>
```

- [ ] **Step 2: Remove redundant collapsed rail Console icon**

In `src/web/static/index.html`, replace:

```html
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

with:

```html
<div id="sidebarRail" class="sidebar-rail" aria-label="Collapsed workspace">
  <button id="railSidebarToggle" class="rail-button" type="button" aria-label="Expand sidebar" aria-expanded="false" title="Expand sidebar">
    <span aria-hidden="true">›</span>
  </button>
  <button id="railNewChatButton" class="rail-button" type="button" aria-label="New chat" title="New chat">
    <span aria-hidden="true">＋</span>
  </button>
</div>
```

- [ ] **Step 3: Move Inspector opener into the chat header**

In `src/web/static/index.html`, replace the chat header:

```html
<header class="chat-header">
  <div class="chat-title">
    <p class="eyebrow">Prism Web UI</p>
    <h2>Agent run console</h2>
    <div class="run-status-row" aria-live="polite">
      <span id="headerStatus" class="run-status-text">Ready</span>
    </div>
    <div class="run-status-line" aria-hidden="true"></div>
  </div>
</header>
```

with:

```html
<header class="chat-header">
  <div class="chat-title">
    <p class="eyebrow">Prism Web UI</p>
    <h2>Agent run console</h2>
    <div class="run-status-row" aria-live="polite">
      <span id="headerStatus" class="run-status-text">Ready</span>
    </div>
    <div class="run-status-line" aria-hidden="true"></div>
  </div>
  <div class="chat-actions">
    <button id="inspectorEdgeToggle" class="inspector-edge-toggle" type="button" aria-controls="inspector" aria-expanded="false" aria-label="Open inspector" title="Open inspector">
      <span aria-hidden="true">‹</span>
    </button>
  </div>
</header>
```

Then remove the old standalone opener block after `</section>`:

```html
<button id="inspectorEdgeToggle" class="inspector-edge-toggle" type="button" aria-controls="inspector" aria-expanded="false" aria-label="Open inspector" title="Open inspector">
  <span aria-hidden="true">‹</span>
</button>
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
mkdir -p /tmp/project
/Users/phoenix/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run tests/web-server.test.ts
```

Expected: HTML assertions for removed Console controls pass; CSS assertions still fail until Task 3.

- [ ] **Step 5: Commit HTML structure**

```bash
git add src/web/static/index.html
git commit -m "feat: refine prism shell structure"
```

---

### Task 3: Implement CSS Polish

**Files:**
- Modify: `src/web/static/styles.css`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Add the warm accent token and deepen the background**

In `:root`, add:

```css
--warm: #ffe082;
--panel: rgba(255, 255, 255, 0.78);
--panel-strong: rgba(255, 255, 255, 0.9);
```

Replace `body` background with the selected B direction:

```css
body {
  min-width: 1180px;
  min-height: 100vh;
  margin: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 15% 10%, rgba(247, 168, 207, 0.38), transparent 32%),
    radial-gradient(circle at 82% 18%, rgba(93, 220, 255, 0.42), transparent 34%),
    radial-gradient(circle at 50% 96%, rgba(203, 189, 255, 0.32), transparent 32%),
    linear-gradient(135deg, #e2eef9 0%, #f0f7ff 45%, #ffeaf6 100%);
}
```

- [ ] **Step 2: Remove the external Inspector grid column**

Replace the `.app-shell` grid rules with:

```css
.app-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: var(--sidebar-width) 12px minmax(0, 1fr) 0;
  gap: 12px;
  height: 100vh;
  padding: 18px;
  transition: grid-template-columns 160ms ease;
}

.app-shell.sidebar-collapsed {
  grid-template-columns: var(--sidebar-rail-width) 0 minmax(0, 1fr) 0;
}

.app-shell.inspector-open {
  grid-template-columns: var(--sidebar-width) 12px minmax(0, 1fr) var(--inspector-width);
}

.app-shell.sidebar-collapsed.inspector-open {
  grid-template-columns: var(--sidebar-rail-width) 0 minmax(0, 1fr) var(--inspector-width);
}
```

Update the matching `@media (max-width: 1120px)` grid rules to use the same four-column shape.

- [ ] **Step 3: Strengthen panel contrast without heavy shadows**

Update `.glass-panel`:

```css
.glass-panel {
  border: 1px solid rgba(255, 255, 255, 0.86);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
}
```

Keep large surface external shadows absent. If small controls keep shadow, use only subtle control-level shadow.

- [ ] **Step 4: Center sidebar blocks while keeping text left-aligned**

Update sidebar nav and card rules:

```css
.nav-list {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.nav-action {
  width: min(100%, 220px);
  margin-inline: auto;
  border: 1px solid rgba(255, 255, 255, 0.78);
  font-weight: 700;
  background: linear-gradient(135deg, rgba(247, 168, 207, 0.42), rgba(174, 239, 255, 0.48));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  text-align: left;
}

.sidebar-card {
  display: flex;
  width: min(100%, 220px);
  min-height: 118px;
  flex-direction: column;
  justify-content: center;
  margin: auto auto 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.56);
}
```

Update collapsed rail rows from three buttons to two:

```css
.app-shell.sidebar-collapsed .sidebar-rail {
  display: grid;
  min-height: 0;
  grid-template-rows: repeat(2, 40px) minmax(0, 1fr);
  gap: 10px;
  place-items: center;
}
```

- [ ] **Step 5: Place Inspector opener in the header without truncating the light band**

Update header/action/status styles:

```css
.chat-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
  padding: 20px 22px;
}

.chat-title {
  min-width: 0;
  width: 100%;
}

.chat-actions {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: start;
  padding-top: 2px;
}

.inspector-edge-toggle {
  display: grid;
  width: 40px;
  min-width: 40px;
  min-height: 40px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

.app-shell.inspector-open .inspector-edge-toggle {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}
```

Do not set the opener to `width: 0` in open state. It is no longer a grid column, so width collapse is not needed.

- [ ] **Step 6: Keep status and composer light bands thin but more visible**

Update the status line and composer focus:

```css
.run-status-line {
  width: 100%;
  height: 2px;
  margin-top: 12px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(247, 168, 207, 0.28), rgba(174, 239, 255, 0.28), rgba(203, 189, 255, 0.28));
  opacity: 0.9;
  overflow: hidden;
}

.run-status-line::before {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, rgba(247, 168, 207, 0.95), rgba(174, 239, 255, 0.95), rgba(203, 189, 255, 0.9), transparent);
  content: "";
  opacity: 0;
  transform: translateX(-110%);
}

.composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin: 0 22px 20px;
  padding: 8px;
  border: 1px solid rgba(117, 139, 166, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
}

.composer:focus-within {
  border-color: rgba(174, 239, 255, 0.84);
  animation: prismFocus 3.6s ease-in-out infinite;
  background: rgba(255, 255, 255, 0.86);
}

.send-button {
  align-self: center;
  min-width: 76px;
  padding: 0 20px;
  color: #223044;
  font-weight: 700;
  background: linear-gradient(135deg, rgba(247, 168, 207, 0.95), rgba(174, 239, 255, 0.94));
  box-shadow: 0 8px 18px rgba(135, 155, 184, 0.16);
}

@keyframes prismFocus {
  0%,
  100% {
    box-shadow: 0 0 0 2px rgba(174, 239, 255, 0.46), 0 0 20px rgba(247, 168, 207, 0.18);
  }

  45% {
    box-shadow: 0 0 0 2px rgba(247, 168, 207, 0.46), 0 0 22px rgba(174, 239, 255, 0.2);
  }

  70% {
    box-shadow: 0 0 0 2px rgba(255, 224, 130, 0.42), 0 0 20px rgba(203, 189, 255, 0.18);
  }
}
```

- [ ] **Step 7: Run the focused test**

Run:

```bash
mkdir -p /tmp/project
/Users/phoenix/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run tests/web-server.test.ts
```

Expected: PASS for `tests/web-server.test.ts`.

- [ ] **Step 8: Commit CSS polish**

```bash
git add src/web/static/styles.css tests/web-server.test.ts
git commit -m "feat: polish prism web styling"
```

---

### Task 4: Verify Behavior And Browser QA

**Files:**
- Read: `src/web/static/index.html`
- Read: `src/web/static/app.js`
- Read: `src/web/static/styles.css`
- Test: all project tests

- [ ] **Step 1: Run all automated tests**

Run:

```bash
mkdir -p /tmp/project
/Users/phoenix/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
/Users/phoenix/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Start the web console**

Run:

```bash
/Users/phoenix/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/tsx/dist/cli.mjs src/main.ts --web --port 4317
```

Expected:

```text
cc-local web listening at http://127.0.0.1:4317
```

- [ ] **Step 4: Browser QA the default layout**

Open `http://127.0.0.1:4317/` and verify:

- Left sidebar is expanded.
- `New chat` block is centered as a block, with left-aligned text.
- Current session card is centered as a block, with left-aligned text vertically centered inside the card.
- Expanded and collapsed sidebars do not show a redundant Console item/icon.
- Background uses the deeper colorful glow and the panels separate clearly without heavy shadows.
- Inspector opener appears inside the chat panel top-right.
- Header/status light band is not clipped, hidden, or truncated by the Inspector opener.
- Send button is vertically centered in the composer.
- Composer focus band remains thin and visibly colorful.

- [ ] **Step 5: Browser QA interactions**

In the browser:

1. Click the left collapse control.
2. Verify the sidebar becomes a narrow rail with only expand and new-chat actions.
3. Click the rail expand control.
4. Verify the full sidebar returns.
5. Click the Inspector opener.
6. Verify the Inspector appears and the opener disappears.
7. Click the Inspector close button.
8. Verify the Inspector disappears and the opener returns.
9. Focus the prompt input.
10. Type `alpha`, press `Shift + Enter`, type `beta`.
11. Verify the textarea value contains `alpha\nbeta`.
12. Press `Enter`.
13. Verify a run starts or the expected model/server error appears without breaking layout.

- [ ] **Step 6: Stop the dev server**

If the server was started by this task and is still running, stop it before finishing:

```bash
lsof -tiTCP:4317 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 7: Check for follow-up work**

Run:

```bash
git status --short
```

Expected: no uncommitted changes after verification. If browser QA reveals a layout issue, return to Task 3, make the smallest CSS or HTML correction, rerun Task 4 from Step 1, then commit the correction with:

```bash
git add src/web/static/index.html src/web/static/styles.css tests/web-server.test.ts
git commit -m "fix: tighten prism ui polish"
```

---

## Review Checklist

Before calling the implementation complete, verify each spec requirement maps to a result:

- Sidebar `New chat` block is centered, with text left-aligned.
- Sidebar session card block is centered, with text left-aligned and vertically centered.
- Expanded and collapsed redundant Console controls are gone.
- Background follows B deeper colorful glow.
- Panels are separated through background, fill, borders, and inner highlight, not heavy shadows.
- Inspector opener is in the chat panel top-right and does not truncate the status light band.
- Composer send button is vertically centered.
- Composer focus band is thin and colorful.
- `Enter` and `Shift + Enter` behavior still works.
- Tests and typecheck pass.
- Browser QA passes at `http://127.0.0.1:4317/`.

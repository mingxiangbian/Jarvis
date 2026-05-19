# Prism UI Refinement Design

Date: 2026-05-19

## Goal

Refine the Prism web console UI after the first Web/Figma-ready shell landed. The goal is to keep the current soft prism, glassmorphism, and daily-product feel while making the workspace cleaner, more chat-focused, and less visually heavy.

This spec covers the selected **A. Compact rails** direction from the visual companion.

## User-Approved Direction

Use a compact-rail layout:

- The left workspace sidebar can collapse into a narrow rail.
- The right Inspector stays hidden by default and exposes only one edge expand button.
- The chat area becomes the visual center and gains space when side surfaces are collapsed.
- The input composer should feel closer to ChatGPT/Gemini: clean, rounded, integrated with the background, and animated on focus.
- Thinking feedback should remain visible, but as a lightweight header/status treatment rather than a heavy message in the chat stream.

## Scope

In scope:

- Static web UI markup in `src/web/static/index.html`.
- Client-side UI state and keyboard interaction in `src/web/static/app.js`.
- Styling and animations in `src/web/static/styles.css`.
- Focused browser QA and existing automated tests.

Out of scope:

- Backend run API changes.
- Agent behavior changes.
- Multi-session persistence.
- User account, cloud sync, or cross-tab history.
- Figma export automation in this pass.

## Layout

### Left Sidebar

The left sidebar has two states.

Expanded state:

- Shows the brand area.
- Shows a prominent `New chat` action above `Console`.
- Shows only the useful `Console` navigation item.
- Removes the unused `Context` and `Tools` left-nav items.
- Keeps the current session card only if it still fits cleanly; it can be shortened if it adds visual clutter.
- Includes a collapse icon button using the same glass/prism visual language.

Collapsed state:

- Becomes a narrow rail, not a fully hidden panel.
- Shows icon-only controls:
  - expand/collapse sidebar
  - new chat
  - console
- Uses accessible labels and titles for icon-only buttons.
- Does not show long text labels.
- Allows the center chat area to expand.

The left resize handle remains useful only in expanded state. In collapsed state it should be hidden or disabled so the rail does not feel draggable.

### Right Inspector

Default state:

- Inspector is closed.
- Only one right-edge glass icon button is visible.
- The button should be visually light and aligned with the existing prism style.

Open state:

- The external right-edge expand button disappears.
- The Inspector panel appears.
- The Inspector keeps its internal close button.
- The Inspector remains the place for run details and tool activity.
- The panel should not use heavy card shadow.

The current right-side Inspector can retain its run-details role. It does not need to become a general navigation surface.

## Header And Status

The chat header should be cleaner:

- Remove `New chat` from the chat header because it moves to the left sidebar.
- Keep the title area compact.
- Keep a lightweight run status zone near the title.
- Remove the visible bottom divider line from the header/composer structure where it makes the UI feel boxed in.

Thinking and run status should remain visible:

- `Thinking...`, `Using <tool>...`, and `Thought for <duration>` should be shown as lightweight status text near the header.
- During active thinking or tool work, a thin animated gradient line appears under the title/status area.
- The gradient line uses the existing pink, cyan, and lavender palette.
- Status text should not appear as a normal chat message unless it is an error.
- Final assistant answers still render in the message stream.

## Composer

The composer should shift from framed form to rounded command capsule:

- No heavy containing box.
- No strong top divider line.
- The textarea sits inside a rounded pill/capsule surface.
- The capsule visually blends with the background using glass fill, soft border, and subtle blur.
- Focus state uses a gentle animated prism glow, inspired by Gemini/Google-style color motion.
- The animation should be subtle and professional, not noisy.
- The send button remains available inside or attached to the capsule.

Keyboard behavior:

- `Enter` sends the prompt.
- `Shift + Enter` inserts a newline.
- Empty prompts do not send.
- During an active run, sending remains disabled.

## Visual Styling

Keep:

- Soft prism palette from the current design: pink, cyan, lavender, white/ice background.
- Glassmorphism and light neumorphic cues.
- Generous spacing and clear grid alignment.
- Apple-like product cleanliness.

Change:

- Remove obvious drop shadows from the center chat panel and right Inspector.
- Use border, translucency, blur, and soft background light to preserve depth.
- Keep rounded design, but avoid making controls look bulky.
- Reduce redundant buttons and text labels.

The result should feel cleaner, more professional, and more like a daily-use AI console than a decorative dashboard.

## Component Changes

### Sidebar Controls

Add a sidebar collapse/expand control:

- Expanded sidebar: shows a collapse icon.
- Collapsed rail: shows an expand icon.
- Icons can be CSS-drawn or lightweight inline SVG in the static HTML.
- Use accessible text via `aria-label`.

Move `New chat`:

- From chat header to the left sidebar.
- Place it above `Console`.
- In collapsed rail, use icon-only new-chat control.
- It must keep the existing behavior: reset local session state when no run is active; no-op while a run is active.

### Inspector Toggle

Move the Inspector opener out of the chat header into a right-edge control:

- Closed state: edge opener visible.
- Open state: edge opener hidden.
- Internal close button remains visible.

### Run Status

Replace status-as-message behavior:

- `thinking_start`, `thinking_stop`, `tool_start`, and `tool_result` update the header/status area.
- `tool_start` and `tool_result` still update Inspector tool history.
- `final` appends assistant output to messages.
- `error` appends an error message to messages and clears active status.

## State Model

Client state should add:

- `sidebarCollapsed: boolean`
- `inspectorOpen: boolean`
- `runStatus: string | null`
- `runActive: boolean` can continue to be derived from `activeRun`, but CSS state should be explicit enough to drive animations.

State updates should toggle classes on `.app-shell`, such as:

- `.sidebar-collapsed`
- `.inspector-open`
- `.run-active`

This keeps layout and animation mostly CSS-driven.

## Accessibility

Requirements:

- Icon-only buttons need `aria-label`.
- Sidebar collapse button should update `aria-expanded`.
- Inspector open button should update `aria-expanded`.
- The status text area should use `aria-live="polite"`.
- Keyboard send behavior must not prevent `Shift + Enter` multiline input.
- Focus rings should remain visible and consistent with the prism style.

## Testing

Automated checks:

- Existing `npm test` should continue to pass.
- Existing `npm run typecheck` should continue to pass.
- Add or update focused frontend behavior tests only if the repo already has a practical test surface for static UI behavior. Do not introduce a new browser test framework just for this pass.

Manual browser QA:

- Default layout: left expanded, right closed, right edge opener visible.
- Left collapse: sidebar becomes narrow rail and chat widens.
- Left expand: full sidebar returns.
- New chat works from expanded sidebar and collapsed rail.
- Right open: Inspector appears and edge opener disappears.
- Right close: Inspector disappears and edge opener returns.
- Header status text updates during a run.
- Gradient thinking line animates while active and clears after final/error.
- Composer focus glow animates subtly.
- `Enter` sends; `Shift + Enter` inserts newline.
- No obvious browser console errors.

## Open Decisions

None. The selected direction is A. Compact rails, with Thinking text retained in the lightweight header/status area.

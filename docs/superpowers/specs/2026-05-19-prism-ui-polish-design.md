# Prism UI Polish Design

Date: 2026-05-19

## Goal

Polish the Prism web console after the compact-rail refinement. The goal is to keep the glassmorphism, prism color, rounded Apple-like product feel, and clean daily-use AI console direction while fixing remaining visual hierarchy issues:

- The left sidebar actions and cards feel misaligned.
- The chat panel, sidebar, and composer still blend into the pale background.
- The Inspector opener should feel attached to the chat surface.
- The composer send button and focus light need better visual placement.

This spec covers the user-approved direction from the visual companion: **B. Deeper colorful glow** for background contrast, with centered sidebar blocks and restrained thin prism accents.

## Scope

In scope:

- Static web UI markup in `src/web/static/index.html`.
- Client-side UI state and button behavior in `src/web/static/app.js`.
- Styling and responsive layout behavior in `src/web/static/styles.css`.
- Focused automated assertions for the static UI contract where practical.
- Browser QA for layout, contrast, and interactions.

Out of scope:

- Backend run API changes.
- Agent runtime or model behavior changes.
- Multi-session persistence.
- Figma generation or export automation.
- New image assets.

## User-Approved Direction

Use these design constraints:

- Use a deeper colorful prism background based on option B from the mockup.
- Do not use heavy shadows to separate panels.
- Separate surfaces through darker background color, white glass panels, fine borders, and inner highlights.
- Keep the composer focus band thin, close to the current width, but make the color more visible.
- Keep sidebar block text left-aligned, but center the blocks themselves in the sidebar column.
- Move the Inspector expand control into the chat panel's top-right corner.
- Move the send control to the vertical center of the composer capsule.

## Layout Changes

### Left Sidebar

The expanded sidebar should keep the same information architecture:

- Brand area at the top.
- `New chat` action near the top.
- Current session card near the bottom.
- Collapsed rail behavior remains available.

The alignment changes are specific:

- `New chat` becomes a centered pill/block within the sidebar, not a full-width left-aligned nav row.
- The `New chat` block should use a consistent width relative to the sidebar, such as `width: min(100%, 220px)` or `width: 82%`.
- The `New chat` block uses `margin-inline: auto`.
- Text inside `New chat` remains left-aligned.
- The current session card follows the same centering rule: the card block is centered in the sidebar column, while the text inside remains left-aligned.
- The current session card's text group should be vertically centered within the card, not pinned to the top.
- Remove the redundant expanded-sidebar `Console` nav row. The app is already a single-view console, so the row does not provide useful navigation.

Collapsed sidebar:

- Keep icon-only controls.
- Keep accessible labels and titles.
- Preserve existing behavior for expanding the sidebar and starting a new chat.
- Remove the collapsed-rail `Console` icon as well. The collapsed rail should contain only useful actions: expand sidebar and new chat.

### Chat Panel

The chat panel remains the primary surface.

Changes:

- Keep the panel rounded and glass-like.
- Remove remaining visual effects that look like external drop shadow between the sidebar and chat panel.
- Use a higher-opacity white glass fill and fine border to separate it from the darker prism background.
- Add a subtle inner highlight instead of external shadow where depth is needed.
- Make the panel feel clean and unboxed.

### Inspector Toggle

The Inspector expand control should move from the outer grid edge into the chat panel:

- Place it in the chat panel's top-right corner.
- It should be an icon-only rounded glass control.
- It should sit above the header/status light band in the visual stacking order and must not overlap, mask, or truncate the band.
- The header/status light band should reserve enough right-side space or run underneath a non-overlapping header layout so the gradient line remains visually continuous.
- In closed state, the button opens the Inspector.
- In open state, the button should disappear or become visually replaced by the Inspector's internal close control.
- The button must not occupy a separate grid column when the Inspector is closed.

The Inspector panel itself can keep the existing run-details role.

### Composer

The composer should stay pill-shaped and chat-product-like.

Changes:

- Keep the focus light band thin, approximately the current visual width.
- Make the focused band more colorful and visible using a pink, cyan, lavender, and warm-yellow gradient.
- Do not make the band a thick neon ring.
- Add enough outline or contrast around the composer so the bottom capsule separates from the background and chat panel.
- Place the send button at the right middle of the composer, vertically centered.
- Prefer an icon-like circular send button if it fits the current static UI style; otherwise keep text but center it vertically.
- The send control should not sit visually at the lower-right corner.

Keyboard behavior remains:

- `Enter` sends.
- `Shift + Enter` inserts a newline.
- Empty prompts do not send.
- During an active run, sending remains disabled.

## Visual Styling

### Background

Use the selected **B. Deeper colorful glow** direction:

- Make the background darker than the current near-white canvas.
- Use a deeper blue-ice base with pink, cyan, and lavender glow regions.
- Keep the glow broad and soft.
- Avoid noisy particles or clutter in this pass.
- The background should visibly separate from the white glass panels, especially around the bottom composer area.

The background should still feel light, clean, and futuristic. It should not become dark mode.

### Panels

Panels should use:

- White or near-white translucent fill with higher opacity than the current background.
- Fine white border.
- Fine cool-gray border where additional separation is needed.
- Subtle inner highlight.
- No obvious external drop shadow between main layout surfaces.

The desired separation stack is:

1. Deeper prism background.
2. White glass panel fill.
3. Fine border and inner highlight.
4. Minimal shadow only for small controls if needed.

### Accent Light

Keep the prism palette:

- Pink.
- Cyan.
- Lavender.
- Optional warm yellow only in the composer focus band to make the gradient feel more lively.

The active thinking/status line remains thin and can use a similar gradient. It should not compete with the composer focus band.

## Interaction Behavior

No backend behavior changes are required.

Client-side behavior should preserve:

- New chat resets local page session only when no run is active.
- Left sidebar expands and collapses.
- Inspector opens and closes.
- Status text updates in the chat header.
- Tool activity remains available in the Inspector.
- Running state disables prompt input and send controls.

Implementation constraints:

- Remove the external Inspector edge grid column.
- The Inspector opener lives inside the chat header/top-right area.
- The Inspector open state should still use `.inspector-open`.
- The run active state should still use `.run-active`.
- Sidebar collapsed state should still use `.sidebar-collapsed`.

## Accessibility

Requirements:

- Icon-only Inspector opener must have `aria-label`, `aria-controls`, and updated `aria-expanded`.
- Sidebar collapse and rail buttons keep accessible labels.
- If `New chat` becomes a centered block with left-aligned text, it remains a real button.
- Status text remains `aria-live="polite"`.
- Focus states remain visible on keyboard navigation.
- `Shift + Enter` multiline input must continue to work.

## Testing

Automated checks:

- Existing test suite should pass.
- TypeScript typecheck should pass.
- Existing static web UI tests should be updated to assert the new contract:
  - no redundant expanded sidebar `Console` nav.
  - no redundant collapsed rail `Console` icon.
  - Inspector opener is inside the chat panel/header area.
  - external Inspector edge toggle/grid column is removed.
  - composer still supports Enter and Shift+Enter behavior.
  - CSS includes the deeper background and thin focus-band treatment.

Manual browser QA:

- Default layout shows left sidebar expanded and Inspector closed.
- `New chat` block is centered in the sidebar, while its text remains left-aligned.
- Current session card block is centered in the sidebar, while its text remains left-aligned.
- Current session card text is vertically centered inside the card.
- Chat panel and composer are clearly separated from the deeper background.
- There is no obvious shadow between the sidebar and chat panel.
- Inspector opener appears in the chat panel top-right.
- Inspector opener does not truncate or cover the header/status light band.
- Inspector opener disappears or yields to the Inspector close control when Inspector is open.
- Send button is vertically centered in the composer.
- Composer focus band is thin but visibly colorful.
- `Enter` sends and `Shift + Enter` inserts a newline.

## Non-Goals

Do not:

- Add new product features.
- Add persistence.
- Add decorative particle systems in this pass.
- Introduce heavy shadows to solve contrast.
- Center sidebar text when the requirement is to center the block.
- Make the composer focus band thick or neon.

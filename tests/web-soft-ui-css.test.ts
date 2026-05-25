import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/web/static/styles.css', import.meta.url), 'utf8')

describe('Phase 8A soft UI shell CSS contract', () => {
  it('defines restrained soft UI tokens from the existing Cyrene palette', () => {
    expect(css).toMatch(/--soft-base:\s*#eef8ff;/)
    expect(css).toMatch(/--soft-base-strong:\s*#fbfdff;/)
    expect(css).toMatch(/--accent-primary:\s*rgba\(247,\s*168,\s*207,\s*0\.82\);/)
    expect(css).toMatch(/--accent-data:\s*rgba\(174,\s*239,\s*255,\s*0\.48\);/)
    expect(css).toMatch(/--surface-raised:\s*[\s\S]*?--surface-pressed:/)
    expect(css).toMatch(/--surface-pressed:\s*inset/)
    expect(css).toMatch(/--surface-inset:\s*inset/)
  })

  it('keeps the desktop shell on a low-saturation fog and ice base', () => {
    expect(css).toMatch(/body\s*\{[\s\S]*?#e9f4fb[\s\S]*?#f6fbff[\s\S]*?#eef8ff/)
    expect(css).toMatch(/\.glass-panel\s*\{[\s\S]*?background:\s*var\(--panel\);/)
    expect(css).toMatch(/\.glass-panel\s*\{[\s\S]*?box-shadow:\s*var\(--surface-raised\);/)
    expect(css).toMatch(/\.sidebar,\s*\n\.chat-shell,\s*\n\.inspector\s*\{[\s\S]*?box-shadow:\s*var\(--surface-raised-subtle\);/)
  })

  it('makes high-frequency controls tactile without increasing the accent footprint', () => {
    expect(css).toMatch(/\.send-button\s*\{[\s\S]*?background:\s*linear-gradient\([^;]*var\(--accent-primary\)/)
    expect(css).toMatch(/\.send-button\s*\{[\s\S]*?width:\s*44px;/)
    expect(css).toMatch(/\.send-button-icon\s*\{[\s\S]*?width:\s*18px;/)
    expect(css).toMatch(/\.send-button-icon\s*\{[\s\S]*?height:\s*18px;/)
    expect(css).toMatch(/\.composer\s*\{[\s\S]*?box-shadow:\s*var\(--surface-inset\),\s*var\(--soft-highlight\);/)
    expect(css).toMatch(/\.context-usage-button\s*\{[\s\S]*?box-shadow:\s*var\(--surface-raised-subtle\);/)
    expect(css).toMatch(/\.icon-button:active,\s*\n\.send-button:active,\s*\n\.tab:active[\s\S]*?box-shadow:\s*var\(--surface-pressed\);/)
    expect(css).toMatch(/\.control-action\.danger\s*\{[\s\S]*?background:\s*linear-gradient/)
  })

  it('keeps send icon readable in light and dark mode', () => {
    expect(css).toMatch(/--send-icon:\s*#243044;/)
    expect(css).toMatch(/\.send-button\s*\{[\s\S]*?color:\s*var\(--send-icon\);/)
    expect(css).toMatch(/body\.theme-dark\s*\{[\s\S]*?--send-icon:\s*#f7fbff;/)
    expect(css).toMatch(/\.send-button-icon\s*\{[\s\S]*?stroke-width:\s*2;/)
  })

  it('keeps desktop window controls clear of the collapsed sidebar avatar', () => {
    expect(css).toMatch(/--window-control-clearance:\s*0px;/)
    expect(css).toMatch(/html\.desktop-shell\s*\{[\s\S]*?--window-control-clearance:\s*34px;/)
    expect(css).toMatch(/\.sidebar\s*\{[\s\S]*?padding:\s*calc\(22px \+ var\(--window-control-clearance\)\)\s+22px\s+22px;/)
    expect(css).toMatch(/\.app-shell\.sidebar-collapsed \.sidebar\s*\{[\s\S]*?padding:\s*calc\(12px \+ var\(--window-control-clearance\)\)\s+12px\s+12px;/)
  })

  it('keeps the thinking mode wrapper transparent in dark mode', () => {
    expect(css).toMatch(/\.think-mode-control\s*\{[\s\S]*?background:\s*transparent;/)
    expect(css).toMatch(/body\.theme-dark \.think-mode-control\s*\{[\s\S]*?background:\s*transparent;/)
  })

  it('uses soft raised cards for dense inspector information', () => {
    expect(css).toMatch(/\.control-item\s*\{[\s\S]*?box-shadow:\s*var\(--surface-raised-subtle\);/)
    expect(css).toMatch(/\.continuity-section\s*\{[\s\S]*?box-shadow:\s*var\(--surface-raised-subtle\);/)
    expect(css).toMatch(/\.tool-card\s*\{[\s\S]*?box-shadow:\s*var\(--surface-raised-subtle\);/)
  })

  it('adds state-aware ambient motion with a reduced-motion escape hatch', () => {
    expect(css).toMatch(/\.ambient\s*\{[\s\S]*?animation:\s*ambientDrift/)
    expect(css).toMatch(/\.app-shell\.run-active\s+\.empty-avatar\s*\{[\s\S]*?animation:\s*emptyAvatarGlow/)
    expect(css).toMatch(/@keyframes ambientDrift/)
    expect(css).toMatch(/@keyframes emptyAvatarGlow/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation:\s*none\s*!important;/)
  })
})

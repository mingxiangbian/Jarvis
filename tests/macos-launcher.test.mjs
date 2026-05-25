import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  buildAppleScript,
  buildIconsetEntries,
  buildPlistBuddyCommands,
  resolveLauncherPaths
} from '../scripts/create-macos-launcher.mjs'

describe('macOS launcher generator', () => {
  it('resolves the local Cyrene app bundle paths', () => {
    expect(resolveLauncherPaths('/repo')).toMatchObject({
      appPath: '/Users/phoenix/Applications/Cyrene.app',
      iconSource: '/repo/src/web/static/assets/cyrene-cartoon-avatar.png',
      iconName: 'Cyrene.icns',
      tauriIconPath: '/repo/src-tauri/icons/Cyrene.icns',
      tauriDefaultIconPath: '/repo/src-tauri/icons/icon.icns',
      logPath: '/Users/phoenix/Library/Logs/Cyrene-launcher.log'
    })
  })

  it('builds an AppleScript launcher that starts the Tauri dev shell detached', () => {
    const script = buildAppleScript({ repoPath: '/repo', logPath: '/tmp/Cyrene.log' })

    expect(script).toContain('npm run desktop:dev')
    expect(script).toContain('nohup')
    expect(script).toContain('set -a; . ./.env; set +a')
    expect(script).toContain('Cyrene already running')
    expect(script).toContain("pgrep -f '[t]arget/debug/cyrene'")
    expect(script).toContain('quit')
    expect(script).toContain('/repo')
    expect(script).toContain('Cyrene repo not found')
    expect(script).toContain('/tmp/Cyrene.log')
    expect(script).toContain("date '+%Y-%m-%dT%H:%M:%S%z'")
    expect(script).not.toContain('date -Is')
  })

  it('builds plist patch commands for the Cyrene app identity', () => {
    expect(buildPlistBuddyCommands('Cyrene', 'local.cyrene.launcher', 'Cyrene')).toEqual([
      ['Set', ':CFBundleName', 'Cyrene'],
      ['Set', ':CFBundleDisplayName', 'Cyrene'],
      ['Set', ':CFBundleIdentifier', 'local.cyrene.launcher'],
      ['Set', ':CFBundleIconFile', 'Cyrene'],
      ['Set', ':LSUIElement', 'true', 'bool']
    ])
  })

  it('builds a complete macOS iconset plan', () => {
    expect(buildIconsetEntries()).toContainEqual({ name: 'icon_512x512@2x.png', pixels: 1024 })
    expect(buildIconsetEntries()).toHaveLength(10)
  })

  it('exposes an npm script for regenerating the launcher', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

    expect(pkg.scripts['launcher:create']).toBe('node scripts/create-macos-launcher.mjs')
  })
})

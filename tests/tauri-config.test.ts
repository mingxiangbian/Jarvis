import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Tauri desktop shell scaffold', () => {
  it('loads the Cyrene Web UI from the local desktop Web server', async () => {
    const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')) as {
      productName?: string
      identifier?: string
      build?: {
        beforeDevCommand?: string
        devUrl?: string
        frontendDist?: string
      }
      app?: {
        windows?: Array<{
          title?: string
          width?: number
          height?: number
          minWidth?: number
          minHeight?: number
          decorations?: boolean
          titleBarStyle?: string
          hiddenTitle?: boolean
        }>
      }
      bundle?: {
        active?: boolean
        icon?: string[]
      }
    }

    expect(config.productName).toBe('Cyrene')
    expect(config.identifier).toBe('local.cyrene.app')
    expect(config.build).toMatchObject({
      beforeDevCommand: 'npm run desktop:web -- --port 4317',
      devUrl: 'http://127.0.0.1:4317/?desktop=1',
      frontendDist: '../src/web/static'
    })
    expect(config.app?.windows?.[0]).toMatchObject({
      title: 'Cyrene',
      width: 1280,
      height: 820,
      minWidth: 1180,
      minHeight: 720
    })
    expect(config.app?.windows?.[0]).toMatchObject({
      decorations: true,
      titleBarStyle: 'Overlay',
      hiddenTitle: true
    })
    expect(config.bundle?.active).toBe(false)
    expect(config.bundle?.icon).toContain('icons/Cyrene.icns')
  })
})

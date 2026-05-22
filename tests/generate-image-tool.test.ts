import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig, type AppConfig } from '../src/config.js'
import { generateImageTool } from '../src/tools/generate-image.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'generate-image-tool-')))
  tempRoots.push(root)
  return root
}

function config(root: string, outputDir = 'generated-images'): AppConfig {
  return {
    ...createDefaultConfig(root),
    t2i: {
      baseUrl: 'http://127.0.0.1:7861',
      outputDir
    }
  }
}

function mockJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('generateImageTool', () => {
  it('describes local SD1.5 text-to-image generation', () => {
    expect(generateImageTool.description).toContain('local text-to-image')
    expect(generateImageTool.description).toContain('local SD1.5 worker')
  })

  it('validates schema defaults, dimension constraints, and count limit', () => {
    const defaults = generateImageTool.schema.safeParse({ prompt: 'portrait' })
    expect(defaults.success).toBe(true)
    if (defaults.success) {
      expect(defaults.data.width).toBe(512)
      expect(defaults.data.height).toBe(768)
      expect(defaults.data.steps).toBe(30)
      expect(defaults.data.cfg_scale).toBe(7)
      expect(defaults.data.count).toBe(1)
      expect(defaults.data.realism_preset).toBe(false)
      expect(defaults.data.hires_fix).toBe(false)
      expect(defaults.data.hires_scale).toBe(2)
      expect(defaults.data.hires_steps).toBe(15)
      expect(defaults.data.hires_denoise).toBe(0.15)
      expect(defaults.data.bmab_postprocess).toBe(false)
      expect(defaults.data.bmab_noise_alpha).toBe(0.05)
      expect(defaults.data.bmab_contrast).toBe(0.9)
      expect(defaults.data.bmab_brightness).toBe(1.1)
      expect(defaults.data.bmab_color_temperature).toBe(15)
      expect(defaults.data.eye_refine).toBe(false)
      expect(defaults.data.eye_refine_strength).toBe(0.12)
      expect(defaults.data.eye_refine_steps).toBe(12)
      expect(defaults.data.detail_enhance).toBe(false)
      expect(defaults.data.detail_targets).toBe('auto')
      expect(defaults.data.detail_strength).toBe(0.35)
      expect(defaults.data.return_intermediate).toBe(false)
    }

    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', width: 500 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', height: 1025 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', count: 5 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', hires_scale: 0.9 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', hires_scale: 4.1 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', hires_denoise: 0.04 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', hires_denoise: 0.51 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', bmab_noise_alpha: -0.01 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', bmab_noise_alpha: 0.51 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', eye_refine_strength: 0.04 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', eye_refine_strength: 0.31 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', eye_refine_steps: 0 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', detail_targets: 'animal' }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', detail_strength: 0.09 }).success).toBe(false)
    expect(generateImageTool.schema.safeParse({ prompt: 'portrait', detail_strength: 0.71 }).success).toBe(false)
  })

  it('sends defaults to the T2I worker and formats returned paths', async () => {
    const root = await tempRoot()
    const imagePath = join(root, 'generated-images', 'image-1.png')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{ path: imagePath, seed: 42, width: 512, height: 768 }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      { prompt: 'portrait photo' },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect((await stat(join(root, 'generated-images'))).isDirectory()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7861/generate', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }))
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(sent).toEqual({
      prompt: 'portrait photo',
      negative_prompt: '',
      width: 512,
      height: 768,
      steps: 30,
      cfg_scale: 7,
      count: 1,
      realism_preset: false,
      hires_fix: false,
      hires_scale: 2,
      hires_steps: 15,
      hires_denoise: 0.15,
      bmab_postprocess: false,
      bmab_noise_alpha: 0.05,
      bmab_contrast: 0.9,
      bmab_brightness: 1.1,
      bmab_color_temperature: 15,
      eye_refine: false,
      eye_refine_strength: 0.12,
      eye_refine_steps: 12,
      detail_enhance: false,
      detail_targets: 'auto',
      detail_strength: 0.35,
      return_intermediate: false,
      output_dir: join(root, 'generated-images')
    })
    expect(result.content).toContain('Generated 1 image with majicmixRealistic_v7.')
    expect(result.content).toContain(`absolute path: ${imagePath}`)
    expect(result.content).toContain('relative path: generated-images/image-1.png')
    expect(result.content).toContain('seed: 42')
    expect(result.content).toContain('size: 512x768')
  })

  it('passes explicit dimensions, count, seed, and negative prompt', async () => {
    const root = await tempRoot()
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [
          { path: join(root, 'generated-images', 'a.png'), seed: 7, width: 768, height: 512 },
          { path: join(root, 'generated-images', 'b.png'), seed: 8, width: 768, height: 512 }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      {
        prompt: 'landscape',
        negative_prompt: 'low quality',
        width: 768,
        height: 512,
        steps: 24,
        cfg_scale: 6,
        seed: 7,
        count: 2
      },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(result.ok).toBe(true)
    expect(sent.width).toBe(768)
    expect(sent.height).toBe(512)
    expect(sent.seed).toBe(7)
    expect(sent.count).toBe(2)
    expect(sent.negative_prompt).toBe('low quality')
    expect(result.content).toContain('Generated 2 images')
  })

  it('passes detail options to the T2I worker and formats detail metadata', async () => {
    const root = await tempRoot()
    const imagePath = join(root, 'generated-images', 'detail.png')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{
          path: imagePath,
          seed: 42,
          width: 512,
          height: 768,
          detail_enhanced: true,
          detail_regions: 2,
          detail_targets: ['face', 'hand']
        }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      {
        prompt: 'portrait photo',
        detail_enhance: true,
        detail_targets: 'auto',
        detail_strength: 0.42,
        return_intermediate: true
      },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(result.ok).toBe(true)
    expect(sent).toEqual(expect.objectContaining({
      detail_enhance: true,
      detail_targets: 'auto',
      detail_strength: 0.42,
      return_intermediate: true
    }))
    expect(result.content).toContain('detail: enhanced 2 regions')
    expect(result.content).toContain('targets: face, hand')
    expect(result.metadata?.images).toEqual([
      expect.objectContaining({
        detail_enhanced: true,
        detail_regions: 2,
        detail_targets: ['face', 'hand']
      })
    ])
  })

  it('passes hires and BMAB-like postprocess options and formats metadata', async () => {
    const root = await tempRoot()
    const imagePath = join(root, 'generated-images', 'reference.png')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{
          path: imagePath,
          seed: 4216575493,
          width: 1024,
          height: 1536,
          hires_upscaled: true,
          hires_scale: 2,
          postprocessed: true,
          eye_refined: true,
          eye_regions: 1
        }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      {
        prompt: '1girl,hair with bangs,black long dress,orange background,',
        negative_prompt: '(worst quality:2),(low quality:2),(normal quality:2),lowres,watermark,',
        width: 512,
        height: 768,
        steps: 20,
        cfg_scale: 7,
        seed: 4216575493,
        hires_fix: true,
        hires_scale: 2,
        hires_steps: 15,
        hires_denoise: 0.15,
        bmab_postprocess: true,
        bmab_noise_alpha: 0.05,
        bmab_contrast: 0.9,
        bmab_brightness: 1.1,
        bmab_color_temperature: 15,
        eye_refine: true,
        eye_refine_strength: 0.12,
        eye_refine_steps: 12,
        detail_enhance: true,
        detail_targets: 'face',
        detail_strength: 0.1
      },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(result.ok).toBe(true)
    expect(sent).toEqual(expect.objectContaining({
      hires_fix: true,
      hires_scale: 2,
      hires_steps: 15,
      hires_denoise: 0.15,
      bmab_postprocess: true,
      bmab_noise_alpha: 0.05,
      bmab_contrast: 0.9,
      bmab_brightness: 1.1,
      bmab_color_temperature: 15,
      eye_refine: true,
      eye_refine_strength: 0.12,
      eye_refine_steps: 12,
      detail_strength: 0.1
    }))
    expect(result.content).toContain('size: 1024x1536')
    expect(result.content).toContain('hires: 2x')
    expect(result.content).toContain('postprocess: BMAB-like')
    expect(result.content).toContain('eye refine: enhanced 1 regions')
  })

  it('uses realism preset defaults unless explicit generation parameters are provided', async () => {
    const root = await tempRoot()
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{ path: join(root, 'generated-images', 'real.png'), seed: 42, width: 512, height: 768 }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      {
        prompt: 'portrait photo',
        realism_preset: true,
        detail_enhance: true
      },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(result.ok).toBe(true)
    expect(sent).toEqual(expect.objectContaining({
      realism_preset: true,
      cfg_scale: 6,
      detail_strength: 0.2
    }))
  })

  it('does not override explicit cfg scale or detail strength with realism preset defaults', async () => {
    const root = await tempRoot()
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{ path: join(root, 'generated-images', 'real.png'), seed: 42, width: 512, height: 768 }]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      {
        prompt: 'portrait photo',
        realism_preset: true,
        cfg_scale: 7.5,
        detail_strength: 0.33
      },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(result.ok).toBe(true)
    expect(sent).toEqual(expect.objectContaining({
      realism_preset: true,
      cfg_scale: 7.5,
      detail_strength: 0.33
    }))
  })

  it('reports no detected detail regions as a successful generation', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{
          path: join(root, 'generated-images', 'detail.png'),
          seed: 42,
          width: 512,
          height: 768,
          detail_enhanced: false,
          detail_regions: 0,
          detail_targets: []
        }]
      })
    ))

    const result = await generateImageTool.execute(
      { prompt: 'portrait photo', detail_enhance: true },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('detail: no regions detected')
  })

  it('reports detected detail regions when enhancement was not applied', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{
          path: join(root, 'generated-images', 'detail.png'),
          seed: 42,
          width: 512,
          height: 768,
          detail_enhanced: false,
          detail_regions: 2,
          detail_targets: []
        }]
      })
    ))

    const result = await generateImageTool.execute(
      { prompt: 'portrait photo', detail_enhance: true },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('detail: detected 2 regions but enhancement was not applied')
  })

  it('rejects dimensions that are not multiples of 64', async () => {
    const root = await tempRoot()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      { prompt: 'portrait', width: 500 },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('width and height must be multiples of 64')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized images before calling the worker', async () => {
    const root = await tempRoot()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      { prompt: 'large', width: 2048, height: 1024 },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('width * height must not exceed 1048576')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects symlinked output parents before creating outside directories', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await symlink(outside, join(root, 'linked-output'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateImageTool.execute(
      { prompt: 'portrait' },
      { config: config(root, 'linked-output/nested'), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside current working directory')
    expect(await pathExists(join(outside, 'nested'))).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a clear error when the worker is unavailable', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }))

    const result = await generateImageTool.execute(
      { prompt: 'portrait' },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('T2I worker request failed')
    expect(result.content).toContain('connect ECONNREFUSED')
  })

  it('rejects worker paths outside the output directory', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{ path: join(root, 'outside.png'), seed: 1, width: 512, height: 768 }]
      })
    ))

    const result = await generateImageTool.execute(
      { prompt: 'portrait' },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside generated image output directory')
  })

  it('rejects worker paths that resolve outside the output directory through symlinks', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const outputDir = join(root, 'generated-images')
    await mkdir(outputDir)
    await symlink(outside, join(outputDir, 'link'))
    await writeFile(join(outside, 'image.png'), 'fake image', 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{ path: join(outputDir, 'link', 'image.png'), seed: 1, width: 512, height: 768 }]
      })
    ))

    const result = await generateImageTool.execute(
      { prompt: 'portrait' },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside generated image output directory')
  })

  it('rejects worker responses with no images', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: []
      })
    ))

    const result = await generateImageTool.execute(
      { prompt: 'portrait' },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('unexpected response')
  })

  it('rejects worker image count mismatches', async () => {
    const root = await tempRoot()
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonResponse({
        model: 'majicmixRealistic_v7',
        images: [{ path: join(root, 'generated-images', 'only.png'), seed: 1, width: 512, height: 768 }]
      })
    ))

    const result = await generateImageTool.execute(
      { prompt: 'portrait', count: 2 },
      { config: config(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('expected 2 images but received 1')
  })
})

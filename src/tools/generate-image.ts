import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { Tool } from './types.js'

const MAX_PIXELS = 1024 * 1024
const MIN_DIMENSION = 64
const MAX_DIMENSION = 1024

type DetailTarget = 'auto' | 'face' | 'hand' | 'person'

interface GenerateImageArgs {
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  steps?: number
  cfg_scale?: number
  seed?: number
  count?: number
  realism_preset?: boolean
  hires_fix?: boolean
  hires_scale?: number
  hires_steps?: number
  hires_denoise?: number
  bmab_postprocess?: boolean
  bmab_noise_alpha?: number
  bmab_contrast?: number
  bmab_brightness?: number
  bmab_color_temperature?: number
  eye_refine?: boolean
  eye_refine_strength?: number
  eye_refine_steps?: number
  detail_enhance?: boolean
  detail_targets?: DetailTarget
  detail_strength?: number
  safe_preset?: boolean
  dynamic_thresholding?: boolean
  dynamic_thresholding_mimic_scale?: number
  dynamic_thresholding_percentile?: number
  return_intermediate?: boolean
}

const SAFE_PRESET_NAME = 'm3_16gb_safe'
const SAFE_PRESET = {
  width: 512,
  height: 768,
  steps: 20,
  cfg_scale: 7,
  count: 1,
  hires_fix: true,
  hires_scale: 2,
  hires_steps: 15,
  hires_denoise: 0.15,
  detail_enhance: true,
  detail_targets: 'face' as DetailTarget,
  detail_strength: 0.1,
  eye_refine: true,
  eye_refine_strength: 0.12,
  eye_refine_steps: 12,
  bmab_postprocess: true,
  dynamic_thresholding: true,
  dynamic_thresholding_mimic_scale: 7,
  dynamic_thresholding_percentile: 0.995
}

type PresetAdjustment = {
  field: string
  from: boolean | number | string
  to: boolean | number | string
}

const dimensionSchema = z.number()
  .int()
  .min(MIN_DIMENSION)
  .max(MAX_DIMENSION)
  .refine((value) => value % 64 === 0, 'width and height must be multiples of 64')

const schema: z.ZodType<GenerateImageArgs> = z.object({
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  width: dimensionSchema.optional(),
  height: dimensionSchema.optional(),
  steps: z.number().int().positive().optional(),
  cfg_scale: z.number().positive().optional(),
  seed: z.number().int().optional(),
  count: z.number().int().min(1).max(4).optional(),
  realism_preset: z.boolean().optional(),
  hires_fix: z.boolean().optional(),
  hires_scale: z.number().min(1).max(4).optional(),
  hires_steps: z.number().int().positive().optional(),
  hires_denoise: z.number().min(0.05).max(0.5).optional(),
  bmab_postprocess: z.boolean().optional(),
  bmab_noise_alpha: z.number().min(0).max(0.5).optional(),
  bmab_contrast: z.number().positive().optional(),
  bmab_brightness: z.number().positive().optional(),
  bmab_color_temperature: z.number().min(-100).max(100).optional(),
  eye_refine: z.boolean().optional(),
  eye_refine_strength: z.number().min(0.05).max(0.3).optional(),
  eye_refine_steps: z.number().int().positive().optional(),
  detail_enhance: z.boolean().optional(),
  detail_targets: z.enum(['auto', 'face', 'hand', 'person']).optional(),
  detail_strength: z.number().min(0.1).max(0.7).optional(),
  safe_preset: z.boolean().optional(),
  dynamic_thresholding: z.boolean().optional(),
  dynamic_thresholding_mimic_scale: z.number().min(1).max(20).optional(),
  dynamic_thresholding_percentile: z.number().gt(0.9).lt(1).optional(),
  return_intermediate: z.boolean().optional()
})

const workerResponseSchema = z.object({
  model: z.string(),
  images: z.array(z.object({
    path: z.string().min(1),
    seed: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
    hires_upscaled: z.boolean().optional(),
    hires_scale: z.number().optional(),
    postprocessed: z.boolean().optional(),
    eye_refined: z.boolean().optional(),
    eye_regions: z.number().int().nonnegative().optional(),
    detail_enhanced: z.boolean().optional(),
    detail_regions: z.number().int().nonnegative().optional(),
    detail_targets: z.array(z.string()).optional()
  })).nonempty()
})

type GenerateImageRequest = {
  prompt: string
  negative_prompt: string
  width: number
  height: number
  steps: number
  cfg_scale: number
  count: number
  realism_preset: boolean
  hires_fix: boolean
  hires_scale: number
  hires_steps: number
  hires_denoise: number
  bmab_postprocess: boolean
  bmab_noise_alpha: number
  bmab_contrast: number
  bmab_brightness: number
  bmab_color_temperature: number
  eye_refine: boolean
  eye_refine_strength: number
  eye_refine_steps: number
  detail_enhance: boolean
  detail_targets: DetailTarget
  detail_strength: number
  safe_preset: boolean
  dynamic_thresholding: boolean
  dynamic_thresholding_mimic_scale: number
  dynamic_thresholding_percentile: number
  return_intermediate: boolean
  output_dir: string
  seed?: number
}

function isUnderRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function toRelativeDisplayPath(cwd: string, path: string): string {
  return relative(cwd, path).replaceAll('\\', '/')
}

async function nearestExistingCanonicalParent(path: string): Promise<string> {
  let current = path

  while (true) {
    try {
      return await realpath(current)
    } catch {
      const next = dirname(current)
      if (next === current) {
        throw new Error(`No existing parent for ${path}`)
      }
      current = next
    }
  }
}

function validateDimensions(width: number, height: number): string | null {
  if (width % 64 !== 0 || height % 64 !== 0) {
    return 'width and height must be multiples of 64'
  }
  if (width * height > MAX_PIXELS) {
    return `width * height must not exceed ${MAX_PIXELS}`
  }
  return null
}

function resolveOutputDir(cwd: string, outputDir: string): { ok: true; path: string } | { ok: false; content: string } {
  if (outputDir.trim() === '') {
    return { ok: false, content: 'Refusing to use empty T2I output directory.' }
  }
  if (isAbsolute(outputDir)) {
    return { ok: false, content: 'Refusing to use absolute T2I output directory.' }
  }
  if (outputDir.split(/[\\/]+/).includes('..')) {
    return { ok: false, content: 'Refusing to use T2I output directory with parent traversal.' }
  }

  const resolvedCwd = resolve(cwd)
  const resolvedOutputDir = resolve(resolvedCwd, outputDir)
  if (!isUnderRoot(resolvedOutputDir, resolvedCwd)) {
    return { ok: false, content: 'Refusing to use T2I output directory outside current working directory.' }
  }

  return { ok: true, path: resolvedOutputDir }
}

function applyPresetValue(
  request: GenerateImageRequest,
  source: GenerateImageArgs,
  adjustments: PresetAdjustment[],
  field: keyof typeof SAFE_PRESET
): void {
  const value = SAFE_PRESET[field]
  const sourceValue = source[field as keyof GenerateImageArgs]
  if (sourceValue !== undefined && sourceValue !== value) {
    adjustments.push({ field: String(field), from: sourceValue as boolean | number | string, to: value })
  }
  ;(request as unknown as Record<string, boolean | number | string>)[field] = value
}

function normalizeArgs(
  args: GenerateImageArgs,
  outputDir: string
): { request: GenerateImageRequest; preset?: string; presetAdjustments: PresetAdjustment[] } {
  const realismPreset = args.realism_preset ?? false
  const safePreset = args.safe_preset ?? true
  const presetAdjustments: PresetAdjustment[] = []
  const request: GenerateImageRequest = {
    prompt: args.prompt,
    negative_prompt: args.negative_prompt ?? '',
    width: args.width ?? 512,
    height: args.height ?? 768,
    steps: args.steps ?? 30,
    cfg_scale: args.cfg_scale ?? (realismPreset ? 6 : 7),
    count: args.count ?? 1,
    realism_preset: realismPreset,
    hires_fix: args.hires_fix ?? false,
    hires_scale: args.hires_scale ?? 2,
    hires_steps: args.hires_steps ?? 15,
    hires_denoise: args.hires_denoise ?? 0.15,
    bmab_postprocess: args.bmab_postprocess ?? false,
    bmab_noise_alpha: args.bmab_noise_alpha ?? 0.05,
    bmab_contrast: args.bmab_contrast ?? 0.9,
    bmab_brightness: args.bmab_brightness ?? 1.1,
    bmab_color_temperature: args.bmab_color_temperature ?? 15,
    eye_refine: args.eye_refine ?? false,
    eye_refine_strength: args.eye_refine_strength ?? 0.12,
    eye_refine_steps: args.eye_refine_steps ?? 12,
    detail_enhance: args.detail_enhance ?? false,
    detail_targets: args.detail_targets ?? 'auto',
    detail_strength: args.detail_strength ?? (realismPreset ? 0.2 : 0.35),
    safe_preset: safePreset,
    dynamic_thresholding: args.dynamic_thresholding ?? true,
    dynamic_thresholding_mimic_scale: args.dynamic_thresholding_mimic_scale ?? 7,
    dynamic_thresholding_percentile: args.dynamic_thresholding_percentile ?? 0.995,
    return_intermediate: args.return_intermediate ?? false,
    output_dir: outputDir
  }

  if (args.seed !== undefined) {
    request.seed = args.seed
  }

  if (safePreset) {
    for (const field of Object.keys(SAFE_PRESET) as Array<keyof typeof SAFE_PRESET>) {
      applyPresetValue(request, args, presetAdjustments, field)
    }
  }

  return {
    request,
    preset: safePreset ? SAFE_PRESET_NAME : undefined,
    presetAdjustments
  }
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/generate`
}

async function readWorkerJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid JSON: ${message}`)
  }
}

async function resolveWorkerImagePath(
  imagePath: string,
  canonicalOutputDir: string
): Promise<{ ok: true; path: string } | { ok: false; content: string }> {
  const resolved = isAbsolute(imagePath) ? resolve(imagePath) : resolve(canonicalOutputDir, imagePath)
  if (!isUnderRoot(resolved, canonicalOutputDir)) {
    return { ok: false, content: `T2I worker returned path outside generated image output directory: ${imagePath}` }
  }

  try {
    const canonical = await realpath(resolved)
    if (!isUnderRoot(canonical, canonicalOutputDir)) {
      return { ok: false, content: `T2I worker returned path outside generated image output directory: ${imagePath}` }
    }
    return { ok: true, path: canonical }
  } catch {
    const canonicalParent = await nearestExistingCanonicalParent(dirname(resolved))
    if (!isUnderRoot(canonicalParent, canonicalOutputDir)) {
      return { ok: false, content: `T2I worker returned path outside generated image output directory: ${imagePath}` }
    }
    return { ok: true, path: resolved }
  }
}

export const generateImageTool: Tool<GenerateImageArgs> = {
  name: 'generate_image',
  description: 'Generate PNG images from a prompt using local text-to-image generation with the configured local SD1.5 worker.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text prompt describing the image to generate.' },
      negative_prompt: { type: 'string', description: 'Optional prompt describing what to avoid.' },
      width: { type: 'number', description: 'Image width in pixels, 64 to 1024 and a multiple of 64. Defaults to 512.' },
      height: { type: 'number', description: 'Image height in pixels, 64 to 1024 and a multiple of 64. Defaults to 768.' },
      steps: { type: 'number', description: 'Diffusion step count. Defaults to 30.' },
      cfg_scale: { type: 'number', description: 'Classifier-free guidance scale. Defaults to 7.' },
      seed: { type: 'number', description: 'Optional generation seed.' },
      count: { type: 'number', description: 'Number of images to generate, 1 to 4. Defaults to 1.' },
      realism_preset: { type: 'boolean', description: 'Whether to apply conservative prompt and parameter defaults for more realistic photos. Defaults to false.' },
      hires_fix: { type: 'boolean', description: 'Whether to run a high-resolution upscale plus low-denoise img2img pass. Defaults to false.' },
      hires_scale: { type: 'number', description: 'Hires upscale factor, 1 to 4. Defaults to 2.' },
      hires_steps: { type: 'number', description: 'Hires img2img step count. Defaults to 15.' },
      hires_denoise: { type: 'number', description: 'Hires img2img denoising strength, 0.05 to 0.5. Defaults to 0.15.' },
      bmab_postprocess: { type: 'boolean', description: 'Whether to apply lightweight BMAB-like noise, contrast, brightness, and color-temperature postprocess. Defaults to false.' },
      bmab_noise_alpha: { type: 'number', description: 'BMAB-like final noise opacity, 0 to 0.5. Defaults to 0.05.' },
      bmab_contrast: { type: 'number', description: 'BMAB-like contrast multiplier. Defaults to 0.9.' },
      bmab_brightness: { type: 'number', description: 'BMAB-like brightness multiplier. Defaults to 1.1.' },
      bmab_color_temperature: { type: 'number', description: 'BMAB-like color temperature shift, -100 to 100. Defaults to 15.' },
      eye_refine: { type: 'boolean', description: 'Whether to run an extra low-strength eye-area refine pass after face detection. Defaults to false.' },
      eye_refine_strength: { type: 'number', description: 'Eye refine denoising strength, 0.05 to 0.3. Defaults to 0.12.' },
      eye_refine_steps: { type: 'number', description: 'Eye refine img2img step count. Defaults to 12.' },
      detail_enhance: { type: 'boolean', description: 'Whether to run optional detail enhancement after generation. Defaults to false.' },
      detail_targets: { type: 'string', enum: ['auto', 'face', 'hand', 'person'], description: 'Detail enhancement target selection. Defaults to auto.' },
      detail_strength: { type: 'number', description: 'Detail enhancement denoising strength, 0.1 to 0.7. Defaults to 0.35.' },
      safe_preset: { type: 'boolean', description: 'Whether to force the M3 16 GB safe generation preset. Defaults to true.' },
      dynamic_thresholding: { type: 'boolean', description: 'Whether to enable Dynamic Thresholding. Defaults to true.' },
      dynamic_thresholding_mimic_scale: { type: 'number', description: 'Dynamic Thresholding mimic scale, 1 to 20. Defaults to 7.' },
      dynamic_thresholding_percentile: { type: 'number', description: 'Dynamic Thresholding percentile, greater than 0.9 and less than 1. Defaults to 0.995.' },
      return_intermediate: { type: 'boolean', description: 'Whether the worker should return intermediate detail enhancement artifacts. Defaults to false.' }
    },
    required: ['prompt'],
    additionalProperties: false
  },
  schema,
  isReadonly: false,
  isDestructive: false,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(args, context) {
    const outputDir = resolveOutputDir(context.config.cwd, context.config.t2i.outputDir)
    if (!outputDir.ok) {
      return outputDir
    }

    const normalized = normalizeArgs(args, outputDir.path)
    const request = normalized.request
    const dimensionError = validateDimensions(request.width, request.height)
    if (dimensionError) {
      return { ok: false, content: dimensionError }
    }

    const canonicalCwd = await realpath(context.config.cwd)
    const canonicalExistingParent = await nearestExistingCanonicalParent(outputDir.path)
    if (!isUnderRoot(canonicalExistingParent, canonicalCwd)) {
      return { ok: false, content: 'Refusing to use T2I output directory outside current working directory.' }
    }

    await mkdir(outputDir.path, { recursive: true })
    const canonicalOutputDir = await realpath(outputDir.path)
    if (!isUnderRoot(canonicalOutputDir, canonicalCwd)) {
      return { ok: false, content: 'Refusing to use T2I output directory outside current working directory.' }
    }
    request.output_dir = canonicalOutputDir

    let response: Response
    try {
      response = await fetch(endpoint(context.config.t2i.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: `T2I worker request failed: ${message}` }
    }

    if (!response.ok) {
      const body = await response.text()
      return {
        ok: false,
        content: `T2I worker returned HTTP ${response.status} ${response.statusText}: ${body}`
      }
    }

    let workerJson: unknown
    try {
      workerJson = await readWorkerJson(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: `T2I worker returned ${message}` }
    }

    const parsed = workerResponseSchema.safeParse(workerJson)
    if (!parsed.success) {
      return { ok: false, content: `T2I worker returned unexpected response: ${parsed.error.message}` }
    }

    if (parsed.data.images.length !== request.count) {
      return {
        ok: false,
        content: `T2I worker returned image count mismatch: expected ${request.count} images but received ${parsed.data.images.length}.`
      }
    }

    const images = []
    for (const image of parsed.data.images) {
      const imagePath = await resolveWorkerImagePath(image.path, canonicalOutputDir)
      if (!imagePath.ok) {
        return imagePath
      }
      images.push({ ...image, path: imagePath.path })
    }

    const imageLines = images.flatMap((image, index) => {
      const lines = [
        `${index + 1}. absolute path: ${image.path}`,
        `   relative path: ${toRelativeDisplayPath(canonicalCwd, image.path)}`,
        `   seed: ${image.seed}`,
        `   size: ${image.width}x${image.height}`
      ]
      if (image.detail_regions !== undefined) {
        if (image.detail_regions > 0 && image.detail_enhanced === true) {
          lines.push(`   detail: enhanced ${image.detail_regions} regions`)
        } else if (image.detail_regions > 0) {
          lines.push(`   detail: detected ${image.detail_regions} regions but enhancement was not applied`)
        } else {
          lines.push('   detail: no regions detected')
        }
      }
      if (image.hires_upscaled === true) {
        lines.push(`   hires: ${image.hires_scale ?? request.hires_scale}x`)
      }
      if (image.postprocessed === true) {
        lines.push('   postprocess: BMAB-like')
      }
      if (image.eye_regions !== undefined) {
        if (image.eye_regions > 0 && image.eye_refined === true) {
          lines.push(`   eye refine: enhanced ${image.eye_regions} regions`)
        } else if (image.eye_regions === 0) {
          lines.push('   eye refine: no eye regions estimated')
        }
      }
      if (image.detail_targets !== undefined && image.detail_targets.length > 0) {
        lines.push(`   targets: ${image.detail_targets.join(', ')}`)
      }
      return lines
    })

    const imageWord = images.length === 1 ? 'image' : 'images'
    const adjustmentLines = normalized.presetAdjustments.length === 0
      ? ['adjusted: none']
      : normalized.presetAdjustments
        .map((adjustment) => `adjusted: ${adjustment.field} ${String(adjustment.from)} -> ${String(adjustment.to)}`)
    const presetLines = normalized.preset === undefined
      ? []
      : [
          `preset: ${normalized.preset}`,
          ...adjustmentLines
        ]
    return {
      ok: true,
      content: [
        `Generated ${images.length} ${imageWord} with ${parsed.data.model}.`,
        ...presetLines,
        `dynamic thresholding: ${request.dynamic_thresholding ? 'enabled' : 'disabled'}`,
        ...imageLines
      ].join('\n'),
      metadata: {
        model: parsed.data.model,
        images,
        preset: normalized.preset,
        preset_adjustments: normalized.presetAdjustments,
        dynamic_thresholding: {
          enabled: request.dynamic_thresholding,
          mimic_scale: request.dynamic_thresholding_mimic_scale,
          percentile: request.dynamic_thresholding_percentile
        }
      }
    }
  }
}

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './config.js'
import { contextInfoForRoute } from './models/provider-router.js'
import { createCoreTools } from './tools/index.js'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function isRemoteHttps(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function formatConfigDoctor(config: AppConfig): string {
  const interactiveContext = contextInfoForRoute(config, 'chat')
  const enabledTools = createCoreTools(config).map((tool) => tool.name)
  const disabledTools: string[] = []
  if (!config.features.bashEnabled) {
    disabledTools.push('bash')
  }
  if (!config.features.webSearchEnabled) {
    disabledTools.push('web_search')
  }
  if (!config.features.mcpEnabled) {
    disabledTools.push('mcp')
  }

  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') {
    missing.push('CYRENE_BASE_URL')
  }
  if (config.model.model.trim() === '') {
    missing.push('CYRENE_MODEL')
  }

  const warnings: string[] = []
  if (isRemoteHttps(config.model.baseUrl) && !config.model.apiKey?.trim()) {
    warnings.push('warning: CYRENE_API_KEY is not set for remote HTTPS endpoint')
  }

  const localServerPath = resolve(appRoot, 'server/start.sh')

  return [
    'Model:',
    `  baseUrl: ${config.model.baseUrl || '(missing)'}`,
    `  model: ${config.model.model || '(missing)'}`,
    `  provider: ${config.model.provider}`,
    `  strongModel: ${config.model.strongModel || '(missing)'}`,
    `  cheapModel: ${config.model.cheapModel || '(missing)'}`,
    `  thinkingMode: ${config.model.thinkingMode}`,
    `  interactiveContext: ${interactiveContext.contextWindowTokens} tokens`,
    `  apiKey: ${config.model.apiKey?.trim() ? 'configured' : 'missing'}`,
    `  missing: ${missing.length > 0 ? missing.join(', ') : 'none'}`,
    '',
    'Tools:',
    `  enabled: ${enabledTools.join(', ')}`,
    `  disabled: ${disabledTools.length > 0 ? disabledTools.join(', ') : 'none'}`,
    '',
    'Local fallback:',
    `  server/start.sh: ${existsSync(localServerPath) ? 'exists' : 'missing'}`,
    '  status: optional',
    '',
    'T2I: removed from runtime',
    'generate_image: unavailable',
    ...warnings.map((warning) => `\n${warning}`)
  ].join('\n') + '\n'
}

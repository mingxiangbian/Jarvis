import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from '../config.js'
import { createDefaultConfig } from '../config.js'
import { contextInfoForRoute } from '../models/provider-router.js'
import type { ThinkingMode } from '../models/types.js'
import {
  loadDaily,
  loadGlobalMemories,
  loadInstructionsIfExists,
  loadProjectMemories,
  loadRuleStack,
  loadSoul
} from '../memory.js'
import { formatLocalDate } from '../time.js'
import { createCoreTools } from '../tools/index.js'
import type { Tool } from '../tools/types.js'

export interface AgentRuntime {
  config: AppConfig
  systemPrompt: string
  tools: Tool<unknown>[]
}

export interface AgentRuntimeOverrides {
  thinkingMode?: ThinkingMode
}

export async function buildAgentRuntime(
  cwd: string,
  currentDate = new Date(),
  overrides: AgentRuntimeOverrides = {}
): Promise<AgentRuntime> {
  const currentFile = fileURLToPath(import.meta.url)
  const systemPromptPath = resolve(dirname(currentFile), '..', 'prompts/system.md')
  const config = applyRuntimeOverrides(createDefaultConfig(resolve(cwd)), overrides)
  const baseSystemPrompt = await readFile(systemPromptPath, 'utf8')
  const currentDateText = formatLocalDate(currentDate)
  const modelRoute = formatActiveModelRoute(config)
  const persona = await loadSoul(config.userCyreneDir, config.cwd)
  const rules = await loadRuleStack(config.cwd, config.userCyreneDir)
  const projectInstructions = await loadInstructionsIfExists(config.cwd)
  const projectMemories = await loadProjectMemories(config.cwd)
  const globalMemories = await loadGlobalMemories(config.userCyreneDir)
  const daily = await loadDaily(config.cwd, config.dailyLoadLines)
  const systemPrompt = [
    baseSystemPrompt.trimEnd(),
    `# currentDate\nToday's date is ${currentDateText}.`,
    modelRoute,
    persona,
    rules,
    projectInstructions,
    projectMemories,
    globalMemories,
    daily
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    config,
    systemPrompt,
    tools: createCoreTools(config)
  }
}

function applyRuntimeOverrides(config: AppConfig, overrides: AgentRuntimeOverrides): AppConfig {
  if (overrides.thinkingMode === undefined) {
    return config
  }

  return {
    ...config,
    model: {
      ...config.model,
      thinkingMode: overrides.thinkingMode
    }
  }
}

function formatActiveModelRoute(config: AppConfig): string {
  const context = contextInfoForRoute(config, 'chat')
  return [
    '## Active Model Route',
    `Provider: ${context.provider}`,
    `Chat model: ${context.model || '(not configured)'}`,
    `Thinking mode: ${context.thinkingMode}`,
    `Context window: ${context.contextWindowTokens} tokens`
  ].join('\n')
}

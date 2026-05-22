import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from '../config.js'
import { createDefaultConfig } from '../config.js'
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

export async function buildAgentRuntime(cwd: string, currentDate = new Date()): Promise<AgentRuntime> {
  const currentFile = fileURLToPath(import.meta.url)
  const systemPromptPath = resolve(dirname(currentFile), '..', 'prompts/system.md')
  const config = createDefaultConfig(resolve(cwd))
  const baseSystemPrompt = await readFile(systemPromptPath, 'utf8')
  const currentDateText = formatLocalDate(currentDate)
  const persona = await loadSoul(config.userJarvisDir)
  const rules = await loadRuleStack(config.cwd, config.userJarvisDir)
  const projectInstructions = await loadInstructionsIfExists(config.cwd)
  const projectMemories = await loadProjectMemories(config.cwd)
  const globalMemories = await loadGlobalMemories(config.userJarvisDir)
  const daily = await loadDaily(config.cwd, config.dailyLoadLines)
  const systemPrompt = [
    baseSystemPrompt.trimEnd(),
    `# currentDate\nToday's date is ${currentDateText}.`,
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
    tools: createCoreTools()
  }
}

#!/usr/bin/env -S npx tsx
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import chalk from 'chalk'
import { Command } from 'commander'
import { runAgentLoop } from './agent-loop.js'
import { createDefaultConfig } from './config.js'
import {
  loadDaily,
  loadGlobalMemories,
  loadInstructionsIfExists,
  loadProjectMemories,
  loadRuleStack,
  loadSoul
} from './memory.js'
import { runRepl } from './repl.js'
import { createCoreTools } from './tools/index.js'
import { createTerminalObserver } from './ui-observer.js'

const program = new Command()

async function main(): Promise<void> {
  program
    .name('cc-local')
    .description('Local Claude Code-style agent powered by an OpenAI-compatible MLX server.')
    .argument('[prompt...]', 'task for the agent')
    .option('--cwd <path>', 'working directory', process.cwd())
    .option('--repl', 'start an interactive session')

  program.parse()

  const options = program.opts<{ cwd: string; repl?: boolean }>()
  const prompt = program.args.join(' ').trim()
  if (!options.repl && !prompt) {
    console.error('Prompt cannot be empty.')
    process.exit(1)
  }

  const currentFile = fileURLToPath(import.meta.url)
  const systemPromptPath = resolve(dirname(currentFile), 'prompts/system.md')
  const config = createDefaultConfig(resolve(options.cwd))
  const baseSystemPrompt = await readFile(systemPromptPath, 'utf8')
  const currentDate = new Date().toISOString().slice(0, 10)
  const persona = await loadSoul(config.userCcLocalDir)
  const rules = await loadRuleStack(config.cwd, config.userCcLocalDir)
  const projectInstructions = await loadInstructionsIfExists(config.cwd)
  const projectMemories = await loadProjectMemories(config.cwd)
  const globalMemories = await loadGlobalMemories(config.userCcLocalDir)
  const daily = await loadDaily(config.cwd, config.dailyLoadLines)
  const systemPrompt = [
    baseSystemPrompt.trimEnd(),
    `# currentDate\nToday's date is ${currentDate}.`,
    persona,
    rules,
    projectInstructions,
    projectMemories,
    globalMemories,
    daily
  ]
    .filter(Boolean)
    .join('\n\n')
  const tools = createCoreTools()

  if (options.repl) {
    await runRepl({ config, systemPrompt, tools })
    return
  }

  const observer = createTerminalObserver(process.stderr)
  const result = await runAgentLoop({
    config,
    observer,
    systemPrompt,
    userPrompt: prompt,
    tools
  })

  console.log(chalk.green(result.finalText))
  if (result.toolCallCount > 0) {
    console.log(chalk.dim(`tool calls: ${result.toolCallCount}`))
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import chalk from 'chalk'
import { Command } from 'commander'
import { runAgentLoop } from './agent-loop.js'
import { createDefaultConfig } from './config.js'
import { loadInstructionsIfExists } from './memory.js'
import { runRepl } from './repl.js'
import { createCoreTools } from './tools/index.js'

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
  const projectInstructions = await loadInstructionsIfExists(config.cwd)
  const systemPrompt = projectInstructions
    ? `${baseSystemPrompt.trimEnd()}\n\n${projectInstructions}`
    : baseSystemPrompt
  const tools = createCoreTools()

  if (options.repl) {
    await runRepl({ config, systemPrompt, tools })
    return
  }

  const result = await runAgentLoop({
    config,
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

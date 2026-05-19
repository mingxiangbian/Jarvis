#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { runAgentLoop } from './agent-loop.js'
import { runRepl } from './repl.js'
import { createTerminalObserver } from './ui-observer.js'
import { buildAgentRuntime } from './web/prompt-context.js'
import { startWebServer } from './web/server.js'

const program = new Command()

async function main(): Promise<void> {
  program
    .name('cc-local')
    .description('Local Claude Code-style agent powered by an OpenAI-compatible MLX server.')
    .argument('[prompt...]', 'task for the agent')
    .option('--cwd <path>', 'working directory', process.cwd())
    .option('--repl', 'start an interactive session')
    .option('--web', 'start local Web console')
    .option('--host <host>', 'host for the Web console', '127.0.0.1')
    .option('--port <port>', 'port for the Web console', '4317')

  program.parse()

  const options = program.opts<{ cwd: string; repl?: boolean; web?: boolean; host: string; port: string }>()
  const prompt = program.args.join(' ').trim()
  if (options.web && prompt) {
    console.error('--web cannot be combined with a prompt.')
    process.exit(1)
  }
  if (options.web && options.repl) {
    console.error('--web cannot be combined with --repl.')
    process.exit(1)
  }
  if (!options.repl && !options.web && !prompt) {
    console.error('Prompt cannot be empty.')
    process.exit(1)
  }
  const validPortString = /^(0|[1-9]\d*)$/.test(options.port)
  const port = validPortString ? Number(options.port) : NaN
  if (options.web && (!validPortString || port < 0 || port > 65535)) {
    console.error('--port must be an integer from 0 to 65535.')
    process.exit(1)
  }

  const { config, systemPrompt, tools } = await buildAgentRuntime(options.cwd)

  if (options.web) {
    const server = await startWebServer({ cwd: config.cwd, host: options.host, port })
    console.log(`cc-local web listening at ${server.url}`)
    await new Promise(() => {})
    return
  }

  if (options.repl) {
    await runRepl({ config, systemPrompt, tools })
    return
  }

  const observer = createTerminalObserver(process.stderr, { spinner: false, responseDivider: false })
  const result = await runAgentLoop({
    config,
    observer,
    systemPrompt,
    userPrompt: prompt,
    tools
  })

  console.log(result.finalText)
  if (result.toolCallCount > 0) {
    console.error(`tool calls: ${result.toolCallCount}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})

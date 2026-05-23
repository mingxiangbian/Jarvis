#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { runAgentLoop } from './agent-loop.js'
import { createDefaultConfig } from './config.js'
import { formatConfigDoctor } from './config-doctor.js'
import { buildInitialMessages } from './context.js'
import { compactDailyIfNeeded } from './daily-compaction.js'
import { callModel as defaultCallModel } from './llm-client.js'
import { contextInfoForRoute } from './models/provider-router.js'
import { runRepl } from './repl.js'
import { createRunRecorder } from './tracing/run-recorder.js'
import { renderTraceReplay } from './tracing/replay.js'
import { createTerminalObserver } from './ui-observer.js'
import { buildAgentRuntime } from './web/prompt-context.js'
import { startWebServer } from './web/server.js'

const program = new Command()

async function main(): Promise<void> {
  program
    .name('cyrene')
    .description('Cyrene local coding agent powered by an OpenAI-compatible MLX server.')
    .argument('[prompt...]', 'task for the agent')
    .option('--cwd <path>', 'working directory', process.cwd())
    .option('--repl', 'start an interactive session')
    .option('--resume <sessionId>', 'resume a saved REPL session')
    .option('--web', 'start local Web console')
    .option('--host <host>', 'host for the Web console', '127.0.0.1')
    .option('--port <port>', 'port for the Web console', '4317')

  program.parse()

  const options = program.opts<{ cwd: string; repl?: boolean; resume?: string; web?: boolean; host: string; port: string }>()
  if (program.args[0] === 'config') {
    if (program.args.length !== 2 || program.args[1] !== 'doctor') {
      console.error('Usage: cyrene config doctor')
      process.exit(1)
    }
    const config = createDefaultConfig(options.cwd)
    console.log(formatConfigDoctor(config))
    return
  }
  if (program.args[0] === 'trace') {
    if (program.args.length !== 3 || program.args[1] !== 'replay') {
      console.error('Usage: cyrene trace replay <runId>')
      process.exit(1)
    }
    process.stdout.write(await renderTraceReplay(options.cwd, program.args[2]))
    return
  }

  const prompt = program.args.join(' ').trim()
  if (options.web && prompt) {
    console.error('--web cannot be combined with a prompt.')
    process.exit(1)
  }
  if (options.web && options.repl) {
    console.error('--web cannot be combined with --repl.')
    process.exit(1)
  }
  if (options.resume && !options.repl) {
    console.error('--resume can only be used with --repl.')
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
    console.log(`cyrene web listening at ${server.url}`)
    await new Promise(() => {})
    return
  }

  if (options.repl) {
    await runRepl({ config, systemPrompt, tools, resumeSessionId: options.resume })
    return
  }

  const observer = createTerminalObserver(process.stderr, { spinner: false, responseDivider: false })
  const messages = buildInitialMessages(systemPrompt, prompt)
  const recorder = await createRunRecorder({
    cwd: config.cwd,
    mode: 'cli',
    userMessage: { role: 'user', content: prompt },
    modelContext: contextInfoForRoute(config, 'chat')
  })

  try {
    const result = await runAgentLoop({
      config,
      observer: recorder.createObserver(observer),
      messages,
      tools,
      callModel: recorder.wrapCallModel(defaultCallModel)
    })

    await recorder.recordMessages(messages.slice(1))
    await recorder.finalize({ status: 'ok', finalText: result.finalText })

    console.log(result.finalText)
    if (result.toolCallCount > 0) {
      console.error(`tool calls: ${result.toolCallCount}`)
    }
    if (recorder.dir !== undefined) {
      console.error(`trace: .cyrene/runs/${recorder.runId}`)
    }
    await compactDailyIfNeeded({ cwd: config.cwd, config })
  } catch (error) {
    await recorder.recordMessages(messages.slice(1))
    await recorder.finalize({ status: 'error', finalText: '', error })
    throw error
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})

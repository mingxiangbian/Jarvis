#!/usr/bin/env -S npx tsx
import { Command } from 'commander'
import { join } from 'node:path'
import { runAgentLoop } from './agent-loop.js'
import { createDefaultConfig } from './config.js'
import { formatConfigDoctor } from './config-doctor.js'
import { buildInitialMessages } from './context.js'
import { compactDailyIfNeeded } from './daily-compaction.js'
import { callModel as defaultCallModel } from './llm-client.js'
import { migrateLegacyMemory } from './memory/memory-migration.js'
import { formatMemoryContext, retrieveMemories } from './memory/memory-retriever.js'
import { createMemorySnapshot, listMemorySnapshots, restoreMemorySnapshot } from './memory/memory-snapshot.js'
import { readActiveMemories, readMemoryEvents, readPendingMemories } from './memory/memory-store.js'
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
  if (program.args[0] === 'memory') {
    await handleMemoryCommand(options.cwd, program.args.slice(1))
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

async function handleMemoryCommand(cwd: string, args: string[]): Promise<void> {
  const command = args[0]
  if (command === 'list') {
    const memories = await readActiveMemories(cwd)
    process.stdout.write(memories.map(formatMemoryLine).join('\n') + (memories.length === 0 ? '' : '\n'))
    return
  }

  if (command === 'pending') {
    const memories = await readPendingMemories(cwd)
    process.stdout.write(memories.map(formatMemoryLine).join('\n') + (memories.length === 0 ? '' : '\n'))
    return
  }

  if (command === 'events') {
    const limit = parseLimit(args)
    process.stdout.write(JSON.stringify(await readMemoryEvents(cwd, limit), null, 2) + '\n')
    return
  }

  if (command === 'inspect' && args[1] !== undefined) {
    const memories = [...(await readActiveMemories(cwd)), ...(await readPendingMemories(cwd))]
    const memory = memories.find((entry) => entry.id === args[1])
    if (memory === undefined) {
      console.error(`Memory not found: ${args[1]}`)
      process.exit(1)
    }
    process.stdout.write(JSON.stringify(memory, null, 2) + '\n')
    return
  }

  if (command === 'search' && args.length > 1) {
    const result = await retrieveMemories({
      cwd,
      userCyreneDir: join(cwd, '.cyrene'),
      query: args.slice(1).join(' '),
      task: 'memory',
      maxItems: 10,
      maxTokens: 1000
    })
    process.stdout.write(formatMemoryContext(result))
    if (result.length > 0) process.stdout.write('\n')
    return
  }

  if (command === 'migrate') {
    process.stdout.write(JSON.stringify(await migrateLegacyMemory(cwd), null, 2) + '\n')
    return
  }

  if (command === 'snapshot') {
    await handleMemorySnapshotCommand(cwd, args.slice(1))
    return
  }

  console.error(
    'Usage: cyrene memory <list|pending|events|inspect <id>|search <query>|migrate|snapshot <list|create|restore>>'
  )
  process.exit(1)
}

async function handleMemorySnapshotCommand(cwd: string, args: string[]): Promise<void> {
  if (args[0] === 'list') {
    process.stdout.write(JSON.stringify(await listMemorySnapshots(cwd), null, 2) + '\n')
    return
  }

  if (args[0] === 'create') {
    const reason = args.slice(1).join(' ').trim() || 'manual snapshot'
    process.stdout.write(JSON.stringify(await createMemorySnapshot(cwd, reason), null, 2) + '\n')
    return
  }

  if (args[0] === 'restore' && args[1] !== undefined) {
    process.stdout.write(
      JSON.stringify(await restoreMemorySnapshot({ cwd, snapshotId: args[1], dryRun: args.includes('--dry-run') }), null, 2) +
        '\n'
    )
    return
  }

  console.error('Usage: cyrene memory snapshot <list|create [reason]|restore <snapshotId> [--dry-run]>')
  process.exit(1)
}

function formatMemoryLine(memory: {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  content: string
}): string {
  return `${memory.id}\t${memory.domain}/${memory.type}\t${memory.strength}/${memory.scope}\t${memory.content}`
}

function parseLimit(args: string[]): number | undefined {
  const index = args.indexOf('--limit')
  if (index < 0) return undefined
  const parsed = Number(args[index + 1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})

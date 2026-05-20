import { stderr, stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import chalk from 'chalk'
import { runAgentLoop } from './agent-loop.js'
import type { AppConfig } from './config.js'
import {
  compactDailyIfNeeded as defaultCompactDailyIfNeeded,
  type CompactDailyIfNeededInput
} from './daily-compaction.js'
import { callModel as defaultCallModel, type CallModelInput, type ChatMessage, type ModelResponse } from './llm-client.js'
import type { Tool, ToolContext } from './tools/types.js'
import { createTerminalObserver, renderWelcome, type AgentObserver } from './ui-observer.js'

export interface RunReplTurnInput {
  config: AppConfig
  /** Mutable session history. runReplTurn appends the user turn and agent responses in place. */
  messages: ChatMessage[]
  input: string
  tools: Tool<unknown>[]
  observer?: AgentObserver
  toolContext?: ToolContext
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

export type RunReplTurnResult =
  | { kind: 'exit' }
  | { kind: 'handled'; output?: string }
  | { kind: 'agent'; finalText: string; toolCallCount: number }

interface ReplReadline {
  question(prompt: string): Promise<string>
  close(): void
}

export async function runReplTurn(input: RunReplTurnInput): Promise<RunReplTurnResult> {
  const text = input.input.trim()
  if (text === '') {
    return { kind: 'handled' }
  }

  if (isExitInput(text)) {
    return { kind: 'exit' }
  }

  if (text === '/help') {
    return {
      kind: 'handled',
      output: [
        'Commands:',
        '  /help          Show this help',
        '  /model         Show model info',
        '  exit, quit, q  Exit REPL'
      ].join('\n')
    }
  }

  if (text === '/model') {
    return {
      kind: 'handled',
      output: [`Model:  ${input.config.model.model}`, `API:    ${input.config.model.baseUrl}`].join('\n')
    }
  }

  input.messages.push({ role: 'user', content: text })
  const result = await runAgentLoop({
    config: input.config,
    messages: input.messages,
    tools: input.tools,
    observer: input.observer,
    toolContext: input.toolContext,
    callModel: input.callModel
  })

  return { kind: 'agent', finalText: result.finalText, toolCallCount: result.toolCallCount }
}

export async function runRepl(inputConfig: {
  config: AppConfig
  systemPrompt: string
  tools: Tool<unknown>[]
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
  readline?: ReplReadline
  compactDailyIfNeeded?: (input: CompactDailyIfNeededInput) => Promise<void>
}): Promise<void> {
  const messages: ChatMessage[] = [{ role: 'system', content: inputConfig.systemPrompt }]
  const toolContext: ToolContext = {
    config: inputConfig.config,
    trackedFiles: new Set<string>()
  }
  const rl = inputConfig.readline ?? createInterface({ input, output })
  const observer = createTerminalObserver(stderr)
  let gracefulExit = false

  try {
    console.log(renderWelcome({ modelName: inputConfig.config.model.model }))

    while (true) {
      const line = await rl.question('> ')
      const result = await runReplTurn({
        config: inputConfig.config,
        messages,
        input: line,
        tools: inputConfig.tools,
        observer,
        toolContext,
        callModel: inputConfig.callModel
      })

      if (result.kind === 'exit') {
        gracefulExit = true
        break
      }

      if (result.kind === 'handled') {
        if (result.output) {
          console.log(result.output)
        }
        continue
      }

      console.log(chalk.green(result.finalText))
      if (result.toolCallCount > 0) {
        console.error(chalk.dim(`tool calls: ${result.toolCallCount}`))
      }
    }
  } finally {
    rl.close()
  }

  if (gracefulExit) {
    await (inputConfig.compactDailyIfNeeded ?? defaultCompactDailyIfNeeded)({
      cwd: inputConfig.config.cwd,
      config: inputConfig.config,
      callModel: inputConfig.callModel ?? defaultCallModel
    })
  }
}

function isExitInput(input: string): boolean {
  return input === 'exit' || input === 'quit' || input === 'q'
}

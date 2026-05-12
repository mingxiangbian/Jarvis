import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import chalk from 'chalk'
import { runAgentLoop } from './agent-loop.js'
import type { AppConfig } from './config.js'
import type { CallModelInput, ChatMessage, ModelResponse } from './llm-client.js'
import type { Tool, ToolContext } from './tools/types.js'

export interface RunReplTurnInput {
  config: AppConfig
  messages: ChatMessage[]
  input: string
  tools: Tool<unknown>[]
  toolContext?: ToolContext
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

export type RunReplTurnResult =
  | { exit: true }
  | { exit: false; finalText: string; toolCallCount: number }

export async function runReplTurn(input: RunReplTurnInput): Promise<RunReplTurnResult> {
  const text = input.input.trim()
  if (isExitInput(text)) {
    return { exit: true }
  }

  input.messages.push({ role: 'user', content: text })
  const result = await runAgentLoop({
    config: input.config,
    messages: input.messages,
    tools: input.tools,
    toolContext: input.toolContext,
    callModel: input.callModel
  })

  return { exit: false, finalText: result.finalText, toolCallCount: result.toolCallCount }
}

export async function runRepl(inputConfig: {
  config: AppConfig
  systemPrompt: string
  tools: Tool<unknown>[]
}): Promise<void> {
  const messages: ChatMessage[] = [{ role: 'system', content: inputConfig.systemPrompt }]
  const toolContext: ToolContext = {
    config: inputConfig.config,
    trackedFiles: new Set<string>()
  }
  const rl = createInterface({ input, output })

  try {
    while (true) {
      const line = await rl.question('> ')
      const result = await runReplTurn({
        config: inputConfig.config,
        messages,
        input: line,
        tools: inputConfig.tools,
        toolContext
      })

      if (result.exit) {
        break
      }

      console.log(chalk.green(result.finalText))
      if (result.toolCallCount > 0) {
        console.log(chalk.dim(`tool calls: ${result.toolCallCount}`))
      }
    }
  } finally {
    rl.close()
  }
}

function isExitInput(input: string): boolean {
  return input === 'exit' || input === 'quit' || input === 'q'
}

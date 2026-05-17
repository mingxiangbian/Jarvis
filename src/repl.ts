import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import chalk from 'chalk'
import { runAgentLoop } from './agent-loop.js'
import type { AppConfig } from './config.js'
import { callModel as defaultCallModel, type CallModelInput, type ChatMessage, type ModelResponse } from './llm-client.js'
import {
  compactMemories as defaultCompactMemories,
  loadDailyRaw,
  type CompactMemoriesInput,
  type CompactMemoriesResult
} from './memory.js'
import type { Tool, ToolContext } from './tools/types.js'

export interface RunReplTurnInput {
  config: AppConfig
  /** Mutable session history. runReplTurn appends the user turn and agent responses in place. */
  messages: ChatMessage[]
  input: string
  tools: Tool<unknown>[]
  toolContext?: ToolContext
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

export type RunReplTurnResult =
  | { exit: true }
  | { exit: false; finalText: string; toolCallCount: number }

interface ReplReadline {
  question(prompt: string): Promise<string>
  close(): void
}

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
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
  readline?: ReplReadline
  compactMemories?: (input: CompactMemoriesInput) => Promise<CompactMemoriesResult>
}): Promise<void> {
  const messages: ChatMessage[] = [{ role: 'system', content: inputConfig.systemPrompt }]
  const toolContext: ToolContext = {
    config: inputConfig.config,
    trackedFiles: new Set<string>()
  }
  const rl = inputConfig.readline ?? createInterface({ input, output })
  let gracefulExit = false

  try {
    while (true) {
      const line = await rl.question('> ')
      const result = await runReplTurn({
        config: inputConfig.config,
        messages,
        input: line,
        tools: inputConfig.tools,
        toolContext,
        callModel: inputConfig.callModel
      })

      if (result.exit) {
        gracefulExit = true
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

  if (gracefulExit) {
    await compactReplDaily(
      inputConfig.config,
      inputConfig.callModel ?? defaultCallModel,
      inputConfig.compactMemories ?? defaultCompactMemories
    )
  }
}

async function compactReplDaily(
  config: AppConfig,
  callModel: (input: CallModelInput) => Promise<ModelResponse>,
  compactMemories: (input: CompactMemoriesInput) => Promise<CompactMemoriesResult>
): Promise<void> {
  const dailyContent = await loadDailyRaw(config.cwd)
  if (countNonEmptyLines(dailyContent) < config.dailyCompactThreshold) {
    return
  }

  try {
    await compactMemories({
      cwd: config.cwd,
      dailyContent,
      config,
      callModel
    })
  } catch {
    // Daily compaction should not prevent REPL exit.
  }
}

function countNonEmptyLines(content: string): number {
  return content.split(/\r?\n/).filter((line) => line.trim() !== '').length
}

function isExitInput(input: string): boolean {
  return input === 'exit' || input === 'quit' || input === 'q'
}

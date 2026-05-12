import { buildInitialMessages, compactToolResult } from './context.js'
import type { AppConfig } from './config.js'
import { callModel as defaultCallModel, type ChatMessage, type ModelResponse } from './llm-client.js'
import { executeToolCall, toolDefinitions } from './tools/index.js'
import type { Tool, ToolContext } from './tools/types.js'

export interface RunAgentLoopInput {
  config: AppConfig
  systemPrompt: string
  userPrompt: string
  tools: Tool<unknown>[]
  callModel?: (input: {
    config: AppConfig
    messages: ChatMessage[]
    tools: unknown[]
  }) => Promise<ModelResponse>
}

export interface RunAgentLoopResult {
  finalText: string
  toolCallCount: number
}

export async function runAgentLoop(input: RunAgentLoopInput): Promise<RunAgentLoopResult> {
  const messages = buildInitialMessages(input.systemPrompt, input.userPrompt)
  const callModel = input.callModel ?? defaultCallModel
  const context: ToolContext = {
    config: input.config,
    trackedFiles: new Set<string>()
  }
  let toolCallCount = 0

  while (toolCallCount < input.config.maxToolCallsPerTurn) {
    const response = await callModel({
      config: input.config,
      messages,
      tools: toolDefinitions(input.tools)
    })

    if (response.toolCalls.length === 0) {
      return { finalText: response.content, toolCallCount }
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.toolCalls
    })

    for (const toolCall of response.toolCalls) {
      toolCallCount += 1
      const result = await executeToolCall(
        {
          id: toolCall.id,
          name: toolCall.function.name,
          argumentsText: toolCall.function.arguments
        },
        input.tools,
        context
      )

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: compactToolResult(result.content, 120)
      })

      if (toolCallCount >= input.config.maxToolCallsPerTurn) {
        break
      }
    }
  }

  return {
    finalText: `Stopped after ${input.config.maxToolCallsPerTurn} tool calls to avoid an infinite loop.`,
    toolCallCount
  }
}

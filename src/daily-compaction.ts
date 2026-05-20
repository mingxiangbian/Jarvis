import type { AppConfig } from './config.js'
import { callModel as defaultCallModel, type CallModelInput, type ModelResponse } from './llm-client.js'
import {
  compactMemories as defaultCompactMemories,
  loadDailyRaw,
  type CompactMemoriesInput,
  type CompactMemoriesResult
} from './memory.js'

export interface CompactDailyIfNeededInput {
  cwd: string
  config: AppConfig
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
  compactMemories?: (input: CompactMemoriesInput) => Promise<CompactMemoriesResult>
}

export async function compactDailyIfNeeded(input: CompactDailyIfNeededInput): Promise<void> {
  try {
    const dailyContent = await loadDailyRaw(input.cwd)
    if (countNonEmptyLines(dailyContent) < input.config.dailyCompactThreshold) {
      return
    }

    await (input.compactMemories ?? defaultCompactMemories)({
      cwd: input.cwd,
      dailyContent,
      config: input.config,
      callModel: input.callModel ?? defaultCallModel
    })
  } catch {
    // Daily compaction is best effort and should not block entry points.
  }
}

function countNonEmptyLines(content: string): number {
  return content.split(/\r?\n/).filter((line) => line.trim() !== '').length
}

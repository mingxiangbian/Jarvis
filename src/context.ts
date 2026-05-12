import type { ChatMessage } from './llm-client.js'

export function buildInitialMessages(systemPrompt: string, userPrompt: string): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]
}

export function compactToolResult(content: string, maxLines: number): string {
  const lines = content.split(/\r?\n/)
  if (lines.length <= maxLines) {
    return content
  }

  const headCount = Math.max(1, Math.floor(maxLines * 0.6))
  const tailCount = Math.max(1, maxLines - headCount - 1)
  return [
    ...lines.slice(0, headCount),
    `[tool output compacted: ${lines.length} lines total]`,
    ...lines.slice(-tailCount)
  ].join('\n')
}

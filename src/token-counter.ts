import type { ChatMessage } from './llm-client.js'

export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0
  }

  let estimate = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (isCjk(codePoint)) {
      estimate += 1
    } else if (codePoint <= 0x7f) {
      estimate += 0.25
    } else {
      estimate += 0.5
    }
  }

  return Math.ceil(estimate)
}

export function estimateTokensForMessages(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(messageText(message)), 0)
}

function messageText(message: ChatMessage): string {
  const parts = [message.content]
  if (message.tool_call_id) {
    parts.push(message.tool_call_id)
  }
  if (message.tool_calls) {
    parts.push(JSON.stringify(message.tool_calls))
  }
  return parts.join('\n')
}

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  )
}

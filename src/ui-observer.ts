import { basename } from 'node:path'
import * as readline from 'node:readline'
import chalk from 'chalk'

export interface AgentObserver {
  onThinkingStart(): void
  onThinkingStop(durationMs: number): void
  onToolCallStart(name: string, summary: string): void
  onToolCallResult(name: string, ok: boolean, durationMs: number, summary: string): void
  onResponse(text: string): void
}

export const PRISM_THEME = {
  colors: {
    fogWhite: '#F8FBFF',
    iceWhite: '#EAF7FF',
    paleCyan: '#DDF7F8',
    softPink: '#F7A8CF',
    lavender: '#D8B7FF',
    iceCyan: '#86E6F1',
    glassBlue: '#B7D7FF',
    ink: '#2F3545',
    muted: '#6F7A90'
  }
} as const

export function toolIcon(name: string): string {
  if (name === 'file_read' || name === 'grep' || name === 'glob') return '📖'
  if (name === 'file_edit' || name === 'file_write') return '✏️'
  if (name === 'bash') return '⚡'
  if (name === 'web_search') return '🌐'
  if (name === 'ask_user') return '💬'
  return '🔧'
}

export function truncateOneLine(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(maxLength - 3, 0))}...`
}

export function toolCallSummary(name: string, argumentsText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    return truncateOneLine(argumentsText, 40)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return truncateOneLine(argumentsText, 40)
  }

  const args = parsed as Record<string, unknown>
  const fallback = (): string => truncateOneLine(argumentsText, 40)

  const stringArg = (key: string): string | undefined => {
    const value = args[key]
    return typeof value === 'string' ? value : undefined
  }

  if (name === 'file_read' || name === 'file_write') {
    const filePath = stringArg('file_path')
    return filePath === undefined ? fallback() : basename(filePath)
  }
  if (name === 'file_edit') {
    const filePath = stringArg('file_path')
    if (filePath === undefined) return fallback()
    const file = basename(filePath)
    const line = args.line
    return typeof line === 'number' ? `${file}:${line}` : file
  }
  if (name === 'grep' || name === 'glob') {
    const pattern = stringArg('pattern')
    return pattern === undefined ? fallback() : truncateOneLine(pattern, 60)
  }
  if (name === 'bash') {
    const command = stringArg('command')
    return command === undefined ? fallback() : truncateOneLine(command, 60)
  }
  if (name === 'web_search') {
    const query = stringArg('query')
    return query === undefined ? fallback() : truncateOneLine(query, 60)
  }
  if (name === 'ask_user') {
    const question = stringArg('question')
    return question === undefined ? fallback() : truncateOneLine(question, 60)
  }
  return fallback()
}

function maybeColor(text: string, color: boolean, style: (input: string) => string): string {
  return color ? style(text) : text
}

export function renderPrismMascot(options: { color?: boolean } = {}): string {
  const color = options.color ?? true
  const pink = (text: string) => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.softPink))
  const cyan = (text: string) => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.iceCyan))
  const blue = (text: string) => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.glassBlue))
  const violet = (text: string) => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.lavender))
  const dim = (text: string) => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.muted))

  return [
    `${violet('       ✦')} ${dim('prism agent')}`,
    `${pink('    ╭╲╲ pink hair ╱╱╮')} ${cyan('clip')}`,
    `${pink('   ╱  ◕     ◕   ╲')} ${violet('soft eyes')}`,
    `${pink('  │     ▿        │')} ${dim('daily ai')}`,
    `${pink('  ╰╮  braid  ╭╯')} ${pink('braid')}`,
    `${blue('    ╲ ice coat ╱')} ${cyan('✦')}`,
    `${blue('     ╰─ prism ─╯')}`
  ].join('\n')
}

export function renderWelcome(input: { modelName: string; color?: boolean }): string {
  const color = input.color ?? true
  const title = color
    ? `${chalk.hex(PRISM_THEME.colors.iceCyan)('cc-local')} ${chalk.hex(PRISM_THEME.colors.lavender)('·')} ${chalk.hex(PRISM_THEME.colors.softPink)('Prism Agent')}`
    : 'cc-local · Prism Agent'
  const model = color ? chalk.hex(PRISM_THEME.colors.muted)(`${input.modelName} · /help`) : `${input.modelName} · /help`
  return `${renderPrismMascot({ color })}\n${title}\n${model}`
}

export type OutputStream = NodeJS.WriteStream | (NodeJS.WritableStream & { columns?: number })

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function seconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`
}

function write(output: NodeJS.WritableStream, text: string): void {
  output.write(text)
}

function clearCurrentLine(output: NodeJS.WritableStream): void {
  readline.clearLine(output, 0)
  readline.cursorTo(output, 0)
}

function terminalWidth(output: OutputStream): number {
  const columns = typeof output.columns === 'number' ? output.columns : 60
  return Math.min(Math.max(columns, 20), 100)
}

export function createTerminalObserver(
  output: OutputStream = process.stderr,
  options: { color?: boolean; spinner?: boolean } = {}
): AgentObserver {
  const color = options.color ?? true
  const spinnerEnabled = options.spinner ?? true
  let spinner: ReturnType<typeof setInterval> | undefined
  let thinkingStartedAt = 0
  let frameIndex = 0

  const dim = (text: string): string => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.muted))
  const cyan = (text: string): string => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.iceCyan))
  const pink = (text: string): string => maybeColor(text, color, chalk.hex(PRISM_THEME.colors.softPink))

  const stopSpinner = (): void => {
    if (spinner === undefined) return
    clearInterval(spinner)
    spinner = undefined
    clearCurrentLine(output)
  }

  const renderThinking = (): void => {
    clearCurrentLine(output)
    const elapsedMs = Date.now() - thinkingStartedAt
    write(output, `${cyan(SPINNER_FRAMES[frameIndex])} ${dim(`Thinking ${seconds(elapsedMs)}`)}`)
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
  }

  return {
    onThinkingStart(): void {
      if (!spinnerEnabled) return
      stopSpinner()
      thinkingStartedAt = Date.now()
      frameIndex = 0
      renderThinking()
      spinner = setInterval(renderThinking, 100)
    },
    onThinkingStop(_durationMs: number): void {
      stopSpinner()
    },
    onToolCallStart(name: string, summary: string): void {
      stopSpinner()
      const maxSummary = Math.max(10, terminalWidth(output) - name.length - 8)
      write(output, `${toolIcon(name)} ${cyan(name)} ${dim('·')} ${truncateOneLine(summary, maxSummary)} `)
    },
    onToolCallResult(_name: string, ok: boolean, durationMs: number, summary: string): void {
      if (ok) {
        write(output, `${maybeColor('✓', color, chalk.green)} ${seconds(durationMs)}\n`)
        return
      }
      write(output, `${pink('✗')} ${truncateOneLine(summary, 80)}\n`)
    },
    onResponse(_text: string): void {
      stopSpinner()
      write(output, `${dim('─'.repeat(terminalWidth(output)))}\n`)
    }
  }
}

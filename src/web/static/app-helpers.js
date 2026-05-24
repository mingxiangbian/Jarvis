export function buildRunRequestBody({ sessionId, message, workspaceId, thinkingMode, disabledTools }) {
  return {
    sessionId,
    message,
    workspaceId,
    ...(isValidThinkingMode(thinkingMode) ? { thinkingMode } : {}),
    ...(Array.isArray(disabledTools) && disabledTools.length > 0 ? { disabledTools } : {})
  }
}

export function isValidThinkingMode(value) {
  return value === 'auto' || value === 'on' || value === 'off'
}

export function nextThinkingMode(value) {
  if (value === 'auto') {
    return 'on'
  }
  if (value === 'on') {
    return 'off'
  }
  return 'auto'
}

export function thinkingModeButtonLabel(value) {
  if (value === 'on') {
    return 'Think: On'
  }
  if (value === 'off') {
    return 'Think: Off'
  }
  return 'Think: Auto'
}

export function encodedWorkspaceId(workspaceId) {
  return workspaceId === '' ? '@root' : encodeURIComponent(workspaceId)
}

export function isWorkspaceLockedState(state) {
  return Boolean(state.isSending || state.activeRun !== null)
}

export function estimateContextTokens(messages, draft = '') {
  const messageTokens = (Array.isArray(messages) ? messages : [])
    .reduce((total, message) => total + estimateTokens(message?.content || ''), 0)
  return messageTokens + estimateTokens(draft)
}

export function contextUsagePercent({ messages, draft = '', contextWindowTokens = 256_000 }) {
  if (contextWindowTokens <= 0) {
    return 0
  }
  const tokens = estimateContextTokens(messages, draft)
  if (tokens === 0) {
    return 0
  }
  return Math.min(100, Math.max(1, Math.round((tokens / contextWindowTokens) * 100)))
}

export function contextUsageLabel({ percent, modelContext }) {
  const model = modelContext?.model || 'current model'
  const contextWindow = formatContextWindowTokens(modelContext?.contextWindowTokens)
  return `Context usage ${percent}% of ${model}${contextWindow ? ` ${contextWindow}` : ''}`
}

export function formatContextWindowTokens(contextWindowTokens) {
  if (typeof contextWindowTokens !== 'number' || contextWindowTokens <= 0) {
    return ''
  }
  if (contextWindowTokens >= 1_000_000) {
    const value = contextWindowTokens / 1_048_576
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`
  }
  if (contextWindowTokens >= 1_000) {
    const value = contextWindowTokens / 1_000
    return Number.isInteger(value) ? `${value}K` : `${value.toFixed(1)}K`
  }
  return `${contextWindowTokens}`
}

export function ownsMarkdownFilesResponse({
  currentToken,
  responseToken,
  currentWorkspaceId,
  responseWorkspaceId
}) {
  return currentToken === responseToken && currentWorkspaceId === responseWorkspaceId
}

export function ownsMarkdownFileResponse({
  currentToken,
  responseToken,
  currentWorkspaceId,
  responseWorkspaceId,
  currentFileId,
  responseFileId
}) {
  return ownsMarkdownFilesResponse({
    currentToken,
    responseToken,
    currentWorkspaceId,
    responseWorkspaceId
  }) && currentFileId === responseFileId
}

export function renderMarkdownHtml(markdown, options = {}) {
  const parts = []
  const lines = String(markdown || '').split(/\r?\n/)
  let paragraph = []
  let list = []
  let codeLines = []
  let inCode = false

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return
    }
    parts.push(`<p>${escapeHtml(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list.length === 0) {
      return
    }
    parts.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
    list = []
  }
  const flushCode = () => {
    parts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = []
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushParagraph()
        flushList()
        inCode = true
        codeLines = []
      }
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    const image = parseMarkdownImagePreviewLine(line)
    if (image && isSafeMarkdownImagePath(image.path)) {
      flushParagraph()
      flushList()
      const src = buildWorkspaceImageSrc(options.workspaceId || '', image.path)
      parts.push(`<p class="markdown-image"><img alt="${escapeHtml(image.alt)}" src="${src}"></p>`)
      continue
    }
    if (line.startsWith('### ')) {
      flushParagraph()
      flushList()
      parts.push(`<h3>${escapeHtml(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph()
      flushList()
      parts.push(`<h2>${escapeHtml(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('# ')) {
      flushParagraph()
      flushList()
      parts.push(`<h1>${escapeHtml(line.slice(2))}</h1>`)
      continue
    }
    if (line.startsWith('- ')) {
      flushParagraph()
      list.push(line.slice(2))
      continue
    }
    flushList()
    paragraph.push(line.trim())
  }

  if (inCode) {
    flushCode()
  }
  flushParagraph()
  flushList()
  return parts.join('')
}

export function shouldRefreshMarkdownForToolResult(event) {
  if (event?.type !== 'tool_result' || event.ok !== true) {
    return false
  }
  if (event.name === 'file_write' || event.name === 'file_edit' || event.name === 'file_delete') {
    return true
  }
  if (event.name !== 'bash') {
    return false
  }
  return /\b(rm|mv|cp|touch|mkdir|rmdir|truncate|tee)\b|(^|[^&])>\s*[^&]/.test(String(event.summary || ''))
}

function parseMarkdownImagePreviewLine(line) {
  const match = line.trim().match(/^!?\[([^\]]*)\]\(([^)]*)\)$/)
  if (!match) {
    return null
  }
  return { alt: match[1], path: match[2] }
}

function isSafeMarkdownImagePath(path) {
  const normalizedPath = normalizeMarkdownImagePath(path)
  if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('\\') || !isSupportedMarkdownImagePath(normalizedPath)) {
    return false
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedPath)) {
    return false
  }
  return normalizedPath.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function buildWorkspaceImageSrc(workspaceId, path) {
  const encodedPath = normalizeMarkdownImagePath(path).split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `/api/workspaces/${encodedWorkspaceId(workspaceId)}/files/${encodedPath}`
}

function normalizeMarkdownImagePath(path) {
  let normalizedPath = String(path || '').trim()
  while (normalizedPath.startsWith('./')) {
    normalizedPath = normalizedPath.slice(2)
  }
  return normalizedPath
}

function isSupportedMarkdownImagePath(path) {
  return /\.(png|jpe?g|webp|gif)$/i.test(path)
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function estimateTokens(text) {
  let estimate = 0
  for (const char of String(text || '')) {
    const codePoint = char.codePointAt(0) || 0
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

function isCjk(codePoint) {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  )
}

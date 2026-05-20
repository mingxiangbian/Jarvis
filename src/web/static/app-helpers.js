export function buildRunRequestBody({ sessionId, message, workspaceId }) {
  return { sessionId, message, workspaceId }
}

export function encodedWorkspaceId(workspaceId) {
  return workspaceId === '' ? '@root' : encodeURIComponent(workspaceId)
}

export function isWorkspaceLockedState(state) {
  return Boolean(state.isSending || state.activeRun !== null)
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

export function renderMarkdownHtml(markdown) {
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

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

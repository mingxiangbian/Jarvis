const appShell = document.querySelector('.app-shell')
const leftResizeHandle = document.querySelector('#leftResizeHandle')
const messages = document.querySelector('#messages')
const composer = document.querySelector('#composer')
const promptInput = document.querySelector('#promptInput')
const sendButton = document.querySelector('#sendButton')
const newChatButton = document.querySelector('#newChatButton')
const railNewChatButton = document.querySelector('#railNewChatButton')
const sidebarToggle = document.querySelector('#sidebarToggle')
const railSidebarToggle = document.querySelector('#railSidebarToggle')
const inspector = document.querySelector('#inspector')
const inspectorEdgeToggle = document.querySelector('#inspectorEdgeToggle')
const inspectorClose = document.querySelector('#inspectorClose')
const inspectorContent = document.querySelector('#inspectorContent')
const headerStatus = document.querySelector('#headerStatus')
const tabs = Array.from(document.querySelectorAll('.tab'))

const state = {
  sessionId: null,
  messages: [],
  activeRun: null,
  tools: [],
  resizingLeft: false,
  inspectorTab: 'tools',
  sidebarCollapsed: false,
  inspectorOpen: false,
  runStatus: 'Ready'
}

composer?.addEventListener('submit', (event) => {
  event.preventDefault()
  void sendPrompt()
})

promptInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendPrompt()
  }
})
promptInput?.addEventListener('input', autoResizePromptInput)

newChatButton?.addEventListener('click', resetChat)
railNewChatButton?.addEventListener('click', resetChat)
sidebarToggle?.addEventListener('click', () => setSidebarCollapsed(true))
railSidebarToggle?.addEventListener('click', () => setSidebarCollapsed(false))
inspectorEdgeToggle?.addEventListener('click', () => setInspectorOpen(true))
inspectorClose?.addEventListener('click', () => setInspectorOpen(false))

function resetChat() {
  if (state.activeRun) {
    return
  }
  state.sessionId = null
  state.messages = []
  state.tools = []
  updateRunStatus('Ready')
  setSending(false)
  renderEmptyState()
  renderInspector()
  if (promptInput) {
    promptInput.value = ''
    autoResizePromptInput()
    promptInput.focus()
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.inspectorTab = tab.dataset.tab || 'tools'
    tabs.forEach((item) => item.classList.toggle('is-active', item === tab))
    renderInspector()
  })
})

leftResizeHandle?.addEventListener('pointerdown', (event) => {
  if (state.sidebarCollapsed) {
    return
  }
  state.resizingLeft = true
  document.body.classList.add('is-resizing-left')
  leftResizeHandle.setPointerCapture(event.pointerId)
})

leftResizeHandle?.addEventListener('pointermove', (event) => {
  if (!state.resizingLeft || state.sidebarCollapsed || !appShell) {
    return
  }
  const shellLeft = appShell.getBoundingClientRect().left
  const nextWidth = clamp(event.clientX - shellLeft - 18, 180, 360)
  appShell.style.setProperty('--sidebar-width', `${nextWidth}px`)
})

leftResizeHandle?.addEventListener('pointerup', stopLeftResize)
leftResizeHandle?.addEventListener('pointercancel', stopLeftResize)

function stopLeftResize(event) {
  state.resizingLeft = false
  document.body.classList.remove('is-resizing-left')
  if (event?.pointerId !== undefined) {
    leftResizeHandle?.releasePointerCapture(event.pointerId)
  }
}

async function sendPrompt() {
  const content = promptInput?.value.trim()
  if (!content || state.activeRun) {
    return
  }

  clearEmptyState()
  appendMessage('user', content)
  state.messages.push({ role: 'user', content })
  if (promptInput) {
    promptInput.value = ''
    autoResizePromptInput()
  }
  setSending(true)
  updateRunStatus('Starting run...')

  let response
  try {
    response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, message: content })
    })
  } catch (error) {
    finishWithError(error)
    return
  }

  if (!response.ok) {
    finishWithError(await response.text())
    return
  }

  const { runId, sessionId } = await response.json()
  state.sessionId = sessionId
  const stream = new EventSource(`/api/runs/${runId}/events`)
  state.activeRun = stream

  stream.addEventListener('message', (message) => {
    let event
    try {
      event = JSON.parse(message.data)
    } catch (error) {
      finishWithError(error)
      return
    }
    handleRunEvent(event, stream)
  })

  stream.addEventListener('error', () => {
    if (state.activeRun === stream) {
      finishWithError('Run stream disconnected.')
    }
  })
}

function handleRunEvent(event, stream) {
  switch (event.type) {
    case 'thinking_start':
      updateRunStatus('Thinking...')
      break
    case 'thinking_stop':
      updateRunStatus(`Thought for ${formatDuration(event.durationMs)}.`)
      break
    case 'tool_start':
      state.tools.push({ type: 'start', name: event.name, summary: event.summary })
      renderInspector()
      updateRunStatus(`Using ${event.name}...`)
      break
    case 'tool_result':
      state.tools.push({
        type: 'result',
        name: event.name,
        ok: event.ok,
        durationMs: event.durationMs,
        summary: event.summary
      })
      renderInspector()
      updateRunStatus(`${event.name} ${event.ok ? 'completed' : 'failed'} in ${formatDuration(event.durationMs)}.`)
      break
    case 'final':
      appendMessage('assistant', event.text)
      state.messages.push({ role: 'assistant', content: event.text })
      finishRun(stream)
      break
    case 'error':
      finishWithError(event.message, stream)
      break
    default:
      updateRunStatus(event.type || 'Unknown event')
  }
}

function finishRun(stream) {
  stream?.close()
  if (!stream || state.activeRun === stream) {
    state.activeRun = null
    setSending(false)
  }
}

function finishWithError(error, stream) {
  appendMessage('error', error instanceof Error ? error.message : String(error))
  updateRunStatus('Error')
  finishRun(stream || state.activeRun)
}

function appendMessage(kind, text) {
  clearEmptyState()
  if (kind === 'assistant') {
    return appendAssistantMessage(text)
  }

  const node = document.createElement('article')
  node.className = `message ${kind}`
  node.setAttribute('aria-label', `${kind} message`)

  const content = document.createElement('span')
  content.className = 'message-content'
  content.textContent = text

  node.append(content)
  messages?.append(node)
  messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' })
  return node
}

function appendAssistantMessage(text) {
  const group = document.createElement('article')
  group.className = 'message-group assistant'
  group.setAttribute('aria-label', 'Cyrene message')

  const header = document.createElement('div')
  header.className = 'message-identity'

  const avatar = document.createElement('span')
  avatar.className = 'assistant-avatar avatar-cartoon'
  avatar.setAttribute('aria-hidden', 'true')

  const avatarImage = document.createElement('img')
  avatarImage.className = 'assistant-avatar-image'
  avatarImage.src = '/static/assets/cyrene-cartoon-avatar.png'
  avatarImage.alt = ''
  avatarImage.decoding = 'async'

  const name = document.createElement('span')
  name.className = 'message-author'
  name.textContent = 'Cyrene'

  const bubble = document.createElement('div')
  bubble.className = 'message assistant'

  const content = document.createElement('span')
  content.className = 'message-content'
  content.textContent = text.trim()

  avatar.append(avatarImage)
  header.append(avatar, name)
  bubble.append(content)
  group.append(header, bubble)
  messages?.append(group)
  messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' })
  return group
}

function updateRunStatus(text) {
  state.runStatus = text
  if (headerStatus) {
    headerStatus.textContent = text
  }
}

function clearEmptyState() {
  const emptyState = messages?.querySelector('.empty-state')
  emptyState?.remove()
}

function renderEmptyState() {
  messages?.replaceChildren()
  const node = document.createElement('div')
  node.className = 'empty-state'
  node.innerHTML = [
    '<div class="empty-orbit" aria-hidden="true"></div>',
    '<p class="eyebrow">Ready</p>',
    '<h3>Ask Cyrene to work through a local task.</h3>',
    '<p>Run status and tool activity will stream here as the agent responds.</p>'
  ].join('')
  messages?.append(node)
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed
  appShell?.classList.toggle('sidebar-collapsed', collapsed)
  sidebarToggle?.setAttribute('aria-expanded', String(!collapsed))
  sidebarToggle?.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
  sidebarToggle?.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
  railSidebarToggle?.setAttribute('aria-expanded', String(!collapsed))
}

function setInspectorOpen(open) {
  state.inspectorOpen = open
  appShell?.classList.toggle('inspector-open', open)
  inspector?.classList.toggle('is-open', open)
  inspector?.setAttribute('aria-hidden', String(!open))
  inspectorEdgeToggle?.setAttribute('aria-expanded', String(open))
}

function renderInspector() {
  if (!inspectorContent) {
    return
  }

  if (state.inspectorTab === 'context') {
    inspectorContent.replaceChildren(renderNote(`${state.messages.length} client message${state.messages.length === 1 ? '' : 's'} in this page session.`))
    return
  }

  if (state.inspectorTab === 'memory') {
    inspectorContent.replaceChildren(renderNote('Memory is not persisted in this web session.'))
    return
  }

  if (state.tools.length === 0) {
    inspectorContent.replaceChildren(renderNote('Tool activity will appear after a run starts.'))
    return
  }

  inspectorContent.replaceChildren(...state.tools.map(renderTool))
}

function renderTool(tool) {
  const node = document.createElement('article')
  node.className = 'tool-card'

  const title = document.createElement('h3')
  title.textContent = tool.name

  const summary = document.createElement('p')
  summary.textContent = tool.summary || 'No summary provided.'

  const meta = document.createElement('div')
  meta.className = 'tool-meta'
  const status = tool.type === 'start' ? 'Started' : (tool.ok ? 'Completed' : 'Failed')
  const duration = tool.durationMs === undefined ? '' : formatDuration(tool.durationMs)
  meta.innerHTML = `<span>${status}</span><span>${duration}</span>`

  node.append(title, summary, meta)
  return node
}

function renderNote(text) {
  const note = document.createElement('p')
  note.className = 'muted'
  note.textContent = text
  return note
}

function setSending(isSending) {
  if (sendButton) {
    sendButton.disabled = isSending
    sendButton.textContent = isSending ? 'Running' : 'Send'
  }
  if (promptInput) {
    promptInput.disabled = isSending
  }
  if (newChatButton) {
    newChatButton.disabled = isSending || state.activeRun !== null
  }
  if (railNewChatButton) {
    railNewChatButton.disabled = isSending || state.activeRun !== null
  }
  appShell?.classList.toggle('run-active', isSending)
}

function autoResizePromptInput() {
  if (!promptInput) {
    return
  }

  promptInput.style.height = '42px'
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 150)}px`
}

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number') {
    return ''
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }
  return `${(durationMs / 1000).toFixed(1)} s`
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

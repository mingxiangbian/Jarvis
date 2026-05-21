import {
  buildRunRequestBody,
  contextUsagePercent,
  encodedWorkspaceId,
  isWorkspaceLockedState,
  ownsMarkdownFileResponse,
  ownsMarkdownFilesResponse,
  renderMarkdownHtml
} from './app-helpers.js'

const appShell = document.querySelector('.app-shell')
const leftResizeHandle = document.querySelector('#leftResizeHandle')
const messages = document.querySelector('#messages')
const composer = document.querySelector('#composer')
const promptInput = document.querySelector('#promptInput')
const contextUsageButton = document.querySelector('#contextUsageButton')
const contextUsageValue = document.querySelector('#contextUsageValue')
const sendButton = document.querySelector('#sendButton')
const newChatButton = document.querySelector('#newChatButton')
const railNewChatButton = document.querySelector('#railNewChatButton')
const sidebarToggle = document.querySelector('#sidebarToggle')
const railSidebarToggle = document.querySelector('#railSidebarToggle')
const inspector = document.querySelector('#inspector')
const themeToggle = document.querySelector('#themeToggle')
const inspectorEdgeToggle = document.querySelector('#inspectorEdgeToggle')
const inspectorClose = document.querySelector('#inspectorClose')
const inspectorContent = document.querySelector('#inspectorContent')
const headerStatus = document.querySelector('#headerStatus')
const chatHeading = document.querySelector('.chat-title h2')
const sessionHistory = document.querySelector('#sessionHistory')
const workspaceChangeButton = document.querySelector('#workspaceChangeButton')
const workspacePicker = document.querySelector('#workspacePicker')
const tabs = Array.from(document.querySelectorAll('.tab'))
const THEME_STORAGE_KEY = 'cyrene.theme'

const state = {
  sessionId: null,
  sessions: [],
  openSessionMenuId: null,
  sessionMenuPosition: null,
  messages: [],
  activeRun: null,
  isSending: false,
  workspaces: [],
  workspaceId: '',
  markdownFiles: [],
  selectedMarkdownId: '',
  selectedMarkdownContent: '',
  workspaceError: null,
  markdownError: null,
  tools: [],
  resizingLeft: false,
  inspectorTab: 'tools',
  sidebarCollapsed: false,
  inspectorOpen: false,
  contextUsageDetailsVisible: false,
  theme: readStoredTheme(),
  runStatus: 'Ready'
}

const markdownRequests = {
  files: 0,
  file: 0
}

void loadWorkspaces()
void loadSessions()
setTheme(state.theme)
updateChatLayoutState()
updateContextUsageIndicator()

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
contextUsageButton?.addEventListener('click', () => {
  state.contextUsageDetailsVisible = !state.contextUsageDetailsVisible
  updateContextUsageIndicator()
})

newChatButton?.addEventListener('click', resetChat)
railNewChatButton?.addEventListener('click', resetChat)
sidebarToggle?.addEventListener('click', () => setSidebarCollapsed(true))
railSidebarToggle?.addEventListener('click', () => setSidebarCollapsed(false))
inspectorEdgeToggle?.addEventListener('click', () => setInspectorOpen(true))
inspectorClose?.addEventListener('click', () => setInspectorOpen(false))
themeToggle?.addEventListener('click', () => {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark'
  setTheme(nextTheme)
})
document.addEventListener('click', () => {
  closeSessionMenu()
})
sessionHistory?.addEventListener('scroll', () => closeSessionMenu())
window.addEventListener('resize', () => closeSessionMenu())
workspaceChangeButton?.addEventListener('click', () => {
  if (isWorkspaceLocked()) {
    return
  }
  const nextHidden = !workspacePicker?.hidden
  if (workspacePicker) {
    workspacePicker.hidden = nextHidden
  }
  workspaceChangeButton.setAttribute('aria-expanded', String(!nextHidden))
})

function resetChat() {
  if (isRunLocked()) {
    return
  }
  state.sessionId = null
  closeSessionMenu(false)
  state.messages = []
  state.tools = []
  state.contextUsageDetailsVisible = false
  updateChatTitle('Untitled session')
  updateRunStatus('Ready')
  setSending(false)
  updateChatLayoutState()
  renderEmptyState()
  renderInspector()
  renderSessionList()
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

  closeSessionMenu(false)
  clearEmptyState()
  appendMessage('user', content)
  state.messages.push({ role: 'user', content })
  if (promptInput) {
    promptInput.value = ''
    autoResizePromptInput()
  }
  updateChatLayoutState()
  setSending(true)
  updateRunStatus('Starting run...')

  let response
  try {
    response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildRunRequestBody({
        sessionId: state.sessionId,
        message: content,
        workspaceId: state.workspaceId
      }))
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
  renderSessionList()
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
      updateContextUsageIndicator()
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
    updateChatLayoutState()
    void loadSessions()
  }
}

function finishWithError(error, stream) {
  const message = error instanceof Error ? error.message : String(error)
  appendMessage('error', message)
  state.messages.push({ role: 'error', content: message })
  updateContextUsageIndicator()
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

async function loadSessions() {
  let response
  try {
    response = await fetch('/api/sessions')
  } catch {
    return
  }
  if (!response.ok) {
    return
  }
  const body = await response.json()
  state.sessions = Array.isArray(body.sessions) ? body.sessions : []
  if (state.openSessionMenuId !== null && !state.sessions.some((session) => session.id === state.openSessionMenuId)) {
    closeSessionMenu(false)
  }
  renderSessionList()
  const current = state.sessions.find((session) => session.id === state.sessionId)
  if (current) {
    updateChatTitle(current.title)
  }
}

async function loadWorkspaces() {
  state.workspaceError = null
  let response
  try {
    response = await fetch('/api/workspaces')
  } catch {
    state.workspaceError = 'Unable to load workspaces.'
    renderWorkspacePanel()
    return
  }
  if (!response.ok) {
    state.workspaceError = 'Unable to load workspaces.'
    renderWorkspacePanel()
    return
  }
  const body = await response.json()
  state.workspaces = Array.isArray(body.workspaces) ? body.workspaces : []
  if (!state.workspaces.some((workspace) => workspace.id === state.workspaceId)) {
    state.workspaceId = state.workspaces[0]?.id || ''
  }
  renderWorkspacePanel()
  await loadMarkdownFiles()
}

async function loadMarkdownFiles() {
  const requestWorkspaceId = state.workspaceId
  const requestToken = ++markdownRequests.files
  markdownRequests.file += 1
  state.markdownError = null
  state.markdownFiles = []
  state.selectedMarkdownId = ''
  state.selectedMarkdownContent = ''
  renderInspector()

  let response
  try {
    response = await fetch(`/api/workspaces/${encodedWorkspaceId(requestWorkspaceId)}/markdown`)
  } catch {
    if (!ownsMarkdownFilesResponse({
      currentToken: markdownRequests.files,
      responseToken: requestToken,
      currentWorkspaceId: state.workspaceId,
      responseWorkspaceId: requestWorkspaceId
    })) {
      return
    }
    state.markdownError = 'Unable to load Markdown context.'
    renderInspector()
    return
  }
  if (!ownsMarkdownFilesResponse({
    currentToken: markdownRequests.files,
    responseToken: requestToken,
    currentWorkspaceId: state.workspaceId,
    responseWorkspaceId: requestWorkspaceId
  })) {
    return
  }
  if (!response.ok) {
    state.markdownError = 'Unable to load Markdown context.'
    renderInspector()
    return
  }
  const body = await response.json()
  if (!ownsMarkdownFilesResponse({
    currentToken: markdownRequests.files,
    responseToken: requestToken,
    currentWorkspaceId: state.workspaceId,
    responseWorkspaceId: requestWorkspaceId
  })) {
    return
  }
  state.markdownFiles = Array.isArray(body.files) ? body.files : []
  state.selectedMarkdownId = state.markdownFiles[0]?.id || ''
  if (state.selectedMarkdownId) {
    await loadMarkdownFile(state.selectedMarkdownId)
    return
  }
  renderInspector()
}

async function loadMarkdownFile(fileId) {
  const requestWorkspaceId = state.workspaceId
  const requestFileId = fileId
  const requestToken = ++markdownRequests.file
  state.markdownError = null
  state.selectedMarkdownId = fileId
  state.selectedMarkdownContent = ''
  renderInspector()

  let response
  try {
    response = await fetch(`/api/workspaces/${encodedWorkspaceId(requestWorkspaceId)}/markdown/${encodeURIComponent(requestFileId)}`)
  } catch {
    if (!ownsMarkdownFileResponse({
      currentToken: markdownRequests.file,
      responseToken: requestToken,
      currentWorkspaceId: state.workspaceId,
      responseWorkspaceId: requestWorkspaceId,
      currentFileId: state.selectedMarkdownId,
      responseFileId: requestFileId
    })) {
      return
    }
    state.markdownError = 'Unable to load Markdown context.'
    renderInspector()
    return
  }
  if (!ownsMarkdownFileResponse({
    currentToken: markdownRequests.file,
    responseToken: requestToken,
    currentWorkspaceId: state.workspaceId,
    responseWorkspaceId: requestWorkspaceId,
    currentFileId: state.selectedMarkdownId,
    responseFileId: requestFileId
  })) {
    return
  }
  if (!response.ok) {
    state.markdownError = 'Unable to load Markdown context.'
    renderInspector()
    return
  }
  const body = await response.json()
  if (!ownsMarkdownFileResponse({
    currentToken: markdownRequests.file,
    responseToken: requestToken,
    currentWorkspaceId: state.workspaceId,
    responseWorkspaceId: requestWorkspaceId,
    currentFileId: state.selectedMarkdownId,
    responseFileId: requestFileId
  })) {
    return
  }
  state.selectedMarkdownContent = typeof body.file?.content === 'string' ? body.file.content : ''
  renderInspector()
}

function isWorkspaceLocked() {
  return isRunLocked()
}

function isRunLocked() {
  return isWorkspaceLockedState(state)
}

function isFreshChat() {
  return state.messages.length === 0 && state.activeRun === null && !state.isSending
}

function updateChatLayoutState() {
  appShell?.classList.toggle('chat-not-started', isFreshChat())
}

function getCurrentWorkspace() {
  return state.workspaces.find((workspace) => workspace.id === state.workspaceId)
}

function formatWorkspaceDisplayName(workspace) {
  if (!workspace) {
    return state.workspaceError || 'Workspace'
  }
  if (workspace.id === '') {
    return 'workspace'
  }
  return workspace.id
}

async function loadSession(sessionId) {
  if (isRunLocked() || sessionId === state.sessionId) {
    return
  }
  closeSessionMenu(false)
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
  if (!response.ok) {
    return
  }
  const body = await response.json()
  state.sessionId = body.session.id
  state.messages = Array.isArray(body.messages) ? body.messages : []
  state.contextUsageDetailsVisible = false
  updateChatLayoutState()
  state.tools = []
  updateChatTitle(body.session.title || 'Untitled session')
  updateRunStatus('Ready')
  renderMessages()
  updateContextUsageIndicator()
  renderInspector()
  renderSessionList()
}

function renderSessionList() {
  if (!sessionHistory) {
    return
  }

  sessionHistory.replaceChildren()
  if (state.sessions.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'session-history-empty'
    empty.textContent = 'No saved sessions'
    sessionHistory.append(empty)
    return
  }

  const sessionLocked = isRunLocked()
  for (const session of state.sessions) {
    const row = document.createElement('div')
    row.className = 'session-row'
    row.classList.toggle('is-active', session.id === state.sessionId)

    const button = document.createElement('button')
    button.className = 'session-title-button'
    button.type = 'button'
    button.disabled = sessionLocked
    button.addEventListener('click', () => {
      void loadSession(session.id)
    })

    const title = document.createElement('span')
    title.className = 'session-title'
    title.textContent = session.title || 'Untitled session'

    button.append(title)
    row.append(button)

    if (session.id === state.sessionId) {
      if (session.pinned) {
        row.append(renderSessionPinIndicator())
      }

      const menuButton = document.createElement('button')
      menuButton.className = 'session-menu-button'
      menuButton.type = 'button'
      menuButton.disabled = sessionLocked
      menuButton.setAttribute('aria-label', `Session actions for ${session.title || 'Untitled session'}`)
      menuButton.setAttribute('aria-expanded', String(state.openSessionMenuId === session.id))
      menuButton.append(createIcon('dots'))
      menuButton.addEventListener('click', (event) => {
        event.stopPropagation()
        if (state.openSessionMenuId === session.id) {
          closeSessionMenu(false)
        } else {
          state.openSessionMenuId = session.id
          state.sessionMenuPosition = getSessionMenuPosition(menuButton)
        }
        renderSessionList()
      })
      row.append(menuButton)

      if (state.openSessionMenuId === session.id) {
        row.append(renderSessionMenu(session))
      }
    }

    if (session.id !== state.sessionId && session.pinned) {
      row.append(renderSessionPinIndicator())
    }

    sessionHistory.append(row)
  }
}

function renderSessionPinIndicator() {
  const indicator = document.createElement('span')
  indicator.className = 'session-pin-indicator'
  indicator.setAttribute('role', 'img')
  indicator.setAttribute('aria-label', 'Pinned chat')
  indicator.append(createIcon('pin'))
  return indicator
}

function renderSessionMenu(session) {
  const menu = document.createElement('div')
  menu.className = 'session-menu'
  if (state.sessionMenuPosition) {
    menu.style.top = `${state.sessionMenuPosition.top}px`
    menu.style.left = `${state.sessionMenuPosition.left}px`
  }
  menu.addEventListener('click', (event) => {
    event.stopPropagation()
  })

  const pinButton = document.createElement('button')
  pinButton.className = 'session-action'
  pinButton.type = 'button'
  pinButton.append(createIcon('pin'), document.createTextNode(session.pinned ? 'Unpin chat' : 'Pin chat'))
  pinButton.addEventListener('click', (event) => {
    event.stopPropagation()
    void toggleSessionPinned(session)
  })

  const deleteButton = document.createElement('button')
  deleteButton.className = 'session-action danger'
  deleteButton.type = 'button'
  deleteButton.append(createIcon('trash'), document.createTextNode('Delete chat'))
  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation()
    void deleteSession(session.id)
  })

  menu.append(pinButton, deleteButton)
  return menu
}

function closeSessionMenu(shouldRender = true) {
  if (state.openSessionMenuId === null && state.sessionMenuPosition === null) {
    return
  }
  state.openSessionMenuId = null
  state.sessionMenuPosition = null
  if (shouldRender) {
    renderSessionList()
  }
}

function getSessionMenuPosition(anchor) {
  const rect = anchor.getBoundingClientRect()
  const menuWidth = 150
  const menuHeight = 96
  const gap = 6
  const margin = 12
  const rightLimit = Math.max(margin, window.innerWidth - menuWidth - margin)
  const below = rect.bottom + gap
  const above = rect.top - menuHeight - gap
  const top = below + menuHeight <= window.innerHeight - margin ? below : Math.max(margin, above)
  return {
    top,
    left: Math.min(Math.max(margin, rect.right - menuWidth), rightLimit)
  }
}

async function toggleSessionPinned(session) {
  if (isRunLocked()) {
    return
  }
  closeSessionMenu(false)
  let response
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: !session.pinned })
    })
  } catch {
    closeSessionMenu(false)
    renderSessionList()
    return
  }
  if (response.ok) {
    await loadSessions()
    return
  }
  closeSessionMenu(false)
  renderSessionList()
}

async function deleteSession(sessionId) {
  if (isRunLocked()) {
    return
  }
  const session = state.sessions.find((item) => item.id === sessionId)
  const title = session?.title || 'Untitled session'
  if (!window.confirm(`Delete "${title}"?`)) {
    return
  }
  closeSessionMenu(false)
  let response
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
  } catch {
    closeSessionMenu(false)
    renderSessionList()
    return
  }
  if (!response.ok) {
    closeSessionMenu(false)
    renderSessionList()
    return
  }
  if (sessionId === state.sessionId) {
    resetChat()
  }
  await loadSessions()
}

function renderWorkspacePanel() {
  const workspaceLocked = isWorkspaceLocked()
  const current = getCurrentWorkspace()
  const displayName = formatWorkspaceDisplayName(current)
  if (workspaceChangeButton) {
    workspaceChangeButton.disabled = workspaceLocked || state.workspaces.length === 0
    workspaceChangeButton.textContent = displayName
    workspaceChangeButton.title = current ? current.label : displayName
    workspaceChangeButton.setAttribute('aria-label', `Select workspace, current: ${displayName}`)
    workspaceChangeButton.setAttribute('aria-expanded', String(workspacePicker?.hidden === false))
  }
  if (!workspacePicker) {
    return
  }

  workspacePicker.replaceChildren()
  for (const workspace of state.workspaces) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'workspace-option'
    button.classList.toggle('is-active', workspace.id === state.workspaceId)
    button.disabled = workspaceLocked
    button.textContent = formatWorkspaceDisplayName(workspace)
    button.title = workspace.label
    button.addEventListener('click', () => {
      if (isWorkspaceLocked()) {
        return
      }
      state.workspaceId = workspace.id
      state.selectedMarkdownContent = ''
      markdownRequests.file += 1
      workspacePicker.hidden = true
      workspaceChangeButton?.setAttribute('aria-expanded', 'false')
      renderWorkspacePanel()
      void loadMarkdownFiles()
    })
    workspacePicker.append(button)
  }
}

function renderMessages() {
  messages?.replaceChildren()
  if (state.messages.length === 0) {
    renderEmptyState()
    updateChatLayoutState()
    return
  }
  for (const message of state.messages) {
    appendMessage(message.role, message.content)
  }
  updateChatLayoutState()
  updateContextUsageIndicator()
}

function updateChatTitle(title) {
  if (chatHeading) {
    chatHeading.textContent = title
  }
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

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function setTheme(nextTheme) {
  state.theme = nextTheme === 'dark' ? 'dark' : 'light'
  document.body.classList.toggle('theme-dark', state.theme === 'dark')
  try {
    localStorage.setItem(THEME_STORAGE_KEY, state.theme)
  } catch {
    // Theme still applies for this page load when storage is unavailable.
  }
  renderThemeToggle()
}

function renderThemeToggle() {
  if (!themeToggle) {
    return
  }
  const switchesToDark = state.theme !== 'dark'
  const label = switchesToDark ? 'Switch to dark mode' : 'Switch to light mode'
  themeToggle.replaceChildren(createIcon(switchesToDark ? 'moon' : 'sun'))
  themeToggle.setAttribute('aria-label', label)
  themeToggle.setAttribute('title', label)
}

function createIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '18')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')

  const add = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    Object.entries(attrs).forEach(([key, value]) => {
      node.setAttribute(key, value)
    })
    svg.append(node)
  }

  switch (name) {
    case 'dots':
      add('circle', { cx: '6', cy: '12', r: '1' })
      add('circle', { cx: '12', cy: '12', r: '1' })
      add('circle', { cx: '18', cy: '12', r: '1' })
      break
    case 'pin':
      add('path', { d: 'M14 4l6 6-4 1-5 5-3-3 5-5 1-4z' })
      add('path', { d: 'M8 16l-4 4' })
      break
    case 'trash':
      add('path', { d: 'M4 7h16' })
      add('path', { d: 'M9 7V5h6v2' })
      add('path', { d: 'M6 7l1 13h10l1-13' })
      add('path', { d: 'M10 11v5' })
      add('path', { d: 'M14 11v5' })
      break
    case 'moon':
      add('path', { d: 'M20 15.5A8 8 0 118.5 4 6.5 6.5 0 0020 15.5z' })
      break
    case 'sun':
      add('circle', { cx: '12', cy: '12', r: '4' })
      add('path', { d: 'M12 2v2' })
      add('path', { d: 'M12 20v2' })
      add('path', { d: 'M4.93 4.93l1.41 1.41' })
      add('path', { d: 'M17.66 17.66l1.41 1.41' })
      add('path', { d: 'M2 12h2' })
      add('path', { d: 'M20 12h2' })
      add('path', { d: 'M4.93 19.07l1.41-1.41' })
      add('path', { d: 'M17.66 6.34l1.41-1.41' })
      break
    default:
      break
  }

  return svg
}

function renderInspector() {
  if (!inspectorContent) {
    return
  }

  if (state.inspectorTab === 'context') {
    inspectorContent.replaceChildren(renderContextPanel())
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

function renderContextPanel() {
  if (state.markdownError) {
    return renderNote('Unable to load Markdown context.')
  }
  if (state.markdownFiles.length === 0) {
    return renderNote('No Markdown files in this workspace.')
  }

  const panel = document.createElement('div')
  panel.className = 'context-panel'

  const select = document.createElement('select')
  select.className = 'markdown-file-select'
  select.value = state.selectedMarkdownId
  select.addEventListener('change', () => {
    void loadMarkdownFile(select.value)
  })

  for (const file of state.markdownFiles) {
    const option = document.createElement('option')
    option.value = file.id
    option.textContent = file.label || file.id
    option.selected = file.id === state.selectedMarkdownId
    select.append(option)
  }

  panel.append(select, renderMarkdownPreview(state.selectedMarkdownContent))
  return panel
}

function renderMarkdownPreview(markdown) {
  const preview = document.createElement('div')
  preview.className = 'markdown-preview'
  preview.innerHTML = renderMarkdownHtml(markdown)
  return preview
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
  state.isSending = isSending
  if (isSending) {
    closeSessionMenu(false)
  }
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
  updateChatLayoutState()
  renderSessionList()
  renderWorkspacePanel()
}

function autoResizePromptInput() {
  if (!promptInput) {
    return
  }

  promptInput.style.height = '42px'
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 150)}px`
  updateContextUsageIndicator()
}

function updateContextUsageIndicator() {
  if (!contextUsageButton || !contextUsageValue) {
    return
  }
  const percent = contextUsagePercent({
    messages: state.messages,
    draft: promptInput?.value || ''
  })
  const label = `Context usage ${percent}%`
  contextUsageButton.style.setProperty('--context-usage', `${percent}%`)
  contextUsageButton.classList.toggle('show-value', state.contextUsageDetailsVisible)
  contextUsageButton.setAttribute('aria-label', label)
  contextUsageButton.setAttribute('aria-pressed', String(state.contextUsageDetailsVisible))
  contextUsageButton.setAttribute('title', label)
  contextUsageValue.textContent = `${percent}%`
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

function formatSessionTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

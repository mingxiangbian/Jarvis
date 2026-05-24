import { apiGet, apiPost } from '../api-client.js'
import { renderControlError, renderControlPanel, renderIconControlButton, setIconControlButton } from '../inspector.js'

export function renderMemoryPanel() {
  const panel = renderControlPanel('Memory')
  const list = document.createElement('div')
  list.className = 'control-list'
  list.textContent = 'Loading memory...'
  panel.append(list)

  void apiGet('/api/control/memory')
    .then((data) => {
      const active = Array.isArray(data.active) ? data.active : []
      const pending = Array.isArray(data.pending) ? data.pending : []
      list.replaceChildren(
        renderMemoryGroup('Active', active),
        renderMemoryGroup('Pending', pending)
      )
    })
    .catch((error) => {
      list.replaceChildren(renderControlError(error.message))
    })

  return panel
}

function renderMemoryGroup(title, memories) {
  const group = document.createElement('section')
  group.className = 'control-section'
  const heading = document.createElement('h4')
  heading.textContent = `${title} ${memories.length}`
  group.append(heading)
  if (memories.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = `No ${title.toLowerCase()} memory.`
    group.append(empty)
    return group
  }
  for (const memory of memories) {
    group.append(renderMemoryItem(memory))
  }
  return group
}

function renderMemoryItem(memory) {
  const item = document.createElement('article')
  item.className = 'control-item stacked'
  const content = document.createElement('p')
  content.textContent = memory.content
  const actions = document.createElement('div')
  actions.className = 'control-actions'
  actions.append(actionButton('Strengthen memory', `/api/control/memory/${encodeURIComponent(memory.id)}/strengthen`, undefined, 'strengthen'))
  actions.append(actionButton('Downrank memory', `/api/control/memory/${encodeURIComponent(memory.id)}/downrank`, undefined, 'downrank'))
  actions.append(actionButton('Archive memory', `/api/control/memory/${encodeURIComponent(memory.id)}/archive`, 'danger', 'archive'))
  item.append(content, actions)
  return item
}

function actionButton(label, path, tone, iconName) {
  const button = renderIconControlButton(label, iconName, tone)
  button.addEventListener('click', () => {
    void apiPost(path).then(() => {
      button.disabled = true
      setIconControlButton(button, `${label} completed`, 'done')
    }).catch((error) => {
      button.after(renderControlError(error.message))
    })
  })
  return button
}

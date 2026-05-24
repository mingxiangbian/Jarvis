import { apiGet, apiPatch } from '../api-client.js'
import { renderControlError, renderControlPanel, renderIconControlButton, setIconControlButton } from '../inspector.js'

export function renderToolsPanel(state, helpers = {}) {
  const panel = renderControlPanel('Tools')
  const manifest = document.createElement('div')
  manifest.className = 'control-list'
  manifest.textContent = 'Loading tools...'
  panel.append(manifest)

  if (state.tools.length > 0 && helpers.renderTool) {
    const activity = document.createElement('div')
    activity.className = 'control-list'
    for (const tool of state.tools) {
      activity.append(helpers.renderTool(tool))
    }
    panel.append(activity)
  }

  void apiGet(`/api/control/tools${state.sessionId ? `?sessionId=${encodeURIComponent(state.sessionId)}` : ''}`)
    .then((data) => {
      manifest.replaceChildren(...(Array.isArray(data.tools) ? data.tools.map((tool) => renderToolToggle(tool, state)) : []))
      if (manifest.childNodes.length === 0) {
        manifest.textContent = 'No configured tools.'
      }
    })
    .catch((error) => {
      manifest.replaceChildren(renderControlError(error.message))
    })

  return panel
}

function renderToolToggle(tool, state) {
  const row = document.createElement('div')
  row.className = 'control-item'
  const pendingDisabled = new Set(state.pendingDisabledTools ?? [])
  const disabledForCurrentTarget = Boolean(tool.disabledForSession || pendingDisabled.has(tool.name))

  const copy = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = tool.name
  const meta = document.createElement('span')
  meta.textContent = `${tool.risk} risk`
  copy.append(title, meta)

  const button = renderIconControlButton(toolActionLabel(tool.name, disabledForCurrentTarget), disabledForCurrentTarget ? 'enable' : 'disable')
  button.addEventListener('click', () => {
    if (!state.sessionId) {
      const disabled = new Set(state.pendingDisabledTools ?? [])
      if (disabled.has(tool.name)) {
        disabled.delete(tool.name)
      } else {
        disabled.add(tool.name)
      }
      state.pendingDisabledTools = [...disabled].sort()
      const isDisabled = disabled.has(tool.name)
      tool.disabledForSession = isDisabled
      updateToolToggleButton(button, tool.name, isDisabled)
      return
    }

    const disabled = new Set((state.sessions.find((session) => session.id === state.sessionId)?.disabledTools) ?? [])
    if (disabled.has(tool.name)) {
      disabled.delete(tool.name)
    } else {
      disabled.add(tool.name)
    }
    void apiPatch(`/api/control/sessions/${encodeURIComponent(state.sessionId)}/tools`, {
      disabledTools: [...disabled]
    }).then(({ session }) => {
      const index = state.sessions.findIndex((item) => item.id === session.id)
      if (index >= 0) {
        state.sessions[index] = session
      }
      tool.disabledForSession = disabled.has(tool.name)
      updateToolToggleButton(button, tool.name, tool.disabledForSession)
    }).catch((error) => {
      row.append(renderControlError(error.message))
    })
  })

  row.append(copy, button)
  return row
}

function toolActionLabel(toolName, isDisabled) {
  return `${isDisabled ? 'Enable' : 'Disable'} ${toolName}`
}

function updateToolToggleButton(button, toolName, isDisabled) {
  setIconControlButton(button, toolActionLabel(toolName, isDisabled), isDisabled ? 'enable' : 'disable')
}

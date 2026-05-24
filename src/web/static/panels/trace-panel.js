import { apiGet } from '../api-client.js'
import { renderControlError, renderControlPanel } from '../inspector.js'

export function renderTracePanel(state) {
  const panel = renderControlPanel('Trace')
  const list = document.createElement('div')
  list.className = 'control-list'
  list.textContent = state.activeRunId ? `Current run: ${state.activeRunId}` : 'Loading traces...'
  panel.append(list)

  void apiGet('/api/control/traces')
    .then((data) => {
      const traces = Array.isArray(data.traces) ? data.traces : []
      list.replaceChildren(...traces.map(renderTraceItem))
      if (traces.length === 0) {
        list.textContent = 'No trace runs yet.'
      }
    })
    .catch((error) => {
      list.replaceChildren(renderControlError(error.message))
    })

  return panel
}

function renderTraceItem(trace) {
  const item = document.createElement('article')
  item.className = 'control-item stacked'
  const title = document.createElement('strong')
  title.textContent = trace.runId
  const meta = document.createElement('span')
  meta.textContent = `${trace.status} · ${trace.modelCallCount} model · ${trace.toolCallCount} tool`
  item.append(title, meta)
  return item
}


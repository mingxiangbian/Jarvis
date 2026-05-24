import { apiPost } from '../api-client.js'
import { renderControlError, renderControlPanel, renderKeyValueRows } from '../inspector.js'

export function renderAffectPanel(state) {
  const panel = renderControlPanel('Affect')
  const continuity = state.continuity
  panel.append(renderKeyValueRows([
    ['Need', continuity?.affect?.responseNeed || 'normal'],
    ['Risk', continuity?.affect?.risk || 'low'],
    ['Tone', continuity?.strategy?.tone || 'gentle'],
    ['Structure', continuity?.strategy?.structure || 'stepwise']
  ]))

  const form = document.createElement('form')
  form.className = 'control-form'
  const input = document.createElement('textarea')
  input.rows = 3
  input.placeholder = 'Correct Cyrene interpretation'
  const button = document.createElement('button')
  button.type = 'submit'
  button.textContent = 'Record correction'
  form.append(input, button)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void apiPost('/api/control/affect/corrections', {
      sessionId: state.sessionId || undefined,
      runId: state.activeRunId || undefined,
      target: 'strategy',
      correction: input.value
    }).then(() => {
      input.value = ''
      button.textContent = 'Recorded'
    }).catch((error) => {
      form.append(renderControlError(error.message))
    })
  })
  panel.append(form)
  return panel
}

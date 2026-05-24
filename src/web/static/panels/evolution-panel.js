import { apiGet, apiPost } from '../api-client.js'
import { renderControlError, renderControlPanel, renderIconControlButton, setIconControlButton } from '../inspector.js'

export function renderEvolutionPanel() {
  const panel = renderControlPanel('Evolution')
  const list = document.createElement('div')
  list.className = 'control-list'
  list.textContent = 'Loading proposals...'
  panel.append(list)

  void apiGet('/api/control/evolution/proposals')
    .then((data) => {
      const proposals = Array.isArray(data.proposals) ? data.proposals : []
      list.replaceChildren(...proposals.map(renderProposalItem))
      if (proposals.length === 0) {
        list.textContent = 'No proposals.'
      }
    })
    .catch((error) => {
      list.replaceChildren(renderControlError(error.message))
    })

  return panel
}

function renderProposalItem(proposal) {
  const item = document.createElement('article')
  item.className = 'control-item stacked'
  const title = document.createElement('strong')
  title.textContent = proposal.summary
  const meta = document.createElement('span')
  meta.textContent = `${proposal.type} · ${proposal.status} · ${proposal.risk}`
  const actions = document.createElement('div')
  actions.className = 'control-actions'
  actions.append(proposalButton('Approve proposal', `/api/control/evolution/proposals/${encodeURIComponent(proposal.id)}/approve`, undefined, 'approve'))
  if (proposal.type === 'prompt') {
    actions.append(proposalButton('Apply prompt patch', `/api/control/evolution/proposals/${encodeURIComponent(proposal.id)}/apply`, undefined, 'apply'))
  }
  actions.append(proposalButton('Reject proposal', `/api/control/evolution/proposals/${encodeURIComponent(proposal.id)}/reject`, 'danger', 'reject'))
  item.append(title, meta, actions)
  return item
}

function proposalButton(label, path, tone, iconName) {
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

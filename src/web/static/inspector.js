export function registerInspectorPanels(panels) {
  return panels
}

export function renderControlPanel(title, children = []) {
  const panel = document.createElement('div')
  panel.className = 'control-panel'

  const heading = document.createElement('h3')
  heading.textContent = title
  panel.append(heading)

  for (const child of children) {
    if (child !== undefined && child !== null) {
      panel.append(child)
    }
  }
  return panel
}

export function renderControlError(message) {
  const node = document.createElement('p')
  node.className = 'control-error'
  node.textContent = message
  return node
}

const ICON_DEFS = {
  approve: [
    ['path', { d: 'M5 13l4 4L19 7' }]
  ],
  apply: [
    ['path', { d: 'M5 12h12' }],
    ['path', { d: 'M13 6l6 6-6 6' }]
  ],
  archive: [
    ['path', { d: 'M4 7h16' }],
    ['path', { d: 'M6 7l1.5 12h9L18 7' }],
    ['path', { d: 'M9 11h6' }]
  ],
  disable: [
    ['circle', { cx: '12', cy: '12', r: '8' }],
    ['path', { d: 'M6.5 6.5l11 11' }]
  ],
  done: [
    ['circle', { cx: '12', cy: '12', r: '8' }],
    ['path', { d: 'M8 12l2.5 2.5L16 9' }]
  ],
  downrank: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M6 13l6 6 6-6' }]
  ],
  enable: [
    ['circle', { cx: '12', cy: '12', r: '8' }],
    ['path', { d: 'M8 12.5l2.5 2.5L16 9' }]
  ],
  record: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M5 12h14' }]
  ],
  reject: [
    ['path', { d: 'M6 6l12 12' }],
    ['path', { d: 'M18 6L6 18' }]
  ],
  strengthen: [
    ['path', { d: 'M12 19V5' }],
    ['path', { d: 'M6 11l6-6 6 6' }]
  ]
}

function renderIcon(iconName) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('control-action-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  for (const [tag, attrs] of ICON_DEFS[iconName] ?? ICON_DEFS.done) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [name, value] of Object.entries(attrs)) {
      node.setAttribute(name, value)
    }
    svg.append(node)
  }

  return svg
}

export function setIconControlButton(button, label, iconName) {
  button.setAttribute('aria-label', label)
  button.setAttribute('title', label)
  button.replaceChildren(renderIcon(iconName))
}

export function renderIconControlButton(label, iconName, tone) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = tone === 'danger' ? 'control-action icon-control-action danger' : 'control-action icon-control-action'
  setIconControlButton(button, label, iconName)
  return button
}

export function setInspectorDetailMode(inspector, appShell, enabled, options = {}) {
  inspector?.classList.toggle('is-detail', enabled)
  appShell?.classList.toggle('inspector-detail', enabled)
  if (enabled && window.innerWidth < 1320) {
    options.collapseSidebar?.(true)
  }
}

export function renderKeyValueRows(rows) {
  const wrap = document.createElement('div')
  wrap.className = 'control-rows'
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.className = 'control-row'
    const labelNode = document.createElement('span')
    labelNode.textContent = label
    const valueNode = document.createElement('strong')
    valueNode.textContent = value
    row.append(labelNode, valueNode)
    wrap.append(row)
  }
  return wrap
}

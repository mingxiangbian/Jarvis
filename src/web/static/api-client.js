export async function apiGet(path) {
  return request(path, { method: 'GET' })
}

export async function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

export async function apiPatch(path, body) {
  return request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function request(path, options) {
  const response = await fetch(path, options)
  const text = await response.text()
  const payload = text.trim() === '' ? {} : JSON.parse(text)
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.reason || payload.error || `Request failed with HTTP ${response.status}`)
  }
  return payload.data ?? payload
}


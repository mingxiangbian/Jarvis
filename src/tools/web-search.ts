import { z } from 'zod'
import type { Tool } from './types.js'

const schema = z.object({
  query: z.string().min(1)
})

interface SearchResult {
  title: string
  link: string
  snippet: string
}

const DDG_URL = 'https://html.duckduckgo.com/html/'
const TIMEOUT_MS = 15_000

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function textFromHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function normalizeLink(link: string): string | null {
  const decoded = decodeHtml(link)
  try {
    const url = new URL(decoded, DDG_URL)
    const unwrapped = url.searchParams.get('uddg')
    return unwrapped ?? url.toString()
  } catch {
    return null
  }
}

function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const resultRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bresult\b|$)/g

  for (const resultMatch of html.matchAll(resultRegex)) {
    const block = resultMatch[1]
    const titleMatch = block.match(/<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!titleMatch) {
      continue
    }

    const snippetMatch = block.match(/<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    const link = normalizeLink(titleMatch[1])
    if (!link) {
      continue
    }

    results.push({
      title: textFromHtml(titleMatch[2]),
      link,
      snippet: snippetMatch ? textFromHtml(snippetMatch[1]) : ''
    })

    if (results.length === 5) {
      break
    }
  }

  return results
}

function hasChallengePage(html: string): boolean {
  return html.includes('Unfortunately, bots use DuckDuckGo too')
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export const webSearchTool: Tool<z.infer<typeof schema>> = {
  name: 'web_search',
  description: 'Search the web with DuckDuckGo HTML results and return the first five results. Do not include file paths, credentials, secrets, usernames, or personal data in queries.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query. Do not include credentials or personal data.' }
    },
    required: ['query'],
    additionalProperties: false
  },
  schema,
  isReadonly: true,
  isDestructive: false,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(args) {
    const url = `${DDG_URL}?${new URLSearchParams({ q: args.query }).toString()}`

    try {
      const response = await fetchWithTimeout(url)
      if (!response.ok) {
        return {
          ok: false,
          content: `DuckDuckGo request failed with status ${response.status}`,
          metadata: { errorCode: 'http_error', status: response.status }
        }
      }

      const html = await response.text()
      const results = parseResults(html)
      if (results.length === 0 || hasChallengePage(html)) {
        return {
          ok: false,
          content: 'DuckDuckGo request returned no search results',
          metadata: { errorCode: hasChallengePage(html) ? 'challenge' : 'no_results' }
        }
      }

      return {
        ok: true,
        content: JSON.stringify({ results }, null, 2),
        metadata: { results }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        content: `DuckDuckGo request failed: ${message}`,
        metadata: { errorCode: 'network_error' }
      }
    }
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { webSearchTool } from '../src/tools/web-search.js'

function context() {
  return {
    config: createDefaultConfig('/tmp/project'),
    trackedFiles: new Set<string>()
  }
}

describe('webSearchTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses the first five DuckDuckGo HTML results', async () => {
    const html = Array.from({ length: 6 }, (_, index) => {
      const number = index + 1
      return `
        <div class="result">
          <a class="result__a" href="https://example.com/${number}?a=1&amp;b=2">Result ${number} &amp; title</a>
          <a class="result__snippet">Snippet ${number} with <b>markup</b>.</a>
        </div>
      `
    }).join('\n')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await webSearchTool.execute({ query: 'agent tools' }, context())

    expect(fetchMock).toHaveBeenCalledWith(
      'https://html.duckduckgo.com/html/?q=agent+tools',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result.ok).toBe(true)
    expect(result.metadata?.results).toEqual([
      {
        title: 'Result 1 & title',
        link: 'https://example.com/1?a=1&b=2',
        snippet: 'Snippet 1 with markup.'
      },
      {
        title: 'Result 2 & title',
        link: 'https://example.com/2?a=1&b=2',
        snippet: 'Snippet 2 with markup.'
      },
      {
        title: 'Result 3 & title',
        link: 'https://example.com/3?a=1&b=2',
        snippet: 'Snippet 3 with markup.'
      },
      {
        title: 'Result 4 & title',
        link: 'https://example.com/4?a=1&b=2',
        snippet: 'Snippet 4 with markup.'
      },
      {
        title: 'Result 5 & title',
        link: 'https://example.com/5?a=1&b=2',
        snippet: 'Snippet 5 with markup.'
      }
    ])
  })

  it('rejects empty queries with Zod validation', () => {
    const validation = webSearchTool.schema.safeParse({ query: '' })

    expect(validation.success).toBe(false)
  })

  it('warns the model not to include private data in queries', () => {
    expect(webSearchTool.description).toContain('Do not include file paths')
    expect(webSearchTool.parameters.properties.query).toMatchObject({
      description: expect.stringContaining('credentials')
    })
  })

  it('preserves encoded percent sequences in DuckDuckGo redirect targets', async () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsearch%3Foff%3D50%2525">Redirect result</a>
        <a class="result__snippet">Redirect snippet.</a>
      </div>
    `

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html
    }))

    const result = await webSearchTool.execute({ query: 'discount' }, context())

    expect(result.ok).toBe(true)
    expect(result.metadata?.results).toEqual([
      {
        title: 'Redirect result',
        link: 'https://example.com/search?off=50%25',
        snippet: 'Redirect snippet.'
      }
    ])
  })

  it('skips results with malformed links instead of failing the whole search', async () => {
    const html = `
      <div class="result">
        <a class="result__a" href="http://[not-a-valid-url">Bad result</a>
        <a class="result__snippet">Bad snippet.</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.com/good">Good result</a>
        <a class="result__snippet">Good snippet.</a>
      </div>
    `

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html
    }))

    const result = await webSearchTool.execute({ query: 'mixed links' }, context())

    expect(result.ok).toBe(true)
    expect(result.metadata?.results).toEqual([
      {
        title: 'Good result',
        link: 'https://example.com/good',
        snippet: 'Good snippet.'
      }
    ])
  })

  it('returns ok false when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await webSearchTool.execute({ query: 'agent tools' }, context())

    expect(result.ok).toBe(false)
    expect(result.content).toContain('network down')
    expect(result.metadata?.errorCode).toBe('network_error')
  })

  it('returns ok false when DuckDuckGo returns a challenge page without results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>'
    }))

    const result = await webSearchTool.execute({ query: 'agent tools' }, context())

    expect(result.ok).toBe(false)
    expect(result.content).toContain('no search results')
  })
})

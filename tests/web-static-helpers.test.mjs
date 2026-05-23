import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildRunRequestBody,
  contextUsagePercent,
  contextUsageLabel,
  encodedWorkspaceId,
  estimateContextTokens,
  escapeHtml,
  isValidThinkingMode,
  isWorkspaceLockedState,
  nextThinkingMode,
  ownsMarkdownFileResponse,
  ownsMarkdownFilesResponse,
  renderMarkdownHtml,
  shouldRefreshMarkdownForToolResult,
  thinkingModeButtonLabel
} from '../src/web/static/app-helpers.js'

describe('web static helpers', () => {
  it('keeps long user messages fully expanded inside the chat bubble', () => {
    const css = readFileSync(new URL('../src/web/static/styles.css', import.meta.url), 'utf8')

    expect(css).toMatch(/\.message-group\s*\{[\s\S]*?flex-shrink:\s*0;/)
    expect(css).toMatch(/\.message\s*\{[\s\S]*?align-items:\s*flex-start;/)
    expect(css).toMatch(/\.message\s*\{[\s\S]*?flex-shrink:\s*0;/)
    expect(css).toMatch(/\.message-content\s*\{[\s\S]*?display:\s*block;/)
    expect(css).toMatch(/\.message-content\s*\{[\s\S]*?min-width:\s*0;/)
    expect(css).toMatch(/\.message-content\s*\{[\s\S]*?word-break:\s*break-word;/)
  })

  it('escapes Markdown preview content while rendering supported blocks', () => {
    const html = renderMarkdownHtml([
      '# <img src=x onerror=alert(1)>',
      '',
      'Paragraph with <script>alert(1)</script> & "quotes".',
      '',
      '- item <b>bold</b>',
      '',
      '```',
      '<button>nope</button>',
      '```'
    ].join('\n'))

    expect(html).toContain('<h1>&lt;img src=x onerror=alert(1)&gt;</h1>')
    expect(html).toContain('<p>Paragraph with &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;.</p>')
    expect(html).toContain('<li>item &lt;b&gt;bold&lt;/b&gt;</li>')
    expect(html).toContain('<pre><code>&lt;button&gt;nope&lt;/button&gt;</code></pre>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<button>nope</button>')
  })

  it('renders safe full-line Markdown PNG images through the workspace file route', () => {
    const html = renderMarkdownHtml('![Portrait <one>](generated-images/portrait.png)', {
      workspaceId: 'project-a'
    })

    expect(html).toContain('<img')
    expect(html).toContain('alt="Portrait &lt;one&gt;"')
    expect(html).toContain('src="/api/workspaces/project-a/files/generated-images/portrait.png"')
    expect(html).not.toContain('<one>')
  })

  it('renders safe full-line Markdown PNG links as image previews', () => {
    const html = renderMarkdownHtml('[Portrait <one>](generated-images/portrait.png)', {
      workspaceId: 'project-a'
    })

    expect(html).toContain('<img')
    expect(html).toContain('alt="Portrait &lt;one&gt;"')
    expect(html).toContain('src="/api/workspaces/project-a/files/generated-images/portrait.png"')
    expect(html).not.toContain('<one>')
  })

  it('renders safe full-line Markdown JPEG images with dot-relative paths', () => {
    const html = renderMarkdownHtml('![Meme <one>](./images/meme.jpeg)', {
      workspaceId: 'project-a'
    })

    expect(html).toContain('<img')
    expect(html).toContain('alt="Meme &lt;one&gt;"')
    expect(html).toContain('src="/api/workspaces/project-a/files/images/meme.jpeg"')
    expect(html).not.toContain('<one>')
  })

  it.each([
    '../secret.png',
    '/tmp/secret.png',
    'javascript:alert(1)'
  ])('leaves unsafe Markdown image paths escaped as paragraph text: %s', (path) => {
    const markdown = `![Secret <one>](${path})`
    const html = renderMarkdownHtml(markdown, { workspaceId: 'project-a' })

    expect(html).toBe(`<p>${escapeHtml(markdown)}</p>`)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<one>')
  })

  it('accepts only Markdown list responses for the current workspace and token', () => {
    expect(ownsMarkdownFilesResponse({
      currentToken: 3,
      responseToken: 3,
      currentWorkspaceId: 'project-a',
      responseWorkspaceId: 'project-a'
    })).toBe(true)

    expect(ownsMarkdownFilesResponse({
      currentToken: 4,
      responseToken: 3,
      currentWorkspaceId: 'project-a',
      responseWorkspaceId: 'project-a'
    })).toBe(false)
    expect(ownsMarkdownFilesResponse({
      currentToken: 3,
      responseToken: 3,
      currentWorkspaceId: 'project-b',
      responseWorkspaceId: 'project-a'
    })).toBe(false)
  })

  it('accepts only Markdown file responses for the current workspace, file, and token', () => {
    expect(ownsMarkdownFileResponse({
      currentToken: 2,
      responseToken: 2,
      currentWorkspaceId: '',
      responseWorkspaceId: '',
      currentFileId: 'README.md',
      responseFileId: 'README.md'
    })).toBe(true)

    expect(ownsMarkdownFileResponse({
      currentToken: 3,
      responseToken: 2,
      currentWorkspaceId: '',
      responseWorkspaceId: '',
      currentFileId: 'README.md',
      responseFileId: 'README.md'
    })).toBe(false)
    expect(ownsMarkdownFileResponse({
      currentToken: 2,
      responseToken: 2,
      currentWorkspaceId: 'project-a',
      responseWorkspaceId: '',
      currentFileId: 'README.md',
      responseFileId: 'README.md'
    })).toBe(false)
    expect(ownsMarkdownFileResponse({
      currentToken: 2,
      responseToken: 2,
      currentWorkspaceId: '',
      responseWorkspaceId: '',
      currentFileId: 'CHANGELOG.md',
      responseFileId: 'README.md'
    })).toBe(false)
  })

  it('builds run requests with the selected workspace and reports workspace lock state', () => {
    expect(buildRunRequestBody({
      sessionId: 's1',
      message: 'hello',
      workspaceId: 'project-a',
      thinkingMode: 'off'
    })).toEqual({
      sessionId: 's1',
      message: 'hello',
      workspaceId: 'project-a',
      thinkingMode: 'off'
    })
    expect(isValidThinkingMode('auto')).toBe(true)
    expect(isValidThinkingMode('on')).toBe(true)
    expect(isValidThinkingMode('off')).toBe(true)
    expect(isValidThinkingMode('enabled')).toBe(false)
    expect(nextThinkingMode('auto')).toBe('on')
    expect(nextThinkingMode('on')).toBe('off')
    expect(nextThinkingMode('off')).toBe('auto')
    expect(nextThinkingMode('enabled')).toBe('auto')
    expect(thinkingModeButtonLabel('auto')).toBe('Think: Auto')
    expect(thinkingModeButtonLabel('on')).toBe('Think: On')
    expect(thinkingModeButtonLabel('off')).toBe('Think: Off')
    expect(thinkingModeButtonLabel('enabled')).toBe('Think: Auto')
    expect(encodedWorkspaceId('')).toBe('@root')
    expect(encodedWorkspaceId('project a')).toBe('project%20a')
    expect(isWorkspaceLockedState({ isSending: true, activeRun: null })).toBe(true)
    expect(isWorkspaceLockedState({ isSending: false, activeRun: {} })).toBe(true)
    expect(isWorkspaceLockedState({ isSending: false, activeRun: null })).toBe(false)
  })

  it('refreshes Markdown context after successful file mutations', () => {
    expect(shouldRefreshMarkdownForToolResult({ type: 'tool_result', name: 'file_write', ok: true })).toBe(true)
    expect(shouldRefreshMarkdownForToolResult({ type: 'tool_result', name: 'file_edit', ok: true })).toBe(true)
    expect(shouldRefreshMarkdownForToolResult({ type: 'tool_result', name: 'file_delete', ok: true })).toBe(true)
    expect(shouldRefreshMarkdownForToolResult({ type: 'tool_result', name: 'bash', ok: true, summary: 'rm notes.md' })).toBe(true)
    expect(shouldRefreshMarkdownForToolResult({ type: 'tool_result', name: 'file_write', ok: false })).toBe(false)
    expect(shouldRefreshMarkdownForToolResult({ type: 'tool_result', name: 'bash', ok: true, summary: 'npm test' })).toBe(false)
    expect(shouldRefreshMarkdownForToolResult({ type: 'final', text: 'done' })).toBe(false)
  })

  it('estimates context usage from saved messages and the current draft', () => {
    expect(estimateContextTokens([], '')).toBe(0)
    expect(estimateContextTokens([
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: '你好' }
    ], 'draft')).toBe(5)
    expect(contextUsagePercent({
      messages: [{ role: 'user', content: 'x'.repeat(400) }],
      draft: '',
      contextWindowTokens: 100
    })).toBe(100)
    expect(contextUsagePercent({
      messages: [{ role: 'user', content: 'hello' }],
      draft: '',
      contextWindowTokens: 100
    })).toBe(2)
    expect(contextUsageLabel({
      percent: 18,
      modelContext: {
        model: 'deepseek-v4-pro',
        contextWindowTokens: 1_048_576
      }
    })).toBe('Context usage 18% of deepseek-v4-pro 1M')
  })
})

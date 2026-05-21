import { describe, expect, it } from 'vitest'
import {
  buildRunRequestBody,
  contextUsagePercent,
  encodedWorkspaceId,
  estimateContextTokens,
  isWorkspaceLockedState,
  ownsMarkdownFileResponse,
  ownsMarkdownFilesResponse,
  renderMarkdownHtml
} from '../src/web/static/app-helpers.js'

describe('web static helpers', () => {
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
    expect(buildRunRequestBody({ sessionId: 's1', message: 'hello', workspaceId: 'project-a' })).toEqual({
      sessionId: 's1',
      message: 'hello',
      workspaceId: 'project-a'
    })
    expect(encodedWorkspaceId('')).toBe('@root')
    expect(encodedWorkspaceId('project a')).toBe('project%20a')
    expect(isWorkspaceLockedState({ isSending: true, activeRun: null })).toBe(true)
    expect(isWorkspaceLockedState({ isSending: false, activeRun: {} })).toBe(true)
    expect(isWorkspaceLockedState({ isSending: false, activeRun: null })).toBe(false)
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
  })
})

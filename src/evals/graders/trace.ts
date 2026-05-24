import { createTraceRun } from '../../tracing/trace-store.js'
import { loadTraceMessages, renderTraceReplay } from '../../tracing/replay.js'
import type { EvalCase, EvalCaseResult } from '../types.js'

export async function gradeTraceCase(cwd: string, testCase: EvalCase): Promise<EvalCaseResult> {
  const runId = runIdFromInput(testCase.input)
  const store = await createTraceRun({
    cwd,
    runId,
    input: {
      runId,
      mode: 'cli',
      cwd,
      startedAt: '2026-05-24T00:00:00.000Z',
      userMessage: { role: 'user', content: 'hello' }
    }
  })
  await store.appendMessage({ at: '2026-05-24T00:00:00.000Z', message: { role: 'user', content: 'hello' } })
  await store.appendMessage({ at: '2026-05-24T00:00:01.000Z', message: { role: 'assistant', content: 'hi' } })
  const messages = await loadTraceMessages(cwd, runId)
  const transcript = await renderTraceReplay(cwd, runId)
  const passed = messages.length === 2 && transcript === expectedTranscript(testCase.expected)
  return {
    id: testCase.id,
    suite: testCase.suite,
    passed,
    score: passed ? 1 : 0,
    blocking: testCase.blocking,
    failures: passed ? [] : [`Unexpected transcript: ${transcript}`],
    evidence: { runId, transcript }
  }
}

function runIdFromInput(input: unknown): string {
  return typeof input === 'object' && input !== null && 'runId' in input && typeof input.runId === 'string'
    ? input.runId
    : 'eval-trace-run'
}

function expectedTranscript(expected: unknown): string {
  return typeof expected === 'object' && expected !== null && 'transcript' in expected && typeof expected.transcript === 'string'
    ? expected.transcript
    : 'user: hello\n\nassistant: hi\n'
}

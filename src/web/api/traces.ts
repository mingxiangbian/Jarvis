import type { ServerResponse } from 'node:http'
import { listTraceRunSummaries, readTraceRunSummary } from '../../tracing/trace-store.js'
import { controlError, controlOk, writeControlJson } from './types.js'

export interface TracesApiContext {
  cwd: string
}

export async function getTraceList(response: ServerResponse, context: TracesApiContext): Promise<void> {
  writeControlJson(response, 200, controlOk({
    traces: await listTraceRunSummaries(context.cwd)
  }))
}

export async function getTraceDetail(
  response: ServerResponse,
  context: TracesApiContext,
  runId: string
): Promise<void> {
  try {
    const trace = await readTraceRunSummary(context.cwd, runId)
    if (trace === null) {
      writeControlJson(response, 404, controlError('Trace run is no longer available.'))
      return
    }
    writeControlJson(response, 200, controlOk({ trace }))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unsafe trace run id:')) {
      writeControlJson(response, 400, controlError('Invalid trace run id.'))
      return
    }
    throw error
  }
}


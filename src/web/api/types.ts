import type { ServerResponse } from 'node:http'

export type ControlWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason?: string }

export function controlOk<T>(data: T): ControlWriteResult<T> {
  return { ok: true, data }
}

export function controlError(error: string, reason?: string): ControlWriteResult<never> {
  return {
    ok: false,
    error,
    ...(reason === undefined ? {} : { reason })
  }
}

export function writeControlJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}


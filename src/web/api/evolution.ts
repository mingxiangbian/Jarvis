import { execFile } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gateEvolutionProposal } from '../../evolution/promotion-gate.js'
import {
  decideEvolutionProposal,
  listEvolutionProposals,
  proposalDir,
  readEvolutionProposal,
  readEvolutionProposalArtifacts,
  updateEvolutionProposalStatus
} from '../../evolution/proposal-store.js'
import type { EvolutionProposal, EvolutionProposalStatus } from '../../evolution/types.js'
import { controlError, controlOk, writeControlJson } from './types.js'

const execFileAsync = promisify(execFile)
const PROMPT_PATCH_ALLOWLIST = new Set(['src/prompts/system.md'])

export interface EvolutionApiContext {
  cwd: string
}

export async function getEvolutionProposals(
  response: ServerResponse,
  context: EvolutionApiContext
): Promise<void> {
  writeControlJson(response, 200, controlOk({
    proposals: await listEvolutionProposals(context.cwd)
  }))
}

export async function getEvolutionProposalDetail(
  response: ServerResponse,
  context: EvolutionApiContext,
  proposalId: string
): Promise<void> {
  try {
    const proposal = await readEvolutionProposal(context.cwd, proposalId)
    const artifacts = await readEvolutionProposalArtifacts(context.cwd, proposalId)
    writeControlJson(response, 200, controlOk({ proposal, artifacts }))
  } catch (error) {
    writeEvolutionReadError(response, error)
  }
}

export async function rejectEvolutionProposal(
  response: ServerResponse,
  context: EvolutionApiContext,
  proposalId: string
): Promise<void> {
  try {
    const approval = await decideEvolutionProposal({
      cwd: context.cwd,
      proposalId,
      status: 'rejected',
      channel: 'web',
      reason: 'Rejected from Web control console'
    })
    const proposal = await updateEvolutionProposalStatus({ cwd: context.cwd, proposalId, status: 'rejected' })
    writeControlJson(response, 200, controlOk({ approved: false, rejected: true, status: proposal.status, approval }))
  } catch (error) {
    writeEvolutionDecisionError(response, error)
  }
}

export async function approveEvolutionProposal(
  response: ServerResponse,
  context: EvolutionApiContext,
  proposalId: string
): Promise<void> {
  let proposal: EvolutionProposal
  try {
    proposal = await readEvolutionProposal(context.cwd, proposalId)
    const artifacts = await readEvolutionProposalArtifacts(context.cwd, proposalId)
    const gate = gateEvolutionProposal({
      proposal,
      evalPassed: evalResultsPassed(artifacts.evalResults),
      hasPromptDiff: artifacts.promptPatchDiff !== undefined
    })
    if (gate.status === 'blocked' || gate.status === 'rejected') {
      writeControlJson(response, 422, controlError(gate.reason))
      return
    }
    const approval = await decideEvolutionProposal({
      cwd: context.cwd,
      proposalId,
      status: 'approved',
      channel: 'web'
    })

    const nextStatus: EvolutionProposalStatus =
      proposal.type === 'prompt'
        ? 'approved'
        : proposal.risk === 'low'
          ? 'applied'
          : 'approved'
    proposal = await updateEvolutionProposalStatus({ cwd: context.cwd, proposalId, status: nextStatus })
    writeControlJson(response, 200, controlOk({
      approved: true,
      applied: proposal.status === 'applied',
      status: proposal.status,
      approval
    }))
  } catch (error) {
    writeEvolutionDecisionError(response, error)
  }
}

export async function applyEvolutionProposal(
  response: ServerResponse,
  context: EvolutionApiContext,
  proposalId: string
): Promise<void> {
  try {
    const proposal = await readEvolutionProposal(context.cwd, proposalId)
    const artifacts = await readEvolutionProposalArtifacts(context.cwd, proposalId)
    if (proposal.type !== 'prompt') {
      writeControlJson(response, 422, controlError('Only prompt proposals can be applied from this endpoint.'))
      return
    }
    if (artifacts.approval?.status !== 'approved') {
      writeControlJson(response, 409, controlError('Prompt proposal must be approved before apply.'))
      return
    }
    const gate = gateEvolutionProposal({
      proposal,
      evalPassed: evalResultsPassed(artifacts.evalResults),
      hasPromptDiff: artifacts.promptPatchDiff !== undefined
    })
    if (gate.status === 'blocked' || gate.status === 'rejected') {
      writeControlJson(response, 422, controlError(gate.reason))
      return
    }
    if (artifacts.promptPatchDiff === undefined) {
      writeControlJson(response, 422, controlError('Prompt proposal is missing prompt.patch.diff.'))
      return
    }
    const unsupportedTarget = unsupportedPromptPatchTarget(artifacts.promptPatchDiff)
    if (unsupportedTarget !== undefined) {
      writeControlJson(response, 422, controlError('Prompt patch touches unsupported file.', unsupportedTarget))
      return
    }

    const patchPath = join(proposalDir(context.cwd, proposalId), 'web-apply.patch')
    await writeFile(patchPath, `${artifacts.promptPatchDiff.trimEnd()}\n`, 'utf8')
    await execFileAsync('git', ['apply', '--check', patchPath], { cwd: context.cwd })
    await execFileAsync('git', ['apply', patchPath], { cwd: context.cwd })
    const updated = await updateEvolutionProposalStatus({ cwd: context.cwd, proposalId, status: 'applied' })
    writeControlJson(response, 200, controlOk({ applied: true, status: updated.status }))
  } catch (error) {
    writeEvolutionDecisionError(response, error)
  }
}

function unsupportedPromptPatchTarget(diff: string): string | undefined {
  const targets = new Set<string>()
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('+++ ')) {
      continue
    }
    const target = line.slice(4).trim()
    if (target === '/dev/null') {
      continue
    }
    const normalized = target.startsWith('b/') ? target.slice(2) : target
    targets.add(normalized)
  }
  return [...targets].find((target) => !PROMPT_PATCH_ALLOWLIST.has(target))
}

function evalResultsPassed(evalResults: unknown): boolean {
  if (evalResults === undefined) {
    return false
  }
  if (typeof evalResults === 'object' && evalResults !== null) {
    const record = evalResults as Record<string, unknown>
    return record.passed === true || record.ok === true || record.status === 'passed' || record.status === 'ok'
  }
  return false
}

function writeEvolutionReadError(response: ServerResponse, error: unknown): void {
  if (error instanceof Error && error.message.startsWith('Invalid proposal id:')) {
    writeControlJson(response, 400, controlError('Invalid proposal id.'))
    return
  }
  if (isFileNotFoundError(error)) {
    writeControlJson(response, 404, controlError('Proposal not found.'))
    return
  }
  throw error
}

function writeEvolutionDecisionError(response: ServerResponse, error: unknown): void {
  if (error instanceof Error && error.message.startsWith('Proposal hash mismatch:')) {
    writeControlJson(response, 409, controlError('Proposal hash changed since approval.', error.message))
    return
  }
  if (error instanceof Error && error.message.startsWith('Invalid proposal id:')) {
    writeControlJson(response, 400, controlError('Invalid proposal id.'))
    return
  }
  if (isFileNotFoundError(error)) {
    writeControlJson(response, 404, controlError('Proposal not found.'))
    return
  }
  if (error instanceof Error) {
    writeControlJson(response, 422, controlError(error.message))
    return
  }
  writeControlJson(response, 422, controlError(String(error)))
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}


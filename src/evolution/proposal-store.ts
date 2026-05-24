import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { CreateEvolutionProposalInput, EvolutionApproval, EvolutionProposal, EvolutionProposalStatus } from './types.js'

export interface CreateStoredEvolutionProposalInput {
  cwd: string
  proposal: CreateEvolutionProposalInput
  rationale: string
  promptPatchDiff?: string
  evalResults?: unknown
}

export interface DecideEvolutionProposalInput {
  cwd: string
  proposalId: string
  status: 'approved' | 'rejected'
  channel: 'cli' | 'web'
  reason?: string
  decidedAt?: string
}

export interface EvolutionProposalArtifacts {
  rationale: string
  promptPatchDiff?: string
  approval?: EvolutionApproval
  evalResults?: unknown
}

export interface UpdateEvolutionProposalStatusInput {
  cwd: string
  proposalId: string
  status: EvolutionProposalStatus
}

export async function createEvolutionProposal(input: CreateStoredEvolutionProposalInput): Promise<EvolutionProposal> {
  const now = new Date().toISOString()
  const proposalId = input.proposal.id ?? `proposal-${randomUUID()}`
  const rationale = input.rationale.trimEnd()
  const promptPatchDiff = input.promptPatchDiff?.trimEnd()
  assertSafeProposalId(proposalId)
  const proposal: EvolutionProposal = {
    id: proposalId,
    type: input.proposal.type,
    status: input.proposal.status ?? 'draft',
    risk: input.proposal.risk,
    sourceRunIds: input.proposal.sourceRunIds,
    evidence: input.proposal.evidence,
    summary: input.proposal.summary,
    proposedChange: input.proposal.proposedChange,
    ...(input.proposal.evalRunId === undefined ? {} : { evalRunId: input.proposal.evalRunId }),
    approvalRequired: input.proposal.approvalRequired,
    gateReason: input.proposal.gateReason,
    createdAt: now,
    proposalHash: ''
  }
  proposal.proposalHash = computeProposalHash(proposal, {
    rationale,
    promptPatchDiff
  })

  const dir = await ensureProposalDir(input.cwd, proposal.id)
  await writeJson(join(dir, 'proposal.json'), proposal)
  await writeFile(join(dir, 'rationale.md'), `${rationale}\n`, 'utf8')
  if (promptPatchDiff !== undefined) {
    await writeFile(join(dir, 'prompt.patch.diff'), `${promptPatchDiff}\n`, 'utf8')
  }
  if (input.evalResults !== undefined) {
    await writeJson(join(dir, 'eval-results.json'), input.evalResults)
  }
  return proposal
}

export async function readEvolutionProposal(cwd: string, proposalId: string): Promise<EvolutionProposal> {
  assertSafeProposalId(proposalId)
  return JSON.parse(await readFile(join(proposalDir(cwd, proposalId), 'proposal.json'), 'utf8')) as EvolutionProposal
}

export async function listEvolutionProposals(cwd: string): Promise<EvolutionProposal[]> {
  let entries
  try {
    entries = await readdir(proposalsDir(cwd), { withFileTypes: true })
  } catch {
    return []
  }
  const proposals = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      proposals.push(await readEvolutionProposal(cwd, entry.name))
    } catch {
    }
  }
  return proposals.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export async function readEvolutionProposalArtifacts(
  cwd: string,
  proposalId: string
): Promise<EvolutionProposalArtifacts> {
  assertSafeProposalId(proposalId)
  const dir = proposalDir(cwd, proposalId)
  return {
    rationale: (await readFile(join(dir, 'rationale.md'), 'utf8')).trimEnd(),
    promptPatchDiff: await readOptionalTrimmedFile(join(dir, 'prompt.patch.diff')),
    approval: await readOptionalJson<EvolutionApproval>(join(dir, 'approval.json')),
    evalResults: await readOptionalJson<unknown>(join(dir, 'eval-results.json'))
  }
}

export async function updateEvolutionProposalStatus(
  input: UpdateEvolutionProposalStatusInput
): Promise<EvolutionProposal> {
  const proposal = await readEvolutionProposal(input.cwd, input.proposalId)
  const artifacts = await readEvolutionProposalArtifacts(input.cwd, input.proposalId)
  const updated: EvolutionProposal = {
    ...proposal,
    status: input.status
  }
  updated.proposalHash = computeProposalHash(updated, {
    rationale: artifacts.rationale,
    promptPatchDiff: artifacts.promptPatchDiff
  })
  await writeJson(join(proposalDir(input.cwd, proposal.id), 'proposal.json'), updated)
  return updated
}

export async function decideEvolutionProposal(input: DecideEvolutionProposalInput): Promise<EvolutionApproval> {
  const proposal = await readEvolutionProposal(input.cwd, input.proposalId)
  await assertProposalHashMatches(input.cwd, proposal)
  const approval: EvolutionApproval = {
    proposalId: proposal.id,
    status: input.status,
    channel: input.channel,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
    decidedBy: 'local-user',
    ...(proposal.evalRunId === undefined ? {} : { evalRunId: proposal.evalRunId }),
    proposalHash: proposal.proposalHash,
    ...(input.reason === undefined ? {} : { reason: input.reason })
  }
  await writeJson(join(proposalDir(input.cwd, proposal.id), 'approval.json'), approval)
  return approval
}

export function computeProposalHash(
  proposal: EvolutionProposal,
  artifacts: { rationale?: string; promptPatchDiff?: string } = {}
): string {
  const canonical = {
    proposal: {
      ...proposal,
      status: '',
      proposalHash: ''
    },
    artifacts
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function proposalsDir(cwd: string): string {
  return resolve(cwd, '.cyrene', 'proposals')
}

export function proposalDir(cwd: string, proposalId: string): string {
  assertSafeProposalId(proposalId)
  const root = proposalsDir(cwd)
  const dir = resolve(root, proposalId)
  if (dir !== root && !dir.startsWith(`${root}${sep}`)) {
    throw new Error(`Invalid proposal id: ${proposalId}`)
  }
  return dir
}

export function assertSafeProposalId(proposalId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(proposalId) || proposalId.includes('..')) {
    throw new Error(`Invalid proposal id: ${proposalId}`)
  }
}

async function ensureProposalDir(cwd: string, proposalId: string): Promise<string> {
  const dir = proposalDir(cwd, proposalId)
  await mkdir(dir, { recursive: true })
  const [cwdRealPath, dirRealPath] = await Promise.all([
    realpath(cwd),
    realpath(dir)
  ])
  if (dirRealPath !== cwdRealPath && !dirRealPath.startsWith(`${cwdRealPath}${sep}`)) {
    throw new Error('Proposal directory must stay inside the project.')
  }
  return dir
}

async function assertProposalHashMatches(cwd: string, proposal: EvolutionProposal): Promise<void> {
  const dir = proposalDir(cwd, proposal.id)
  const rationale = (await readFile(join(dir, 'rationale.md'), 'utf8')).trimEnd()
  const promptPatchDiff = await readOptionalTrimmedFile(join(dir, 'prompt.patch.diff'))
  const currentHash = computeProposalHash(proposal, {
    rationale,
    promptPatchDiff
  })
  if (currentHash !== proposal.proposalHash) {
    throw new Error(`Proposal hash mismatch: ${proposal.id}`)
  }
}

async function readOptionalTrimmedFile(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trimEnd()
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

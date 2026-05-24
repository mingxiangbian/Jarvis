import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEvolutionProposal,
  decideEvolutionProposal,
  listEvolutionProposals,
  readEvolutionProposal,
  updateEvolutionProposalStatus
} from '../src/evolution/proposal-store.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-evolution-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('evolution proposal store', () => {
  it('creates, reads, lists, and approves a proposal with a stable hash', async () => {
    const cwd = await createTempDir()
    const proposal = await createEvolutionProposal({
      cwd,
      proposal: {
        type: 'procedural',
        risk: 'low',
        sourceRunIds: ['run-1'],
        evidence: ['User confirmed a durable workflow.'],
        summary: 'Remember the workflow.',
        proposedChange: { content: 'Use eval before evolution.' },
        evalRunId: 'eval-1',
        approvalRequired: false,
        gateReason: 'Eligible low-risk procedural note.'
      },
      rationale: 'The lesson has explicit evidence.'
    })

    await expect(readEvolutionProposal(cwd, proposal.id)).resolves.toMatchObject({
      id: proposal.id,
      proposalHash: proposal.proposalHash
    })
    await expect(listEvolutionProposals(cwd)).resolves.toHaveLength(1)
    const decision = await decideEvolutionProposal({ cwd, proposalId: proposal.id, status: 'approved', channel: 'cli' })
    expect(decision.proposalHash).toBe(proposal.proposalHash)
    await expect(readFile(join(cwd, '.cyrene', 'proposals', proposal.id, 'approval.json'), 'utf8')).resolves.toContain(
      '"status": "approved"'
    )
  })

  it('records Web approvals and updates proposal status', async () => {
    const cwd = await createTempDir()
    const proposal = await createEvolutionProposal({
      cwd,
      proposal: {
        type: 'procedural',
        risk: 'low',
        sourceRunIds: ['run-1'],
        evidence: ['User confirmed a durable workflow.'],
        summary: 'Remember the workflow.',
        proposedChange: { content: 'Use eval before evolution.' },
        evalRunId: 'eval-1',
        approvalRequired: false,
        gateReason: 'Eligible low-risk procedural note.'
      },
      rationale: 'The lesson has explicit evidence.'
    })

    const approval = await decideEvolutionProposal({
      cwd,
      proposalId: proposal.id,
      status: 'approved',
      channel: 'web'
    })
    const updated = await updateEvolutionProposalStatus({
      cwd,
      proposalId: proposal.id,
      status: 'approved'
    })

    expect(approval.channel).toBe('web')
    expect(updated.status).toBe('approved')
    await expect(readEvolutionProposal(cwd, proposal.id)).resolves.toMatchObject({ status: 'approved' })
  })

  it('rejects unsafe proposal ids', async () => {
    const cwd = await createTempDir()
    await expect(readEvolutionProposal(cwd, '../outside')).rejects.toThrow('Invalid proposal id')
  })

  it('rejects approval when the stored proposal hash no longer matches artifacts', async () => {
    const cwd = await createTempDir()
    const proposal = await createEvolutionProposal({
      cwd,
      proposal: {
        type: 'procedural',
        risk: 'low',
        sourceRunIds: ['run-1'],
        evidence: ['User confirmed a durable workflow.'],
        summary: 'Remember the workflow.',
        proposedChange: { content: 'Use eval before evolution.' },
        evalRunId: 'eval-1',
        approvalRequired: false,
        gateReason: 'Eligible low-risk procedural note.'
      },
      rationale: 'The lesson has explicit evidence.'
    })
    const path = join(cwd, '.cyrene', 'proposals', proposal.id, 'proposal.json')
    await writeFile(path, `${JSON.stringify({ ...proposal, summary: 'Tampered proposal.' }, null, 2)}\n`, 'utf8')

    await expect(
      decideEvolutionProposal({ cwd, proposalId: proposal.id, status: 'approved', channel: 'cli' })
    ).rejects.toThrow(/Proposal hash mismatch/)
  })
})

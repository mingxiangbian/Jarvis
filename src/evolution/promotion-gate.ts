import type { EvolutionProposal, EvolutionProposalStatus } from './types.js'

export interface GateEvolutionProposalInput {
  proposal: EvolutionProposal
  evalPassed: boolean
  hasPromptDiff?: boolean
}

export interface GateEvolutionProposalDecision {
  status: EvolutionProposalStatus
  approvalRequired: boolean
  reason: string
}

const SUPPORTED_TYPES = new Set(['memory', 'procedural', 'tool_usage_note', 'prompt'])

export function gateEvolutionProposal(input: GateEvolutionProposalInput): GateEvolutionProposalDecision {
  if (!SUPPORTED_TYPES.has(input.proposal.type)) {
    return {
      status: 'rejected',
      approvalRequired: false,
      reason: `Unsupported proposal type: ${input.proposal.type}`
    }
  }

  if (input.proposal.sourceRunIds.length === 0 || input.proposal.evidence.length === 0) {
    return {
      status: 'blocked',
      approvalRequired: false,
      reason: 'Proposal is missing source run evidence'
    }
  }

  if (input.proposal.evalRunId === undefined) {
    return {
      status: 'blocked',
      approvalRequired: false,
      reason: 'Proposal is missing eval result'
    }
  }

  if (!input.evalPassed) {
    return {
      status: 'blocked',
      approvalRequired: false,
      reason: 'Proposal eval has blocking failures'
    }
  }

  if (input.proposal.type === 'prompt') {
    if (input.hasPromptDiff !== true) {
      return {
        status: 'blocked',
        approvalRequired: false,
        reason: 'Prompt proposal is missing prompt.patch.diff'
      }
    }
    return {
      status: 'approval_required',
      approvalRequired: true,
      reason: 'Prompt proposal requires manual approval'
    }
  }

  if (input.proposal.risk !== 'low') {
    return {
      status: 'approval_required',
      approvalRequired: true,
      reason: `${input.proposal.risk} risk proposal requires manual approval`
    }
  }

  return {
    status: 'eligible',
    approvalRequired: false,
    reason: 'Low-risk proposal passed eval gate'
  }
}

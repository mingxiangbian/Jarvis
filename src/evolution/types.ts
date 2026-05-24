export type SupportedEvolutionProposalType = 'memory' | 'procedural' | 'tool_usage_note' | 'prompt'
export type UnsupportedEvolutionProposalType = 'skill' | 'code' | 'permission' | 'shell_policy'
export type EvolutionProposalType = SupportedEvolutionProposalType | UnsupportedEvolutionProposalType
export type EvolutionProposalStatus =
  | 'draft'
  | 'eligible'
  | 'approval_required'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'blocked'
export type EvolutionRisk = 'low' | 'medium' | 'high'

export interface EvolutionProposal {
  id: string
  type: EvolutionProposalType
  status: EvolutionProposalStatus
  risk: EvolutionRisk
  sourceRunIds: string[]
  evidence: string[]
  summary: string
  proposedChange: unknown
  evalRunId?: string
  approvalRequired: boolean
  gateReason: string
  createdAt: string
  proposalHash: string
}

export interface EvolutionApproval {
  proposalId: string
  status: 'approved' | 'rejected'
  channel: 'cli'
  decidedAt: string
  decidedBy: 'local-user'
  evalRunId?: string
  proposalHash: string
  reason?: string
}

export interface CreateEvolutionProposalInput {
  type: EvolutionProposalType
  risk: EvolutionRisk
  sourceRunIds: string[]
  evidence: string[]
  summary: string
  proposedChange: unknown
  evalRunId?: string
  approvalRequired: boolean
  gateReason: string
  status?: EvolutionProposalStatus
  id?: string
}

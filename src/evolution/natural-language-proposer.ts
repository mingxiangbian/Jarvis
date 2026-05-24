import { runEvalHarness } from '../evals/eval-runner.js'
import { gateEvolutionProposal } from './promotion-gate.js'
import { createEvolutionProposal } from './proposal-store.js'
import type { EvolutionProposal, EvolutionProposalType } from './types.js'

export interface ProposeEvolutionFromTextInput {
  cwd: string
  text: string
}

export interface ProposeEvolutionFromTextResult {
  proposal: EvolutionProposal
  evalRunId: string
  evalPassed: boolean
}

export async function proposeEvolutionFromText(
  input: ProposeEvolutionFromTextInput
): Promise<ProposeEvolutionFromTextResult> {
  const text = input.text.trim()
  if (text === '') {
    throw new Error('Proposal text cannot be empty.')
  }

  const classified = classifyProposalText(text)
  const report = await runEvalHarness({
    cwd: input.cwd,
    suites: ['memory', 'affect', 'security', 'evolution']
  })
  const draft: EvolutionProposal = {
    id: 'draft',
    type: classified.type,
    status: 'draft',
    risk: classified.risk,
    sourceRunIds: ['cli-natural-language'],
    evidence: [`CLI natural-language proposal: ${text}`],
    summary: classified.summary,
    proposedChange: classified.proposedChange,
    evalRunId: report.evalRunId,
    approvalRequired: false,
    gateReason: '',
    createdAt: report.finishedAt,
    proposalHash: ''
  }
  const gate = gateEvolutionProposal({
    proposal: draft,
    evalPassed: report.passed,
    hasPromptDiff: classified.promptPatchDiff !== undefined
  })
  const proposal = await createEvolutionProposal({
    cwd: input.cwd,
    proposal: {
      type: draft.type,
      status: gate.status,
      risk: draft.risk,
      sourceRunIds: draft.sourceRunIds,
      evidence: draft.evidence,
      summary: draft.summary,
      proposedChange: draft.proposedChange,
      evalRunId: report.evalRunId,
      approvalRequired: gate.approvalRequired,
      gateReason: gate.reason
    },
    rationale: [
      'Created from CLI natural-language proposal.',
      '',
      text
    ].join('\n'),
    promptPatchDiff: classified.promptPatchDiff,
    evalResults: report
  })

  return {
    proposal,
    evalRunId: report.evalRunId,
    evalPassed: report.passed
  }
}

function classifyProposalText(text: string): {
  type: EvolutionProposalType
  risk: 'low' | 'medium' | 'high'
  summary: string
  proposedChange: unknown
  promptPatchDiff?: string
} {
  const lower = text.toLowerCase()
  if (matchesAny(lower, ['permission', '权限', 'shell 权限', 'tool permission'])) {
    return {
      type: 'permission',
      risk: 'high',
      summary: summarize(text),
      proposedChange: { content: text }
    }
  }
  if (matchesAny(lower, ['shell_policy', 'shell policy', 'shell策略', 'shell 策略'])) {
    return {
      type: 'shell_policy',
      risk: 'high',
      summary: summarize(text),
      proposedChange: { content: text }
    }
  }
  if (matchesAny(lower, ['tool usage', '工具使用', 'tool note'])) {
    return {
      type: 'tool_usage_note',
      risk: 'low',
      summary: summarize(text),
      proposedChange: { content: text }
    }
  }
  if (matchesAny(lower, ['procedural', 'procedure', '流程', '步骤'])) {
    return {
      type: 'procedural',
      risk: 'low',
      summary: summarize(text),
      proposedChange: { content: text }
    }
  }
  if (matchesAny(lower, ['system prompt', 'prompt', '系统提示', '提示词'])) {
    return {
      type: 'prompt',
      risk: 'high',
      summary: summarize(text),
      proposedChange: { content: text },
      promptPatchDiff: [
        'diff --git a/src/prompts/system.md b/src/prompts/system.md',
        '--- a/src/prompts/system.md',
        '+++ b/src/prompts/system.md',
        '@@',
        `+${text}`
      ].join('\n')
    }
  }
  return {
    type: 'memory',
    risk: matchesAny(lower, ['删除', '覆盖', 'delete', 'overwrite']) ? 'high' : 'low',
    summary: summarize(text),
    proposedChange: { content: text }
  }
}

function matchesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

function summarize(text: string): string {
  return text.length <= 120 ? text : `${text.slice(0, 117)}...`
}

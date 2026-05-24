import type { EvalCase } from '../types.js'

export function loadEvalCases(): EvalCase[] {
  return [
    {
      id: 'memory.project-hard-auto-write',
      suite: 'memory',
      title: 'Project hard memory can auto-write',
      kind: 'module_contract',
      tags: ['phase-3'],
      input: { scenario: 'project-hard-auto-write' },
      expected: { action: 'auto_write' },
      blocking: true
    },
    {
      id: 'memory.implicit-personal-pending',
      suite: 'memory',
      title: 'Implicit personal memory stays pending',
      kind: 'module_contract',
      tags: ['phase-3'],
      input: { scenario: 'implicit-personal-pending' },
      expected: { action: 'pending' },
      blocking: true
    },
    {
      id: 'memory.diagnostic-affective-reject',
      suite: 'memory',
      title: 'Diagnostic affective memory is rejected',
      kind: 'module_contract',
      tags: ['phase-3', 'phase-4'],
      input: { scenario: 'diagnostic-affective-reject' },
      expected: { action: 'reject' },
      blocking: true
    },
    {
      id: 'affect.no-diagnostic-label',
      suite: 'affect',
      title: 'Affect analysis avoids diagnostic labels',
      kind: 'module_contract',
      tags: ['phase-4'],
      input: { scenario: 'distressed-user' },
      expected: { excludes: ['depressed'], includes: ['distressed'] },
      blocking: true
    },
    {
      id: 'affect.policy-non-anthropomorphic',
      suite: 'affect',
      title: 'Continuity policy avoids subjective emotion claims',
      kind: 'module_contract',
      tags: ['phase-4'],
      input: { scenario: 'continuity-policy' },
      expected: { excludes: ['Cyrene feels'] },
      blocking: true
    },
    {
      id: 'security.bash-deny-pattern',
      suite: 'security',
      title: 'Bash deny pattern blocks high-risk shell command',
      kind: 'module_contract',
      tags: ['phase-0', 'security'],
      input: { command: 'rm -rf /' },
      expected: { denied: true },
      blocking: true
    },
    {
      id: 'security.unsupported-permission-proposal',
      suite: 'security',
      title: 'Unsupported permission proposal is rejected',
      kind: 'module_contract',
      tags: ['phase-6', 'security'],
      input: { proposalType: 'permission' },
      expected: { status: 'rejected' },
      blocking: true
    },
    {
      id: 'trace.create-and-replay',
      suite: 'trace',
      title: 'Trace store creates replayable transcript',
      kind: 'module_contract',
      tags: ['phase-2'],
      input: { runId: 'eval-trace-run' },
      expected: { transcript: 'user: hello\n\nassistant: hi\n' },
      blocking: true
    },
    {
      id: 'evolution.prompt-requires-approval',
      suite: 'evolution',
      title: 'Prompt proposal requires approval',
      kind: 'module_contract',
      tags: ['phase-6'],
      input: { proposalType: 'prompt' },
      expected: { status: 'approval_required' },
      blocking: true
    },
    {
      id: 'evolution.missing-eval-blocked',
      suite: 'evolution',
      title: 'Proposal without eval result is blocked',
      kind: 'module_contract',
      tags: ['phase-5', 'phase-6'],
      input: { scenario: 'missing-eval' },
      expected: { status: 'blocked' },
      blocking: true
    }
  ]
}

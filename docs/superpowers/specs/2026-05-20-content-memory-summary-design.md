# Content Memory Summary Design

## Goal

Convert `daily.md` from a tool-call log into a clean short-term content memory. The file should help future sessions recover useful context without inheriting noise from routine exploration, command execution, or file edits.

The system should prefer skipping weak entries over writing low-value summaries. It should be conservative enough for local models: code performs the first-pass filtering and final validation, while the model only summarizes candidate turns.

## Non-Goals

- Do not record every tool call.
- Do not record file edits merely because a file changed.
- Do not make `daily.md` a full transcript.
- Do not change durable memory file format or `MEMORY.md` indexing.
- Do not require Web users to exit a session before memory compaction can run.

## Current Problem

`runAgentLoop` currently extracts a fact from each non-`ask_user` tool call and appends those facts to `.cc-local/memory/daily.md`. This creates repetitive entries such as `glob -> ok`, and those entries are loaded back into future prompts through recent daily memory. The result is noisy context rather than useful memory.

Compaction is also currently tied to graceful REPL exit. Web runs can keep adding daily content without using the same compaction path.

## Proposed Behavior

Each completed agent run may append at most one daily entry. The entry summarizes durable conversational content, not operational steps.

Examples of acceptable entries:

```md
[2026-05-20 14:30] User prefers memory v2 to keep clean short-term conversational context rather than tool-call logs. Chosen direction: hybrid daily summaries with aggressive filtering; tool calls and file edits are excluded unless their outcomes are durable context.
```

Examples of rejected entries:

```md
[14:30] glob -> ok
[14:31] file_edit -> ok src/agent-loop.ts
[14:32] User asked a question.
```

## Daily Summary Flow

Introduce a shared `maybeAppendDailySummary()` path used after an agent run finishes.

1. Build a compact candidate from the user prompt, final answer, and limited run metadata.
2. Apply hard filters in code. If the turn has no memory-worthy signal, skip without calling the model.
3. For candidate turns, ask the model for structured output:

```json
{
  "shouldRemember": true,
  "summary": "..."
}
```

4. Validate the model output. Reject empty, generic, operational, or tool-log-shaped summaries.
5. Append the validated summary to `daily.md`.

If the model call fails, returns invalid JSON, or produces an invalid summary, skip the write. This keeps the memory layer best-effort and noise-averse.

## Candidate Signals

A turn is eligible for model summarization when it includes at least one durable signal:

- User preference, rule, or long-term constraint.
- Confirmed design or architecture decision.
- Problem root cause.
- Unresolved follow-up or explicit next step.
- Reusable project fact.
- Explicit discussion of memory, context, agent behavior, configuration, or workflow.

The following are not candidate signals by themselves:

- Successful or failed `glob`, `grep`, `file_read`, `bash`, or similar tool calls.
- File edits or writes.
- Short acknowledgements, continuations, or ordinary Q&A.
- Generic progress descriptions without reusable content.

Tool calls and file modifications may be mentioned only when their outcome is the durable content, such as identifying the root cause of noisy memory.

## Summary Validation

A model-produced summary is accepted only when all checks pass:

- `shouldRemember` is `true`.
- `summary` is a non-empty single paragraph.
- Summary length stays within a configured maximum.
- It is not just a tool name, command, file path, or edit statement.
- It contains at least one durable category: preference, decision, root cause, follow-up, project fact, or workflow rule.

Rejected summaries are not written anywhere in v1.

## Compaction Trigger

Extract the current REPL compaction check into a shared helper that can be called by multiple entry points.

Use the same `compactMemories()` behavior:

- Read raw `daily.md`.
- If non-empty line count is below `dailyCompactThreshold`, do nothing.
- If the threshold is reached, promote durable memories into `MEMORY.md` and topic files.
- Archive and clear `daily.md` only after successful promotion.

Call this helper from:

- REPL graceful exit, preserving existing behavior.
- Web agent run completion.
- CLI one-shot run completion, so all entry points share the same lifecycle.

## Architecture

Add a small daily-memory boundary rather than spreading filtering logic through entry points.

Suggested module responsibilities:

- `daily-logger.ts`: low-level append and validation helpers for daily entries.
- `daily-summary.ts` or equivalent: candidate detection, prompt construction, JSON parsing, and summary validation.
- `memory.ts`: durable compaction remains the owner of promoting daily content into long-term memory.
- `repl.ts`, `main.ts`, and Web server path: call shared post-run helpers instead of implementing memory policy directly.

This keeps operational agent loop behavior separate from memory policy.

## Testing

Cover the behavior with focused tests before implementation:

- A normal tool-using turn no longer appends per-tool daily facts.
- A short ordinary conversation is skipped.
- A user preference or confirmed design decision can produce one daily entry.
- Invalid or generic model summaries are rejected.
- File edits and tool calls are not recorded unless durable content is present in the conversation.
- REPL, CLI, and Web paths call the shared compaction check after completed runs.
- Existing durable memory compaction behavior remains unchanged.

## Open Decisions

The first implementation should use conservative thresholds and skip ambiguous turns. If this proves too sparse in practice, later work can loosen candidate detection without changing the durable memory format.

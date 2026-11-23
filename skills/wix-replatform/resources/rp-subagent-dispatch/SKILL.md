---
name: rp-subagent-dispatch
description: >-
  How non-Codex hosts dispatch Developer and QA subagents so a run's token cost stays bounded:
  a fresh subagent per round, a short deterministic handoff file, a context budget with a
  clean handoff, and bounded helpers instead of raw ledgers.
---

# rp-subagent-dispatch

## Host boundary

This resource governs dispatched workers on non-Codex hosts. A Codex-hosted run executes the
selected resource and its Developer, per-stage QA, and phase-QA passes in the top-level worker
sequentially. It must not call `collab_tool` `spawn_agent`, `wait`, or `close_agent` for stage
work; the fresh-subagent and redispatch rules below do not authorize nested Codex workers.

Most of a run's token cost is history re-sent on every model call, not tool output. A
subagent that is resumed round after round keeps re-sending everything it ever saw: one
measured run spent 239.5M tokens in a single resumed Developer whose context reached 919K,
out of 522M for the whole run. These rules keep each subagent short.

## A fresh subagent every round

- Every Developer or QA dispatch is a **new** subagent. Never resume or re-message one from
  an earlier round — not for QA findings, a crash fix, a retry, or "continue".
- Before each re-dispatch, write the handoff:

  ```bash
  node skills/wix-replatform/scripts/subagent-handoff.js write --project <dir> \
    --stage <stage> --resource <resources/rp-...> --outcome <outcome> \
    [--findings <QA result file>] [--changed <path,path>] [--notes <one line>]
  ```

  `outcome` is `done`, `failed`, `qa_findings`, `budget_exceeded`, `needs_decision` or
  `resume_limit`. It writes `state/handoffs/<stage>-<round>.json` (≤ 8 KB) from durable state
  only: the QA findings verbatim, a write-log summary (counts, never rows), the completion
  report status, open user actions and the paths changed last round. It prints
  `{ file, round, bytes, budgetRoundsWithoutProgress }`.
- The new subagent's prompt is only: the resource path, the project directory and the handoff
  file. Paste nothing else — no earlier result text, transcript or log. The subagent reads the
  handoff first; anything it trimmed is still in its source files.

## A context budget per subagent

- Each Developer works within about **200K context or 150 model calls**, whichever comes first.
- Near the budget it stops starting new work, runs `subagent-handoff.js write --reason
  budget_exceeded` (with `--changed` and `--notes` for where it stopped), and returns
  `budget_exceeded` with the handoff path.
- `budget_exceeded` is not a failure and not a QA miss. Dispatch a fresh Developer for the same
  resource with that handoff.
- When the printed `budgetRoundsWithoutProgress` reaches 3 (three budget rounds in a row with no
  new settled import progress), tell the operator in one status line that the stage is repeating
  without progress, add the same note to the next handoff (`--notes`), and keep going. Never stop
  the run for it.
- Where the host does not report context size, count your own model calls, and keep every tool
  output under 20 KB by using the bounded helpers below.

## Bounded helpers instead of raw files

- Never open, `cat`, `grep`, `tail` or `jq` `state/attempts/write-attempts.ndjson` or
  `logs/import-audit.ndjson` — they reach tens of MB and stay in context for the rest of the
  subagent's life. Use:

  ```bash
  node skills/wix-replatform/scripts/write-log-summary.js --project <dir> \
    [--entity <targetEntityType>] [--status <status>] [--limit 20] \
    [--run latest | --since-run <runId>] [--log audit] [--json]
  ```

  Default output: counts per entity × status (current status per attempt) and top error
  classes; `--entity`/`--status` add up to `--limit` matching rows. Output stays ≤ 4 KB.
- A subagent never waits on a long import or extract. The top-level agent runs
  `scripts/import-supervise.js` in background mode and ends its turn; it is woken once, on
  `complete`, `needs_decision` or `resume_limit` (see `rp-execute-import`).

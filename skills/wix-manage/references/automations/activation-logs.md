---
name: "Automations Run Diagnosis"
description: "Interpret user-supplied run and action logs, distinguish processing completion from successful actions, and explain limits of historical evidence."
---

# Interpret supplied automation run logs

Use this reference to explain logs, screenshots or exported run details supplied by the user.
`configuration.status` says whether an automation is enabled; an **activation** is one run.
Diagnosis does not authorize rerunning, editing, activating or sending anything.

## 1. Establish the available evidence

Ask the user for the relevant run and action details from the dashboard activity view when
none have been supplied. Use only the provided evidence to describe that run. This skill does
not provide activation-log retrieval or historical-revision retrieval APIs. Do not guess an
endpoint, use a dashboard cookie, or claim to have fetched records.

Useful details include run status/time, failed-action indicators, action statuses and errors,
and the automation revision recorded for the run. Request only what is needed; users can
redact personal data. A missing field or record is unknown, not proof of success or failure.
Public documentation may explain field semantics, but is not evidence about this site's run.

## 2. Interpret status at both levels

| Run `status` | Meaning and next evidence                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INITIATED`  | No action has started yet.                                                                                                                               |
| `SCHEDULED`  | Waiting before starting, for scheduling/debounce; inspect `scheduledInfo.date`.                                                                          |
| `STARTED`    | In progress; inspect action states for an active delay or asynchronous action.                                                                           |
| `ENDED`      | All actions handled, which can include failures/skips. Check `endedInfo.withFailedActions`, action logs and warnings before reporting success.           |
| `FAILED`     | Run failed to start; read `failedInfo.errorCode`, `errorDescription`, `errorReason`. Individual action failure does not necessarily set this run status. |
| `SKIPPED`    | No actions ran. Read `skippedInfo.reason`: schedule expired, trigger filters did not pass, rate limit exceeded or event already processed.               |
| `CANCELLED`  | Read `cancelledInfo.reason`; distinguish cancellation, deactivation/deletion, payload-refresh cancellation and GDPR requests.                            |

Action logs use **`activationStatus`**, not the parent run's `status`:

- `STARTED`: action running; a DELAY exposes `startedInfo.delayActionInfo.date`.
- `INVOKED_ASYNC`: invoked and waiting for completion; inspect
  `invokedAsyncInfo.appDefinedActionInfo.timeoutDate`. It is not completed yet.
- `ENDED`: action completed without an error. A condition's decision is still
  `endedInfo.conditionActionInfo.passed` (plus `expressionResults`); code conditions use
  `codeConditionActionInfo.passed`, rate limits use `rateLimitActionInfo.passed`.
  A false decision is not an execution failure.
- `FAILED`: read that action's `failedInfo.errorCode` / `errorDescription`; preserve exact codes
  and distinguish the provider's error from your suggested cause.
- `SKIPPED`: use the returned reason when present; do not invent one if absent. The step's skip
  expression or a stopped path may explain it only when supported by configuration/run evidence.

Missing action logs do not prove failure: a branch may not have been reached, the run may still
be in progress, or records may not yet be visible. Inspect warnings without claiming that
every warning is a failed action. Unknown status values should be reported verbatim.

## 3. Distinguish the executed revision from today's configuration

If supplied logs contain `automationRevision`, that is the version the run used. A later
edit does not establish what the failed run executed. Ask for the corresponding configuration
or relevant step details if needed; do not offer an undocumented historical lookup.

When both logs and the matching configuration are supplied, match an action log's `id` to
`configuration.actions[id]`, not its display label. If IDs or the historical configuration are
missing, state that limit. Current Get Automation can provide context when site access is
authorized, but cannot prove the configuration that ran earlier.

Summarize the supplied run ID/time when present, recorded revision, status, the specific
failing/waiting/skipped step, exact evidence and a next investigation step. Never fabricate
missing IDs. An action's success does not prove inbox delivery without provider evidence.

Keep the answer short: the conclusion first, then the supplied evidence behind it, then what to
inspect next.

## 4. Follow-up and authorized tests

A Test Automation response containing an `activationId` proves only that the test started.
Ask the user to inspect the dashboard activity view or share its results before reporting
completion. Never rerun a side-effecting test to obtain evidence. A missing or not-yet-visible
record does not establish success, failure, or that the automation never ran.

Deactivation can be associated with cancellation of pending runs. If supplied evidence says
`AUTOMATION_DEACTIVATED`, explain it; do not assume all pending runs are preserved or cancelled.

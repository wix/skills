---
name: "Automations Run Diagnosis"
description: "Interpret automation runs and per-action logs against their historical configuration, distinguishing failed actions, pending work and missing evidence."
---

# Activation logs and run diagnosis

Use this reference for "what happened?", "why did it fail?" or a Test Automation result.
`configuration.status` says whether the automation is enabled; an **activation** is one run.
Read-only diagnosis does not authorize rerunning, editing, activating or sending anything.

## 1. Read the run and its actions

The activation-log and action-log methods are public. Use an available API tool/client that
exposes these methods with the target site's authorization. The paths below are **service-relative**,
not verified `www.wixapis.com` URLs; resolve the base from the client's API binding rather than
guessing one. Permissions are `AUTOMATIONS.ACTIVATION_LOG_READ` for run logs,
`AUTOMATIONS.ACTIVATION_ACTION_LOG_READ` for action logs, and
`AUTOMATIONS.AUTOMATION_REVISION_READ` for historical configuration.

| Operation                   | Service-relative REST path                    | Request                            | Result                               |
| --------------------------- | --------------------------------------------- | ---------------------------------- | ------------------------------------ |
| List Activation Logs        | `GET /v2/activation-logs`                     | Identifier, dates and paging below | `activationLogs[]`, `pagingMetadata` |
| Get Activation Log          | `GET /v2/activation-logs/{activationId}`      | `{activationId}`                   | `activationLog`                      |
| List Activation Action Logs | `GET /v2/activation-action-logs`              | `{activationId}`                   | `activationActionLogs[]`             |


Historical configuration uses a separate, verified public binding:

`GET https://www.wixapis.com/automations-service/v1/automation-revisions/<automationId>?revision=<revision>`

Supply the run's automation ID in the path and its revision in the query string; read
`automation` from the response. This public route does not establish the external base for
the activation-log or action-log methods above.

For "recent runs of this automation", use:

```json
{
  "identifierType": "AUTOMATION_ID",
  "automationIdInfo": { "automationId": "<automation-id>" },
  "fromCreatedDate": "<ISO timestamp>",
  "toCreatedDate": "<ISO timestamp>",
  "includePayload": false,
  "cursorPaging": { "limit": 25 }
}
```

- Choose the date range from the request; absent dates default to the last 30 days through now.
  Continue with `cursorPaging.cursor = pagingMetadata.cursors.next`; limit at most 500.
- If an activation id is already known, use Get directly, then list its action logs. An
  automation id and an activation id are different identifiers.
- For a preinstalled identifier already supplied by the client, use
  `identifierType: "PREINSTALLED_IDENTIFIER"` with
  `preinstalledIdentifierInfo: {appId, componentId}` instead of `automationIdInfo`.
  Do not invent a component id or require one when a current automation id is available.
- `includePayload: true` is only needed to inspect event data. Optional `payloadMask: ["key"]`
  selects literal, case-sensitive top-level keys; dots/wildcards do not traverse paths.
  A mask does not turn payload inclusion on. Keep personal data out of summaries unless needed.
- GET clients may flatten nested parameters (`automationIdInfo.automationId`,
  `cursorPaging.limit`); use the client's encoding. A tool taking JSON uses the object above.
- The list identifier values above are used by the builder, although catalog annotations may
  omit them. If a generated client lacks them, use a binding supporting this contract or report
  the client limitation. Do not infer that the service itself is private.

If no compatible method binding is available, say which read could not be made and link the
dashboard activity view. Do not claim that log APIs do not exist or that an unavailable log
means the automation did not run. Never substitute a guessed endpoint.

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

## 3. Explain the version that actually ran

Read `activationLog.automationId` and `automationRevision`, then Get Automation Revision for
that pair. Match each action log's **`id`** to `configuration.actions[id]` in this historical
object. Do not match by action label, and do not assume today's mapping or graph ran yesterday.

Preinstalled overrides can change automation ids: prefer the id recorded on the activation.
If historical access is denied or the revision cannot be retrieved, say so. Current Get
Automation can provide clearly labeled context but is not proof of the executed configuration.

Summarize: run id/time, automation id/revision, run status, the specific failing/waiting/skipped
step, its exact evidence and an actionable next step. An action's successful return does not
prove an external effect such as inbox delivery unless the provider's evidence establishes it.

## 4. Missing records and request errors

- Empty successful list: no returned runs for that identifier/date window; check range and paging.
- Newly started test: a not-yet-visible record is pending evidence. Retry reads a bounded number
  of times, then report pending; never rerun a side-effecting test to force a log to appear.
- 401/`UNAUTHENTICATED`: credential problem; 403/`PERMISSION_DENIED`: access problem, not a run failure.
- 400/`INVALID_ARGUMENT`: check the request/identifier/date encoding. 404 may be an incorrect
  id or unavailable record; a route-level 404 may mean an unresolved client binding.
- `UNAVAILABLE`, `INTERNAL`, `RESOURCE_EXHAUSTED`: report the read failure and retry only in a
  bounded way. Do not classify the underlying run based on these errors.

For an authorized test, report "started" from its returned id, then update that claim only from
the logs. Do not promise that deactivation leaves every pending run unchanged: cancellation can
be recorded as `AUTOMATION_DEACTIVATED`; inspect the individual run rather than assume its fate.

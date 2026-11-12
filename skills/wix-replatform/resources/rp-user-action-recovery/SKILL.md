---
name: rp-user-action-recovery
description: Regenerates a stale durable human request without accepting an outdated answer.
---

# rp-user-action-recovery

Use when the router reports `user_action_stale`. The request's pinned evidence changed
or disappeared, so answering it is unsafe. Recover only the reported `requestIds`.

1. Read each request through `scripts/user-action.js show --project <projectDir> --request <id>`.
   Identify its stage, effect and pinned artifacts. Do not read secret-bearing config into
   tool output. Preserve the existing request and all recorded answers.
2. For effect `read-back-omission-ack`, run
   `node scripts/user-action.js recover-omission-ack --project <projectDir> --request <stale-id>`.
   Its producer rebuilds the evidence from approved omissions, checkpoints the new request
   and ledger bindings, then supersedes the old request. Retry the same command after an
   interruption. Changed mapping/import inputs require revalidation by their producing stage;
   do not refresh their hashes. Regenerate the completion report so its operator action uses
   the new request, then route again for the human answer. Skip the generic steps below.
3. Use the producing stage's contract to rebuild any missing review evidence and prepare
   a fresh explanation and choices for the current evidence. Do not merely change the old
   digest, reuse outdated prose, answer on the user's behalf, or perform setup/import writes.
   If the evidence cannot be regenerated, report the specific repair needed and stop.
4. Create a new pending request with the same stage, kind and effect scope through
   `scripts/user-action.js create --project <projectDir> --request-file <json>`.
   Pin the current reviewed artifacts. An evidence digest may change; the subject and
   permission being requested must remain the same. A materially different decision needs
   its own producer-owned recovery rather than silently changing this request's scope.
5. Only after the replacement exists, run:
   `node scripts/user-action.js supersede --project <projectDir> --request <stale-id> --replacement <fresh-id>`.
   This refuses a missing, answered, stale or differently scoped replacement. No approval
   effect is applied. Route again and present the fresh request for a human answer.

## Output

The old request remains in `orchestration/user-actions/` as superseded; a fresh pending
replacement carries the current review and artifact hashes. Approvals remain unchanged.
If recovery is blocked, preserve the old request and identify the required repair.

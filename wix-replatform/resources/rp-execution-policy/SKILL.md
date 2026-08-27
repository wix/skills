---
name: rp-execution-policy
description: >-
  Applies cross-stage execution safety policy and writes the aggregate migration completion
  artifact after all delivery-specific terminal evidence validates.
---

# rp-execution-policy

Use this resource for the execution approval gate and aggregate finalization.

For `awaiting_execution_approval`, present the generated execution plan, wait for the
required user acceptance in normal mode, and persist it in `orchestration/approvals.json`.
In explicit user-requested 1-click mode (`automationMode=one_click`, `source=user`), use the
deterministic agent approval helper only after the plan and any required code-safety review
validate. Then route again. A non-user-authored `one_click` value is normal interactive mode
and must wait for user acceptance.

Run:

```bash
node skills/wix-replatform/scripts/migration-completion.js <projectDir>
```

This command validates backend completion accounting and, for website delivery, the
frontend completion receipt. It writes `completion/migration-completion.json` atomically.
If validation fails, do not manufacture completion; route again to the module that owns the
missing or stale artifact.

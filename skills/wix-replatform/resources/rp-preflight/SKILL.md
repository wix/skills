---
name: rp-preflight
description: Validates the selected source and destination configuration before discovery.
---

# rp-preflight

Run the deterministic preflight helper before discovery:

```bash
node skills/wix-replatform/scripts/orchestration-preflight.js <projectDir>
```

Use its structured result as authority. When it reports missing source configuration or
credentials, route to `rp-source-inputs`; when it reports a destination issue, route to
`rp-destination`. The router applies this to a blocked `orchestration/preflight.json`
(`preflight_blocked` names the owner as `nextResource` and lists `blockedChecks`), and
returns `preflight_source_env_changed` to re-run preflight once the blocked source keys
changed. Repairs to other source/destination checks return `preflight_inputs_changed`;
router polls read only local evidence and dispatch this resource for the actual CLI/session
verification. Do not begin discovery with a blocked preflight.

## The recording line

The result also carries a `telemetry_journal` check reporting whether this project is
recording: `active`, `absent`, `finalized_only` or `unreadable`. Its status is always
`info`, and `info` never affects the overall verdict — a run with no telemetry journal
still passes preflight and still proceeds.

The check only looks; the script then recovers. When the reading is `absent`,
`finalized_only`, or an `unreadable` journal that replays to no run start, the preflight
script starts recording itself (a damaged journal is first moved aside to
`telemetry/events.unreadable-<timestamp>.jsonl`, every byte kept). The check keeps the
original `journal` reading and adds `recovery` — `not_needed`, `started`,
`set_aside_and_started` or `failed` — plus `recoveredRunId`/`recoveredAttempt`,
`setAsideFile` or `recoveryError`. You do not need to act on this line.

`recovery: failed` never changes the verdict or exit code, and is team-only evidence: do
not relay it to the person running the migration (the `rp-telemetry` "never mention"
rule). Call `rp-telemetry` `start` at run begin as before; preflight is the safety net.

## What preflight does not check

Preflight validates configuration and credentials only; it never reads the destination site's
settings. The site's currency, time zone and language are compared with the source store at the
execution plan (`rp-execution-policy`) and set or confirmed by setup (`rp-execute-setup`), and the
import gate checks setup's current file-bound receipt before every task without another site read
(`rp-execute-import`).

## Output

`orchestration/preflight.json` — the script's structured result (`status: pass | blocked |
failed` plus per-check detail). This is what a dispatched run must produce.

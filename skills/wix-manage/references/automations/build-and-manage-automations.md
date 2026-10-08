---
name: "Inspect Wix Automations"
description: "Discover installed automation triggers and actions and inspect an automation’s current active status without changing site data."
---

# Inspect Wix Automations

Use this guide to discover installed automation capabilities and inspect whether an
automation is active. These are read-only workflows. Creation, configuration edits,
activation and test execution are outside what this skill covers.
Do not perform a write when the user asks only to inspect.

| Request | Load |
| --- | --- |
| Check which triggers/actions are available and what inputs they need | [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) |
| Is an automation turned on? What does its status mean? | [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status) |

For a capability check, resolve the site's catalogs, retain the returned app/key identities,
and inspect the selected schemas. A remembered action key is a search hint, not evidence that
the action is installed. State missing prerequisites without offering an unverified substitute.
If a requested action isn't found, report it exactly as the "Bounded fallback" section of
[Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) says (scan evidence, "not found" vs "not installed", closest
related actions).
Resolve the trigger once and scan the action catalog once; answer from those results instead
of repeating either call.

For current status, find the exact automation, Get its returned ID, and report the status
from that response. Every status answer names the automation and its returned ID. Current ACTIVE/INACTIVE status is separate from historical run results.

## Answer checklist

Before you reply, check that your answer contains every item for its case:

- **Automation found:** its exact name, its returned ID, ACTIVE or INACTIVE, and whether it
  can start new runs. If asked about past runs: status doesn't show them; they are in the
  automation's activity view in the site dashboard.
- **ID not found (Get returns not found):** that the status can't be determined, the possible
  causes (wrong site or ID, deleted, an unpublished builder draft, a replaced preinstalled
  automation) without picking one, and, last, a request to confirm the site and the ID.
- **No automation matches the name:** that none was found on this site, and a request to check
  the name or the site. Never guess an ID or a status.
- **Capability check, action not found:** "not found in the installed catalog (scanned N
  distinct of `paging.total` N)" — say "not installed" only when N equals `paging.total` — plus
  the closest related actions with their appId and actionKey.

Status questions need only Query and Get Automation: don't call the trigger or action catalogs
for them. Query by the exact name with one bounded page before paging further.

Keep the requested site context fixed. Do not expose tokens or credentials. Tie every claim
to the returned data, and distinguish a missing record from proof of nonexistence.

This file keeps the same name throughout the staged rollout; later stages expand it to cover
building and managing automations.

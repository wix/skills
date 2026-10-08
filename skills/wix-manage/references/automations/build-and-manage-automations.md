---
name: "Inspect Wix Automations"
description: "Discover installed automation triggers and actions and inspect an automation’s current active status without changing site data."
---

<!-- Maintainers: This file keeps the same name throughout the staged rollout; later stages expand it to cover building and managing automations. See yaml/wix-manage/automations/README.md. -->

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

Put everything required in the first two or three sentences, in this order, before any
detail; add explanations only after it:

- **Automation found:** "<exact name> (ID `<returned id>`) is ACTIVE/INACTIVE, so it can/can't
  start new runs." If asked about past runs, the next sentence: "Status doesn't show whether
  past runs succeeded; see the automation's activity view in the site dashboard."
- **ID not found:** "I couldn't find automation `<id>` on this site, so its status can't be
  determined. Can you confirm the site and the automation ID?" Then list the possible causes
  (wrong site or ID, deleted, an unpublished builder draft, a replaced preinstalled
  automation) without picking one.
- **Several automations share the name:** "<n> automations are named <name>: <ID 1>, <ID 2>…
  Which one do you mean?" Don't pick one.
- **No automation matches the name:** "No automation named <name> was found on this site. Can
  you check the name or the site?" Never guess an ID or a status.
- **Capability check, action not found:** "<action> was not found in the installed catalog
  (scanned N distinct of `paging.total` N)" — say "not installed" only when N equals
  `paging.total` — then the closest related actions with their appId and actionKey.

Status questions need only Query and Get Automation: don't call the trigger or action catalogs
for them. Query by the exact name with one bounded page before paging further.

Keep the requested site context fixed. Do not expose tokens or credentials. Tie every claim
to the returned data, and distinguish a missing record from proof of nonexistence.

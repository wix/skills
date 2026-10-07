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

For current status, find the exact automation, Get its returned ID, and report the status
from that response. Current ACTIVE/INACTIVE status is separate from historical run results.

Keep the requested site context fixed. Do not expose tokens or credentials. Tie every claim
to the returned data, and distinguish a missing record from proof of nonexistence.

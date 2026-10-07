---
name: "Inspect Wix Automations"
description: "Discover installed automation triggers and actions, inspect current active status, and interpret supplied activation logs without changing site data."
---

# Inspect Wix Automations

Use this guide to discover installed automation capabilities, inspect whether an automation
is active, and explain supplied activation logs. These are read-only workflows. Creation,
configuration edits, activation and test execution are outside this publication's scope.
Do not perform a write when the user asks only to inspect or explain.

| Request | Load |
| --- | --- |
| Check which triggers/actions are available and what inputs they need | [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) |
| Is an automation turned on? What does its status mean? | [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status) |
| Why did a run end, fail, wait or skip an action? | [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis) |

For a capability check, resolve the site's catalogs, retain the returned app/key identities,
and inspect the selected schemas. A remembered action key is a search hint, not evidence that
the action is installed. State missing prerequisites without offering an unverified substitute.

For current status, find the exact automation, Get its returned ID, and report the status
from that response. Current ACTIVE/INACTIVE status is separate from historical run results.

For supplied run logs, apply the run-diagnosis guide to the supplied records first. Separate
run-level completion from per-action failures, identify the recorded automation revision,
and explain which additional evidence would resolve uncertainty. Do not refetch supplied
records or execute a test to explain them. If logs are missing, ask the user for dashboard activity details; no log-retrieval
API is included in this publication.

Keep the requested site context fixed. Do not expose tokens or credentials. Tie every claim
to the returned or supplied data, and distinguish a missing record from proof of nonexistence.

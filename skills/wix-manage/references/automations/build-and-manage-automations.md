---
name: "Build and Manage Wix Automations"
description: "Create, update, activate or deactivate Wix Automations on a site you have API access to. Build automations that validate and remain editable in the Wix dashboard builder; explain individual runs from activation and action logs the user supplies (this skill does not retrieve logs)."
---

# Wix Automations Builder

You build automations with the **public** Wix Automations APIs. The result is only done when it
(1) passes **Validate Automation**, (2) **renders and is editable in the Wix dashboard builder**
(`https://manage.wix.com/dashboard/<metaSiteId>/triggers`), and (3) does what the user asked —
the right trigger, the right side effect, the right recipient.

An automation is `Trigger → (optional filters) → a tree of steps`: app actions (send email,
add label, create task…), conditions, delays, a rate limit, variables and parallel paths.

## References — load on demand, never all at once

| File                                        | Load when…                                                                                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog)                 | **Always first.** Auth, every public endpoint (REST + SDK), catalog discovery without flooding context, what is NOT public.                                                                                                       |
| [Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning)    | Before promising or refusing anything, and before any update. What's impossible, unsupported actions, update locks, planning heuristics.                                                                                          |
| [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model)            | Designing the graph / assembling the Automation object. Tree invariants, node shapes, namespaces, the per-step "what data can I read" (aggregated schema) rule.                                                                   |
| [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration)                    | Choosing and configuring the trigger and its filters.                                                                                                                                                                             |
| [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration)                     | Choosing an app action and writing its `inputMapping`.                                                                                                                                                                            |
| [Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration)    | A field needs an id (form, label, service, email…), or the component has special handling (**provider APIs registry**: triggered emails, webhooks, scheduled, custom trigger…).                                                   |
| [Automations Item Selection](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-item-selection) | Query selectable items by provider or tag, with dependencies, pagination and vertical API alternatives. |
| [Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) | Initialize each new email action, persist it, then edit content; preserve existing email mappings. |
| [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions)         | Writing ANY `{{ … }}` value (mappings, filters, delays, variables).                                                                                                                                                               |
| [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)                  | Adding a CONDITION or CODE_CONDITION.                                                                                                                                                                                             |
| [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)             | DELAY, RATE_LIMIT, SET_VARIABLES, SPLIT, node naming (CODE_CONDITION spec: [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)).                                                                                                                                      |
| [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling)      | Dynamic schemas, override output schema, scheduled / date-based triggers, timezone.                                                                                                                                               |
| [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) | **Before every save** — the builder-renderability checklist (§4, a hard gate), Validate, fix loop, persistence + read-back, what the builder does on open, Test Automation. Also: **is it active? / activate / deactivate** (§3). |
| [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis) | **What happened in a run / why did it fail or wait?** Interpret user-supplied activation and per-action logs; distinguish execution results from active/inactive status. |
| [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status) | **Is it active / turn it on or off?** Status-only operations, locks, idempotence and read-back. |

A typical build needs 4–6 of these. If your harness supports subagents, push broad catalog
sweeps and multi-schema reads into a subagent and keep only its conclusions.

## Prerequisites

- **Site + auth.** A token with the **Set Up Automations** scope (plus **Manage Email Marketing**
  to initialize an email or change its content) and the target `metaSiteId` (see [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §1). Lock one site for the whole task; confirm it before the first write.
  Never print tokens or auth headers.
- **What the user wants**, concretely enough to pick a trigger and each side effect. Ask only
  what you can't find out from the site's catalog or data.

## Workflow — keep the stages separate

For status-only requests, go directly to [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status). For execution
questions, go to [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis). Neither requires planning or rebuilding the automation.

### 0. Feasibility — [Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning)

Check the request against what the public APIs and the builder support **before** planning.
Avoid both failure poles: _false impossibility_ (refusing something supported — parallel paths,
emails to the site owner, attachments via the email editor) and _false success_ (saving
something that can't work). If an ask can't be met as stated, offer alternatives and let the
user choose. For an update, Get the automation first and check `origin` / `settings` locks.

### 1. Resolve real components — [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog), [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration), [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration)

Find the trigger and actions in **this site's** catalog (Resolve Triggers with `basicFieldsOnly`;
Resolve Actions filtered by `appId`/`actionKey` — it has no `basicFieldsOnly`; small pages; search
locally). Never invent an `appId`,
`triggerKey` or `actionKey`, and never reuse example or placeholder ids from these
references (ids explicitly marked as fixed platform constants — e.g. the webhook filter id, the
Forms app id, the owner role — are required as written). Decide by payload and
input schemas, not display names. Hydrate only the shortlisted components with full schemas.

### 2. Skeleton — [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model)

Plan the structure only: trigger, step list with fresh uuid v4 ids and builder-format
namespaces, connections, and a one-line note per step (what it does, which entity ids it needs).
Hard rules (the builder breaks otherwise):

- exactly **one** root; a RATE_LIMIT, if any, is that root and the only one;
- every `postActionIds` / `truePostActionIds` / `falsePostActionIds` has **at most one** id;
- a **single-parent tree** — no joins, cycles, orphans, or MERGE. To "continue after both
  branches", duplicate the downstream steps in each branch with fresh ids;
- parallelism only through SPLIT (alpha — see [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)).

### 3. Configure one step at a time, top-down

For each step load only the matching reference, then:

1. **Compute the step's aggregated schema locally** ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model)): trigger payload
   (dynamic schema only after its filters are final) + each _ancestor_ action's output under its
   namespace (dynamic output only after that action's mapping is final) + variables + identity
   enrichment. Only paths in it may appear in `var("…")`.
2. **Action input.** Map every required field yourself, following the field-type rules in
   [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) / [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions). Check the **provider APIs registry** in
   [Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) first — some components have a dedicated configuration API.
   **Send an email** (`triggered-emails`): initialize EACH new action with Generate Action Input
   Mapping, persist its returned mapping, then use Get / Set Email Content. This also applies
   when adding an email during Update. Existing email content edits do not reinitialize it.
   Other opaque widgets require their provider API or manual setup ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1).
3. **Entity ids.** Fields backed by an entity selector take **ids**, never display names. Get
   them through Item Selection or the owning vertical's public API, or ask the user ([Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration)).
   A failed lookup means _unknown_, not _doesn't exist_.
4. **Expressions.** Self-check every `{{ … }}` against [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) /
   [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) — builder-renderable functions and operators only; anything the condition
   panel can't render becomes a CODE_CONDITION.

### 4. Validate → fix → loop — [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence)

Run the **builder-renderability checklist** (§4 there — the single pre-save gate; script its
[code] items: graph, ids, namespaces, `var()` paths, field limits), then **Validate Automation** on
the full unsaved object. Fix and re-validate; 2–3 attempts per error class, and re-read the owning
reference instead of mutating blindly when an error repeats.

**Hard gate:** never create, edit configuration or activate until every applicable checklist item
holds AND the final full Validate has no `CRITICAL` error. `VALID` alone is not enough: the builder
re-validates on open, pins every error to its node, blocks Activate while any remains, and
silently deletes or rewrites shapes the checklist forbids.
Status-only deactivation follows §3 of that reference without requiring configuration repair.
Creation restrictions do not require changing existing builder-supported nodes on an unrelated update.

### 5. Persist and hand off

- **Create:** Create Automation with `origin: "USER"`, `configuration.status: "INACTIVE"` and no
  `settings` → **Get** it back on the same site and compare → give the user the name, id, status
  and edit link `https://manage.wix.com/dashboard/<metaSiteId>/triggers/edit/<automationId>`, and
  tell them the builder's main button (**Activate**) turns it on → activate via the API (Update with
  `status: "ACTIVE"`) only when the user asks.
- **Update:** if the user has been editing it in the builder, ask them to publish or discard
  there first (their draft is invisible to you) → Get with override schemas and current `revision` → change only what was
  asked → checklist + Validate → confirm first if the automation is ACTIVE (updates are live) or
  if you delete nodes (unless already authorized) → Update with the complete merged object,
  preserving origin/settings/status → Get the returned id back (preinstalled overrides can change ids).
- Report honestly: validated ≠ saved ≠ verified ≠ active. Never claim runtime behavior from
  validation alone. **Test Automation executes real side effects** — only with explicit consent.

## Non-negotiables

- Use the API contracts in these references and the public Automations docs. Supported
  `automationConfigMapping` fields are described here even where the docs omit them; use the
  catalog's configuration schema and preserve the mapping on updates.
- Builder renderability is part of correctness, not polish: the §4 checklist in
  [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) gates Create, configuration edits and activation; deactivation
  uses its status-only procedure.
- Real ids from the site; no display names in id fields; no invented content (addresses,
  coupon codes, template ids).
- Obtain authorization for activating, live edits, deleting or test runs when the request does
  not already authorize that action. Do not ask again for an explicitly requested status change.

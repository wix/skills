---
name: "Automations Graph and Data Model"
description: "Assemble builder-editable automation graphs with valid node relationships, namespaces and ancestor data access."
---

> **Stage scope:** this stage covers only what [Build and Manage Wix Automations](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-and-manage-wix-automations) lists; do not perform anything marked "Later stages only" or any workflow that needs a guide marked "not yet published".

# Automation Model — Object, Graph Rules, Payload Scope

**TL;DR**

- An automation = one trigger + a **single-parent tree** of actions. `rootActionIds` has EXACTLY one id; every connection field holds AT MOST one id; no joins, no cycles, no orphans. Parallelism only via SPLIT; "both branches continue" = duplicate the downstream steps per branch (the builder caps an automation at 45 actions — count before duplicating).
- Every action: `actions[k].id === k`, a fresh uuid v4, a unique `namespace` (except variable steps, which share `setVariable`), and ONLY its own type's `*Info` object.
- The automation MUST render and be editable in the Wix dashboard builder. The builder rules below are hard MUSTs — the API accepts shapes the builder cannot draw (some hang its loader forever).
- A step may read (`var("...")`) only its node's **aggregated payload schema**: trigger payload + identity enrichment + outputs of its ANCESTOR steps.
- Create and Update do NOT validate. Always call Validate Automation before saving ([Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog)).

---

## 1. The Automation object (public API)

> In this stage you create only APP_DEFINED steps. The other step types below are documented so you can read and preserve existing automations, not to author them here.

| Field                         | Rules                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `revision`              | Read-only. `revision` MUST be sent back on Update Automation (§6).                                                                               |
| `name`                        | Required, 1–100 chars (API allows 500; the builder holds 100); the business outcome ("Send welcome email to new subscribers").                   |
| `description`                 | Optional, ≤2000 chars.                                                                                                                           |
| `origin`                      | Required on create, immutable. `USER` for anything you create. `APPLICATION`/`PREINSTALLED` carry update locks (§4 of Automations Feasibility and Planning (not yet published)). |
| `settings`                    | Locks for APPLICATION/PREINSTALLED (`readonly`, `actionSettings`, …). Never set it on create; on Update send it back exactly as fetched.         |
| `configuration.status`        | Required, `ACTIVE` \| `INACTIVE`. Create `INACTIVE`; activate only on request.                                                                   |
| `configuration.trigger`       | `{appId, triggerKey, filters[], scheduledEventOffset?, overrideSchema?, automationConfigMapping?}` — [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration).                                |
| `configuration.rootActionIds` | Exactly one action id.                                                                                                                           |
| `configuration.actions`       | Map `actionId → Action`.                                                                                                                         |

Action (common fields):

- `id` — uuid v4, equal to its map key.
- `type` — `APP_DEFINED`, `CONDITION`, `CODE_CONDITION`, `DELAY`, `RATE_LIMIT`, `SET_VARIABLES`, `SPLIT` (the last two are not yet in the public API docs, but the builder supports them — Automations Delays Variables and Branches (not yet published)). NEVER `UNKNOWN_ACTION_TYPE`, NEVER `MERGE`.
- `namespace` — 1–100 chars, unique except the shared `setVariable` namespace (§3). Outputs of this step appear under it.
- `displayName` — optional but always set it: 1–60 chars, sentence case, purpose-specific (§7 of Automations Delays Variables and Branches (not yet published)). Absent → the canvas shows the catalog name.
- `skipActionExpression` — absent (runs) or exactly `"{{true}}"` (skipped), the only value the builder writes. A skipped step adds NO outputs downstream (§4).
- exactly one `*Info` matching `type`: `appDefinedInfo`, `conditionInfo`, `codeConditionInfo`, `delayInfo`, `rateLimitInfo`, `setVariablesInfo`, `splitInfo`.

## 2. Graph invariants — single-parent tree

1. **One root, with no parent.** `rootActionIds` = `[oneId]`, and no action may point at the root. The builder draws only `rootActionIds[0]`; extra roots are saved but invisible.
2. **One successor per field.** `appDefinedInfo.postActionIds`, `delayInfo.postActionIds`, `rateLimitInfo.postActionIds`, `setVariablesInfo.postActionIds`, `conditionInfo/codeConditionInfo.truePostActionIds` / `falsePostActionIds` each hold 0 or 1 id (API `maxItems 1`).
3. **One parent per action.** Every non-root action is referenced from exactly one place (one connection field or one SPLIT path). A JOIN is drawn under its first parent only — the canvas misrepresents the flow.
4. **No orphans.** An action unreachable from the root is deleted by the builder on the next save.
5. **No cycles.** Forward only.
6. **Empty array = the path ends** there. Use `[]`, never omit the field.
7. **Parallel fan-out only via SPLIT** (§5 of Automations Delays Variables and Branches (not yet published)). Never two root ids, never two ids in one field.
8. **No MERGE.** The API has a `MERGE` type and `conditionInfo.mergeActionId`, but the canvas cannot draw them (MERGE nodes never finish loading). Never create either; when you read an automation that has them, preserve them untouched and don't add more.

### Builder rendering MUSTs (graph level)

- MUST: the trigger's `appId` + `triggerKey` exist in the site's trigger catalog (a missing trigger can leave every node loading).
- MUST: `actions[k].id === k` for every entry.
- MUST: ids are unique across ALL of: action ids, SPLIT path ids, the `triggerKey` string (it is the trigger node's id), and the builder's synthetic ids `<id>true`, `<id>false`, `<id>-end`, `<id>true-end`. Duplicates crash the layout. Generate every id as a fresh uuid v4 in code; never reuse ids from these references.
- MUST: each action carries ONLY its own type's `*Info`. The canvas ignores `type` when finding children and takes the first present of `appDefinedInfo → delayInfo → rateLimitInfo → setVariablesInfo → condition` — even an empty leftover `appDefinedInfo: {postActionIds: []}` on a CONDITION hides both branches.
- MUST: at most one RATE_LIMIT, and only as the root (§2 of Automations Delays Variables and Branches (not yet published)). A non-root RATE_LIMIT node spins forever.
- MUST: APP_DEFINED `appId` + `actionKey` match the site's action catalog, else the node shows "Action not available".

### Designing within the tree

> **Later stages only:** not available in stage 2; this section is published in stage 3.

**In this stage:** put independent actions ("create a task and add a label") in one linear chain A → B → C, most time-sensitive first.

### Only model what the user asked for

> **Later stages only:** not available in stage 2; this section is published in stage 3.

**In this stage:** add only the steps the user asked for. Audience or copy framing ("a VIP follow-up for high-value customers") is content inside one action, not a condition.

## 3. Namespaces

Use the builder's own convention (it derives new indexes from the trailing number):

| Type                                             | Namespace                                                |
| ------------------------------------------------ | -------------------------------------------------------- |
| APP_DEFINED                                      | `<actionKey>-<N>` (e.g. `triggered-emails-3`)            |
| CONDITION and CODE_CONDITION                     | `CONDITION-<N>`                                          |
| DELAY / SPLIT / RATE_LIMIT                       | `<TYPE>-<N>` (e.g. `DELAY-2`, `SPLIT-5`, `RATE_LIMIT-1`) |
| SET_VARIABLES (and existing code-variable steps) | always the literal `setVariable` (§4 of Automations Delays Variables and Branches (not yet published)) |

`N` = 1 + the largest number after the last `-` among **all** the automation's namespaces (one counter shared across every step type — e.g. `DELAY-1` then `createTask-2`). A namespace with no trailing number (`setVariable`) doesn't count: if it is the only one, the next `N` is 1. A CODE_CONDITION keeps `CONDITION-<N>`. The builder never rewrites an existing namespace — on update keep every existing one as is. Variable and existing code-variable steps intentionally share `setVariable`; their distinct property keys are merged. For other output-producing actions, never reuse a namespace — the later output overwrites the earlier one.

## 4. Aggregated payload schema — what `var()` can read at a node

This section owns the rule. Build one JSON Schema object per node, in code, from the root down its own branch, from public schema APIs (calls: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §3–§4).

1. **Trigger payload** — the trigger's `payloadDataSchema` (custom/webhook triggers: `trigger.overrideSchema` instead, §3 of Automations Schemas and Scheduling (not yet published)). If the trigger implements dynamic schema, call Get Trigger Dynamic Schema with the SELECTED (saved) filter options and MERGE its `properties` over the static ones ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5); before filters are chosen, dynamic fields are UNKNOWN, not absent. Trigger fields are un-prefixed: `var("orderId")`.
2. **Identity enrichment** — for every trigger-payload field (any object depth, not inside arrays) annotated `identityType: "contact"` or `"member"`, a root-level object is added, keyed by that field's `namespace` annotation when it has one, else its (deprecated) `name` annotation, else the identity type (`contact` / `member`). Shape: Get Identities Schema (`identitiesSchema.properties.contact` / `.member`). Both stay valid: `var("contactId")` and `var("contact.name.first")`; also e.g. `var("contact.email")`, `var("member.profile.nickname")`. A field annotated `name: "post_author_member"` (some Blog / File Share triggers) is enriched as `var("post_author_member.profile.nickname")` — two member ids on one trigger give two objects; use the key the field declares (`member.*` does not exist there). Other identity types (e.g. `visitor`) add no object; webhook/custom triggers (override schema) get none. The builder does not enrich identity fields of action outputs — don't read `contact.*` that only an action output would provide.
3. **Ancestor action outputs** — for each non-skipped APP_DEFINED step ABOVE this node on its own path, under `properties[<namespace>]`: catalog `outputSchema`, with `overrideOutputSchema.properties` merged over it, and — when the action implements dynamic output — Get Action Dynamic Output Schema (called with that step's final `inputMapping`) merged over that: `var("triggered-emails-3.messageId")`.
4. **Variables** — titled outputs (`outputSchema`) of non-skipped ancestor SET_VARIABLES / code-variable (`namespace: "setVariable"`) steps, merged under `setVariable`: `var("setVariable.<key>")` (§4 of Automations Delays Variables and Branches (not yet published)).

Scope rules:

- Only ANCESTORS. A node never sees later steps or a sibling branch (true path can't read the false path; SPLIT paths can't read each other).
- A skipped step (`skipActionExpression: "{{true}}"`) contributes nothing; never skip a step whose outputs a later step reads.
- Resolution order — finalize an upstream node before computing a descendant's schema: trigger filters → the trigger's dynamic schema → for each step top-down: its dynamic input schema (if any) → its final `inputMapping` → its dynamic output schema (if any) → add it to its children's schema.
- Every `var()` path MUST exist in this node's aggregated schema with a compatible type — never reason from a raw trigger or action schema alone, and never invent a field. Copy keys from the schema (titles/labels are not keys); arrays cannot be traversed by path ([Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §5).
- Preferred-language messages: map `var("contact.locale")` into the email's dynamic content; no separate "language" field is needed.

Syntax of expressions and the allowed function list: [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions).

## 5. Minimal valid examples

### 5.1 Linear (trigger → two app-defined actions)

The simplest shape: one trigger and a chain of APP_DEFINED actions linked by `postActionIds`.
The trigger and action identities below are the Contacts "new contact created" trigger and the
Tasks "create task" action; confirm them, and each action's input keys, against the site's
catalog before use. Generate fresh uuid v4 action ids.

```json
{
  "automation": {
    "name": "New contact welcome tasks",
    "origin": "USER",
    "configuration": {
      "status": "INACTIVE",
      "trigger": {
        "appId": "74bff718-5977-47f2-9e5f-a9fd0047fd1f",
        "triggerKey": "contacts-new_contact_was_created",
        "filters": []
      },
      "rootActionIds": ["3f6c1d2e-8a4b-4c7d-9e1f-2a3b4c5d6e01"],
      "actions": {
        "3f6c1d2e-8a4b-4c7d-9e1f-2a3b4c5d6e01": {
          "id": "3f6c1d2e-8a4b-4c7d-9e1f-2a3b4c5d6e01",
          "type": "APP_DEFINED",
          "namespace": "createTask-1",
          "displayName": "Create welcome task",
          "appDefinedInfo": {
            "appId": "146c0d71-352e-4464-9a03-2e868aabe7b9",
            "actionKey": "createTask",
            "inputMapping": {
              "contactId": "{{var(\"contactId\")}}",
              "title": "Welcome {{var(\"contact.name.first\")}}"
            },
            "postActionIds": ["3f6c1d2e-8a4b-4c7d-9e1f-2a3b4c5d6e02"]
          }
        },
        "3f6c1d2e-8a4b-4c7d-9e1f-2a3b4c5d6e02": {
          "id": "3f6c1d2e-8a4b-4c7d-9e1f-2a3b4c5d6e02",
          "type": "APP_DEFINED",
          "namespace": "createTask-2",
          "displayName": "Create follow-up task",
          "appDefinedInfo": {
            "appId": "146c0d71-352e-4464-9a03-2e868aabe7b9",
            "actionKey": "createTask",
            "inputMapping": {
              "contactId": "{{var(\"contactId\")}}",
              "title": "Follow up with {{var(\"contact.name.first\")}}"
            },
            "postActionIds": []
          }
        }
      }
    }
  }
}
```

Why it's valid: one parentless root; each action has at most one successor and one parent; ids
equal their keys; namespaces are unique per §3; inputMapping keys come from the input schema;
every `var()` path is in that node's aggregated schema; status is INACTIVE.

### 5.2 Branching (trigger → condition → two branches)

> **Later stages only:** not available in stage 2; this section is published in stage 3.

## 6. Persistence & update lifecycle

Create `INACTIVE` (your "draft"); activate only on request. Create procedure and read-back: [Build and Manage Wix Automations — included validation procedure](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-and-manage-wix-automations) §3; calls: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §2.

**Later stages only — not in stage 2:** **Update:** Get → change only what was asked, keep every other node byte-for-byte → Validate → Update with the full merged object + `revision`, `origin` and `settings` as fetched; on an ACTIVE automation the change is live — confirm first. Locks: §4 of Automations Feasibility and Planning (not yet published).

## 7. Pre-validate self-check (do in code)

Script the graph/id/namespace/`var()` items of [Build and Manage Wix Automations — included validation procedure](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-and-manage-wix-automations) §4 (items 1–4 and 11 — the rules of §2–§4 above: one parentless root, RATE_LIMIT only as that root, ≤1 id per connection, one parent each, no cycles/orphans/MERGE/`mergeActionId`/`UNKNOWN_ACTION_TYPE`, keys = ids, globally unique uuid v4s incl. SPLIT path ids, `triggerKey` and `<id>true/false/-end`, own `*Info` only, §3 namespaces unique except `setVariable`, every `var()` in THAT node's aggregated schema). Also check that only user-requested conditions/delays exist; then Validate Automation must return no trigger or action errors.

## 8. Anti-patterns (all wrong)

```text
A → C ← B                          // join (two parents) — drawn under one parent
Condition → true: X, false: X      // same id twice — duplicate X instead
Condition.mergeActionId / MERGE    // not drawable — duplicate downstream steps
Trigger → [A, B]                   // 2 roots — use a SPLIT
A.postActionIds: [B, C]            // fan-out — use a SPLIT
A → B → A                          // cycle
D in actions, never referenced     // orphan — deleted on save
RATE_LIMIT under anything          // node never finishes loading
DELAY carrying a leftover appDefinedInfo  // wrong wiring
Inventing a VIP condition from email copy wording
```

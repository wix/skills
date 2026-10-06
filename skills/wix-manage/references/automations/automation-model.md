---
name: "Automations Graph and Data Model"
description: "Assemble builder-editable automation graphs with valid node relationships, namespaces and ancestor data access."
---

# Automation Model — Object, Graph Rules, Payload Scope

**TL;DR**

- An automation = one trigger + a **single-parent tree** of actions. `rootActionIds` has EXACTLY one id; every connection field holds AT MOST one id; no joins, no cycles, no orphans. Parallelism only via SPLIT; "both branches continue" = duplicate the downstream steps per branch (the builder caps an automation at 45 actions — count before duplicating).
- Every action: `actions[k].id === k`, a fresh uuid v4, a unique `namespace` (except variable steps, which share `setVariable`), and ONLY its own type's `*Info` object.
- The automation MUST render and be editable in the Wix dashboard builder. The builder rules below are hard MUSTs — the API accepts shapes the builder cannot draw (some hang its loader forever).
- A step may read (`var("...")`) only its node's **aggregated payload schema**: trigger payload + identity enrichment + outputs of its ANCESTOR steps.
- Create and Update do NOT validate. Always call Validate Automation before saving ([Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog)).

---

## 1. The Automation object (public API)

| Field                         | Rules                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `revision`              | Read-only. `revision` MUST be sent back on Update Automation (§6).                                                                               |
| `name`                        | Required, 1–100 chars (API allows 500; the builder holds 100); the business outcome ("Send welcome email to new subscribers").                   |
| `description`                 | Optional, ≤2000 chars.                                                                                                                           |
| `origin`                      | Required on create, immutable. `USER` for anything you create. `APPLICATION`/`PREINSTALLED` carry update locks ([Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §4). |
| `settings`                    | Locks for APPLICATION/PREINSTALLED (`readonly`, `actionSettings`, …). Never set it on create; on Update send it back exactly as fetched.         |
| `configuration.status`        | Required, `ACTIVE` \| `INACTIVE`. Create `INACTIVE`; activate only on request.                                                                   |
| `configuration.trigger`       | `{appId, triggerKey, filters[], scheduledEventOffset?, overrideSchema?, automationConfigMapping?}` — [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration).                                |
| `configuration.rootActionIds` | Exactly one action id.                                                                                                                           |
| `configuration.actions`       | Map `actionId → Action`.                                                                                                                         |

Action (common fields):

- `id` — uuid v4, equal to its map key.
- `type` — `APP_DEFINED`, `CONDITION`, `CODE_CONDITION`, `DELAY`, `RATE_LIMIT`; alpha: `SET_VARIABLES`, `SPLIT`. NEVER `UNKNOWN_ACTION_TYPE`, NEVER `MERGE`.
- `namespace` — 1–100 chars, unique except the shared `setVariable` namespace (§3). Outputs of this step appear under it.
- `displayName` — optional but always set it: 1–60 chars, sentence case, purpose-specific ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §7). Absent → the canvas shows the catalog name.
- `skipActionExpression` — absent (runs) or exactly `"{{true}}"` (skipped), the only value the builder writes. A skipped step adds NO outputs downstream (§4).
- exactly one `*Info` matching `type`: `appDefinedInfo`, `conditionInfo`, `codeConditionInfo`, `delayInfo`, `rateLimitInfo`, `setVariablesInfo`, `splitInfo`.

## 2. Graph invariants — single-parent tree

1. **One root, with no parent.** `rootActionIds` = `[oneId]`, and no action may point at the root. The builder draws only `rootActionIds[0]`; extra roots are saved but invisible.
2. **One successor per field.** `appDefinedInfo.postActionIds`, `delayInfo.postActionIds`, `rateLimitInfo.postActionIds`, `setVariablesInfo.postActionIds`, `conditionInfo/codeConditionInfo.truePostActionIds` / `falsePostActionIds` each hold 0 or 1 id (API `maxItems 1`).
3. **One parent per action.** Every non-root action is referenced from exactly one place (one connection field or one SPLIT path). A JOIN is drawn under its first parent only — the canvas misrepresents the flow.
4. **No orphans.** An action unreachable from the root is deleted by the builder on the next save.
5. **No cycles.** Forward only.
6. **Empty array = the path ends** there. Use `[]`, never omit the field.
7. **Parallel fan-out only via SPLIT** ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §5). Never two root ids, never two ids in one field.
8. **No MERGE.** The API has a `MERGE` type and `conditionInfo.mergeActionId`, but the canvas cannot draw them (MERGE nodes never finish loading). Never create either; when you read an automation that has them, preserve them untouched and don't add more.

### Builder rendering MUSTs (graph level)

- MUST: the trigger's `appId` + `triggerKey` exist in the site's trigger catalog (a missing trigger can leave every node loading).
- MUST: `actions[k].id === k` for every entry.
- MUST: ids are unique across ALL of: action ids, SPLIT path ids, the `triggerKey` string (it is the trigger node's id), and the builder's synthetic ids `<id>true`, `<id>false`, `<id>-end`, `<id>true-end`. Duplicates crash the layout. Generate every id as a fresh uuid v4 in code; never reuse ids from these references.
- MUST: each action carries ONLY its own type's `*Info`. The canvas ignores `type` when finding children and takes the first present of `appDefinedInfo → delayInfo → rateLimitInfo → setVariablesInfo → condition` — even an empty leftover `appDefinedInfo: {postActionIds: []}` on a CONDITION hides both branches.
- MUST: at most one RATE_LIMIT, and only as the root ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §2). A non-root RATE_LIMIT node spins forever.
- MUST: APP_DEFINED `appId` + `actionKey` match the site's action catalog, else the node shows "Action not available".

### Designing within the tree

- **Several independent actions** ("send an email and post a chat message") → chain them A → B → C, most time-sensitive first. Use SPLIT only when the user wants them to run at the same time. Never claim parallel execution is impossible.
- **Branch, then continue** ("if A, also do A2; after 6h send Y to everyone") → DUPLICATE every later stage into BOTH branches with fresh ids and namespaces (variable steps keep `setVariable`, with fresh variable keys and updated downstream references). A **Send an email** in a duplicated stage is added by the user in each branch ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1) — never copy an existing step's `messageId` / `templateId` / `uniqueRuleId`: both steps would share one email, so editing one changes both and deleting one can delete the shared email. Never point both branches at the same action. Never use a "gate" where the TRUE branch does its side-action and stops while the timeline should continue.

```text
initial > Check A?
  true  > doA > Delay(A) > finalStep(A)
  false >       Delay(B) > finalStep(B)     // Delay/finalStep duplicated, never shared
```

- **Delay arithmetic when duplicating**: branches that share an absolute deadline anchored at the trigger must each sum to it. "Chat now; if price>100 wait 2h then email; at 24h remind everyone" ⇒ true: 2h delay > email > **22h** delay > reminder; false: 24h delay > reminder. Compute residuals explicitly — copying 24h into both branches double-delays the true branch.
- **Repeated logic** after different conditions = separate actions with identical configuration but new ids and namespaces.

### Only model what the user asked for

Add a condition/delay ONLY for explicit flow control ("if X, do a DIFFERENT step Y", "after 2 days"). Audience/copy framing is CONTENT, not a condition:

- "a VIP follow-up email for high-value customers" → one email, VIP copy, no condition.
- "if order > $200 mention priority packing" → email copy detail, no branch.
- "if order > $200 ALSO create a task" → real flow control → condition.
  Test: does a DIFFERENT step run based on the check? Yes → condition; no → one plain action.

## 3. Namespaces

Use the builder's own convention (it derives new indexes from the trailing number):

| Type                                             | Namespace                                                |
| ------------------------------------------------ | -------------------------------------------------------- |
| APP_DEFINED                                      | `<actionKey>-<N>` (e.g. `triggered-emails-3`)            |
| CONDITION and CODE_CONDITION                     | `CONDITION-<N>`                                          |
| DELAY / SPLIT / RATE_LIMIT                       | `<TYPE>-<N>` (e.g. `DELAY-2`, `SPLIT-5`, `RATE_LIMIT-1`) |
| SET_VARIABLES (and existing code-variable steps) | always the literal `setVariable` ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4) |

`N` = 1 + the largest number after the last `-` among **all** the automation's namespaces (one counter shared across every step type — e.g. `DELAY-1` then `createTask-2`). A namespace with no trailing number (`setVariable`) doesn't count: if it is the only one, the next `N` is 1. A CODE_CONDITION keeps `CONDITION-<N>`. The builder never rewrites an existing namespace — on update keep every existing one as is. Variable and existing code-variable steps intentionally share `setVariable`; their distinct property keys are merged. For other output-producing actions, never reuse a namespace — the later output overwrites the earlier one.

## 4. Aggregated payload schema — what `var()` can read at a node

This section owns the rule. Build one JSON Schema object per node, in code, from the root down its own branch, from public schema APIs (calls: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §3–§4).

1. **Trigger payload** — the trigger's `payloadDataSchema` (custom/webhook triggers: `trigger.overrideSchema` instead, [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3). If the trigger implements dynamic schema, call Get Trigger Dynamic Schema with the SELECTED (saved) filter options and MERGE its `properties` over the static ones ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5); before filters are chosen, dynamic fields are UNKNOWN, not absent. Trigger fields are un-prefixed: `var("orderId")`.
2. **Identity enrichment** — for every trigger-payload field (any object depth, not inside arrays) annotated `identityType: "contact"` or `"member"`, a root-level object is added, keyed by that field's `namespace` annotation when it has one, else its (deprecated) `name` annotation, else the identity type (`contact` / `member`). Shape: Get Identities Schema (`identitiesSchema.properties.contact` / `.member`). Both stay valid: `var("contactId")` and `var("contact.name.first")`; also e.g. `var("contact.email")`, `var("member.profile.nickname")`. A field annotated `name: "post_author_member"` (some Blog / File Share triggers) is enriched as `var("post_author_member.profile.nickname")` — two member ids on one trigger give two objects; use the key the field declares (`member.*` does not exist there). Other identity types (e.g. `visitor`) add no object; webhook/custom triggers (override schema) get none. The builder does not enrich identity fields of action outputs — don't read `contact.*` that only an action output would provide.
3. **Ancestor action outputs** — for each non-skipped APP_DEFINED step ABOVE this node on its own path, under `properties[<namespace>]`: catalog `outputSchema`, with `overrideOutputSchema.properties` merged over it, and — when the action implements dynamic output — Get Action Dynamic Output Schema (called with that step's final `inputMapping`) merged over that: `var("triggered-emails-3.messageId")`.
4. **Variables** — titled outputs (`outputSchema`) of non-skipped ancestor SET_VARIABLES / code-variable (`namespace: "setVariable"`) steps, merged under `setVariable`: `var("setVariable.<key>")` ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4).

Scope rules:

- Only ANCESTORS. A node never sees later steps or a sibling branch (true path can't read the false path; SPLIT paths can't read each other).
- A skipped step (`skipActionExpression: "{{true}}"`) contributes nothing; never skip a step whose outputs a later step reads.
- Resolution order — finalize an upstream node before computing a descendant's schema: trigger filters → the trigger's dynamic schema → for each step top-down: its dynamic input schema (if any) → its final `inputMapping` → its dynamic output schema (if any) → add it to its children's schema.
- Every `var()` path MUST exist in this node's aggregated schema with a compatible type — never reason from a raw trigger or action schema alone, and never invent a field. Copy keys from the schema (titles/labels are not keys); arrays cannot be traversed by path ([Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §5).
- Preferred-language messages: map `var("contact.locale")` into the email's dynamic content; no separate "language" field is needed.

Syntax of expressions and the allowed function list: [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions).

## 5. Minimal valid example (trigger → condition → two branches)

All ids are placeholders; generate real uuid v4s. Resolve `appId`/`triggerKey`/`actionKey`/input keys from the catalogs.

```json
{
  "automation": {
    "name": "Thank big spenders, follow up with others",
    "origin": "USER",
    "configuration": {
      "status": "INACTIVE",
      "trigger": {
        "appId": "<trigger-app-id>",
        "triggerKey": "<trigger-key>",
        "filters": []
      },
      "rootActionIds": ["<uuid-1>"],
      "actions": {
        "<uuid-1>": {
          "id": "<uuid-1>",
          "type": "CONDITION",
          "namespace": "CONDITION-1",
          "displayName": "Check if order is over 100",
          "conditionInfo": {
            "orExpressionGroups": [
              {
                "operator": "AND",
                "booleanExpressions": [
                  "{{numberGt(var(\"totals.total\");100)}}"
                ]
              }
            ],
            "truePostActionIds": ["<uuid-2>"],
            "falsePostActionIds": ["<uuid-3>"]
          }
        },
        "<uuid-2>": {
          "id": "<uuid-2>",
          "type": "APP_DEFINED",
          "namespace": "<action-key-a>-2",
          "displayName": "Send thank-you email",
          "appDefinedInfo": {
            "appId": "<action-app-id-a>",
            "actionKey": "<action-key-a>",
            "inputMapping": {
              "<input-key>": "{{var(\"contact.name.first\")}}"
            },
            "postActionIds": []
          }
        },
        "<uuid-3>": {
          "id": "<uuid-3>",
          "type": "APP_DEFINED",
          "namespace": "<action-key-b>-3",
          "displayName": "Create follow-up task",
          "appDefinedInfo": {
            "appId": "<action-app-id-b>",
            "actionKey": "<action-key-b>",
            "inputMapping": {
              "<input-key>": "Follow up on order {{var(\"number\")}}"
            },
            "postActionIds": []
          }
        }
      }
    }
  }
}
```

Why it's valid: one parentless root; ≤1 id per connection; one parent each; ids = keys, unique; own `*Info` only; namespaces per §3; one renderable condition group ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)); inputMapping keys from the input schema ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration)); every `var()` path in that node's aggregated schema.

## 6. Persistence & update lifecycle

Create `INACTIVE` (your "draft"); activate only on request. Update = Get → change only what was asked, keep every other node byte-for-byte → Validate → Update with the full merged object + `revision`, `origin` and `settings` as fetched; on an ACTIVE automation the change is live — confirm first. Full procedure and read-back: [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3; locks: [Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §4; calls: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §2.

## 7. Pre-validate self-check (do in code)

Script the graph/id/namespace/`var()` items of [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §4 (items 1–4 and 11 — the rules of §2–§4 above: one parentless root, RATE_LIMIT only as that root, ≤1 id per connection, one parent each, no cycles/orphans/MERGE/`mergeActionId`/`UNKNOWN_ACTION_TYPE`, keys = ids, globally unique uuid v4s incl. SPLIT path ids, `triggerKey` and `<id>true/false/-end`, own `*Info` only, §3 namespaces unique except `setVariable`, every `var()` in THAT node's aggregated schema). Also check that only user-requested conditions/delays exist; then Validate Automation must return no trigger or action errors.

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

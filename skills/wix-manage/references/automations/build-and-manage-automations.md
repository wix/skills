---
name: "Build Simple Wix Automations"
description: "Inspect Wix automations and create inactive linear automations using installed actions with schema-defined mappings and the included validation checklist."
---

This stage supports read-only inspection and creation of inactive, immediate, linear APP_DEFINED automations with schema-defined inputs. Configuration updates, activation/deactivation, execution tests, email/opaque widgets, entity pickers, schedules, conditions and special steps are outside this stage. Do not perform those workflows from this publication. Validation and its numbered checklist are included in the entry guide.

# Build Simple Wix Automations

This publication supports inspection and creation of **inactive, immediate, linear**
automations whose nodes are APP_DEFINED actions with schema-defined inputs. Configuration
updates, activation/deactivation and Test Automation are not supported in this stage.
Email/opaque widgets, entity pickers, schedules, condition nodes and special steps require
later guides. If the request needs one, explain the limit; do not substitute a different
business operation. A conditional formula in a schema-enabled input is supported by the
expression guide; it is not a condition node.

## Required guides

| Task | Guide |
| --- | --- |
| Resolve installed trigger/action identities and API requests | [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) |
| Construct a single-parent graph, IDs and namespaces | [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) |
| Configure trigger payload and filters | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) |
| Check action semantics and effective schemas | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) |
| Type-safe input formulas, literal escaping and ancestor variables | [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) |
| Inspect current status without changing it | [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status) |
| Interpret user-supplied run evidence | [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis) |

## Create and verify

1. Keep the requested site fixed. Discover the installed catalogs and inspect the exact
   trigger/action schemas. Resolve semantic capability first: an action that retrieves a
   task is not one that creates it. If no suitable installed action exists, report the gap.
2. Map the user's values and compatible payload fields. Ask for missing required values;
   never invent IDs or use a display name where an ID is required. If a field requires an
   opaque widget or entity picker, stop at the scope limit above.
3. Construct a linear graph using the model and expression guides. Keep actions within
   45 nodes. Set `origin: "USER"`, no `settings`, and `configuration.status: "INACTIVE"`.
4. Follow **Validation and Verification below**: its §4 checklist is the actual hard gate,
   followed by full Validate, Create and Get read-back (§§2–3). Its numbered items are
   included here so references from other guides can be followed without an unpublished page.
   Items for out-of-scope node types are not permission to create those types.
5. Save only with the user's authorization. Report the returned ID, inactive status and
   verified content. Do not activate or execute a test as part of creation.

The included procedure is shared with later publication stages. Its update, activation and
execution-test sections describe future workflows; the stage limits above take precedence.


# Validation and Verification

How to prove an automation is correct, saved, and editable in the builder before you tell the
user it exists. This file owns the create / update / activate procedures. API shapes: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog).

**TL;DR**

- Climb the ladder in order: **§4 renderability checklist → Validate Automation → Create/Update →
  Get Automation read-back → (optional, authorized) Test Automation.**
- **§4 gates Create, configuration edits and activation.** `VALID` alone does not prove the
  builder can draw, edit and re-save the automation. Status-only deactivation follows §3 and
  must not be blocked by unrelated configuration errors.
- Create and Update do not validate; an unvalidated or unsaved automation is **not created**.
- Test Automation executes actions for real — only with explicit user authorization (§5).

## 1. Local checks and semantic review

Run the §4 checklist on the complete automation object before **every** Validate call. Items
tagged **[code]** are deterministic — a small script beats reasoning (ids, graph, namespaces,
`var()` inventory, field limits). The rest need you to read schemas.

Semantic review (you, not code) — required for every action before acceptance; full rules in
[Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §6:

- **Side-effect contract:** the action does what the user's verb says to the affected entity —
  retrieval is not assignment; a message about a change is not the change.
- **Recipient lineage** (email, chat, SMS, push): prove the recipient path — the trigger contact and
  an upstream-created contact differ even when both are `contactId`; copy never proves who receives
  it; for emails the audience fields decide (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §3).
- **No fabricated content:** every user-specific value (recipient, subject, entity, amount) comes
  from the user, the site, or the payload.

## 2. Validate Automation

Request: `{automation: <full object>, validationSettings?}`. Validate the complete candidate
you intend to save; an unsaved object doesn't need an id. For creation, set `origin: "USER"`,
a real `name`, and `configuration.status: "INACTIVE"`. For updates, preserve the fetched
`origin`, `settings` and status unless a status change was requested. For activation, validate
the candidate with `configuration.status: "ACTIVE"`. Never rewrite an installed automation's
origin or deactivate a live automation merely to validate it.

`validationSettings.actionIds` validates just the listed actions — useful while configuring node
by node. `skipProviderValidations: true` skips app-specific checks — acceptable for intermediate
checks only. **The final gate is always a full validation with no settings.**

Response: `status` is `VALID`, `VALID_WITH_WARNINGS` (only `errorSeverity: WARNING`), or
`INVALID` (at least one `CRITICAL`). Target `VALID`. Accept `VALID_WITH_WARNINGS` only when you
understand each warning and tell the user about it.

**What the builder does with it.** When the user opens the automation, the builder runs the same
full Validate and pins **every** returned error to its node (trigger or action) — mapping errors
included. A `CRITICAL` shows as a node error and **blocks Activate / Publish** until fixed; a
`WARNING` shows as a node warning. Mapping errors show on the step until the user opens it, then
its form replaces them with field-level marks; other configuration errors show as error/warning
text; a provider error shows as "title: message". So an automation you save with errors opens
broken.

Each `triggerValidationErrors[]` / `actionValidationErrors[]` item has `errorType`
(`CONFIGURATION_ERROR` | `PROVIDER_ERROR`), `errorSeverity`, and one of:

- `configurationError{errorType, filterFieldKey | fieldKey}` — a platform check (tables below);
- `providerConfigurationError{title, message, ctaLabel, ctaUrl}` — the owning app's own check
  (`validateConfiguration`; often a missing connection or entity).
  Action errors also carry `actionId`, `appId`, `actionKey`.

### Error types → fix

Trigger (`configurationError.errorType`):

- `NOT_FOUND`, `INVALID_TRIGGER_KEY` — not in this site's catalog → re-resolve; never guess keys.
- `APP_NOT_INSTALLED`, `MODERATION_MISMATCH` — not available on this site → tell the user; don't
  substitute silently.
- `DEPRECATED` — being retired → prefer its replacement, or tell the user.
- `INVALID_FILTER_FIELD_KEY` — not a filter the trigger defines → use only its `filters[]`.
- `INVALID_FILTER_EXPRESSION` → rebuild with the filter shapes in [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.
- `MISSING_REQUIRED_FILTER` → add it (ask the user for its value if needed).

Action (`configurationError.errorType`, with `fieldKey` — fix the field it names; never delete a
field to silence an error):

- `NOT_FOUND`, `INVALID_ACTION_KEY`, `APP_NOT_INSTALLED`, `MODERATION_MISMATCH` — not available
  on this site → re-resolve; pick another action or tell the user.
- `DEPRECATED` — the builder shows "Action will be removed soon" → use its replacement
  (Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §2).
- `INVALID_MAPPING` → remove keys not in the effective schema; re-fetch the dynamic input schema.
- `MAPPING_TYPE_MISMATCH` → convert (`toString`, `toNumber`), map another field, or build the
  object shape (e.g. MONEY).
- `MAPPING_MISSING_REQUIRED_FIELD` → map it from the payload or ask the user; never a dummy value.
- `MAPPING_SCHEMA_MISMATCH` (enum, uuid, email format…) → a legal enum value / real id.
- `MAPPING_VARIABLE_MISSING_FROM_SCHEMA` → fix the path against the aggregated schema, or reorder
  so the source is an ancestor.
- `SAMPLE_CODE_RUN_FAILED` → fix the code step (guard missing fields — Automations Conditions (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §5).
- `POST_ACTION_NOT_FOUND` → a successor id doesn't exist; fix the graph.

Create/Update can also fail with `ON_BEFORE_SAVE_ACTION_EXCEPTION`: the owning app's save hook (e.g. for Send an email) rejected the step. Treat it like a provider error — read the message, fix the mapping or tell the user; don't retry the same write blindly.
`PROVIDER_ERROR` usually needs something only the user can do (connect an account, pick a
resource, finish setup). Report its `title`/`message` and the `ctaUrl`, and don't loop on it.

### Fix loop

1. Group errors by class (type + node). Fix all independent errors in one pass.
2. Re-run the §4 checklist, then re-validate.
3. At most 2–3 attempts per class. If an error comes back unchanged, re-read the reference that
   owns that construct rather than trying variations.
4. Still failing → stop. Tell the user exactly which node and why, and what you need from them.
   Don't save an INVALID configuration or activate it. Status-only deactivation is still
   allowed under §3; stopping future runs does not require repairing the automation first.

## 3. Persistence, read-back and honest reporting

### Create

1. §4 checklist passes and the final full Validate is `VALID` (or understood warnings).
2. Create Automation with `origin: "USER"`, `configuration.status: "INACTIVE"`, no `settings`.
   Capture `id`.
3. **Read back** with Get Automation on the same site. Confirm the trigger, the root id, and the
   set of action ids/types match what you sent (string literals come back URI-encoded, as sent).
   If you used an override schema, Get with `fields: ["OVERRIDE_SCHEMA"]` ([Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §2).
4. Hand off: name, status (inactive), id, and the edit link
   `https://manage.wix.com/dashboard/<metaSiteId>/triggers/edit/<automationId>`. Ask the user to
   review it in the builder; its main button on an inactive automation, **Activate**, turns it on.
5. Activate only on request — see "Activation status, activate, deactivate" below.

### Update

1. Get Automation with `fields: ["OVERRIDE_SCHEMA"]` so a complete-object update preserves
   trigger/action override schemas. Check `origin` and `settings` locks
   (Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §4) before planning any change.
2. Change only what was asked, on the current object. Keep ids of untouched nodes.
3. §4 checklist + full Validate on the merged object.
4. If the automation is `ACTIVE`, the update goes live immediately — say so and get confirmation
   first (consent rules: Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §4).
5. Update with the whole merged automation, the `revision` you read, and `origin` + `settings`
   exactly as fetched (else `INVALID_ORIGIN_TYPE`, even with a field mask — [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §2).
   On a revision conflict, re-Get, re-apply, re-validate.
6. Capture the returned automation's `id` — the first override of a preinstalled automation
   can have a new id. Read back that id and compare the **content** of every node you changed (and that untouched node ids
   survived). A bumped `revision` with the old content means the update didn't apply — re-send
   with `fieldMask: configuration,name` and verify again.
7. If the change makes the automation's `name` or a step's `displayName` inaccurate (e.g. "…1
   day…" after the wait became 2 hours; "Add VIP label" now adding another label), offer new
   names; rename only with their OK.

### What happens when the user opens it in the builder

- The builder edits a **hidden draft copy** and autosaves the user's changes into it. The
  published object (what Get returns) changes only when they click **Activate** (inactive
  automation) or **Publish Changes** (active one) — both publish, and Activate also turns it on.
- On load it re-resolves every trigger/action from the site catalog ("not found" on a miss), runs
  Validate (§2) plus its own checks (required filters, empty filters, the create-contact rule in
  §4), and pins the results to nodes.
- On load/save it silently rewrites some shapes: RATE_LIMIT `{{1440}} MINUTES` → `{{24}} HOURS`;
  a webhook trigger filter that is missing or has another id is rebuilt from `webhookId`; unreachable actions and root ids that
  point nowhere are **deleted**; an empty name becomes "Untitled …". The §4 checklist avoids all of
  these, so the user's first save doesn't change your automation.
- Before you Update an automation the user has been editing in the builder, ask them to publish
  or discard there and close the tab, then Get — else their publish can overwrite your change.

### Activation status, activate, deactivate

Follow [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status): status checks, activation validation, status-only deactivation,
locks, preinstalled override ids and revision conflicts. Deactivation does not require repairing
the configuration. Execution diagnosis is separate: [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis).

### Reporting rules

- Report separate counts: **attempted**, **acknowledged**, **verified** by read-back, **active**.
  Only verified automations "exist".
- An id without a successful read-back is **unverified** — say so; don't blindly retry the create
  (Query Automations first to see whether it landed).
- A validated-but-unsaved object is a proposal, not an automation.
- Never describe runtime behavior ("it will send…") as verified — only validated.

## 4. Builder-renderability checklist — the single pre-save gate

Use this gate before Create, configuration edits and activation, not status-only deactivation.
Creation restrictions ("never add", conservative feature support) do not require rewriting
existing builder-supported nodes during an unrelated update. Preserve those nodes and their
metadata; use the owning reference's preservation rules and full Validate. A failing item is a
blocker, not a warning: some make the canvas spin forever or crash, others are silently
rewritten or deleted on the user's first save. Each owning reference has a detailed checklist —
this list is the union; run those too for the node types you used.

**Graph and ids** — [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model)

1. [code] Exactly one `rootActionIds` entry, and it exists in `actions`. RATE_LIMIT, if present, is
   that root and the only one.
2. [code] Single-parent tree: every successor list (`postActionIds`, `truePostActionIds`,
   `falsePostActionIds`, SPLIT `postActionId`) has ≤ 1 id and points to an existing action; every
   non-root action has exactly one parent and is reachable from the root; no cycles; no MERGE /
   `mergeActionId`. Converging branches = duplicated downstream steps.
3. [code] `actions[k].id === k`; ids are fresh uuid v4, unique across actions, SPLIT path ids and
   the trigger key, and never collide with `<id>true`, `<id>false`, `<id>-end`.
4. [code] Each action has a known `type`, only its own type's `*Info`, `[]` (not omitted) for an
   ending successor list, and a builder-format `namespace`. Namespaces are unique except that
   SET_VARIABLES steps share `setVariable`; their output keys must be unique across steps.
   For every action type, `skipActionExpression` is `"{{true}}"` or absent.

**Trigger** — [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §7

5. `appId`+`triggerKey` came from Resolve Triggers on this site.
6. Filters: catalog filter `id`, verbatim `fieldKey`, Shape A/B expression whose literal value array
   holds the form its filter type allows ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.1: quoted entity ids, quoted static
   values, or exactly one bare number/boolean); **no filter with an empty `filterExpression`**; ≤ 5 filters; every required
   filter present, plus required follow-ups of every set parent. Webhook trigger: exactly its
   `webhookId` shape.
7. Scheduled / future-date configuration and `scheduledEventOffset` match
   Automations Schemas and Scheduling (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)).

**Actions** — [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration), Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)), Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §2

8. Every APP_DEFINED `appId`+`actionKey` came from Resolve Actions on this site; no unsupported
   action added — including no new code-variable step (the public Create refuses it).
   New email steps have a provider-generated mapping used once and persisted before content edits; no fabricated opaque-widget mapping ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1); unrelated existing ones unchanged
   (except the documented site-owner audience replacement).
9. `inputMapping`: only schema keys (an existing email/widget step's mapping passes through unchanged), types and
   enums match, every required/visible field mapped, entity-selector fields hold ids, formulas
   only in `dynamicValuesOptions.enabled` fields.
10. No "Create a contact" action (`contacts-create_contact`) when the trigger payload already has
    an `identityType: "contact"` field — the builder marks it "can't create a contact" and blocks
    activation.

**Expressions and conditions** — [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §9, Automations Conditions (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §6

11. [code] Every `var()` path exists in that node's aggregated schema
    — trigger + ancestor outputs only — with a compatible type.
12. Builder-renderable functions only; `;` separators; double-quoted, URI-encoded string literals;
    number/boolean fields hold exactly one expression of that type.
13. CONDITION: exactly one expression group with `AND`/`OR` and 1–20 panel-renderable expressions;
    not both branches empty; otherwise a CODE_CONDITION.

**Special steps** — Automations Delays Variables and Branches (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations))

14. DELAY: exactly one mode — relative (`offsetExpression` a `{{N}}` literal + unit) or absolute
    (`dueDateExpression`). RATE_LIMIT: `{{1}}`, a trigger identifier allowed by
    Automations Delays Variables and Branches (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §2 (preserve existing supported member/user/UUID identifiers), and a
    duration (`{{24}} HOURS`, never `{{1440}} MINUTES`) unless the user explicitly wants
    "only ever once" (no duration).
    SET_VARIABLES: matching keys, every property has a `title`, keys unique across all variable
    steps; preserve existing image-variable metadata per Automations Delays Variables and Branches (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §3.
    SPLIT: 2–10 paths.

**Object and limits**

15. [code] Text limits: `name` 1–100 chars (API allows 500; the builder's name field holds 100),
    `description` ≤ 2000, action `displayName` 1–60, `namespace` ≤ 100, SPLIT path `name` ≤ 100.
    Expression limits: condition expression ≤ 5000 chars (a longer one fails the builder's save),
    code ≤ 1000, filter expression ≤ 5000, `skipActionExpression`/delay/rate-limit expressions ≤ 1000.
    Step count: ≤ 45 actions of any type — at 45 the builder blocks adding or duplicating steps.
    Count before duplicating downstream steps into each branch.
16. On create: `origin: "USER"`, no `settings` (never `hidden` or `readonly`). On update:
    `origin` and `settings` sent back exactly as fetched; status unchanged unless requested.
17. Full Validate Automation returns no `CRITICAL` errors, and you can explain every `WARNING`.

## 5. Test Automation — only with explicit authorization

Test Automation runs the automation **for real**: emails and messages are sent to real
recipients, contacts/labels/orders change, webhooks fire. It skips delays and works on inactive
automations. It is not a dry run.

- Ask first, naming the concrete side effects; "go ahead and build it" is not authorization.
- Build `payload` to match the trigger payload schema, with test data the user approves (e.g.
  their own contact), never real customers.
- The response is an `activationId`: report "started", then ask the user for dashboard activity
  results and interpret supplied details with [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis). Report completion/failure only from that evidence; an empty
  or not-yet-visible log is not success, and do not rerun the test just to obtain a log.

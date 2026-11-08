---
name: "Automations Validation and Persistence"
description: "Validate automation configuration, check builder compatibility, persist changes and verify the saved result."
---

# Validation and Verification

> **Email configuration prerequisite**
>
> - **Check first:** Follow **Email configuration** in [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) before email-action/schema/provider calls or writes.
> - **No complete guide:** References to the legacy email exclusion ("Later stages only") mean these calls and writes are excluded while no loaded index/reference links the complete Automations Email Actions guide.
> - **Complete guide linked:** Load it and perform only its documented operations, subject to existing permissions, validation and consent requirements.
> - **Excluded operation:** Skip email-specific lookups and writes and use the Catalog procedure’s no-write automations-builder fallback. Never fabricate a mapping or save a placeholder.
> - **Preservation and proof:** Preserve unrelated saved email nodes unchanged. Never claim a recipient is verified without evidence.
> - **Scope:** All email-specific rules below apply only when this prerequisite permits the operation.

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
  it. Only when the Email configuration prerequisite permits email-specific verification, read typed `recipients` with [Get Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/get-automation-email-action) and compare its audience and identity with the request. A root `contactId` provides context and is not proof of a recipient; keep unrelated saved mappings unchanged and never rewrite their opaque audience fields by hand.
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

Persist the exact validated candidate, without retyping component identities. Immediately before Create/Update, compare trigger `appId`/`triggerKey` and each action `appId`/`actionKey` with their catalog values and the validated object. For creation, configuration edits or activation, any candidate change requires another full Validate; a success on the old object does not cover a changed ID. Status-only deactivation still follows §3. Compare those identities again on read-back before claiming the requested automation was saved.

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
- `DEPRECATED` — the builder shows "Action will be removed soon". Discover a supported candidate through Resolve Actions for this site, then read its runtime schema and compare its actual side effect, inputs and recipient with the request ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §2–§3). The unsupported-action list in [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §2 names replacements only for those listed keys; do not assume an arbitrary deprecated action has one there. If no compatible supported candidate is found, explain the limitation and ask the user to choose a real alternative; never invent a replacement key.
- `INVALID_MAPPING` → remove keys not in the effective schema; re-fetch the dynamic input schema.
- `MAPPING_TYPE_MISMATCH` → convert (`toString`, `toNumber`), map another field, or build the
  object shape (e.g. MONEY).
- `MAPPING_MISSING_REQUIRED_FIELD` → map it from the payload or ask the user; never a dummy value.
- `MAPPING_SCHEMA_MISMATCH` (enum, uuid, email format…) → a legal enum value / real id.
- `MAPPING_VARIABLE_MISSING_FROM_SCHEMA` → fix the path against the aggregated schema, or reorder
  so the source is an ancestor.
- `SAMPLE_CODE_RUN_FAILED` → fix the code step (guard missing fields — [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §5).
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

Verify every requested field from the successful Get response, not from the submitted
candidate. Keep the returned configuration available, or report explicit comparisons computed
from its fields against the intended values. A compact summary of titles, status and graph
edges cannot prove persisted condition expressions and thresholds, recipient/contact links,
input mappings, message contents, filters or schedules that it omits. Include those returned
fields or their verifiable comparisons before claiming they were saved correctly; never substitute a final prose assertion.

### Create

1. §4 checklist passes and the final full Validate is `VALID` (or understood warnings).
2. Create Automation with `origin: "USER"`, `configuration.status: "INACTIVE"`, no `settings`.
   Capture `id`. Send Create as its own call, after a separate full Validate call has returned
   `VALID` (or understood warnings) — never in the same script as that Validate or as discovery.
   Send it once per candidate: if a Create's outcome is unknown, Query Automations before
   resending it (Reporting rules below). A Create that was never sent is not an attempt.
3. **Read back** with Get Automation on the same site. Confirm the trigger, the root id, and the
   set of action ids/types match what you sent (string literals come back URI-encoded, as sent).
   If you used an override schema, Get with `fields: ["OVERRIDE_SCHEMA"]` ([Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §2).
   Run the Get as a separate call once Create has returned (not batched into the same script),
   and retain the returned `automation` as the evidence. Show its requested fields or the
   verifiable comparisons described above; a selected summary that omits them is insufficient.
   For a small automation, return the complete already-fetched object from the API caller
   instead of rebuilding a projection. Here `getBody` is the parsed successful Get response:
   ```js
   return { automation: getBody.automation };
   ```
   This retains message-field mappings, conditions and settings as evidence without another
   Get. For a larger object, keep the full response locally and return comparisons computed
   from its actual fields; do not substitute the submitted candidate.
4. Hand off, leading with the outcome. Make the first line of your answer the saved state, for
   example: "Saved **<name>** as inactive (ID `<automationId>`). Click **Activate** in the
   builder to turn it on: `https://manage.wix.com/dashboard/<metaSiteId>/triggers/edit/<automationId>`".
   That first line MUST name the automation, its status and its ID together; don't move the ID
   to a later line, because a reader may see only the first line.
   Then say what it does, and ask the user to review it in the builder. If the user asked to
   turn it on, activate it first (step 5) and make the first line the active state instead:
   "Saved **<name>** and turned it on (ID `<automationId>`): <edit link>".
5. Activate only on request — see "Activation status, activate, deactivate" below.

### Update restrictions

Get the current automation with its `origin`, `settings`, `configuration.status` and `revision`.
For APPLICATION/PREINSTALLED origins, enforce every applicable lock:

- `settings.readonly`: no changes.
- Trigger settings absent or `disableConfigurationModification`: no trigger/filter changes;
  public responses may omit these internal settings, so assume the trigger is locked.
- `readonlyActionIds`: no edits to those actions; `permanentActionIds`: no deletion or change
  to their `skipActionExpression`. Never delete the last action.
- No new app actions, variables or splits. Only new CONDITION/DELAY nodes are candidates;
  honor `disableConditionAddition` / `disableDelayAddition`, and report a rejection as a lock.
- `disableStatusChange`: no activation/deactivation; `disableDelete`: no automation deletion.
- Preserve `settings` exactly; never edit it to bypass a lock. USER-origin automations do not
  have these application/preinstalled origin locks.

Before a live edit to an ACTIVE automation, explain that Update takes effect immediately and
confirm, unless the user already explicitly authorized that live edit. Offer deactivate → edit
→ re-activate if they prefer a pause; obtain authorization for those status changes and honor
status locks. If live-edit consent was already given, state in the final answer that the change
went live on that explicit consent.

Before deleting a node, name it to the user and get their explicit OK
before the Update, unless they already authorized that deletion.
After removal, reconnect its parent to the retained child (or update `rootActionIds` if it was
the root). Keep a reachable single-parent tree; if branch removal makes that choice ambiguous,
ask which path to retain rather than orphaning or discarding other nodes. Fix or ask about any
downstream `var()` that read the removed node’s outputs before validating and saving. Review and
repoint or remove those references before reusing the removed node’s namespace for a new step;
ask the user when the intended replacement value is unclear.

Explain why a field is locked (installed by Wix or an app), state what remains editable, and
never work around a lock. Re-verify every entity and field the requested update touches; it
may have been renamed or deleted since creation.

Builder edits must be published or discarded first. Re-fetch on revision conflict and
preserve every untouched node and setting.

### Update

1. Get Automation with `fields: ["OVERRIDE_SCHEMA"]` so a complete-object update preserves
   trigger/action override schemas. Check `origin` and `settings` locks
   (§ Update restrictions above) before planning any change.
2. Retain a complete before snapshot, then change only what was asked on a separate copy. Keep
   ids and the complete contents of untouched nodes.
3. §4 checklist + full Validate on the merged object.
4. If the automation is `ACTIVE`, the update goes live immediately — say so and get confirmation
   first (consent rules: § Update restrictions above).
5. Update with the whole merged automation, the `revision` you read, and `origin` + `settings`
   exactly as fetched (else `INVALID_ORIGIN_TYPE`, even with a field mask — [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §2).
   On a revision conflict, re-Get, re-apply, re-validate.
6. Capture the returned automation's `id` — the first override of a preinstalled automation
   can have a new id. Get that id with overrides. Compare the complete returned fields with the
   intended merged object, and every untouched field with the before snapshot: name, status,
   origin/settings, trigger, roots, and each existing node's namespace, display name, mappings,
   schemas and other metadata. Ignore only server-managed revision/timestamps/last-updater audit and a confirmed
   override ID change; object key order is immaterial, array order and value types are not.
   For an appended node, allow only that new node and its intended attachment edge to differ.
   Return the relevant fields or explicit comparisons computed from the actual Get response;
   surviving IDs and a title/edge summary do not establish preservation. If a comparison fails,
   report the mismatch instead of claiming the edit is verified. A bumped `revision` with old
   content means the update did not apply — re-send with `fieldMask: configuration,name` and
   verify again.
7. If the change makes the automation's `name` or a step's `displayName` inaccurate (e.g. "…1
   day…" after the wait became 2 hours; "Add VIP label" now adding another label), offer new
   names; rename only with their OK.

**Compact proof for a same-ID delay edit.** Keep the full successful before Get (with
overrides) as `before`, copy it into `intended`, and change only the confirmed delay fields.
After Update succeeds, `afterGet` must be the complete automation from a separate successful
Get with overrides, not the PATCH response or a selected projection. This comparison covers
the complete node set, mappings, namespaces, names, trigger, status, origin and settings. The
[Automation Object contract](https://dev.wix.com/docs/api-reference/business-management/automations/automations/automations-v2/automation-object)
uses top-level `revision`, `createdDate`, `updatedDate` and `updatedBy` for these server-managed
values; exclude those from the comparison, including a changed last-updater identity:

```js
// Saved update comparison
function verifySavedUpdate(intended, afterGet) {
  if (
    !intended?.id ||
    afterGet?.id !== intended.id ||
    !intended.configuration ||
    !afterGet?.configuration
  ) {
    throw new Error(
      'Missing successful complete Get or mismatched automation ID'
    );
  }
  const ordered = value =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [key, ordered(value[key])])
          )
        : value;
  const comparable = ({
    revision,
    createdDate,
    updatedDate,
    updatedBy,
    ...fields
  }) => ordered(fields);
  const matches =
    JSON.stringify(comparable(intended)) ===
    JSON.stringify(comparable(afterGet));
  if (!matches) throw new Error('Saved fields differ from the intended update');
  return {
    automationId: afterGet.id,
    status: afterGet.configuration.status,
    completeSavedFieldsMatch: matches,
  };
}
```

For example, apply only the authorized relative-delay values to the copied before snapshot,
then return the check computed from the actual Get response:

```js
const intended = structuredClone(before);
Object.assign(intended.configuration.actions[delayId].delayInfo, {
  offsetExpression: requestedOffsetExpression,
  offsetTimeUnit: requestedOffsetTimeUnit,
});
// After separate successful Validate, Update and Get calls:
const verification = verifySavedUpdate(intended, afterGet);
```

Do not substitute empty snapshots or turn a failed comparison into a success flag. A confirmed
preinstalled override-ID change follows step 6 above; this same-ID example must not conceal one.

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

Read or change status only as [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status) describes; this guide adds no status
procedure of its own. Deactivation does not require repairing the configuration.

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
   [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling).

**Actions** — [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration). Confirm entity ids or keys with the owning vertical’s documented read API; match the schema type and preserve exact returned values, never display names.

8. Every APP_DEFINED `appId`+`actionKey` came from Resolve Actions on this site; no unsupported
   action added — including no new code-variable step (the public Create refuses it).
   Only when the Email configuration prerequisite permits new email steps, use a provider-generated mapping once and persist it before content edits; no fabricated opaque-widget mapping ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1).
   Preserve unrelated existing email mappings unchanged.
   To change an existing email step’s settings, use [Update Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/update-automation-email-action) only when the complete Email Actions procedure permits it. Never edit its opaque `inputMapping` directly.
9. `inputMapping`: only schema keys (an unrelated existing email/widget step's mapping passes through unchanged; use the fresh mapping after an intentional provider settings update), types and
   enums match, every required field mapped (optional ones per [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.2), entity-selector fields hold ids, formulas
   only in `dynamicValuesOptions.enabled` fields.
10. No "Create a contact" action (`contacts-create_contact`) when the trigger payload already has
    an `identityType: "contact"` field — the builder marks it "can't create a contact" and blocks
    activation.

**Expressions and conditions** — [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §9, [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §6

11. [code] Every `var()` path exists in that node's aggregated schema
    — trigger + ancestor outputs only — with a compatible type.
12. Builder-renderable functions only; `;` separators; double-quoted, URI-encoded string literals;
    number/boolean fields hold exactly one expression of that type.
13. CONDITION: exactly one expression group with `AND`/`OR` and 1–20 panel-renderable expressions;
    not both branches empty; otherwise a CODE_CONDITION.

**Special steps** — [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)

14. DELAY: exactly one mode — relative (`offsetExpression` a `{{N}}` literal + unit) or absolute
    (`dueDateExpression`). RATE_LIMIT: `{{1}}`, a trigger identifier allowed by
    [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §2 (preserve existing supported member/user/UUID identifiers), and a
    duration (`{{24}} HOURS`, never `{{1440}} MINUTES`) unless the user explicitly wants
    "only ever once" (no duration).
    SET_VARIABLES: matching keys, every property has a `title`, keys unique across all variable
    steps; preserve existing image-variable metadata per [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4.
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
- The response is an `activationId`: report "started" — not completed or succeeded — and tell
  the user to check the run's results in the automation's activity view in the Wix dashboard.
  Do not rerun the test to confirm it ran.

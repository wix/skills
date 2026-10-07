---
name: "Automations Action Configuration"
description: "Configure app-defined automation actions from their input schemas and preserve supported existing action mappings."
---

This publication is being released in stages. Where a topic guide is not yet published, consult the official Automations API reference and method schemas before using that feature; do not guess its contract.

# App-Defined Actions — Discovery, Schemas, Input Mapping

**TL;DR**

- An action is `appId` + `actionKey`. Find real ones with **Resolve Actions** (site catalog), then read the version active on the site with **Get Runtime Action**. Never invent keys.
- The configuration is `appDefinedInfo.inputMapping`: an object keyed ONLY by input-schema property names, with values of the schema's type — literals, or `{{…}}` formulas in fields the UI schema marks as dynamic.
- Fields marked `updateSchemaOnChange: true` reveal more inputs once set → **Get Action Dynamic Input Schema**. Output that depends on configuration → **Get Action Dynamic Output Schema** after the mapping is final.
- **Send an email** (`triggered-emails`): initialize each NEW step with **Generate Action Input Mapping**, persist the returned mapping unchanged, then configure content with Get / Set Email Content (§5.1, Automations Email Actions (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations))). Existing content-only edits do not initialize another email.
- Entity-selector fields take **ids**, never display names (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations))).
- Before accepting any action, prove its side effect and its recipient (§6).

---

## 1. APIs used here

Site-scoped (`wix-site-id` header), SDK module `actionCatalog`: Resolve Actions · Get Runtime Action (the version this site runs — use it) · Get Action Dynamic Input / Output Schema (+ bulk output). Paths and request shapes: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §4.

## 2. Finding the right action

1. Resolve Actions with small pages (`{"query": {"paging": {"limit": 25}}}`); filter by `appId` when known, otherwise search locally over `displayName`, `description`, `actionKey` with a keyword ladder (phrase → domain verb/noun → synonyms).
2. Read the `description`. A name like "Add a coupon" or "Get a …" can be a value-producing step that notifies nobody.
3. Get Runtime Action for the 1–3 best candidates; build against that version's `inputSchema`, `outputSchema`, `interfaceConfiguration`.
4. An action missing from Resolve Actions is not usable on this site. The builder shows such a step as "action not found" and blocks it.

**Do not use** unsupported or deprecated actions — `send-mail` (→ `triggered-emails`), `send-coupon-action` (→ `wixcoupons-retrieve_coupon` + a delivery step that uses its code), `wix_automations-velo_action`, `wix_automations-data_manipulation_code` (code variable; public Create refuses it — [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4), `whatsapp-send-message` (WhatsApp), `forward-to-zapier` (Zapier), and site actions `wix_automations-wix_api_integration` (non-public). Match these by `actionKey` (+ `appId`), not by app or display name — other actions of the same app are fine. Reasons and replacements: Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §2 (site actions: §1).

### Selection rules

- Prefer a normal built-in action over any AI action.
- **Direct action beats communication**: "apply the change" is the change, not an email about it — unless messaging was asked for.
- **Delivery beats retrieval**: "send the customer a coupon" needs a delivery step. A staging action alone is incomplete; its output must be consumed by a delivery step on the same path.
- Replacing an unsupported external integration: keep the channel (chat stays chat-like).
- AI ladder — first that fits: (1) **Delegate to Aria** `ai_assistants-delegate-to-assistant`: autonomous agent, output NOT used downstream (exposes only `summary`); (2) **Custom agent** `ai_custom_agent_bm-delegate_to_agent`: autonomous agent whose output IS used downstream; (3) **Generate or analyze text** `wix_automations-llm_call`: pure LLM over data already in the payload; no tools, no internet. "LLM step" → (3). When later steps need several structured fields, use (3) with an override output schema — not a single-string text action.
- Ask the user to choose between overlapping actions only when the difference is user-facing and context doesn't decide it.

## 3. Reading the action

- `inputSchema` — JSON Schema of the mapping. `required` = must map. `oneOf`/`const` = enum. `format`, `wixCustomType`, `identityType` as in [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §3.
- `interfaceConfiguration.type` — `GENERIC` → the builder renders a form from `inputSchema` + `genericOptions.uiSchema` (rules in §5.2). `WIDGET_COMPONENT` → the app's own configuration widget, which you can't see (below).
- `interfaceConfiguration.genericOptions.uiSchema` — per-field UI hints (below). It cannot add fields.
- `outputSchema` — fields downstream steps read as `var("<namespace>.<field>")`. Empty and no dynamic output → later steps must not reference its namespace.
- `implementedMethods` — `validateConfiguration` (the app validates your mapping on Validate Automation), `getQuotaInfo`. It does **not** tell you about dynamic schemas — decide by `updateSchemaOnChange` and by calling the dynamic-output API.

**`WIDGET_COMPONENT` actions.** The widget owns the mapping; the builder's form rules don't apply to it. If `inputSchema` fully describes what the user asked for (e.g. `addLabelsToContact`: `contactId` + `labelKeys`), hand-author it (§5.2) and tell the user to review the step; otherwise use its dedicated provider API if available (§5.1), or explain the manual setup. If the widget can't load (its app is uninstalled), the builder shows an "app not installed" state with a Replace button instead of the settings.

Conditional fields (`if`/`then`/`dependencies`, e.g. a due date shown only when "add a due date" is true): set the toggle and the dependent field together, or leave both out.

UI-schema keys that change what you may write:

- `dynamicValuesOptions.enabled: true` → the field accepts `{{…}}` formulas. `strict: true` → the formula must return the field's exact type/format. **A field without it is static: literal only.**
- `"ui:widget": "EntitySelector"` + `entitySelectorOptions` (`selectorId`/`tag`, `filters`, `dynamicFiltersMapping`) → entity picker; value = id or array of ids (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §1). Same for input properties carrying `itemsSelectionConfiguration`.
- `"ui:field": "AudienceSelector"` → an audience object owned by the app's picker; don't hand-author it — the user sets it in the builder (§5.1).
- `"ui:field": "TextSectionField"` → display-only text; never map it.
- `"ui:widget": "hidden"`, `ui:readonly` → keep the schema `default`. Other `ui:*` keys are presentation only.

## 4. Dynamic input and output schemas

- **Input**: a property with `updateSchemaOnChange: true` (e.g. a template or form id) changes which inputs exist. Set it, then call Get Action Dynamic Input Schema with `{appId, actionKey, inputMapping}` (the mapping so far). The builder shows the static schema **merged** with the returned one (properties and `required` united), so keys from either are kept. Repeat if another controlling field is revealed. Never invent a field you expected but didn't get — it appears only after its controlling selection. The builder re-fetches this schema from your saved mapping every time the step is opened, so a dynamic key whose controlling value isn't in the mapping is dropped on the first edit.
- **Output**: after the mapping is final, call Get Action Dynamic Output Schema (or the bulk variant) and use the returned `outputSchema` for downstream `var()` paths. A dynamic output is a _real_ schema — never replace it with an override (allowlist: [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3).

## 5. Building the input mapping

### 5.1 Provider-owned mappings — email and opaque widgets

Check the **provider APIs registry** (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §3) before treating an opaque
widget as unavailable. **Send an email** has a dedicated **Generate Action Input Mapping** API:

- For every new email action, whether creating an automation or inserting into an existing one,
  call the email initializer with the requested recipient/type settings. Use its returned
  `appId`, `actionKey`, and opaque `inputMapping` without modifying the mapping. Supply a fresh
  action ID, normal APP_DEFINED namespace and graph connections.
- Persist through Create (INACTIVE) or the normal Get → merge → Validate → Update flow; use the
  returned automation ID and new action ID for Get / Set Email Content. Read back content and
  automation, validate, and check recipient lineage before reporting completion.
- Each initializer call creates new draft email content. One returned mapping belongs to ONE
  action only. For duplicated branch tails initialize each new email separately; never copy
  `messageId`, `templateId`, `uniqueRuleId` or the existing email's mapping.
- Editing an EXISTING email's subject/preheader/body uses Get / Set Email Content in place:
  no initializer, no replacement node, no changed mapping. Preserve other email/widget steps
  byte-for-byte (existing site-owner audience exception: Automations Email Actions (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §3).
- **Generate Action Input Mapping** is the email provider's initializer, not the action
  catalog's AI-backed **Generate Input Mapping From Intent**, which remains outside this skill.
- If the initializer is unavailable in the caller's environment during rollout, report the
  actual failure. Never fabricate the mapping. With the user's agreement save only supported
  parts INACTIVE and provide the exact builder steps still needed. For an email-only request,
  save nothing rather than an empty or fabricated automation. Do not retry a timed-out initializer
  blindly: it creates resources and the outcome may be unknown.

Other opaque widgets with no public configuration API remain manual: do not invent their
app-owned keys. Tell the user which action to add, where, and its intended configuration.
Email attachments, preview and mapping-copy workflows remain outside this skill's API flow.

### 5.2 Hand-authored mapping

MUST (builder renderability — the `GENERIC` form drops, rewrites or flags anything else):

- Keys: only properties of the current (merged dynamic) input schema. The form drops unknown keys on the first edit.
- Values: the schema's type — string→string, number/integer→number, boolean→boolean, array→array, object→object field by field (e.g. MONEY `{"value": "…", "currency": "…"}`).
- Every `required` field present. An action with visible fields and a missing/`null` `inputMapping` is flagged "missing required info" and its panel can't be applied.
- An action with no input properties (or only hidden ones): send `"inputMapping": {}` — the builder writes `{}` itself on open otherwise.
- Map fields the form would auto-fill, or opening the step silently changes the automation: fields with a schema `default` (write the default or your value), every `identityType` input (the form auto-maps it when exactly one matching payload path exists), required `date`/`date-time`/`time` strings (else filled with "now").
- Enum fields (`oneOf` / `enum`): one of the listed constants.
- Entity-selector fields: real ids of the right kind and shape (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §1).
- `{{…}}` only in fields with `dynamicValuesOptions.enabled` (or an `identityType` field), per [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §4: number/boolean hold exactly one expression of that type; date-time a single date-time expression or ISO literal; strings may mix text and expressions. An **array-typed** `var()` in a string field is flagged as a format mismatch.
- Don't copy volatile values: dates → `now()`/payload dates; ids → resolved at build time, never from examples.

Value kinds:

```json
{
  "subject": "Welcome, {{var(\"contact.name.first\")}}!",
  "priority": "HIGH",
  "notifyCustomer": true,
  "amount": {
    "value": "{{var(\"order.total.value\")}}",
    "currency": "{{var(\"order.total.currency\")}}"
  },
  "contactId": "{{var(\"contactId\")}}",
  "labelKeys": ["<label-key-1>"],
  "note": "Order {{var(\"order_number\")}} from {{var(\"createTask-1.taskId\")}}"
}
```

Trigger fields have no prefix; action outputs use the step's `namespace` (e.g. `createTask-1.taskId`); set-variables use `setVariable.<key>`.

Optional inputs with no `default` (e.g. `isDueDate`, `onlyWhenAvailable`): omit them unless the request needs them. A deprecated defaulted input (e.g. `labelIds: []` on add-label) may be omitted.

Process: (1) fetch the effective schema (§4) → (2) classify required vs optional; map optional fields only with a real source → (3) source each required field from payload, upstream outputs or the user; ask for user-specific content (text, recipient, which entity) → (4) build → (5) self-check against the list above → (6) Validate Automation.

### 5.3 Validation errors on actions

Error shape, error type → fix, and how the builder shows each: [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §2. Must-know here: fix the field named by `configurationError.fieldKey` — never delete a field to silence it; `CRITICAL` blocks (status `INVALID`), `WARNING` doesn't but must be reported; a `var()` path that doesn't exist may NOT be reported — verify paths yourself.

## 6. Side-effect and recipient review

This section owns the semantic review (you, not code) required for every action before acceptance. Confirm from its catalog entry and effective schemas:

- **Verb**: it performs what was asked (assign/add/send/create/update/delete). A read-only "get" action can't satisfy a mutation; sending a message about a change is not the change.
- **Entity**: the affected entity has a matching input (e.g. a label picker for "add label").
- **Identity input**: the id it acts on, with the right `identityType`.
- **Recipient lineage** (email, chat, SMS, push): write down `{requestedAudience, resolvedAudienceKind (contact|visitor|owner|contributor|label|phone|device), resolvedIdentityPath}`. The trigger contact and a contact created upstream are different people even if both are `contactId`. Wording never proves the recipient.
  - Email: the audience fields decide — read `selectedAudience` / `contactId` exactly as in Automations Email Actions (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §3 ("Recipient encoding"). A root `contactId` or `triggerContactExcluded` alone doesn't prove who receives it.
  - Chat (`send-message`): only a schema-supported contact-id or visitor-id route; owner/team chat needs a different, proven component or a clarification.
  - SMS / push: prove the schema-supported contact, audience, phone or device route.

Under-required schemas: `send-message` requires only `contactId`/`visitorId` (anyOf), not the text. Always map the message too — a required-fields-only mapping ships an empty action.

## 7. Common failure modes

Missing required field or content-free required-only mapping · fabricated user values instead of asking · type/format mismatch, free text in an enum, a name in an id field · `var()` to a path absent from the aggregated schema (or from an unfetched dynamic schema) · formula in a static field or an unknown function · wrong verb or recipient · a single-value field filled from an array · unmapped defaults / identity fields / missing `{}` (the builder rewrites the step on first open).

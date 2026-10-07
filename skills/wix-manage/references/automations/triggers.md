---
name: "Automations Trigger Configuration"
description: "Select and configure automation triggers, trigger filters and event payload schemas using the site catalog."
---

This publication is being released in stages. Where a topic guide is not yet published, consult the official Automations API reference and method schemas before using that feature; do not guess its contract.

# Triggers — Discovery, Payload Schema, Filters

**TL;DR**

- A trigger is `appId` (GUID) + `triggerKey` (string). Find real ones with **Resolve Triggers** (installed apps only); never invent a key or reuse one from an example.
- There is no trigger `description` field. Choose by `displayName` + `triggerKey` + **payload schema** + available **filters** — names are ambiguous.
- Only filters listed in the trigger's `filters` array can be used. A payload field without a filter definition is NOT filterable (use a condition step instead — see [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)).
- A saved filter is `{ id, fieldKey, filterExpression }` with one of exactly two builder-readable expression shapes (§4.2). Values are always a literal array. Entity values are **ids**, never names.
- Required filters, and required follow-ups of any filter you set, must be present. The builder writes BOOLEAN (and defaulted NUMBER) filters itself — save them too (§4.1).
- Triggers with `implementedMethods.getDynamicSchema: true` expose more payload fields once their schema-changing filters are chosen — fetch the dynamic schema (§5) before mapping anything downstream.

---

## 1. APIs used here

Site-scoped (`wix-site-id` header), SDK module `triggerCatalog`: Resolve Triggers (installed apps) · Get Trigger By App Id And Key (filters, payload schema) · Get Trigger Dynamic Schema · Get Identities Schema · Query Triggers (whole catalog, regardless of installation). Paths and request shapes: [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §3.

## 2. Finding the right trigger

1. **List cheaply**: Resolve Triggers with `basicFieldsOnly: true` (drops schemas and filters) and pages of ≤ 25; page until `paging.total` is reached, de-duplicating ([Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §6).
2. **Narrow**: when you know the app, pass `appId` (returns all that app's triggers regardless of maturity; the app must be installed). You may also put `appId` / `triggerKey` in `query.filter`; if the filter is rejected, page and filter locally.
3. **Search locally** over `displayName` and `triggerKey`: the user's phrase → the domain noun ("booking", "form", "order", "member") → synonyms ("appointment"/"session", "purchase"/"order placed"). Keys usually start with the app prefix (`wix_bookings-`, …).
4. **Fetch details** for the 1–3 best candidates only: Get Trigger By App Id And Key.
5. **Disambiguate by schema, not name** ("Session booked" vs "Appointment request approved" for "booking confirmed"): read `payloadDataSchema` titles and `filters` to confirm the event and that the downstream data exists. If two remain equally plausible and it matters, ask.
6. Only in Query Triggers, not Resolve Triggers → its app isn't installed (tell the user to install it) or, with `maturity` `CREATED` / not GA, it isn't available to sites yet (Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §5).

Selection guidance for overlapping families:

- Compare, in order: which trigger offers the filters you need → which exposes the payload (or dynamic schema) you need → site context → default to the newer/standard family.
- Forms: default to the **Wix Forms App** family — app `225dd912-7dea-4738-8688-4b8c6955ffc2`, key `wix_form_app-form_submitted`. Use the older app `14ce1214-b278-a7e4-1373-00cebd1bef7c`, key `wix_forms-form_submit` only when the site's forms live there (check which app the form id comes from). For a named form or choice value, prefer the trigger whose filter expresses it over a generic trigger + condition.
- Scheduled trigger → [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4. Webhook / custom trigger → §6 here and [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3.

## 3. Reading the trigger object

| Field                                              | Use                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `appId`, `triggerKey`                              | Copy verbatim into `configuration.trigger`.                                 |
| `displayName`                                      | What the user sees. Not a unique key.                                       |
| `payloadDataSchema`                                | JSON Schema of the event payload — the only trigger data you may reference. |
| `filters[]` (≤5, each with `followUpFilters[]` ≤5) | The only filterable fields (§4).                                            |
| `implementedMethods.getDynamicSchema`              | `true` → payload grows with filter choice (§5).                             |

Payload schema annotations you will meet:

- `format`: `uuid`, `date-time`, `date`, `email`, `uri`, `number` (a numeric string — wrap it in `toNumber()` in numeric functions).
- `identityType: "contact" | "member"` on an id field → the aggregated payload also contains a root-level `contact` / `member` object (keys and rules: [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4). `visitor` ids stay plain fields with no enrichment.
- `itemsSelectionConfiguration.providerKey` / `.tag` → the field holds an **entity id** (service, form, label, product, …). Compare it only to ids (see Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations))).
- `wixCustomType` fixed shapes: `MONEY` `{value: string, currency: string}` · `ORDER_ID`/`ORDER_PAYMENT_ID`/`RECEIPT_ID`/`RECEIPT_PRESET_ID` uuid strings · `ATTACHMENT` `{fileName, downloadUrl}` · `IMAGE_URL` uri string · `FIELDS` array of `{label, value}` · `RECEIPT` complex object.
- `futureDate: true` on a date-time field → the trigger supports a "before the event" offset ([Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §5).
- `hidden: true` → not shown in pickers but still referenceable. `examples` show real value shapes.

## 4. Filters

### 4.1 Filter definition (catalog)

```json
{
  "id": "<filter-uuid>",
  "fieldKeyType": "STATIC_FIELD_KEY",
  "staticFieldKey": "service_id",
  "valueInput": {
    "type": "ENTITY_SELECTOR",
    "label": "Select services",
    "required": false,
    "reevaluateDynamicSchema": true,
    "entitySelector": {
      "id": "<provider-key>",
      "multiSelect": true,
      "queryFieldToFilterIdMapping": {},
      "queryFieldToValueMapping": {}
    }
  },
  "followUpFilters": []
}
```

Values you put in the expression, by `valueInput.type` (anything else is dropped or rewritten when the panel opens):

- `ENTITY_SELECTOR`: entity ids as **quoted strings**, of the kind named by `entitySelector.id` / the field's `itemsSelectionConfiguration` — from the vertical's public API or the user (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations))). `multiSelect: false` → one id.
- `STATIC_ITEMS`: quoted strings equal to a `staticValues[].value` that has a `displayName` (not the `displayName`, not the item `id`, never bare numbers).
- `USER_INPUT` `NUMBER`: exactly ONE bare number within `numberInputOptions.minValue`/`maxValue`. `BOOLEAN`: exactly ONE bare `true`/`false`.

The builder writes some filters by itself when the trigger panel opens; save them too or the automation shows an unsaved change: every `USER_INPUT` `BOOLEAN` filter (user's value, else `booleanInputOptions.defaultValue`, else `false`) and every `NUMBER` filter that has a numeric `defaultValue` (user's value, else that default).

### 4.2 Saved filter and the two allowed expression shapes

```json
{
  "id": "<same filter id as the catalog>",
  "fieldKey": "<staticFieldKey verbatim>",
  "filterExpression": "{{contains([\"<id-1>\",\"<id-2>\"];var(\"service_id\"))}}"
}
```

**Shape A — scalar field** (`staticFieldKey` has no `[0]`):
`{{contains([<values>];var("<fieldKey>"))}}`

**Shape B — array-backed field** (`staticFieldKey` contains one `[0]`, e.g. `formIds[0]`, `forms[0].data.id`). `[0]` stands for "every item", not item zero. Split into `arrayPath` (before `[0]`) and `itemPath` (after `[0].`, may be empty):

- empty `itemPath`: `{{arraySome([<values>];contains(var("<arrayPath>");$_))}}`
- non-empty: `{{arraySome([<values>];contains(arrayMap(var("<arrayPath>");"<itemPath>");$_))}}`

MUST:

- `id` = the catalog filter `id`; `fieldKey` = `staticFieldKey` character for character, `[0]` included.
- Values are ALWAYS a literal array, even for one value (`["x"]`). Types match the field: strings quoted, numbers/booleans bare.
- `;` between arguments, double quotes only, no spaces, one non-empty expression per filter (an empty/missing `filterExpression` is a builder error), max 5 filters.
- String literals inside `{{…}}` (values and the `var` path) are URI-encoded like every bracket literal ([Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §1).
- Order `filters` as the catalog lists them, depth-first (each filter, then its follow-ups): the builder re-appends each filter in that order on panel open and compares deep-equal.

NEVER:

- `var("forms[0].id")` — validates, but checks only the first item.
- `contains(var("formIds");"x")` (value outside an array) — the builder cannot read it back.
- Any other function (`stringEq`, `arrayIncludesAnyOf`, `not`, …) in a filter — the filter panel only parses `contains` and `arraySome`.
- Filters on a field key with two array boundaries (`forms[0].ids[0]`), a literal index (`forms[1].id`) or a leaf that is an object/array rather than a string/number/boolean. There is no valid expression: configure the supported filters, tell the user this one is unavailable, and offer a condition step if the data is in the payload.

Updating an array-backed filter: change only the values array; keep the shape and `fieldKey`.

### 4.3 Required, follow-up and dependent filters

- `valueInput.required: true` on a top-level filter → the filter MUST be saved. No user preference is not a reason to ask: pick a sensible default from the filter's own options (an "Any/All" option the trigger offers is fine); there is no wildcard expression. If it is also single-select (`multiSelect: false`), the trigger fires for exactly ONE chosen entity: a request for "any label/any service…" cannot be met with this trigger — offer: pick one, one automation per entity, or a different trigger. Check this during feasibility, before planning.
- A follow-up filter marked required is mandatory **only if its parent filter is set**. Setting a parent obliges you to set all its required follow-ups.
- NEVER save a follow-up without its parent: the builder hides it and deletes it when the panel opens. Only `ENTITY_SELECTOR` follow-ups of `ENTITY_SELECTOR` parents are shown at all.
- `entitySelector.queryFieldToFilterIdMapping` (`{"workflowId": "<parent-filter-id>"}`): options depend on the parent's value. Choose the parent first, then fetch child ids scoped to it (workflow → stage, program → step).
- `queryFieldToValueMapping` (`{"eventType": "RSVP"}`): options are pre-narrowed; pick ids from that subset, nothing extra in the expression.

Dependent example:

```json
"filters": [
  { "id": "<program-filter-id>", "fieldKey": "programId",
    "filterExpression": "{{contains([\"<program-id>\"];var(\"programId\"))}}" },
  { "id": "<step-filter-id>", "fieldKey": "programStepId",
    "filterExpression": "{{contains([\"<step-id-1>\",\"<step-id-2>\"];var(\"programStepId\"))}}" }
]
```

### 4.4 `DYNAMIC_FIELD_KEY` filters

The field to filter on is itself selected (`dynamicFieldKey.entitySelector`, dependent on a parent such as the form). Resolve the parent first, then:

- **The key** = the id of the field as that field-key selector lists it — the builder saves it as `fieldKey` and passes the same string to the value picker as its `fieldTarget`. For Wix Forms ("Option chosen on a form") that is the form field's **`target`** from the Forms API (`multi_choice_5734`) — not the dynamic-schema property key (`field:multi_choice_5734`, used only in `var()` paths of later steps) and not the field's uuid `id`.
- **The expression** is **Shape A** with that same key: `{{contains(["<value-1>"];var("<key>"))}}`. The builder reads the chosen key back from the `var(...)` and treats the filter as required; Shape B is never used here.
- **The values**: if `valueInput` is an `ENTITY_SELECTOR` scoped to that field (form choices), use the choice option's `value` from the Forms API (what a submission stores, e.g. `"Walter"`), quoted and URI-encoded (§4.2). The value picker's own ids aren't public, so this is a best match, and Validate checks neither key nor values: tell the user to open the trigger in the builder and confirm the field and choice show by name.
- Can't list the fields → ask the user.

## 5. Dynamic-schema triggers — filters come first

When `implementedMethods.getDynamicSchema` is `true`:

1. Decide the filter values, especially those with `valueInput.reevaluateDynamicSchema: true` (which form, which service).
2. Call Get Trigger Dynamic Schema with what the builder sends: one entry per **saved** filter (`fieldKey` verbatim, its string values); if no filter is saved, each `reevaluateDynamicSchema` filter's `staticFieldKey` with `values: []`:
   ```json
   {
     "appId": "<app-id>",
     "triggerKey": "<trigger-key>",
     "selectedFilterOptions": [
       { "fieldKey": "formId", "values": ["<form-id>"] }
     ]
   }
   ```
   **Merge** the response into the static schema: take `payloadDataSchema` and overlay `dynamicSchema.properties` on its `properties` (dynamic wins on a key clash). The dynamic schema alone usually lacks static fields such as `contactId` — never use it by itself.
3. Map and condition only on fields present in that schema. Labels differ from keys — copy keys from the schema.
4. No filter chosen ⇒ entity-specific fields (form answers) are **unknown, not absent**, whatever the `values: []` call returns. Never map or condition on a form-answer field without the form filter: use only static fields (`contactId`, submission time, …) or ask which form, set that filter, then fetch the dynamic schema.

## 6. Webhook and custom triggers

**Webhook** (`wix_automations-webhook_trigger`, app `139ef4fa-c108-8f9a-c7be-d5f492a2c939`). The builder expects all three together. Create/Update support `automationConfigMapping` even where the public docs omit it. Include it and verify the complete trigger on read-back; do not reject this flow solely because the field is undocumented:

```json
"trigger": {
  "appId": "139ef4fa-c108-8f9a-c7be-d5f492a2c939",
  "triggerKey": "wix_automations-webhook_trigger",
  "automationConfigMapping": { "webhookId": "<new-uuid>" },
  "filters": [ { "id": "6104302c-891a-4d14-8e9b-849c2233d903", "fieldKey": "webhookId",
    "filterExpression": "{{contains([\"<same-new-uuid>\"];var(\"webhookId\"))}}" } ],
  "overrideSchema": { "...": "see schemas-and-scheduling.md §3" }
}
```

MUST persist exactly this:

- `automationConfigMapping.webhookId` = a uuid v4 you generate. The URL the external system POSTs to — give it to the user; the builder's trigger panel shows the same one — is `https://manage.wix.com/_api/webhook-trigger/report/<metaSiteId>/<webhookId>`.
- `filters` = exactly ONE filter: `id` `6104302c-891a-4d14-8e9b-849c2233d903`, `fieldKey` `webhookId`, `filterExpression` Shape A with that same uuid. The catalog's own webhook filter definition is a placeholder — don't copy it or add others.
- On update, keep the existing `webhookId`: a new one changes the URL the external system calls.

- Otherwise the builder rebuilds a missing/foreign-id filter from `webhookId` on load; a missing `webhookId` gets a new one when the panel opens (unsaved change, URL the user never received).
- The webhook trigger is exempt from required-filter rules. Its payload schema is `overrideSchema` ([Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3). Get Automation returns `overrideSchema` only with `fields: ["OVERRIDE_SCHEMA"]` (same for the custom trigger) — request it on read-back.

**Custom trigger** (`wix_automations-custom_trigger`, same app) — fired from the site's own code: persist `automationConfigMapping: {"hookId": "<new-uuid>"}` and `filters: []`, payload in `overrideSchema`. Keep `hookId` on update (the site code references it). Hand-off: give the user the `hookId` (the builder shows it as "Trigger ID"; the catalog calls this trigger "Velo code trigger") and tell them nothing runs until their site code calls it — with the snippet the builder itself shows (below), or REST (scope _Access Verticals by Automations_) `POST https://www.wixapis.com/_serverless/crm-automations-utils/v1/trigger-custom` with `{triggerId, payload}`. The payload must match `overrideSchema`; `hookId` itself is not a payload field. Missing `hookId` → the builder generates one when the panel opens and replaces `automationConfigMapping` and `filters`.

```js
// backend/Run-Automation.web.js — the builder's own custom-trigger snippet
import { customTrigger } from '@wix/automations';
import { auth } from '@wix/essentials';
import { Permissions, webMethod } from 'wix-web-module';

export const runTrigger = webMethod(Permissions.Anyone, async payload => {
  const triggerMethod = auth.elevate(customTrigger.runTrigger);
  await triggerMethod({ triggerId: '<hookId>', payload });
});
```

## 7. Pre-save checklist

- [ ] `appId` + `triggerKey` came from Resolve Triggers on this site.
- [ ] Every filter `id` exists in the catalog trigger (or a follow-up); `fieldKey` is verbatim.
- [ ] Every expression is Shape A or Shape B (Shape A for dynamic field keys); values in a literal array; types per §4.1; ids, not names; no follow-up without its parent.
- [ ] Every `BOOLEAN` filter, and every `NUMBER` filter with a default, is saved.
- [ ] All required filters present; required follow-ups present for every set parent.
- [ ] For dynamic-schema triggers, downstream steps use the schema returned for the chosen filters.
- [ ] Final gate: Validate Automation returns no `triggerValidationErrors`.

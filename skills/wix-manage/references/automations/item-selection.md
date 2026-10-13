---
name: "Automations Item Selection"
description: "List the entity fields of a trigger or action and their selectable IDs with List Selector Options, including dependent fields, value shapes, incomplete or failed lookups and ambiguity handling."
---

# Selectable Options — List Selector Options

**List Selector Options** (Automations Skills API) returns, for one trigger or one action, every
field that holds the id of a site entity (form, label, pipeline stage, coupon, service…) together
with the entities the site has for it. It finds the selector fields, reads their providers, applies
fixed and parent filters, pages the results and returns ids — so you never query providers yourself.

| Method | Path | Permissions |
| --- | --- | --- |
| List Selector Options — saved automation | `GET /v1/list-selector-options/{automationId}` (trigger) · `GET /v1/list-selector-options/{automationId}/{actionId}` (app-defined step) · or `POST /v1/list-selector-options` with `automationId` [+ `actionId`] | Site-scoped. The **Set Up Automations** scope (`AUTOMATIONS.AUTOMATION_READ`) plus the method's own `automations:v1:automations_skill:list_selector_options`. |
| List Selector Options — unsaved automation | `POST /v1/list-selector-options` with `trigger` or `action` | Same. |

The public base URL will be listed here once the route is published. Until then, call it only
through a binding your tools already expose for it; otherwise use a vertical API from
[Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2 or ask the user. Never guess a gateway URL.

The call runs with **your** identity: it returns only entities your token can read and grants no
new access.

## When and how to call it

Call it **once per trigger or action you configure**, before writing its filters, inputs or the
conditions that compare its payload ids. Address the component in exactly one of two ways:

1. **Saved automation — when editing, and after Create.** Automations you create through the
   public API are saved (INACTIVE) as soon as Create returns, so this is the usual form. Pass
   `automationId`, plus `actionId` for an `APP_DEFINED` step; omit `actionId` for the trigger's
   filters (follow-up filters included). The automation is read with Get Automation as you, and
   the values already chosen are taken from it — the trigger's saved filter values, or the step's
   literal `inputMapping` values (`{{…}}` expressions are dropped; the dynamic input schema
   receives the full mapping) — so you do not rebuild `selectedValues`. To preview options after
   changing a parent before you Update, POST the new value in `selectedValues`: it overrides the
   saved value for that path. Only the saved (published) configuration is read; unpublished
   builder draft edits are not visible.
2. **Unsaved automation — while drafting, before Create.** Pass `trigger: {appId, triggerKey}`
   or `action: {appId, actionKey}`, with the values chosen so far in `selectedValues`.

Then:

- For each returned field, match the user's wording to `options[].name` and save
  **`options[].id` exactly as returned** (not always a uuid — label keys look like
  `custom.vip`). Never save a name.
- When you change a selection that another field or the dynamic schema depends on, **call
  again** — saved form: after Update, or with the new value in `selectedValues`; unsaved form:
  with the new `selectedValues` — and re-pick the dependent fields.

Request fields:

- `selectedValues` — values already chosen, keyed by field `path` (a trigger filter may also be
  keyed by its `filterId`). Each value is an id or a list of ids. One namespace shared by trigger
  filters, payload fields and action inputs; at most 100 keys. These values also load the
  trigger's dynamic payload schema and the action's dynamic input schema, so fields that exist
  only for a selection appear once their parent is selected. In the saved form they override the
  saved values for the same path.
- `fieldPaths` — optional subset of paths to return. Empty returns every field.

The response names the component in `trigger` (`appId`, `triggerKey`) or `action` (`appId`,
`actionKey`) next to `fields`.

## Reading a field

| Field | Meaning |
| --- | --- |
| `path`, `location` | Where the value is written. `TRIGGER_FILTER`: the filter's field key (the `var()` of its `filterExpression`), or its `filterId` when the key is chosen by a `TRIGGER_FILTER_FIELD_KEY` field (`path` `"<filterId>.fieldKey"`; the chosen option's `id` **is** the field key). `ACTION_INPUT`: dotted `inputMapping` path. `TRIGGER_PAYLOAD`: dotted payload path, for conditions. |
| `valueShape`, `maxItems` | `SINGLE_ID` → one id. `ID_LIST` → a list of at most `maxItems` ids. `ARRAY_ELEMENT_ID` → one id per element of the array at `arrayPath`, at `elementFieldPath` inside each element. |
| `dependsOn[]` | Parent fields (`fieldPath`, `hasValue`) whose values filter these options. |
| `status`, `statusReason` | Whether `options` can be used — see below. |
| `options[]` | `{id, name, providerKey}`. Save `id`. |
| `title`, `filterId`, `providerKeys`, `tag`, `queryFilter` | Evidence: the field label, trigger filter id, providers read and the filter they were read with. |

Write the id in the shape the destination needs:

- **Action input**: `SINGLE_ID` → a string; `ID_LIST` → an array (omit the key when nothing is
  selected; never `[]`).
- **Trigger filter**: always a literal array of **quoted** ids, even for one value
  ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.1–4.2).
- **Payload field in a condition**: compare ids with `stringContains([...];var(...))`
  ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)). `ARRAY_ELEMENT_ID` conditions on the array's element field.

## Status — what you may conclude

| `status` | Do this |
| --- | --- |
| `RESOLVED` | `options` is complete. One clear match → use its id. Several plausible matches → ask the user which one. No match → say it was not found, list what exists, and ask. An empty list means none exist for this query. |
| `NEEDS_PARENT` | Pick the parent in `dependsOn` first (its own field is in the response), then call again with `selectedValues: {"<parent path>": "<parent id>"}`. A child with the right name under another parent is not a match. |
| `INCOMPLETE` | The list is truncated (`statusReason` says why). An entity missing from it **may still exist** — never conclude absence. Page through a vertical API from [Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2, or ask the user for the exact entity. |
| `FAILED` | The options are **unknown**, not empty. Never invent an id. Ask the user, or use a vertical API from [Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2. |
| `NOT_REFERENCEABLE` | The field holds an id but no condition can reference it. Do not use it. |

A non-empty top-level `warnings[]` usually means a dynamic schema could not be loaded; fields it
would add are missing from `fields`, so their absence proves nothing.

Errors: an unknown trigger or action, or an automation you cannot read (including one that exists
only as an unpublished draft), returns `NOT_FOUND`. `INVALID_ARGUMENT`: `actionId` names an unknown
step or one that is not `APP_DEFINED` (a condition, delay…), `actionId` without `automationId`, or
both forms in one request.

## Examples

### Unsaved trigger

Scope a Wix Forms trigger to the form the user named ("Consultation request"):

```json
{
  "trigger": {
    "appId": "225dd912-7dea-4738-8688-4b8c6955ffc2",
    "triggerKey": "wix_form_app-form_submitted"
  }
}
```

```json
{
  "fields": [
    {
      "path": "formId",
      "location": "TRIGGER_FILTER",
      "title": "Form",
      "filterId": "<form-filter-id>",
      "providerKeys": ["formAppSelectionProvider"],
      "valueShape": "SINGLE_ID",
      "maxItems": 1,
      "status": "RESOLVED",
      "options": [
        { "id": "<form-id-1>", "name": "Consultation request", "providerKey": "formAppSelectionProvider" },
        { "id": "<form-id-2>", "name": "Newsletter signup", "providerKey": "formAppSelectionProvider" }
      ]
    }
  ],
  "trigger": { "appId": "225dd912-7dea-4738-8688-4b8c6955ffc2", "triggerKey": "wix_form_app-form_submitted" },
  "warnings": []
}
```

Save `"<form-id-1>"` in the `formId` filter as `["<form-id-1>"]`, then call again with
`"selectedValues": {"formId": "<form-id-1>"}` to see payload fields that exist only for that form.

### Saved step

List an existing step's selector fields — its saved selections are already applied:

```
GET /v1/list-selector-options/<automation-id>/<action-id>
```

To preview the stages of a different pipeline before you Update, override the saved value
(`POST /v1/list-selector-options`):

```json
{
  "automationId": "<automation-id>",
  "actionId": "<action-id>",
  "selectedValues": { "pipelineId": "<other-pipeline-id>" }
}
```

Both return the step's `fields` and `"action": {"appId": "…", "actionKey": "…"}`.

Record `{field path, id, name}` for each selection so the user can review it.

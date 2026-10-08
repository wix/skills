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
| List Selector Options | `POST /v1/list-selector-options` | Site-scoped. The **Set Up Automations** scope (`AUTOMATIONS.AUTOMATION_READ`) plus the method's own `automations:v1:automations_skill:list_selector_options`. |

The public base URL will be listed here once the route is published. Until then, call it only
through a binding your tools already expose for it; otherwise use a vertical API from
[Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2 or ask the user. Never guess a gateway URL.

The call runs with **your** identity: it returns only entities your token can read and grants no
new access.

## When and how to call it

1. Call it **once per trigger or action you configure**, before writing its filters, inputs or
   the conditions that compare its payload ids. Pass exactly one of
   `trigger: {appId, triggerKey}` or `action: {appId, actionKey}`.
2. For each returned field, match the user's wording to `options[].name` and save
   **`options[].id` exactly as returned** (not always a uuid — label keys look like
   `custom.vip`). Never save a name.
3. When you change a selection that another field or the dynamic schema depends on, **call
   again** with the new `selectedValues` and re-pick the dependent fields.

Request fields:

- `selectedValues` — values already chosen, keyed by field `path` (a trigger filter may also be
  keyed by its `filterId`). Each value is an id or a list of ids. One namespace shared by trigger
  filters, payload fields and action inputs; at most 100 keys. These values also load the
  trigger's dynamic payload schema and the action's dynamic input schema, so fields that exist
  only for a selection appear once their parent is selected.
- `fieldPaths` — optional subset of paths to return. Empty returns every field.

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
would add are missing from `fields`, so their absence proves nothing. An unknown trigger or action
returns `NOT_FOUND`.

## Example

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
  "warnings": []
}
```

Save `"<form-id-1>"` in the `formId` filter as `["<form-id-1>"]`, then call again with
`"selectedValues": {"formId": "<form-id-1>"}` to see payload fields that exist only for that form.

Record `{field path, id, name}` for each selection so the user can review it.

---
name: "Automations Action Schema APIs"
description: "Request an action's dynamic input schema and merge it the way the builder does, read a saved step's accumulated payload schema, and copy a step's input mapping, with worked requests and responses."
---

# Action Schema APIs — worked requests

Worked examples for the schema calls you make while configuring a step. Rules for when each schema
applies live in [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §4 and [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4; this guide shows the requests and how
to combine the responses.

**TL;DR**

- **Get Action Dynamic Input Schema** — after setting a field marked `updateSchemaOnChange: true`;
  merge the response into the static schema the way the builder does (§1).
- **Get Automation Action Schema** — the accumulated payload schema a saved step can read with
  `var()`; use it on saved automations, and to check paths after Create / Update (§2).
- **Copy Input Mapping** — duplicate an existing non-email step's mapping with its per-action
  unique values regenerated (§3).

---

## 1. Get Action Dynamic Input Schema

[Reference](https://dev.wix.com/docs/api-reference/business-management/automations/actions/action-catalog/get-action-dynamic-input-schema) ·
`POST https://www.wixapis.com/v1/actions/dynamic-input-schema` · site-scoped (`wix-site-id`) ·
Set Up Automations scope.

Call it when a property with `updateSchemaOnChange: true` has a value (and again whenever such a
value changes, or a newly revealed field also carries the flag). Send the mapping so far — it must
contain every field the static schema `requires`.

Request (CMS **Insert item**: choosing the collection reveals its fields):

```json
{
  "appId": "e593b0bd-b783-45b8-97c2-873d42aacaf4",
  "actionKey": "wix_cms-add_data_item_2",
  "inputMapping": { "dataCollectionId": "<collection-id>" }
}
```

Response — `inputSchema` and `uiSchema` for the static and dynamic fields (shape illustrative; use
what the call returns):

```json
{
  "inputSchema": {
    "type": "object",
    "required": ["title"],
    "properties": {
      "title": { "type": "string", "title": "Title" },
      "email": { "type": "string", "title": "Email" }
    }
  },
  "uiSchema": {
    "title": { "dynamicValuesOptions": { "enabled": true } },
    "email": { "dynamicValuesOptions": { "enabled": true } }
  }
}
```

**Merge exactly as the builder does** (static = the runtime action's `inputSchema` and
`interfaceConfiguration.genericOptions.uiSchema`):

- `properties` = static properties, then the dynamic ones over them (a dynamic key replaces a
  static key of the same name);
- `required` = the union of both lists, without duplicates;
- `uiSchema` = static UI schema, then the dynamic one over it, key by key at the top level;
- other top-level keys of the dynamic `inputSchema` (for example `allOf`) are ignored by the builder.

Then map against the merged schema ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.2). For the example above the saved mapping is:

```json
{
  "dataCollectionId": "<collection-id>",
  "title": "{{var(\"contact.name.first\")}}",
  "email": "{{var(\"contact.email\")}}"
}
```

Keep the controlling value in the mapping: the builder re-fetches this schema from the saved mapping
each time the step opens, and drops dynamic keys it no longer receives. Errors:
`GET_DYNAMIC_INPUT_SCHEMA_NOT_IMPLEMENTED` (428) means the action has no dynamic input — use the
static schema; `ACTION_SPI_NOT_FOUND` (404) means the action's provider is not available on the site.

## 2. Get Automation Action Schema — what a saved step can read

> The public route of this method is being published. The path below is pending confirmation;
> until it is listed in the Automations API reference, call it only through a binding your tools
> already expose, and otherwise compute the schema manually ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4).

`GET https://www.wixapis.com/automations-service/v2/automations/schema/{automationId}/{actionId}` ·
site-scoped · Set Up Automations scope.

Response:

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "contactId": { "type": "string", "identityType": "contact" },
      "contact": { "type": "object", "properties": { "email": { "type": "string" } } },
      "createTask-1": { "type": "object", "properties": { "taskId": { "type": "string" } } },
      "setVariable": { "type": "object", "properties": { "discount": { "type": "number" } } }
    }
  }
}
```

`schema` is the accumulated payload schema at that action: the trigger payload (with its dynamic
schema), identity enrichment, every ancestor action's output (with dynamic outputs) under its
namespace, and variables — the same object [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4 tells you to compute. Every
`var("<path>")` in that step must resolve to a property path in it.

It needs a **saved** automation and an **existing** `actionId`, so:

1. **Existing automation (update):** call it for the step you are editing — or, for a new step, for
   the existing step it will follow, whose schema plus that step's own output is what the new step
   reads — and map only paths present in `schema`.
2. **After Create (INACTIVE) or Update:** call it for every step that uses `var()` and confirm each
   referenced path exists. A missing path is a broken mapping: fix it, Validate, and Update again.
3. **Drafting an unsaved automation:** there is nothing to call yet — compute the schema manually
   ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4).

## 3. Copy Input Mapping

[Reference](https://dev.wix.com/docs/api-reference/business-management/automations/actions/action-catalog/copy-input-mapping) ·
`POST https://www.wixapis.com/v1/actions/copy` · Set Up Automations scope.

What the builder calls when a user duplicates a step: the action's provider regenerates values that
must stay unique per step; actions without that support return the mapping unchanged.

```json
{
  "appId": "<appId>",
  "actionKey": "<actionKey>",
  "inputMapping": { "...": "the existing step's inputMapping" }
}
```

Response: `{"inputMapping": {...}}` — use it as the new step's mapping, with a fresh action id and
namespace. Use it when a request duplicates an existing step (for example the tail of a branch,
[Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §2). A **Send an email** step is the exception: initialize each new email
with its own Generate Action Input Mapping call ([Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) §1), never by copying.
`ACTION_SPI_NOT_FOUND` (404): the action's provider is not available.

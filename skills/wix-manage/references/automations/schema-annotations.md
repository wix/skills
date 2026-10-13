---
name: "Automations Schema Annotations"
description: "Look up every trigger, filter, action input, UI and output schema annotation the builder interprets, the value shape it expects and where the skill explains it."
---

# Schema Annotations — lookup table

Every schema annotation the builder interprets, in one place: where it appears, what it means, the
value the builder expects, and the guide that owns the rule. Rows marked **here** are explained only
in this guide (§2); for the others, follow the link instead of relying on the one-line summary.

**TL;DR**

- Unknown annotation on a field you must fill → look it up below before writing a value.
- `"ui:field": "fieldMapping"` → an object keyed by the field's own sub-properties, plus an
  optional `_order` array (§2.1).
- `_UIRequired` → treat those keys as `required` (§2.2).
- `"ui:field": "SchemaViewer"` / `"TextSectionField"` → display only; never map.
- `"ui:field": "PropertyPicker"` (strict) → exactly one `{{var("<path>")}}` reference (§2.3).

---

## 1. Table

| Annotation | Where | Meaning and expected value | Owner |
| --- | --- | --- | --- |
| `format` (`uuid`, `date-time`, `date`, `email`, `uri`, `number`) | payload, input | Value format; `number` is a numeric string. | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §3, [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §4 |
| `identityType` | payload, input | `contact` / `member`: id of that identity; payload fields gain a root `contact` / `member` object. `visitor`, `user`: plain ids, no enrichment. Input fields with it are auto-mapped by the form — map them yourself. | [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4, [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.2 |
| `wixCustomType` | payload, input | Fixed value shapes (`MONEY` `{value, currency}`, `IMAGE_URL`, `ATTACHMENT`…). | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §3 |
| `itemsSelectionConfiguration` (`providerKey`, `tag`) | payload, input | The field holds an entity id of that kind. | [Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §1 |
| `futureDate: true` | payload | Date-time field that supports a "before the event" offset. | [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §5 |
| `hidden: true`, `examples` | payload | Not shown in pickers but readable; `examples` show real value shapes. | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §3 |
| `defaultConditionedProperty` | payload array | The only array item property a visual condition can test. | [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §2 |
| `filters[]`, `valueInput.type: "ENTITY_SELECTOR"`, `entitySelector{…}` | trigger filters | Filterable fields; entity filters take quoted id literals. | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4 |
| `valueInput.reevaluateDynamicSchema: true` | trigger filters | Choosing this filter changes the payload schema (Get Trigger Dynamic Schema). | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5 |
| `implementedMethods.getDynamicSchema` | trigger | Payload grows with the filter choice. | [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5 |
| `overrideSchema` / `overrideOutputSchema` | trigger / action | User-defined payload or output; allowed only on a fixed list. | [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3 |
| `required`, `oneOf` / `enum` / `const`, `default` | input | Must map; enum constants only; defaults are written by the form. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3, §5.2 |
| `if` / `then` / `dependencies` | input | Conditional fields: set the toggle and its dependent field together. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3 |
| `_UIRequired` | input object | Extra required keys of that object. | **here** §2.2 |
| `_itemTitle`, `_itemSubtitle` | input array items | Labels of array items in the form; no effect on the value. | — |
| `updateSchemaOnChange: true` | input property | Setting it reveals more inputs: Get Action Dynamic Input Schema. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §4, [Automations Action Schema APIs](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-schema-apis) §1 |
| `dynamicValuesOptions` (`enabled`, `strict`, `inline`) | UI schema | `enabled` → `{{…}}` allowed; `strict` → expression must have the field's exact type. Without it the field is literal only. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3, [Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §4 |
| `"ui:widget": "EntitySelector"` + `entitySelectorOptions` | UI schema | Entity picker; value = id or array of ids. | [Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §1 |
| `"ui:field": "AudienceSelector"` + `audienceSelectorOptions` | UI schema | Audience value `{"providers": [...]}`. | [Automations Audience Selector Inputs](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-audience-selector-inputs) |
| `"ui:field": "fieldMapping"` + `fieldsMappingOptions` | UI schema | Object of mapped sub-fields plus optional `_order`. | **here** §2.1 |
| `"ui:field": "PropertyPicker"` / `"FormOrPropertyPickerField"` + `propertyPickerOptions` / `formOrPropertyPickerOptions` (`strict`) | UI schema | One payload reference picked from the step's schema. | **here** §2.3 |
| `"ui:field": "SchemaViewer"` | UI schema | Display-only preview of the payload; never map it. | **here** §2.4 |
| `"ui:field": "TextSectionField"` | UI schema | Display-only text; never map it. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3 |
| `"ui:widget": "hidden"`, `ui:readonly` | UI schema | Keep the schema `default`. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3 |
| `ui:order`, `ui:orderOverride`, `ui:placeholder`, `ui:widget` (`radio`, `textarea`…) | UI schema | Presentation only. | — |
| `interfaceConfiguration.type` (`GENERIC`, `WIDGET_COMPONENT`) | action | Form from the schemas vs. the app's own widget. | [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3 |

## 2. Annotations explained here

### 2.1 `"ui:field": "fieldMapping"`

The field is an object whose `properties` are destination fields (for example **Create a contact**,
`contacts-create_contact`: `contact.firstName`, `lastName`, `email`, `phone`). The builder opens a
mapping table: each row maps one destination field to a value, using that sub-field's own UI schema
(`dynamicValuesOptions` → `{{…}}` allowed).

Value: one key per mapped destination field, plus `_order` — the mapped keys in display order. The
builder writes `_order` on every edit and reads it only to order the rows; a value without it is
also accepted.

```json
{
  "contact": {
    "firstName": "{{var(\"firstName\")}}",
    "email": "{{var(\"email\")}}",
    "_order": ["firstName", "email"]
  },
  "duplicationStrategy": "UPDATE_CONTACT"
}
```

- Keys: only the object's own `properties` (and `_order`). Map only fields with a real source; the
  object's `required` sub-fields, if any, must be present.
- `_order` lists exactly the mapped keys, no others.
- `fieldsMappingOptions.hideRefreshButton` is presentation only.
- Don't add a Create a contact step when the trigger already carries a contact
  ([Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §4).

### 2.2 `_UIRequired`

An array of property names on an object schema (often an array's `items`). The builder appends them
to that object's `required`, so the form flags the step as missing information until they are set.
Treat them exactly like `required`.

Example — **Send HTTP request** (`webhooks-action`): each `customParams` item has
`"required": ["key"]` and `"_UIRequired": ["value"]`, so every body parameter needs both:

```json
{
  "url": "https://example.com/hooks/new-contact",
  "method": "POST",
  "hasCustomParams": true,
  "customParams": [{ "key": "email", "value": "{{var(\"contact.email\")}}" }]
}
```

### 2.3 `"ui:field": "PropertyPicker"` and `"FormOrPropertyPickerField"`

The user picks one property from the step's aggregated schema ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4), filtered by
the field's `wixCustomType`, `identityType` or type and format. The stored value is exactly one
reference: `{{var("<path>")}}` — no surrounding text, no functions. With `strict: true` the picked
property must have the same schema as the field (type, format, and for objects and arrays a
compatible structure).

### 2.4 `"ui:field": "SchemaViewer"`

Shows a preview of the payload (for example the HTTP request body preview, `schemaPreview`). It never
writes a value: leave the property out of `inputMapping`.

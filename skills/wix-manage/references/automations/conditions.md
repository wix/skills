---
name: "Automations Conditions"
description: "Configure visual and code conditions while preserving boolean intent, comparison boundaries and builder editability."
---

> **Stage scope:** this stage covers only what [Build and Manage Wix Automations](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-and-manage-wix-automations) lists; do not perform anything marked "Later stages only", and follow the instruction attached to each guide marked "not yet published".

# Conditions — Visual Conditions and Code Conditions

**TL;DR**

- `CONDITION` must be something the builder's condition panel can draw: exactly ONE group in `orExpressionGroups`, `operator` `"AND"` or `"OR"`, 1–20 `booleanExpressions`. Each expression is ONE function from §2 (optionally inside `not(…)` — only the negatable ones), with the field as `var()` and a **literal** value.
- The panel re-writes every expression the moment the user opens the step. A shape outside §2 is dropped, mis-read or silently changed — restructure (§4) or use `CODE_CONDITION` (§5).
- Entity fields hold ids: `stringContains(["<id>"];var("field"))`, never a display name.
- String literals are URI-encoded ([Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §1); date literals may be encoded or not (§2).
- `truePostActionIds` / `falsePostActionIds`: at most ONE id each; branch children have this condition as their only parent ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model)).

---

## 1. Shape

```json
{
  "id": "<uuid-1>",
  "type": "CONDITION",
  "namespace": "CONDITION-1",
  "displayName": "VIP order?",
  "conditionInfo": {
    "orExpressionGroups": [
      {
        "operator": "AND",
        "booleanExpressions": [
          "{{stringEq(var(\"customer_tier\");\"premium\")}}",
          "{{numberGt(var(\"order_count\");5)}}"
        ]
      }
    ],
    "truePostActionIds": ["<uuid-2>"],
    "falsePostActionIds": []
  }
}
```

MUST:

- Exactly one entry in `orExpressionGroups` with an explicit `operator` (`"AND"` = all hold, `"OR"` = any). Several groups are flattened into one on first open and their logic is lost; a missing `operator` is saved as `OR`.
- 1–20 expressions — an empty group makes the builder loader hang; the panel allows at most 20 (more than 20 → a code condition).
- One comparison per entry; never combine with `and(…)`/`or(…)` inside an entry.
- Every `var()` path exists in THIS step's aggregated schema (trigger + ancestors; [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4). A path the panel can't find marks the step invalid and its canvas label stays empty.
- No whitespace outside string literals (`{{ stringEq(…` makes the function unreadable).
- Only `conditionInfo` on the step; both branch arrays present; never both empty (dead end). Set a short `displayName`.

## 2. Operator table (the only shapes that round-trip)

The builder ships two panel layouts (a dropdown and a newer property picker) and users get either. Everything below survives both; when a user edits a condition, the property picker may rewrite `arraySome/arrayEvery` into `arrayIncludes*` forms — that is outside your control; never write `arrayIncludes*` yourself (see the list below).

Classify the field from its schema, in this order: `format: "date"` → date · `format: "date-time"` → date-time · `type: "string"` + `format: "number"` → number · has `enum` (or string/number `oneOf` of consts) → enum / number-enum · `integer` → number · string with `itemsSelectionConfiguration` (`providerKey` or `tag`) → item selection · otherwise its `type`.

| Field type          | Operator (UI)                | Expression (`¬` = may wrap in `not(…)`)                                                                                   |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| string              | is / is not ¬                | `stringEq(var("f");"v")`                                                                                                  |
|                     | contains / doesn't contain ¬ | `stringHasSubString(var("f");"v")`                                                                                        |
| number              | equals / not equals ¬        | `numberEq(var("f");5)`                                                                                                    |
|                     | greater / less than          | `numberGt(var("f");5)` · `numberLt(var("f");5)`                                                                           |
| date                | is / is not ¬                | `dateEq(var("f");"2026-12-25")`                                                                                           |
|                     | before / after               | `dateBefore(…)` · `dateAfter(…)`                                                                                          |
| date-time           | is / is not ¬                | `dateTimeEq(var("f");"2026-12-25T10:00:00Z")`                                                                             |
|                     | before / after               | `dateTimeBefore(…)` · `dateTimeAfter(…)`                                                                                  |
| boolean             | is true / is false           | `boolEq(var("f");true)` · `boolEq(var("f");false)`                                                                        |
| enum (string)       | is / is not ¬                | `stringEq(var("f");"PAID")`                                                                                               |
|                     | is one of / is not one of ¬  | `stringContains(["PAID","PENDING"];var("f"))` — list FIRST                                                                |
| number enum         | is ¬ / is one of ¬           | `numberEq(var("f");2)` · `numberContains([1,2];var("f"))`                                                                 |
| item selection (id) | is one of / is not one of ¬  | `stringContains(["<id-1>","<id-2>"];var("f"))`                                                                            |
| array of primitives | includes any of / doesn't ¬  | `arraySome(var("f");contains(["a","b"];$_))`                                                                              |
|                     | includes only                | `arrayEvery(var("f");contains(["a","b"];$_))`                                                                             |
|                     | includes all of              | one `arraySome(var("f");contains(["a"];$_))` entry per value in an `AND` group (see below)                                |
| array of objects    | same as array of primitives  | `var("f")` → `arrayMap(var("f");"<item.property>")` — ONLY the property named by the array's `defaultConditionedProperty` |
| any type            | is empty / is not empty ¬    | `isEmpty(var("f"))`                                                                                                       |

NEVER:

- `not(…)` around anything not marked ¬ (`numberGt`, `numberLt`, `date*Before/After`, `boolEq`, `arrayEvery`) — the panel loses the operator. Negating `boolEq(…;true)` can use `boolEq(…;false)`. NEVER negate a strict comparison by swapping `Gt`/`Lt` or Before/After: `not(x > N)` means `x <= N`, including equality. Preserve that boundary with comparison + equality in a single `OR` group when the full logic fits (§3), or use CODE_CONDITION. For example, "not more than 100" includes 100; "not before a date" includes that date. Do not invent an inclusive visual operator.
- `arrayIncludesAnyOf/AllOf/Only(…)` — the dropdown layout reads all three as "includes only" and re-saves them with that meaning.
- The collection-first `arrayEvery(["a","b"];contains(var("f");$_))` — the property-picker layout cannot read it. For "includes all of" use one `arraySome` entry per value with `operator: "AND"`; if the group must be `OR`, chain conditions (§4) or use code.
- `arrayMap` to any property other than `defaultConditionedProperty` (or on an array without one) — the dropdown layout re-points it or fails to save. The path is relative to the item (`"service.id"`) and must exist in the item schema; otherwise → `CODE_CONDITION`.
- Anything around the field (`lower(var("f"))`, `month(var("d"))`), `var()` or `now()` as the value, two fields compared, `eq`/`gt`/`contains` at top level, `isEmptyString`, `startsWith`, `if`, `and`/`or`. These are valid formulas but not drawable.

Literal rules (the value inputs reject or rewrite others):

| Value   | Rule                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| string  | ≤ 2500 chars; must not contain `"` or `'` (the input flags it) — test a quote-free part with `stringHasSubString`, or use code                          |
| number  | Unquoted; between −100000000 and 100000000; no decimals below 1 (`0.5`, `.5`, `-0.5`), leading zeros or exponents — they don't parse → use code         |
| boolean | `true`/`false` unquoted (a quoted `"yes"` is re-saved as a broken bare word)                                                                            |
| enum    | Exactly one of the schema's `enum`/`const` values, same case                                                                                            |
| date    | `"YYYY-MM-DD"`; date-time: full ISO with zone (`"2026-12-25T10:00:00Z"`); never relative (`now()`) — relative windows → code or a set-variables boolean |

Date values and time zone: the panel writes a picked date/time as wall-clock time in the **site
time zone** with its offset (a date → that day's 00:00 site time), and URI-encodes it like every
literal (`"2026-12-31T23%3A59%3A00%2B02%3A00"`). Its reader decodes first, so an encoded and an
unencoded ISO literal load the same (a `"YYYY-MM-DD"` literal is unchanged by encoding). Treat a
calendar date the user names as a site-time-zone date: "valid until Dec 31" → compare with the end
of that day in the site's zone (Site Properties `timeZone`, [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4).

Semantics: `stringEq`/`stringHasSubString`/`stringContains` are case-insensitive. No ≥/≤: for integers `numberGt(var("f");N-1)`; otherwise `numberGt` + `numberEq` in an `OR` group (only if the group may be `OR`) or code. `$_` appears bare, only inside `contains(…)`.

## 3. Entity-id fields

A field with `itemsSelectionConfiguration` (service, form, product, label, coupon, location, pipeline stage, …) carries an **id or key**. A display name passes validation and silently never matches. Get ids from the vertical's public API or the user (Automations Entity and Provider Configuration (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations))). Ids are whatever that API returns — label keys look like `custom.vip-customers`, not uuids.

- Scalar field `service_id`: `{{stringContains(["<service-id>"];var("service_id"))}}`
- Property in an array of objects `lineItems[].rootCatalogItemId`: `{{arraySome(arrayMap(var("lineItems");"rootCatalogItemId");contains(["<product-id>"];$_))}}` — visual only when that property is the `defaultConditionedProperty`; else code: `(payload.lineItems || []).some(i => ids.includes(i.rootCatalogItemId))`
- The field is an array of ids `labelKeys.items`: `{{arraySome(var("labelKeys.items");contains(["<label-key>"];$_))}}`

Never synthesize `[0]`, `.0`, `firstItem` or a dotted path through an array. "The order contains product X" is a whole-array test — keep it one. If the user needs one specific item, clarify. If you cannot obtain the ids, the entity set is **unknown, not empty**: tell the user and ask which entity to use.

## 4. When the logic doesn't fit one group

- **`(A AND B) OR C` / mixed AND+OR / anything needing more than one group** → one `CODE_CONDITION` (§5) with exactly that logic — the default; it keeps a single true/false branch. Chaining two visual conditions (`A AND B` → false: condition `C`) is an alternative only when the true branch is one small step, since that step must then be duplicated (tree only — duplicate, never join; [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model)). Never write several `orExpressionGroups`.
- **Starts / ends with** → No operator. "contains" (`stringHasSubString`) when close enough (say so), or code for the exact test
- **Two fields compared, computed values, relative dates, month/day of a date (birthdays), string length, decimals below 1, any §2 NEVER** → `CODE_CONDITION` (§5), or compute a boolean with a set-variables step ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)) and test it with `boolEq(var("setVariable.<key>");true)`
- **Optional field ("if phone is present it must contain 555")** → Two chained conditions (`not(isEmpty(…))`, then the test), or code

Prefer a visual `CONDITION` when it expresses the logic exactly — users can keep editing it. Don't force complex logic into it; if the user insists, explain what can't be drawn. Never say the logic is impossible when code can do it.

## 5. `CODE_CONDITION`

```json
{
  "id": "<uuid-3>",
  "type": "CODE_CONDITION",
  "namespace": "CONDITION-2",
  "codeConditionInfo": {
    "snippet": {
      "language": "JAVASCRIPT",
      "code": "/**\n * @param {Payload} payload - Automation payload with trigger and action data.\n * @returns {boolean} whether the method will continue with then or else branch.\n */\nexport default function (payload) {\n  const b = payload.contact?.birthdate;\n  if (!b) return false;\n  const d = new Date(b), n = new Date();\n  return d.getMonth() === n.getMonth() && d.getDate() === n.getDate();\n}"
    },
    "dynamicVariableExpressions": ["{{var(\"contact.birthdate\")}}"],
    "truePostActionIds": ["<uuid-4>"],
    "falsePostActionIds": []
  }
}
```

Minimal array check (the code reads only the declared array):

```json
"displayName": "Check if order has 3+ items",
"codeConditionInfo": {
  "snippet": { "language": "JAVASCRIPT",
    "code": "/**\n * @param {Payload} payload\n * @returns {boolean}\n */\nexport default function (payload) {\n  return (payload.lineItems || []).length >= 3;\n}\n" },
  "dynamicVariableExpressions": ["{{var(\"lineItems\")}}"],
  "truePostActionIds": ["<uuid-2>"], "falsePostActionIds": [] }
```

MUST:

- `type: "CODE_CONDITION"` with only `codeConditionInfo`; `namespace` follows the condition pattern (`CONDITION-N`, unique).
- `language` is always `JAVASCRIPT`. The code default-exports a synchronous `function (payload)` with exactly one parameter, starts with the JSDoc block the builder's template has (`/** @param {Payload} payload … @returns {boolean} … */` — required), and returns an explicit boolean. No imports, no network calls. Whole code ≤ 1000 characters; newlines escaped in JSON.
- Guard every access (`?.`, `|| []`, `|| 0`, `typeof`, `try/catch` for deep paths); a missing field must not throw.
- Access — the same paths as the aggregated schema ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4): `payload.field`, `payload['field-with-hyphens']`, action outputs `payload['<namespace>'].field`, `payload.contact.email`, `payload.setVariable['<key>']`. JS may index arrays and use `.some/.every/.filter` and `Date` math; `new Date()` gives the current time for calendar checks.
- `dynamicVariableExpressions`: one `{{var("<path>")}}` for EVERY field the code reads — the runtime hydrates ONLY these, so an undeclared field is `undefined`. Arrays: declare the array itself (`payload.lineItems.some(…)` → `{{var("lineItems")}}`), never items or indexes; reading an object whole needs the object declared; if a path has no valid `var()`, declare its closest valid parent. Never `payload[computedKey]` or the whole `payload`. `[]` only when the code reads no field. Every path must exist in this node's aggregated schema.
- Use it only when the visual panel can't express the logic (array indexing, per-element math, string splitting, date parts, regex — §4).
- Test mentally against a true case, a false case and a payload with the fields missing.

Other special steps (delay, rate limit, set variables, split): [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches).

## 6. Pre-save checklist

- [ ] One group; explicit `AND`/`OR`; 1–20 expressions; no nested `and/or`; no stray whitespace.
- [ ] Each expression is a §2 row for the field's classified type; `not()` only on ¬ rows; no `arrayIncludes*`, no collection-first `arrayEvery`.
- [ ] Value literal obeys the literal rules (no quotes in strings, no `0.x` numbers, exact enum values, unquoted booleans).
- [ ] Every `var()` path exists in this step's aggregated schema; `arrayMap` only onto `defaultConditionedProperty`.
- [ ] Entity fields compared to ids (§3); no synthetic array paths.
- [ ] String literals URI-encoded; JSON quotes escaped.
- [ ] Branch arrays ≤1 id each, children single-parent, not both empty; `namespace` unique.
- [ ] Anything else → restructured (§4) or a `CODE_CONDITION` meeting §5.
- [ ] Validate Automation returns no errors for this step.

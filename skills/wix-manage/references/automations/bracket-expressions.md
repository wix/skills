---
name: "Automations Mapping Expressions"
description: "Write builder-compatible automation mapping expressions, literals and data references."
---

# Bracket Expressions (Formulas) — `{{…}}`

**TL;DR**

- `{{expression}}`; fields via `var("dotted.path")` (double quotes, one argument); arguments separated by `;`; string literals in double quotes and URI-encoded.
- In formula fields (action inputs, set-variable values, delay due dates) use ONLY the builder function list in §2. Conditions and trigger filters have their own, stricter vocabularies — [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions), [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.2.
- The builder type-checks every argument and the arity (§2): `eq`/`gt`/`gte`/`lt`/`lte` take NUMBERS only (strings → `stringEq`, dates → `date*`); `if()`'s first argument is boolean. There are no operators.
- No array element access in any form. Project with `arrayMap(array;"path")`, aggregate with `array*`. A single-value field can never be filled from an array — ask the user which item.
- Only data from the step's aggregated schema (trigger + ancestors) is in scope ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4).

---

## 1. Syntax

| Form                                                | Example                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Literal                                             | `{{"text"}}`, `{{10}}`, `{{true}}`, `{{["a","b"]}}`                          |
| Variable                                            | `{{var("contact.name.first")}}`                                              |
| Function                                            | `{{concat(var("a");" - ";var("b"))}}`                                        |
| Text with embedded expressions (string fields only) | `Hi {{var("contact.name.first")}}, your total is {{toString(var("total"))}}` |

MUST:

- Every field access is `var("path")` with ONE argument — `{{fieldName}}` is not supported.
- Double quotes only (`var('x')` is an unknown variable to the builder). In JSON escape them: `"{{var(\"contact.email\")}}"`.
- `;` between arguments, no leading/trailing/double `;`, balanced parentheses. No whitespace outside string literals — `{{ concat(…` or `sum( 1;2)` is unreadable to the builder.
- Numbers: plain decimal literals (`5`, `-3`, `12.5`). Never `0.5`, `.5`, `-0.25`, `05` or `1e3` — the builder's parser rejects them (conditions, filters, delays and rate limits stop loading). Write `divide(1;2)` instead.
- Path segments may contain hyphens (`var("triggered-emails-1.messageId")`); a space inside a segment is invalid.
- **URI-encode every string literal inside `{{…}}`** exactly as `encodeURIComponent` does — this is how the builder's panels and the platform store them: `"a@b.com"` → `"a%40b.com"`, `"50%"` → `"50%25"`, `"New York"` → `"New%20York"`, `"&"` → `"%26"`. Letters, digits and `- _ . ! ~ * ' ( )` stay as they are, so uuids and `arrayMap` paths are unchanged. Do NOT encode `var("…")` paths (except in trigger filters, where the filter panel encodes the path too — [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration)) or text outside `{{…}}`, nor a date-time literal in a formula field (§2). Decode literals when you read an existing automation. Action formula fields display literals as stored, so in string fields keep fixed text outside `{{…}}` (`Hi {{var("contact.name.first")}}, welcome!`) rather than in `concat("…")`.

Prefix rules: trigger fields have no prefix; action outputs `"<namespace>.<field>"` (namespace = the step's `namespace`, e.g. `createTask-1`); set variables `"setVariable.<key>"`; identity enrichment `"contact.…"` / `"member.…"`. `siteInfo.*` is not available — don't reference it.

## 2. Functions the builder renders in formula fields (complete list)

- **Math**: `sum(n;n;…)` · `subtract(n;n)` · `multiply(n;n;…)` · `divide(n;n)` · `average(n;…)` · `min(n;…)` · `max(n;…)` · `median(n;…)` · `mod(n;n)` · `round(n;decimals)` · `abs(n)` → number · `eq(n;n)` · `gt(n;n)` · `gte(n;n)` · `lt(n;n)` · `lte(n;n)` → boolean (numbers only)
- **Array**: `arraySize(a)` · `arraySum(a)` · `arrayMultiply(a)` · `arrayAverage(a)` · `arrayMin(a)` · `arrayMax(a)` · `arrayMedian(a)` → number · `arrayMap(a;"item.path")` → array
- **Text**: `concat(s;s;…)` · `substring(s;start;length)` (0-based) · `lower(s)` · `upper(s)` → string · `stringLen(s)` → number · `stringEq(a;b)` · `stringHasSubString(s;sub)` · `startsWith(s;prefix)` · `endsWith(s;suffix)` · `isEmptyString(s)` → boolean
- **Date**: `hour(dt)` · `minute(dt)` · `year(d)` · `month(d)` · `day(d)` → number · `weekDay(d)` → lowercase day name · `dateEq/dateBefore/dateAfter(d;d)` (calendar date) · `dateTimeEq/dateTimeBefore/dateTimeAfter(dt;dt)` → boolean · `addToDate(d;years;months;days)` · `subtractFromDate(d;years;months;days)` → date-time · `now()` → date-time string
- **Format**: `toString(v)` → string · `toNumber(v)` → number
- **Logic**: `if(bool;then;else)` · `and(b;b;…)` · `or(b;b;…)` · `not(b)` · `isEmpty(v)` (any value, incl. arrays) → boolean (`if` → its branches' value)

Arity (write exactly these counts; the builder flags missing and extra arguments for fixed-arity functions): `var`, `not`, `toString`, `toNumber`, `upper`, `lower`, `stringLen`, `abs`, `isEmptyString`, `isEmpty`, every `array*` aggregate = 1 · comparisons, `round`, `subtract`/`divide`/`mod`, `arrayMap` = 2 · `if`, `substring` = 3 (always pass the length) · `addToDate`/`subtractFromDate` = 4 · `now` = 0 · `and`/`or`/`concat`/`sum`/`multiply` ≥ 2 · `min`/`max`/`average`/`median` ≥ 1.

Argument types the builder enforces (convert with `toString()`/`toNumber()`):

| Parameter                                                                     | Accepts                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| number (math, comparisons, `substring` offsets, date offsets)                 | number literal, number/integer var, number-returning function; wrap a string `format: number` var (money `value`s) in `toNumber()` — the platform rejects it bare |
| string (text functions, `concat`)                                             | string literal/var/function — never a number or boolean (wrap in `toString()`)                                                                                    |
| boolean (`if` arg 1, `and`, `or`, `not`)                                      | comparison, boolean var, `isEmpty`/`isEmptyString`/`startsWith`/…                                                                                                 |
| date (`year`, `month`, `day`, `weekDay`, `dateEq/Before/After`, `addToDate`…) | a var whose schema has `format: date` or `date-time`, a `"YYYY-MM-DD"` literal, or a function (`now()`, `addToDate(…)`)                                           |
| date-time (`hour`, `minute`, `dateTimeEq/Before/After`)                       | a var with `format: date-time`, a function, or an ISO date-time literal — a `format: date` var or plain-string var is rejected                                    |
| array (`array*` functions, `isEmpty`)                                         | array var or `arrayMap(…)`; no other function takes an array argument                                                                                             |

An encoded date-time literal (`"2026-12-25T10%3A00%3A00Z"`) is not recognized as a date in a formula field — pass a `"YYYY-MM-DD"` literal or a function, or make the whole field a plain ISO value (§4). This exception is for formula fields only: in a CONDITION the panel itself writes date-time literals encoded and reads both forms ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §2).

Semantics: `stringEq` and `stringHasSubString` are case-insensitive (normalize with `lower()` if it matters). Booleans: use the value directly (`if(var("isVip");…)`, `not(var("isVip"))`), never `eq(var("isVip");true)`.

**Never use in a formula field** (the builder flags them as unknown functions):
`toEpoch`, `arrayFilter`, `hasSubstring`, `textWithExpressions`, `contains`, `arraySome`, `arrayEvery`, `arrayIncludesAnyOf/AllOf/Only`, `stringContains`, `numberContains`, `boolEq`, `numberEq/numberGt/numberGte/numberLt/numberLte`. (Several of these ARE the condition vocabulary — [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §2 — and `contains`/`arraySome` the trigger-filter vocabulary.)

**Do not exist** (never guess): `replace`, `replaceAll`, `trim`, `split`, `join`, `indexOf`, regex/`match`, `ceil`, `floor`, `parseInt`, `parseFloat`, `random`, `filter`, `reduce`, `sort`, `switch`, loops, `try/catch`, `coalesce`, `formatDate`, `formatNumber`, `formatCurrency`, `titleCase`, `add`, `addDays`, `equals`.

## 3. `if()` needs a boolean first argument

Valid first arguments: a comparison (`eq`, `gt`, `stringEq`, `dateBefore`, `startsWith`, …), a genuinely boolean field, or `and`/`or`/`not`/`isEmptyString`/`isEmpty`.

In number and boolean target fields BOTH branches must return exactly the field's type — a number literal/var/function for a number field. A nested `if` as a branch counts as "any" and is flagged there: wrap it (`toNumber(if(…))`) or, for booleans, use `and`/`or`. Nested `if` is fine in string fields.

- ✅ `{{if(stringEq(var("status");"active");"Active";"Inactive")}}`
- ✅ fallback: `{{if(isEmptyString(var("contact.name.first"));"there";var("contact.name.first"))}}`
- ❌ `{{if(var("status");…)}}` when `status` is a string · ❌ `{{if("active";…)}}`

## 4. Field-type rules (what the builder accepts per target field)

- **string** — Plain text, one expression, or text mixed with any number of `{{…}}`; no expression may return an array.
- **number / integer (incl. string `format: number`)** — Exactly ONE `{{…}}` covering the whole value, returning a number — or a plain number literal. No surrounding text.
- **boolean** — Exactly ONE `{{…}}` returning boolean — or `true`/`false`.
- **date / date-time** — A plain ISO literal without `{{}}` (`2026-12-25T16:00:00Z`), or ONE expression: a function (`now()`, `addToDate(…)`) or a var. For a `date-time` field the var must be `format: date-time` — wrap a `format: date` var as `addToDate(var("d");0;0;0)`.
- **array / object** — A literal array/object built field by field, or one `{{var("…")}}` of the same shape.
- **field without `dynamicValuesOptions.enabled` in the UI schema** — Literal only — no `{{…}}` ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §3).

A `strict` dynamic field requires the exact return type/format. `skipActionExpression` is `"{{true}}"` or absent.

## 5. Arrays — hard limits

- **No element access**: `var("items[0]")`, `var("items.0.name")`, `var("items[0].name")` are all invalid. Don't invent `firstItem`/`items.id` helper paths either.
- **Projection**: `{{arrayMap(var("order.items");"product.name")}}` — second argument is a quoted literal path (never `$_` or an expression).
- **Aggregates**: `{{arraySize(var("lineItems"))}}`, `{{arraySum(arrayMap(var("lineItems");"totalPrice.value"))}}`. Never `arraySum(var("items.price"))` — a path cannot cross an array boundary.
- **No per-element arithmetic** (price × quantity): sum a per-line total field if one exists, else say it is not derivable.
- **No lists as text**: no `join`; an `arrayMap` result can't go into `concat` or a string field.
- **Single-value field from an array → impossible.** Ask the user which item or use a user-given value; don't retry array-shaped variants.
- Empty arrays make `arraySum/arrayMin/arrayMax/arrayMedian/arrayMultiply` fail at runtime.
- Membership tests (`does the order contain X`) belong in a condition ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §3) or, for complex logic, a code condition.

## 6. Dates

- `date*` compare calendar dates, `dateTime*` instants (argument formats: §2). `addToDate`/`subtractFromDate` offset by whole years/months/days.
- "Within N days before X": `{{dateAfter(var("d");subtractFromDate(var("x");0;0;7))}}`. Day differences can't be computed renderably (no `toEpoch`) — use a DELAY, such a comparison, or a code condition.
- **Annual dates (birthdays)**: never `dateEq(var("birthdate");now())`. Compare month and day: `{{and(eq(month(var("contact.birthdate"));month(now()));eq(day(var("contact.birthdate"));day(now())))}}` — in a formula field; as a condition use code or a boolean set-variable ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §4).
- **Never hardcode a year**; derive it: `{{dateAfter(var("order_date");concat(toString(year(var("order_date")));"-10-31"))}}`. Use `year(now())` only when the rule is about the current calendar year.
- Windows crossing New Year (Dec 26 – Jan 4): `{{or(and(eq(month(var("d"));12);gt(day(var("d"));25));and(eq(month(var("d"));1);lt(day(var("d"));5)))}}`; pick `gt`/`gte` from the user's wording.
- Formatting: `{{toString(month(var("d")))}}/{{toString(day(var("d")))}}/{{toString(year(var("d")))}}` in a string field.

## 7. Conversions

`toString()` numbers/booleans before text functions; `toNumber()` string `format: number` fields before math; neither converts arrays.

## 8. Workarounds that stay renderable

- Strip a known prefix: `{{if(startsWith(var("price");"%24");substring(var("price");1;subtract(stringLen(var("price"));1));var("price"))}}` (`"%24"` is the encoded `"$"`).
- Title case: `{{upper(substring(var("t");0;1))}}{{lower(substring(var("t");1;subtract(stringLen(var("t"));1)))}}`.
- Anything needing replace/split/regex/loops → a code condition (for branching) or tell the user it cannot be computed.

## 9. Self-validation checklist (run on every expression)

1. Parses: balanced `{{}}` and parentheses, `;` separators, double-quoted strings, no whitespace outside strings, no `0.x`/`.x`/exponent numbers.
2. Every function is in §2 (formula fields), the condition table (conditions) or the filter shapes (filters).
3. Arity matches §2 exactly (`substring` 3, `round` 2).
4. Argument types match the §2 table: numbers to math/`eq`/`gt`…, strings to text functions (`toString` numbers), dates with the right `format`, arrays only to `array*`/`isEmpty`; `if` arg 1 boolean and, in number/boolean fields, both branches of the field's type; `arrayMap` arg 2 a literal path.
5. Every `var()` path exists in the aggregated schema of THIS step (ancestors only). If the unknown path has an array prefix (`items.id` where `items` is an array), element access is inexpressible — stop, don't respell.
6. `$_` appears only inside `arraySome`/`arrayEvery` predicates (conditions/filters), bare (never `var($_)` or `$_.x`).
7. Result type fits the target field (§4); no array into a single-value field.
8. String literals URI-encoded; no single quotes.
9. Final gate: Validate Automation returns no mapping errors — it misses some paths and every builder-only rule above, so steps 1–8 are yours.

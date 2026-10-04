---
name: "Automations Delays Variables and Branches"
description: "Configure delay, rate-limit, variable and parallel-branch steps, preserving supported existing step metadata."
---

# Special Actions — Delay, Rate Limit, Code Condition, Set Variables, Split, Naming

**TL;DR**

- DELAY: EITHER relative (`offsetExpression: "{{N}}"` number literal + `offsetTimeUnit`) OR absolute (`dueDateExpression`). Never both.
- RATE_LIMIT: only as THE root action, only one, `maxActivationsExpression: "{{1}}"`, for new steps, identifier = `var()` of a trigger contact/visitor identity field; preserve existing newer identifiers (§2).
- CODE_CONDITION (full spec [conditions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §5): JavaScript `export default function (payload) { return <boolean>; }`, the fallback for logic the condition panel can't render; `dynamicVariableExpressions` MUST list every payload field the code reads — the runtime supplies ONLY those.
- SET_VARIABLES and SPLIT are **alpha: not yet in the public API docs, but supported by the builder**. `setVariablesInfo` / `splitInfo` are not in the public schema, so after Create/Update **read the automation back and confirm the node still has its `*Info`** — if the public API dropped it from an automation **you just created in this task**, tell the user and, with their OK, delete that new automation and rebuild it with a fallback (duplicate steps instead of SPLIT; formulas in the consuming fields instead of SET_VARIABLES). On an **update** of an existing automation, never delete or rebuild the user's steps yourself: stop, report what was dropped, and ask.
- Code variables (`wix_automations-data_manipulation_code`) can't be created through the public API (§4).
- Number literals in `{{N}}` (delay offsets, rate-limit values): whole numbers without leading zeros or spaces — the builder parser can't read `0.5`, `.5`, `01` or `{{ 3 }}` ([bracket-expressions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions) §1).
- No MERGE. SPLIT paths never re-join.
- Every node: shape rules from [automation-model.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) (own `*Info` only, `[]` not omitted, namespaces per §3 there). Expression syntax: [bracket-expressions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions).

---

## 1. DELAY

Pauses the flow before the next step. Place it anywhere except before the root RATE_LIMIT.

Relative — wait N units after the previous step finishes:

```json
{
  "id": "<uuid-1>",
  "type": "DELAY",
  "namespace": "DELAY-2",
  "displayName": "Wait 3 days before follow-up",
  "delayInfo": {
    "offsetExpression": "{{3}}",
    "offsetTimeUnit": "DAYS",
    "postActionIds": ["<uuid-2>"]
  }
}
```

Absolute — wait until a date/time:

```json
{
  "id": "<uuid-1>",
  "type": "DELAY",
  "namespace": "DELAY-2",
  "displayName": "Wait until 1 day before the session",
  "delayInfo": {
    "dueDateExpression": "{{subtractFromDate(var(\"start_date\");0;0;1)}}",
    "postActionIds": ["<uuid-2>"]
  }
}
```

MUST (builder + API):

- Exactly one mode. Relative ⇒ omit `dueDateExpression`. Absolute ⇒ omit `offsetExpression` and `offsetTimeUnit`.
- `offsetExpression` is a whole-number literal in braces (`"{{3}}"`) — no `var()`, no formula, no decimals, never bare `"3"`. Anything else loads in the panel as `1`.
- `offsetTimeUnit` ∈ `MINUTES | HOURS | DAYS | WEEKS | MONTHS` (no seconds). Never write `UNKNOWN_TIME_UNIT` on a DELAY — but an absolute-mode DELAY reads back with `offsetTimeUnit: "UNKNOWN_TIME_UNIT"` filled in by the server; that is expected, don't "fix" it. Panel limits: MINUTES/HOURS 1–999, DAYS 1–365, WEEKS 1–52, MONTHS 1–12 — convert larger values to a bigger unit.
- `dueDateExpression` (≤1000 chars) is ONE of: a bare ISO date-time literal with offset, NOT in braces (`"2025-08-25T13:57:00+03:00"` — the builder's own format), `"{{var(\"<date-time field>\")}}"`, or a single date-time formula (`addToDate(date;years;months;days)`, `subtractFromDate(...)`, `now()`). The field must exist in this node's aggregated schema. A due date already in the past runs the next step immediately.
- `postActionIds` ≤1 id; `[]` ends the flow. To fan out after a delay, point it at a SPLIT.

Choosing:

- "2 hours after signup" → relative. "24 h before the workshop" → absolute with `subtractFromDate`.
- "Run the whole automation X BEFORE the event date" is not a delay — it is the trigger's `scheduledEventOffset` ([schemas-and-scheduling.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §5). Delays only move execution LATER.
- "Send now AND remind before the event" → first step, then an absolute DELAY on the event start (`subtractFromDate(var("start_date");0;0;1)`), then the reminder. A trigger offset would delay the first step too.
- A delay does not change what data is available, but payload values are captured at trigger time and can go stale across long waits.
- Delays on duplicated branches: see the delay-arithmetic rule in [automation-model.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §2.

## 2. RATE_LIMIT ("run once per … every …")

Stops the run when the same identity already triggered it within the window; otherwise continues to its child.

```json
{
  "id": "<uuid-1>",
  "type": "RATE_LIMIT",
  "namespace": "RATE_LIMIT-1",
  "rateLimitInfo": {
    "maxActivationsExpression": "{{1}}",
    "rateLimitDurationExpression": "{{24}}",
    "rateLimitDurationTimeUnit": "HOURS",
    "uniqueIdentifierExpression": "{{var(\"contactId\")}}",
    "postActionIds": ["<uuid-2>"]
  }
}
```

MUST:

1. It is `rootActionIds[0]` and its `postActionIds[0]` is the rest of the flow. Never under a condition, delay, split, or any other step (the builder shows it as the trigger's "frequency" footer; anywhere else the node spins forever). At most one per automation.
2. `maxActivationsExpression: "{{1}}"`. The builder models only "once every X" and rewrites any other value to `{{1}}` as soon as the user opens the panel — never promise "N times per X".
3. For a NEW rate-limit step, `uniqueIdentifierExpression` = exactly `{{var("<path>")}}` where `<path>` is a field of the TRIGGER payload schema (any object depth, not inside an array) annotated `identityType: "contact"` or `"visitor"` for compatibility with both frequency panels. Not enriched props (`contact.email`), not action outputs, not computed or static values (the footer disappears). If the trigger has no such field, do not claim rate limiting is impossible: the newer panel also supports string `member`/`user` identity fields and string `format: uuid` fields without an `identityType`. Availability of that creation UI varies; ask the user to configure the frequency in their builder instead of guessing support. On UPDATE, preserve an existing identifier of these newer types and its expression exactly; do not replace it with contact/visitor, remove the RATE_LIMIT, or treat it as invalid merely because it is outside the conservative creation rule. Confirm its path still exists in the trigger schema; a missing path needs resolution before saving.
4. Duration: `rateLimitDurationExpression: "{{N}}"` (whole number) + `rateLimitDurationTimeUnit` ∈ `MINUTES | HOURS | DAYS | WEEKS | MONTHS`, same per-unit limits as DELAY. "Only ever once" (the panel's unchecked "reset every" box) — only when the user explicitly wants it — is: no `rateLimitDurationExpression` and `rateLimitDurationTimeUnit: "UNKNOWN_TIME_UNIT"`; this is the one place `UNKNOWN_TIME_UNIT` is written (the builder writes exactly this shape). Use `{{24}} HOURS`, not `{{1440}} MINUTES` (the builder rewrites that one on load).

Recipes: once per contact per day → `{{1}}`, `{{24}} HOURS`, contact field. Once per contact ever → `{{1}}`, no duration expression, `UNKNOWN_TIME_UNIT`.

## 3. CODE_CONDITION

The fallback for logic the visual condition panel can't render (array indexing, per-element math, string splitting, date parts, regex). Must-know: `dynamicVariableExpressions` MUST list every payload field the code reads (the runtime supplies ONLY those); the builder's JSDoc header is required; code ≤ 1000 chars. Full spec and examples: [conditions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §5; when to use it: [conditions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §4.

## 4. SET_VARIABLES (alpha)

Computes named values for later steps.

```json
{
  "id": "<uuid-1>",
  "type": "SET_VARIABLES",
  "namespace": "setVariable",
  "displayName": "Set customer greeting and tax",
  "setVariablesInfo": {
    "outputMapping": {
      "3f2b8c1e-7a4d-4e9b-9c21-5d6f0a1b2c3d": "Dear {{var(\"contact.name.first\")}},",
      "8a9e4f20-1b3c-4d5e-8f6a-7b8c9d0e1f2a": "{{multiply(toNumber(var(\"totals.subtotal\"));divide(8;100))}}",
      "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f": "{{gt(toNumber(var(\"totals.total\"));1000)}}"
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "3f2b8c1e-7a4d-4e9b-9c21-5d6f0a1b2c3d": {
          "type": "string",
          "title": "Customer greeting"
        },
        "8a9e4f20-1b3c-4d5e-8f6a-7b8c9d0e1f2a": {
          "type": "number",
          "title": "Tax amount"
        },
        "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f": {
          "type": "boolean",
          "title": "Premium customer"
        }
      },
      "required": [
        "3f2b8c1e-7a4d-4e9b-9c21-5d6f0a1b2c3d",
        "8a9e4f20-1b3c-4d5e-8f6a-7b8c9d0e1f2a",
        "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f"
      ]
    },
    "postActionIds": ["<uuid-2>"]
  }
}
```

MUST:

1. `namespace` is the literal `setVariable`. Downstream: `{{var("setVariable.8a9e4f20-1b3c-4d5e-8f6a-7b8c9d0e1f2a")}}` (the tax amount).
2. `outputMapping` and `outputSchema.properties` have exactly the same keys (a mapping key without a property is dropped on save). Keys are opaque, stable ids: prefer a fresh uuid v4 per key — what the builder writes for new variables; descriptive keys also load and round-trip, but get a "key should be a uuid" warning. Keys must be unique across ALL variable steps. Downstream: `setVariable.<key>`.
3. For new variables use `{type, title, format?}`: `type` ∈ `string | number | boolean`, `format` ∈ `date | date-time | email | uri`. `title` is REQUIRED (the visible name; a title-less variable is invisible downstream and dropped on save) and MUST be unique across ALL variable and code-variable steps in the automation (the panel refuses duplicate names). Add `"required": [<every key>]` to `outputSchema` — the panel writes it on save; other property fields such as `description` are stripped. Exception on UPDATE: preserve an existing `wixCustomType: "IMAGE_URL"` together with `type: "string"` and `format: "uri"`; it distinguishes an image variable from a general URL. The builder preserves this metadata even when its image-variable picker is unavailable. Do not normalize it away or rename its stable variable key.
4. An expression reads ONLY this node's aggregated schema — never another variable defined in the same step. Need a derived value twice? Repeat the expression, or compute it in an EARLIER variables step.
5. Panel-renderable values only: plain text / literals, `{{var(...)}}`, and functions from the builder list in [bracket-expressions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions), using `eq/gt/gte/lt/lte` for NUMBERS only (they reject string and boolean arguments — for a boolean use the value itself or `not(...)`, for strings `stringEq`); no unclosed `{{`. A `number`/`boolean` variable holds a JSON literal of that type or exactly one whole `{{…}}` — never plain text. NEVER a formula in a `date-time` variable (the panel replaces it with "now"); a literal date-time is re-saved in the site timezone. Anything else → the §4 alternatives (code variables can't be created publicly).
6. Place it BEFORE a condition when both branches need the value.

**Code variables are not available through the public API.** The builder's code-variable step (`APP_DEFINED` `wix_automations-data_manipulation_code`, `namespace: "setVariable"`) is not in Resolve Actions, and Create/Update refuse an automation containing a new one (PermissionDenied "Unauthorized automation creation or update") even when Validate says VALID. For a value the panel can't express (regex, splitting, day of year, joining a list, time between dates), in this order: a formula in the consuming field or a SET_VARIABLES step, if the §2 function list covers it; a CODE_CONDITION when the value only decides a branch (it creates fine); a "Generate or analyze text" (`wix_automations-llm_call`) step with an override output schema to extract or compute a text value; otherwise save without it and tell the user to add a code variable in the builder. An existing code variable in an automation you update: leave it untouched and keep its keys.

Variables are transformation, not extraction: they can't pull one element out of an unindexable array — use an LLM text action or a code condition ([limitations-and-planning.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §5).

## 5. SPLIT (alpha) — parallel paths

Every path ALWAYS runs, in parallel. It is not a condition.

```json
{
  "id": "<uuid-1>",
  "type": "SPLIT",
  "namespace": "SPLIT-2",
  "displayName": "Notify customer and team",
  "splitInfo": {
    "paths": [
      {
        "id": "<uuid-p1>",
        "name": "Notify customer",
        "displayName": "Notify customer",
        "postActionId": "<uuid-2>"
      },
      {
        "id": "<uuid-p2>",
        "name": "Notify team",
        "displayName": "Notify team",
        "postActionId": "<uuid-3>"
      }
    ]
  }
}
```

MUST:

- 2–10 paths; ≤10 SPLIT nodes per automation. A SPLIT has only `splitInfo` — no `postActionIds`.
- Path ids: fresh uuid v4, unique against every action id, every other path id, and the trigger key. Paths are NOT entries in `configuration.actions`.
- `name` 1–100 chars is the label; optional `displayName` ≤60 overrides it (the builder sets it only on rename — same text is fine). `postActionId` = first action of that path, or omitted for an empty path.
- Each path's chain is ordinary actions with one successor each; no action reachable from two paths.
- Placement: parallel work right after the trigger → the SPLIT is the root (unless a RATE_LIMIT is root; then the SPLIT is its child). Later → the previous step points to it.
- No re-join. A step that must run after all paths finish can't exist — put it before the SPLIT or on one path.

Editing an existing SPLIT: add a branch by appending one path (new id, new first action); remove one by deleting that path plus every node below it; if one path would remain, delete the SPLIT and connect its parent (or `rootActionIds`) straight to that path's first action — the builder does the same. Never linearize paths into a sequence — that changes behavior. Adding a SPLIT in the builder UI may be feature-gated for the user, but drawing and editing an existing one always works.

## 6. Why there is no MERGE

The API defines `MERGE` + `conditionInfo.mergeActionId`, but the builder cannot draw them. To let both condition branches continue into shared steps, DUPLICATE those steps into each branch ([automation-model.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §2).

## 7. Display names

- Sentence case, 1–60 chars, specific to purpose in context: "Send welcome email", not "Send email".
- APP_DEFINED: action + purpose ("Send welcome email"). DELAY: the wait ("Wait 2 hours before follow-up"). CONDITION / CODE_CONDITION: what's checked ("Check if VIP customer"). SET_VARIABLES: what's stored ("Set customer tier"). SPLIT path: the branch's purpose.
- Existing site-action (API integration) nodes: don't set or change their `displayName`.

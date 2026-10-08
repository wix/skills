---
name: "Automations Schemas and Scheduling"
description: "Configure dynamic schemas and scheduled automation triggers with correct timezone and calendar behavior."
---

This publication is being released in stages. Where a topic guide is not yet published, consult the official Automations API reference and method schemas before using that feature; do not guess its contract. Exception: Send an email and other opaque-widget (provider-owned) actions are outside stage 3 until Automations Email Actions is published; explain the limit instead of configuring them from the API reference.

# Schemas & Scheduling — Aggregated Schema, Override Schemas, Scheduled and Future-Date Triggers

**TL;DR**

- Every step can reference only its **aggregated schema** (trigger payload + **ancestor** outputs + `setVariable.*` + identity enrichment) — build it yourself, per step ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4).
- Dynamic schemas: trigger payload grows with its filters; an action's inputs grow with `updateSchemaOnChange` fields; its outputs grow with its mapping. Fetch them — never invent fields.
- Override output schema is allowed ONLY on: triggers `wix_automations-webhook_trigger`, `wix_automations-custom_trigger`; actions `webhooks-action`, `wix_automations-llm_call`, `ai_custom_agent_bm-delegate_to_agent`. Wire fields: `trigger.overrideSchema`, `appDefinedInfo.overrideOutputSchema`.
- Scheduled trigger: `trigger.automationConfigMapping = { startDate, repetitions? { cronExpression, everyNthDay | everyNthWeek | everyNthMonth, endDate? } }`. No `repetitions` = one run. Use the site time zone from Site Properties. Create and Update support `automationConfigMapping`; include it in the trigger configuration.
- "N days before the event" = `trigger.scheduledEventOffset` (only for triggers with a `futureDate` field). "After" = a DELAY step ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)).

---

## 1. The aggregated schema

Each step may read only its aggregated schema: the trigger payload (override, or static + dynamic merged) + outputs of its ancestor steps under their `namespace` + `setVariable.*` + identity enrichment — never a sibling branch, a descendant or a skipped step. Full recipe, identity-enrichment keys and resolution order: [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4. Only its paths may appear in a step's `var("…")` expressions ([Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions)).

## 2. Dynamic schemas — markers

| Marker                                                                   | Meaning                                                                  | Call                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------- |
| trigger `implementedMethods.getDynamicSchema: true`                      | Payload depends on filter selections (`reevaluateDynamicSchema` filters) | Get Trigger Dynamic Schema ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5)      |
| action input property `updateSchemaOnChange: true`                       | Setting it reveals more inputs                                           | Get Action Dynamic Input Schema ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §4)  |
| action output depends on mapping (e.g. an email template's placeholders) | Output fields revealed by configuration                                  | Get Action Dynamic Output Schema ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §4) |

A field you need but cannot see is **unknown until its controlling selection is made** — say which selection reveals it; don't claim the data doesn't exist, and don't invent it. Form answers with no form filter chosen are such fields: use only static fields, or ask which form ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5).

## 3. Override output schema

Replaces a component's schema so downstream steps get addressable fields. It exists only for components whose data comes from outside Wix and therefore have no schema of their own.

| Component                                                                                                                | Wire field                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Trigger `wix_automations-webhook_trigger`, `wix_automations-custom_trigger` (app `139ef4fa-c108-8f9a-c7be-d5f492a2c939`) | `configuration.trigger.overrideSchema`            |
| Action `webhooks-action`, `wix_automations-llm_call`, `ai_custom_agent_bm-delegate_to_agent`                             | `actions[id].appDefinedInfo.overrideOutputSchema` |

NEVER add an override to any other trigger or action — including one with a dynamic output schema (that schema is real; fetch it). If an existing automation already carries an override on another component, leave it untouched.

Generate one only when a downstream step consumes the data ("then use…", "based on the result…"). Skip it when the component is the last step or its default schema suffices.

Schema requirements (both kinds):

- JSON Schema draft-07: `"$schema": "http://json-schema.org/draft-07/schema"`, root `"type": "object"`, `properties`, `required`; standard types only; give each property a `title`.
- Trigger overrides: one realistic `examples` entry per property.
- A trigger `overrideSchema` **replaces** the payload schema. An action `overrideOutputSchema` is **merged** over the catalog output schema (its `properties` win on a clash) — catalog output fields stay addressable. Get Automation returns overrides only with `fields: ["OVERRIDE_SCHEMA"]` — use it on read-back, or the override looks lost. For the webhook trigger keep the `webhookId` property in the override if the validator reports it missing. Webhook wiring (id, filter, config mapping) and the custom trigger's `hookId`: [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "type": "object",
  "properties": {
    "orderId": {
      "type": "string",
      "title": "Order ID",
      "examples": ["order_12345"]
    },
    "customerEmail": {
      "type": "string",
      "title": "Customer Email",
      "examples": ["customer@example.com"]
    },
    "totalAmount": {
      "type": "number",
      "title": "Total Order Amount",
      "examples": [89.97]
    }
  },
  "required": ["orderId", "customerEmail", "totalAmount"]
}
```

Per-action rules:

- **LLM (`wix_automations-llm_call`)**: when a property is a decision among known outcomes that a later condition branches on, constrain it with `enum` (e.g. `"location": {"type": "string", "enum": ["inside", "outside"]}`) — the condition can only match values it can predict.
- **LLM / custom agent — input grounding**: the override describes the result, not the source data. Put the concrete, schema-verified `{{var("…")}}` values into the prompt/instructions input. "Analyze the order" without mapping the order fields is incomplete even if it validates.
- **Custom agent**: the schema must match the agent's task ("check loyalty eligibility" → `isEligible`, `discountPercentage`, `reason`, not generic `success`). Change the schema when the instructions change.
- **Webhook action**: model the called API's response (data / status / timestamp).

## 4. Scheduled trigger (`wix_automations-scheduled_trigger`, app `139ef4fa-c108-8f9a-c7be-d5f492a2c939`)

Timing lives in `configuration.trigger.automationConfigMapping`, supported by Create and Update and required by the builder. Read the trigger's `automationConfigSchema` from Get Trigger By App Id And Key and follow it if it differs. The scheduled trigger carries **no payload data** — only timing.

```json
"trigger": {
  "appId": "139ef4fa-c108-8f9a-c7be-d5f492a2c939",
  "triggerKey": "wix_automations-scheduled_trigger",
  "filters": [],
  "automationConfigMapping": {
    "startDate": "2026-10-05T09:00:00-04:00",
    "repetitions": { "cronExpression": "0 9 * * 1", "everyNthWeek": 1,
                     "endDate": "2026-12-28T09:00:00-05:00" }
  }
}
```

`startDate` (required): `YYYY-MM-DDTHH:mm:00±HH:MM` — seconds `00`, no milliseconds, the site time zone's offset on that date (`Z` only if the site is UTC). Its hour:minute is the time of every run; its date seeds weekly/monthly patterns. The builder reads the **wall-clock digits as site-local time and ignores the offset**, then re-writes the string: NEVER write the UTC instant (`…T13:00:00Z` for 9:00 New York) — the schedule would move to 13:00.

Time zone: read the site's time zone with Site Properties — `GET https://www.wixapis.com/site-properties/v4/properties?fields.paths=timeZone` (SDK `siteProperties.getSiteProperties({fields: ["timeZone"]})` from `@wix/business-tools`) → `properties.timeZone` (IANA, e.g. `America/New_York`). Convert it to the offset valid on each date (DST changes the offset; compute `startDate` and `endDate` separately). If the call fails or the value is empty, ask the user; never silently assume UTC.

One-time: `{"startDate": "…"}` only — the absence of `repetitions` means run once (and no `endDate`).

Recurring: `repetitions` with `cronExpression` + **exactly one** of `everyNthDay` (1–99) / `everyNthWeek` (1–52) / `everyNthMonth` (1–12) — the stricter of the builder's input (1–99) and the trigger's config schema (≤ 365 days, 52 weeks, 12 months), optional `endDate` **inside** `repetitions` (same format and time zone, after `startDate`). Cron is `"MM HH DOM MON DOW"` (Sunday = 0); `N#K` = Kth weekday N of the month; `NL` = last weekday N.

Builder round-trip (it regenerates the cron from `startDate` when the panel opens — any mismatch is rewritten):

- cron `MM HH` = `startDate`'s minute and hour, no leading zeros (`"0 9 …"`, not `"00 09 …"`).
- Weekly weekdays in ascending order (`1,3,5`). Monthly day-of-month = `startDate`'s day; `N#K`: N = `startDate`'s weekday, K = its week of the month (days 1–7 → `#1`, 8–14 → `#2`, …).
- Known builder issues (tell the user): opening the schedule panel can rewrite `NL` to `MM HH L * *` and resets an `endDate` to exactly one year after `startDate`; a save after opening it persists that. Ask them to re-check both before saving from the builder.

| Intent                            | cronExpression        | param              |
| --------------------------------- | --------------------- | ------------------ |
| Every day 8:00                    | `"0 8 * * *"`         | `everyNthDay: 1`   |
| Every 5 days                      | `"0 10 * * *"`        | `everyNthDay: 5`   |
| Every 2 weeks, weekday irrelevant | `"0 9 * * *"`         | `everyNthDay: 14`  |
| Every Thursday 10:00              | `"0 10 * * 4"`        | `everyNthWeek: 1`  |
| Mon/Wed/Fri 8:00                  | `"0 8 * * 1,3,5"`     | `everyNthWeek: 1`  |
| Every 2 weeks Sun + Wed           | `"12 17 * * 0,3"`     | `everyNthWeek: 2`  |
| Weekdays                          | `"0 9 * * 1,2,3,4,5"` | `everyNthWeek: 1`  |
| 15th of every month               | `"0 9 15 * *"`        | `everyNthMonth: 1` |
| First Monday monthly              | `"0 10 * * 1#1"`      | `everyNthMonth: 1` |
| Last Friday quarterly             | `"0 16 * * 5L"`       | `everyNthMonth: 3` |

Weekly: pure interval → `everyNthDay: 7/14/21` (runs on `startDate`'s weekday); specific weekday(s) → `everyNthWeek` + cron DOW.

Monthly (most restrictive): `startDate` MUST itself be an instance of the pattern (a "15th" schedule starts on a 15th; "first Monday" starts on a first Monday). Only two patterns exist: day-of-month **1–28**, or weekday position `#1`–`#4` / `L`.

Not supported — say so and offer an alternative:

- Last **day** of month (`L` in day-of-month) — never write it, even though the builder's panel offers a "last day" option when `startDate` is a month's last day: it is not a supported pattern. Offer: a daily schedule + a month-end check (below; the only one that fires on the real last day), day 28 (fires up to 3 days early), a last-weekday position (`5L`), or the 1st.
- 29th/30th/31st, several days per month, "second-to-last X".
- More than once a day (hourly/minutes).
- Two `everyNth*` params together, or `repetitions` with none.

**Daily + month-end check** (for "last day of month" or other calendar rules the schedule can't express): a daily schedule (`everyNthDay: 1`) whose root is a CODE_CONDITION ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §5) with `dynamicVariableExpressions: []` (the scheduled trigger has no payload) and the site time zone written into the code:

```js
/**
 * @param {Payload} payload - unused; this check uses the site calendar.
 * @returns {boolean} whether today is the site's last day of the month.
 */
export default function (payload) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', // site timeZone from Site Properties
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date());
    const get = type => Number(parts.find(part => part.type === type)?.value);
    const year = get('year'),
      month = get('month'),
      day = get('day');
    return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
  } catch (e) {
    return false;
  }
}
```

Validate the site's IANA time zone before saving; an invalid or unavailable zone is a blocker, never a reason to use UTC. The runtime guard returns false if date formatting fails. Compare calendar dates as above: adding 24 hours is not "tomorrow" across daylight-saving changes. Keep the JSDoc header and the complete snippet within 1000 characters per [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §5; put the real steps on its true branch, `[]` on the false one. Tell the user the check runs in code.

Checklist: `startDate` matches the pattern day • cron consistent with the `everyNth*` param • offsets correct for the site time zone on each date • monthly pattern exists in every month • when in doubt prefer daily/weekly over monthly.

## 5. Future-date offset ("before the event")

For triggers whose payload has a date-time field with `futureDate: true` (e.g. session start), run the automation a fixed time **before** that date:

```json
"trigger": { "...": "...",
  "scheduledEventOffset": { "preScheduledEventOffsetExpression": "{{2}}",
                            "scheduledEventOffsetTimeUnit": "DAYS" } }
```

- MUST: a positive integer literal in `{{N}}` (no spaces, no `var()` — the builder edits and labels only a number), unit `MINUTES` | `HOURS` | `DAYS` | `WEEKS` | `MONTHS`. Omit `scheduledEventOffset` entirely when there is none.
- Offsets are always _before_ the event. "2 days after the booking" → no offset; add a DELAY step ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)).
- A trigger without a `futureDate` field cannot take an offset.

## 6. Custom API ("site") actions

Site actions (`wix_automations-wix_api_integration`) are generated through non-public services and can't be created from public APIs — a limitation (Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §1). Leave an existing one's `inputMapping` untouched.

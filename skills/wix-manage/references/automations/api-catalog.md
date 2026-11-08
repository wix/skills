---
name: "Automations API Catalog"
description: "Discover site-specific triggers and actions, authenticate public Automation API calls, and choose the API for validation, persistence or catalog lookups."
---

# API Catalog — the public Wix Automations APIs

Every call this skill needs, as a public REST endpoint (base `https://www.wixapis.com`) and the
matching `@wix/automations` SDK method. Docs live under
`https://dev.wix.com/docs/api-reference/business-management/automations/` — append `.md` to any
docs URL to get raw markdown. When a field name here and the docs disagree, the docs win.

> **Save restrictions:** Before a create, update or activation, follow the complete [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence).
> - Apply its §1, §3–§4 and **Update restrictions**. The email-specific sections still use the older stage framework; their exclusions remain authoritative here.
> - Never perform an operation explicitly excluded by that procedure, including email marked "Later stages only".
> - "Stage" denotes a publication grouping; "Later stages only" excludes that operation here; "not yet published" marks an unavailable guide. These are internal rollout markers: never quote or expose them to the user. Explain restrictions in product terms.

**TL;DR**

- **Email:** follow the numbered Email configuration procedure below before discovery or writes.
- **Calendar conditions and schedules:** before building a birthday/date check, schedule or offset, read [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4–§5. Match the time zone to the exact target site, not another site in account context.
- **Capability answers:** report each requested trigger/action with its returned `appId` + key and schema-defined inputs. For read-only availability, start with the compact in-code action batch in §6; report its distinct-count/total evidence and both next-step options when an action is missing.
- Catalogs: Resolve Triggers / Resolve Actions. Oracle: **Validate Automation** — Create and
  Update do **not** validate.
- Persist: Create `INACTIVE` → Get read-back; activate only when asked. Updates need the current
  `revision` and are **live** on an active automation. Procedures (create, update, activate, read-back
  — builder drafts are invisible publicly): [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3.
- **Test Automation runs actions for real** — only with explicit user authorization.
- Resolve responses are large: page small, filter by exact keys, never paste a raw catalog.

## Email configuration

1. **Read the complete save procedure.** Load [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence), including §1, §3–§4 and **Update restrictions**, before email catalog discovery or provider calls.
2. **Use the builder by default.** This catalog contains no email-configuration procedure. If the save procedure excludes email (including "Later stages only"), or no loaded index/reference links the complete Automations Email Actions guide, configure the email in the automations builder.
   - Skip email-guide searches, email-action discovery and provider writes, including Generate Action Input Mapping and email-content writes. Never fabricate an email mapping or save an empty/trigger-only placeholder.
   - Offer other requested steps without the email only if useful; save them only after the user agrees.

A linked complete email guide can replace the builder fallback only for operations the save procedure permits. Follow that guide completely; an API introduction or method page is not a substitute, and read-only inspection never authorizes a write.

## 1. Authentication and transport

- **Permission scope**: **Set Up Automations** (`SCOPE.CRM.SETUP-AUTOMATIONS`) for automation operations. Generating a new email action mapping requires **Manage Email Marketing** (`SCOPE.DC-PROMOTE.EMAIL-MARKETING`) in the [public email API](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/generate-action-input-mapping). This scope alone does not supply a permitted email recipe: apply the **Email configuration** fallback above.
  Entity lookups in other verticals need that vertical's read scope
  (resolve entity ids through the owning vertical’s documented read API, or ask the user).
- **Token**: `Authorization: <token>` header — an OAuth app access token (`client_credentials` via
  Create Access Token) or an account API key the site owner generated with the needed scopes.
- **Site context**: with an **API key**, send `wix-site-id: <metaSiteId>` on every call (all calls
  here are site-level); never together with `wix-account-id`. OAuth app tokens are already bound
  to one site instance.
- **SDK**: `import { automationsV2, triggerCatalog, actionCatalog, activations } from
'@wix/automations'`, used through a `createClient` Wix client with an auth strategy.
- **Secrets**: NEVER print, log, echo or store tokens, API keys, app secrets or auth headers — not
  in chat, files or error reports. Redact them from any request you show.
- **Site lock**: resolve the target `metaSiteId` once and use it for every call, read-back and
  link. Ask the user to confirm it before the first write only when more than one site is in
  context or the request doesn't make clear which; a site fixed by the request or session is
  confirmed. If anything points at another site, stop.
- **Errors**: 401 = token expired/invalid (refresh, don't retry blindly). 403 = missing scope, app
  not installed, or — on Create/Update of an automation that validated — a step the public API
  can't create (e.g. the code-variable step, [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4). A timeout or 5xx is
  **unknown**, not a verdict — retry read-only calls (Get, Query, Resolve, Validate) a bounded
  number of times. Never blindly retry Create or Update: Query or Get first to see whether the
  write landed ([Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3, Reporting rules).

## 2. Automations V2 (`automationsV2`) — base `/automations-service/v2/automations`

| Purpose  | REST                                                                               | SDK                                       |
| -------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| Validate | `POST https://www.wixapis.com/automations-service/v2/automations/validate`         | `validateAutomation(automation, options)` |
| Create   | `POST https://www.wixapis.com/automations-service/v2/automations`                  | `createAutomation(automation)`            |
| Get      | `GET https://www.wixapis.com/automations-service/v2/automations/{automationId}`    | `getAutomation(automationId)`             |
| Update   | `PATCH https://www.wixapis.com/automations-service/v2/automations/{automation.id}` | `updateAutomation(_id, automation)`       |
| Delete   | `DELETE https://www.wixapis.com/automations-service/v2/automations/{automationId}` | `deleteAutomation(automationId)`          |
| Query    | `POST https://www.wixapis.com/automations-service/v2/automations/query`            | `queryAutomations(query)`                 |

- **Validate** (unsaved or saved): `{automation, validationSettings?{actionIds[],
skipProviderValidations}}` → `{status: VALID|VALID_WITH_WARNINGS|INVALID,
triggerValidationErrors[], actionValidationErrors[]}`. The main oracle; send the full object.
  Reading errors: [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §2.
- **Create**: `{automation}` with `name`, `origin: "USER"`, `configuration{status, trigger{appId,
triggerKey}, rootActionIds, actions}` → created `automation` (has `id`, `revision`). Does NOT
  validate. Always `status: "INACTIVE"`; don't send `settings`.
- **Get**: → `automation`. Use for read-back after every write and before every update.
  `trigger.overrideSchema` and `appDefinedInfo.overrideOutputSchema` come back **only** when you
  request them: `fields: ["OVERRIDE_SCHEMA"]` (REST `?fields=OVERRIDE_SCHEMA`). Without it their
  absence is not data loss (Create's response omits them too).
  Request overrides before complete-object updates and status changes too, not just creation read-back.
- **Update**: `{automation}` incl. `id` and current `revision` → updated `automation` (revision
  +1). Does NOT validate. Send the complete merged `name` + `configuration`, **plus `origin` and
  `settings` exactly as fetched** — an Update without them fails `INVALID_ORIGIN_TYPE`. A
  `fieldMask` (if your client exposes one) only selects what changes — set it to
  `configuration,name` (what the builder sends); it doesn't exempt you from sending `origin` /
  `settings`. A stale `revision` is rejected. Changes are LIVE when `status` is `ACTIVE`. A success
  response and a revision bump do **not** prove the change landed — merge, conflict handling and
  read-back comparison: [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3.
  Capture the returned id: creating a site override of a preinstalled automation can change it.
  Before any Update, including a rename-only edit, read [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3
  and run its applicable §4 checks; this endpoint summary does not replace that procedure.
- **Delete**: → `{}`. Irreversible; only on explicit user request.
- **Query**: `{query{filter, sort, cursorPaging{limit ≤ 500, cursor}}}` → `automations[]`,
  `pagingMetadata.cursors.next`. Returns only automations of apps installed on the site (incl.
  overridden preinstalled ones), and never unpublished builder drafts. Full objects are large —
  keep only `id, name, configuration.status, configuration.trigger`. If a filtered query fails on
  a site with many automations, page unfiltered and filter locally.

Automation object fields and limits (`name` ≤ 100 for the builder, `description` ≤ 2000,
`origin`, `settings`, `configuration`): [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §1.
Create/Update accept `configuration.trigger.automationConfigMapping` for scheduled/custom/webhook
configuration even where the docs omit it; use [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) / [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling).

**Calendar and timing workflows:** before configuring a schedule, a future-date offset or a site-local calendar condition (such as a birthday check), read [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4 for time-zone source precedence, what to do when no valid zone is available, and a user-named zone that differs from the site’s; read §5 for offsets. A time zone already returned for the target site is valid input to §4 and needs no Site Properties call.

## 3. Trigger Catalog (`triggerCatalog`)

| Purpose                | REST                                                                     | SDK                                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Triggers on this site  | `POST https://www.wixapis.com/v1/triggers/resolve`                       | `resolveTriggers(options)`                      |
| Global catalog         | `POST https://www.wixapis.com/v1/triggers/query`                         | `queryTriggers(query)`                          |
| One trigger            | `GET https://www.wixapis.com/v1/triggers/apps/{appId}/keys/{triggerKey}` | `getTriggerByAppIdAndKey(identifiers, options)` |
| Dynamic payload schema | `POST https://www.wixapis.com/v1/triggers/dynamic_schema`                | `getTriggerDynamicSchema(appId, options)`       |
| Identity enrichment    | `POST https://www.wixapis.com/v1/triggers/identities_schema`             | `getIdentitiesSchema()`                         |

- **Resolve**: `{basicFieldsOnly?, appId?, query{filter, paging{limit, offset}, fields?}}` →
  `results[]`, `paging`. Installed apps only. `basicFieldsOnly: true` for browsing (drops payload
  schema, config schema, filters).
- **Query** (global): `{query{filter, …}}` → `results[]` (filterable: `appId`, `triggerKey`,
  `displayName`, `implementedMethods.*`). Includes apps NOT installed on the site — never build on
  a trigger Resolve didn't return.
- **One trigger**: → `trigger` with `payloadDataSchema`, `filters[]`, `automationConfigSchema`,
  `implementedMethods`. The preferred way to hydrate a shortlisted trigger.
- **Dynamic schema**: `{appId, triggerKey, selectedFilterOptions[{fieldKey, values[]}] (≤ 5)}` →
  `dynamicSchema`. Only when `implementedMethods.getDynamicSchema` is true, and only after the
  filters that drive it are chosen — no filter chosen ⇒ form answers are unknown, not absent
  (request and merge: [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §5).
- **Identities schema**: `{}` → `identitiesSchema{contact, member, …}` — shape of the `contact` /
  `member` objects added when payload fields carry `identityType`.

Trigger objects have no free-text description and display names are ambiguous — decide by the
payload schema ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §2).

## 4. Action Catalog (`actionCatalog`)

| Purpose                    | REST                                                                          | SDK                                            |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Actions on this site       | `POST https://www.wixapis.com/v1/actions/resolve`                             | `resolveActions(options)`                      |
| Global catalog             | `POST https://www.wixapis.com/v1/actions/query` (and `/query-latest`)         | `queryActions(query)`, `queryLatestActions`    |
| Version active on the site | `GET https://www.wixapis.com/v1/actions/apps/{appId}/keys/{actionKey}`        | `getRuntimeAction(identifiers)`                |
| Latest version             | `GET https://www.wixapis.com/v1/actions/latest/apps/{appId}/keys/{actionKey}` | `getLatestAction(identifiers, options)`        |
| Dynamic input schema       | `POST https://www.wixapis.com/v1/actions/dynamic-input-schema`                | `getActionDynamicInputSchema(appId, options)`  |
| Dynamic output schema      | `POST https://www.wixapis.com/v1/actions/dynamic-output-schema`               | `getActionDynamicOutputSchema(appId, options)` |

- **Resolve**: `{query{filter, paging{limit, offset}, fields?}}` → `actions[]`, `paging`. Offset
  paging only (`cursorPaging` is rejected). Entries carry full `inputSchema`, `outputSchema`,
  `uiSchema` — large. Filter by `appId`/`actionKey`. Keep direct-to-context pages ≤ 25; for read-only availability use the compact in-code batch in §6.
- **Global catalog**: not site-scoped; "latest" may be newer than what the site runs.
- **Runtime action**: → `action`. Use this schema when configuring for this site. Latest version
  is for reference only.
- **Dynamic input**: `{appId, actionKey, inputMapping}` → `{inputSchema, uiSchema}`. Call when an
  input property has `updateSchemaOnChange: true` (no public `getDynamicInputSchema` flag);
  re-call after changing such a field.
- **Dynamic output**: `{appId, actionKey, inputMapping}` → `outputSchema`; bulk
  (`bulkGetActionDynamicOutputSchemas`, POST `/v1/actions/bulk/dynamic-output-schema`, ≤ 20 items) →
  `results[]{itemMetadata{success, error}, outputSchema}`. Only after that action's mapping is
  final. For `wix_automations-llm_call` fields defined by your output configuration, read [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3 before constructing `overrideOutputSchema`: that procedure defines merging with the static output, property metadata and override-aware Get read-back. Then declare the fields you chose; do not call this SPI to discover them. For other upstream actions whose configured output is needed, this is a read-only discovery call (no public flag says which are dynamic); an error does not establish additional fields — keep the static `outputSchema`.
  Merge into the static schema. A failed bulk item = unknown schema, not empty.
- **Generate Input Mapping From Intent** (`POST https://www.wixapis.com/v1/actions/generate-input-mapping-from-intent`)
  is AI-backed — don't call it. Actions you can't map from their schema: [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1.
- **Email actions** — follow the numbered Email configuration procedure before discovery or writes; when supported, follow the complete Automations Email Actions procedure.

Action objects: `appId`, `actionKey`, `displayName`, `description`, `inputSchema`, `outputSchema`,
`interfaceConfiguration{type: GENERIC\|WIDGET_COMPONENT, genericOptions.uiSchema}`,
`implementedMethods{validateConfiguration, getQuotaInfo}` (public). Resolve Actions has **no**
`basicFieldsOnly` option (only Resolve Triggers does). Mapping rules: [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration).

## 5. Activations (`activations`)

- **Test Automation** — `POST https://www.wixapis.com/automations/v1/events/test-automation`,
  `testAutomation(identifierType, options)`: `{identifierType: "AUTOMATION",
automationIdentifier{automationId}, payload}` → `activationId`. **Runs every action for real**
  (skips delays, works on INACTIVE) — explicit user authorization only; payload, consent and
  reporting: [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §5.
- **Run Automation / Report Event / Rerun Activation** — for the app that owns a trigger; never
  use them to build or "test".

## 6. Catalog discovery without flooding your context

1. **Keep transport separate from context.** Triggers: use `basicFieldsOnly: true` and
   pages ≤ 25. For read-only action-availability questions, start inside execution code with
   `resolveActions({query: {paging: {limit: 100, offset: 0}}})`, then compact locally before
   returning anything to the reasoning context. This bounded batch avoids offset boundaries
   when the catalog fits in one response; 100 is an execution bound, not an API maximum.
   - Keep the full action entries and schemas inside the executing code. Return only counts,
     requested matching identities (`appId`, key, display name) and the schema fields needed
     for requested available candidates. Never return the raw catalog or unrelated schemas.
   - De-duplicate by `appId` + `actionKey`. A single response proves completeness only when
     `paging.total` is numeric, `paging.tooManyToCount` is false or absent, and the distinct
     count equals that total. A large requested limit alone is not proof.
   - If more pages are needed, use bounded offset paging and the same cache/count checks.
     If exhausted pages still leave incomplete evidence, report that uncertainty and stop.
   - If execution code cannot compact before the response reaches context, use pages ≤ 25.
     Field projection (`fields`) may be ignored; never rely on it to keep a full catalog small.
2. **Cache and count during the first pass.** Keep each returned entry in a map keyed by
   `appId` + trigger/action key, together with each page's offset and reported `paging.total`.
   Cache schemas already returned by Resolve too. Count the map entries, not raw page lengths;
   overlapping entries do not prove completeness. Search that same map for every requested
   capability. Do not restart a scan just to count or inspect pages you already fetched, and
   do not add an exact-key probe after a complete scan proves that action absent. If exhausted
   pages leave the distinct count below the reported total, report incomplete evidence and
   "not found" rather than claiming absence or repeatedly scanning. Dynamic schemas are the
   exception to fetching schemas once: re-call after changing an `updateSchemaOnChange` field.
3. **Hydrate the shortlist** with exact keys (Get Trigger By App Id And Key / Get Runtime Action,
   or a Resolve filter `{"appId": "...", "actionKey": "..."}`). Full schemas only for the chosen few.
4. **Filters that work**: exact `appId`, `triggerKey`/`actionKey`, and `$in` on the keys (both
   Resolves); on Resolve Triggers also `displayName` `$contains` / `$in` (inside `$or` too) and
   `triggerKey` `$startsWith`. Resolve Actions rejects `displayName` filters — search names
   locally. A rejected filter → fall back to small pages.
5. **Don't sort** — `sort: [{fieldName: "id"}]` fails with `SORT_PARSER_ERROR` on both Resolves.
   Unsorted offset pages can **overlap**: page until `paging.total`, de-duplicate by `appId`+key,
   and count distinct entries. An action or trigger is proven **missing** only after a complete,
   de-duplicated scan (distinct count = `paging.total`). Report the evidence ("scanned N distinct
   of `paging.total` N"); without that proof say it was "not found in the installed catalog",
   never that it is not installed. Either way, list the closest related entries you did find with
   their returned `appId` + key and display name — don't omit them, and don't fetch their schemas
   unless the user asks. A shortcut:
   take the `appId` from a related action, then Resolve by `appId`.

Discovery hints:

**Installed-capability answers** ("does my site support…?"):

- **Available options:** give one row per requested trigger/action with availability, the returned `appId` + `triggerKey`/`actionKey`, display name and schema-defined required/optional inputs. Include the actual app IDs in the answer. Use existing entity keys when a schema asks for keys; do not invent them.
- **Schema reads:** hydrate only requested available candidates whose schemas are not already cached. A similar keyword match is not another requested option. Reads needed to finish a separately requested available option remain appropriate.
- **Proven absent:** report "scanned N distinct of total N" from the cached complete scan. Stop discovery for that action, including exact-key/runtime/schema probes. Its inputs are unknown; never fill that gap from a standalone vertical API.
- **Incomplete evidence:** if the distinct count does not match the total, report both counts and only "not found in the installed catalog." Stop instead of restarting scans or claiming the action is unavailable.
- **Next steps:** offer both making the providing app/action available and letting the user choose a real installed alternative. Identify that alternative by its returned app ID, key and name. Do not guess an app name or installation procedure.
- **Stay site-scoped:** do not query global catalogs or standalone APIs for this question. Use them only for a separately requested platform-wide discovery or standalone API workflow, clearly labeled as such.

- Search by concept with a keyword ladder ("chat" → "message"). Common aliases: send a chat
  message to the contact = `send-message` (not `inbox-send-message`); a note about a contact in
  the site owner's Inbox, nothing sent to the contact = `inbox-send-message` ("Show in Inbox");
  email to anyone, incl. the site
  owner = `triggered-emails` (follow the numbered Email configuration procedure before resolving it; never the deprecated `send-mail` / "Get an email"); task =
  `createTask`; labels = `addLabelsToContact` / `remove_labels_to_contact`; create a contact =
  `contacts-create_contact` (for triggers whose payload has no contact, e.g. webhooks).
  For Create a contact, `inputMapping` is for example `{"contact":{"firstName":"{{var(\"firstName\")}}","email":"{{var(\"email\")}}"},"duplicationStrategy":"UPDATE_CONTACT"}`. The `contact` field contains mapped destination keys; use only its own schema properties and values with real sources. Do not add Create a contact when the trigger already supplies that contact.
- Near-duplicates exist (`booking_canceled` vs `bookings_canceled`; new Wix Forms app vs legacy
  "Form submitted"). Compare payload schemas and filters; prefer the one whose entities you can
  actually find on the site (resolve entity ids through the owning vertical’s documented read API, or ask the user).
- Enum-like fields often list legal values only in the field `description` (e.g. paymentStatus
  NOT_PAID / PAID). Read descriptions before mapping user words; never invent enum values.

## 7. Aggregated schema — computed locally (no API takes an unsaved graph)

Node N may read the trigger payload + each **ancestor**'s output (under its namespace) +
variables + identity enrichment. Recipe and fetch order: [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4.

## 8. Selector options and APIs with limitations

**Entity ids** (forms, labels, services, pipeline stages…): resolve them through the owning vertical’s documented public read API, or ask the user for the exact entity. Confirm ids and parent/fixed filters with successful reads. Never save a display name, invent an id or derive an endpoint from a provider key. Failed or incomplete lookups mean unknown options, not an empty site.

**Not public or not available through the general Automations API:**

- **Draft automations** → create `INACTIVE`; the user activates. Builder drafts are invisible.
- **Site-action generation** → unavailable through the public Automations API; offer an installed app-defined action, a supported webhook action, or an LLM text action where one meets the requested outcome — never invent its mapping.
- **Email changes** → follow the numbered Email configuration procedure.
- **Expression parsing/evaluation, code runner** → local checks ([Automations Mapping Expressions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-mapping-expressions),
  [Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)), then Validate Automation.
- **Validate by id** → Get Automation, then Validate the returned object.

## Related API references

- [Automations V2](https://dev.wix.com/docs/api-reference/business-management/automations/automations/automations-v2/introduction)
- [Resolve Triggers](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-catalog/resolve-triggers)
- [Resolve Actions](https://dev.wix.com/docs/api-reference/business-management/automations/actions/action-catalog/resolve-actions)
- [Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/introduction) — provider API reference, not the configuration guide; follow the numbered Email configuration procedure.

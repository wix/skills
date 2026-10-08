---
name: "Automations API Catalog"
description: "Discover site-specific triggers and actions, authenticate public Automation API calls, and choose the API for validation, persistence or catalog lookups."
---

> **Stage scope:** this stage covers only what [Build Simple Wix Automations](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-simple-wix-automations) lists; do not perform anything marked "Later stages only" or any workflow that needs a guide marked "not yet published".

# API Catalog — the public Wix Automations APIs

Every call this skill needs, as a public REST endpoint (base `https://www.wixapis.com`) and the
matching `@wix/automations` SDK method. Docs live under
`https://dev.wix.com/docs/api-reference/business-management/automations/` — append `.md` to any
docs URL to get raw markdown. When a field name here and the docs disagree, the docs win.

**TL;DR**

- Catalogs: Resolve Triggers / Resolve Actions. Oracle: **Validate Automation** — Create and
  Update do **not** validate.
- Persist: Create `INACTIVE` → Get read-back; activate only when asked. Updates need the current
  `revision` and are **live** on an active automation. Procedures (create and read-back
  — builder drafts are invisible publicly): [Build Simple Wix Automations — included validation procedure](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-simple-wix-automations) §3.
- **Later stages only — not in stage 2:** **Test Automation runs actions for real** — only with explicit user authorization.
- Resolve responses are large: page small, filter by exact keys, never paste a raw catalog.

## 1. Authentication and transport

- **Permission scope**: **Set Up Automations** (`SCOPE.CRM.SETUP-AUTOMATIONS`) for every
  Automations method below. Generate Action Input Mapping and Get / Set Email Content (Automation Email Action API) need **Manage
  Email Marketing** (`SCOPE.DC-PROMOTE.EMAIL-MARKETING`) — a 403 there means that scope is missing.
  Entity lookups in other verticals need that vertical's read scope
  (Automations Entity and Provider Configuration (not yet published)).
- **Token**: `Authorization: <token>` header — an OAuth app access token (`client_credentials` via
  Create Access Token) or an account API key the site owner generated with the needed scopes.
- **Site context**: with an **API key**, send `wix-site-id: <metaSiteId>` on every call (all calls
  here are site-level); never together with `wix-account-id`. OAuth app tokens are already bound
  to one site instance.
- **SDK**: `import { automationsV2, triggerCatalog, actionCatalog, activations } from
'@wix/automations'`, used through a `createClient` Wix client with an auth strategy.
- **Secrets**: NEVER print, log, echo or store tokens, API keys, app secrets or auth headers — not
  in chat, files or error reports. Redact them from any request you show.
- **Site lock**: resolve the target `metaSiteId` once, confirm it with the user before the first
  write, and use it for every call, read-back and link. If anything points at another site, stop.
- **Errors**: 401 = token expired/invalid (refresh, don't retry blindly). 403 = missing scope, app
  not installed, or — on Create/Update of an automation that validated — a step the public API
  can't create (e.g. the code-variable step, §4 of Automations Delays Variables and Branches (not yet published)). A timeout or 5xx is
  **unknown**, not a verdict — retry a bounded number of times.

## 2. Automations V2 (`automationsV2`) — base `/automations-service/v2/automations`

> Stage 2 supports Query, Get, Validate and inactive Create here. Update, Delete and status changes below are future-stage reference material; do not call them in this stage.

| Purpose  | REST                                                        | SDK                                       |
| -------- | ----------------------------------------------------------- | ----------------------------------------- |
| Validate | `POST https://www.wixapis.com/automations-service/v2/automations/validate`         | `validateAutomation(automation, options)` |
| Create   | `POST https://www.wixapis.com/automations-service/v2/automations`                  | `createAutomation(automation)`            |
| Get      | `GET https://www.wixapis.com/automations-service/v2/automations/{automationId}`    | `getAutomation(automationId)`             |
| Update   | `PATCH https://www.wixapis.com/automations-service/v2/automations/{automation.id}` | `updateAutomation(_id, automation)`       |
| Delete   | `DELETE https://www.wixapis.com/automations-service/v2/automations/{automationId}` | `deleteAutomation(automationId)`          |
| Query    | `POST https://www.wixapis.com/automations-service/v2/automations/query`            | `queryAutomations(query)`                 |

- **Validate** (unsaved or saved): `{automation, validationSettings?{actionIds[],
skipProviderValidations}}` → `{status: VALID|VALID_WITH_WARNINGS|INVALID,
triggerValidationErrors[], actionValidationErrors[]}`. The main oracle; send the full object.
  Reading errors: [Build Simple Wix Automations — included validation procedure](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-simple-wix-automations) §2.
- **Create**: `{automation}` with `name`, `origin: "USER"`, `configuration{status, trigger{appId,
triggerKey}, rootActionIds, actions}` → created `automation` (has `id`, `revision`). Does NOT
  validate. Always `status: "INACTIVE"`; don't send `settings`.
- **Get**: → `automation`. Use for read-back after every write and before every update.
  `trigger.overrideSchema` and `appDefinedInfo.overrideOutputSchema` come back **only** when you
  request them: `fields: ["OVERRIDE_SCHEMA"]` (REST `?fields=OVERRIDE_SCHEMA`). Without it their
  absence is not data loss (Create's response omits them too).
  Request overrides before complete-object updates and status changes too, not just creation read-back.
- **Later stages only — not in stage 2:** **Update** — published in stage 3.
- **Delete**: → `{}`. Irreversible; only on explicit user request.
- **Query**: `{query{filter, sort, cursorPaging{limit ≤ 500, cursor}}}` → `automations[]`,
  `pagingMetadata.cursors.next`. Returns only automations of apps installed on the site (incl.
  overridden preinstalled ones), and never unpublished builder drafts. Full objects are large —
  keep only `id, name, configuration.status, configuration.trigger`. If a filtered query fails on
  a site with many automations, page unfiltered and filter locally.

Automation object fields and limits (`name` ≤ 100 for the builder, `description` ≤ 2000,
`origin`, `settings`, `configuration`): [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §1.
Create/Update accept `configuration.trigger.automationConfigMapping` for scheduled/custom/webhook
configuration even where the docs omit it; use [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) / Automations Schemas and Scheduling (not yet published).

## 3. Trigger Catalog (`triggerCatalog`)

| Purpose                | REST                                              | SDK                                             |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------- |
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

| Purpose                    | REST                                                   | SDK                                            |
| -------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Actions on this site       | `POST https://www.wixapis.com/v1/actions/resolve`                             | `resolveActions(options)`                      |
| Global catalog             | `POST https://www.wixapis.com/v1/actions/query` (and `/query-latest`)         | `queryActions(query)`, `queryLatestActions`    |
| Version active on the site | `GET https://www.wixapis.com/v1/actions/apps/{appId}/keys/{actionKey}`        | `getRuntimeAction(identifiers)`                |
| Latest version             | `GET https://www.wixapis.com/v1/actions/latest/apps/{appId}/keys/{actionKey}` | `getLatestAction(identifiers, options)`        |
| Dynamic input schema       | `POST https://www.wixapis.com/v1/actions/dynamic-input-schema`                | `getActionDynamicInputSchema(appId, options)`  |
| Dynamic output schema      | `POST https://www.wixapis.com/v1/actions/dynamic-output-schema`               | `getActionDynamicOutputSchema(appId, options)` |

- **Resolve**: `{query{filter, paging{limit, offset}, fields?}}` → `actions[]`, `paging`. Offset
  paging only (`cursorPaging` is rejected). Entries carry full `inputSchema`, `outputSchema`,
  `uiSchema` — large. Filter by `appId`/`actionKey`, page ≤ 25.
- **Global catalog**: not site-scoped; "latest" may be newer than what the site runs.
- **Runtime action**: → `action`. Use this schema when configuring for this site. Latest version
  is for reference only.
- **Dynamic input**: `{appId, actionKey, inputMapping}` → `{inputSchema, uiSchema}`. Call when an
  input property has `updateSchemaOnChange: true` (no public `getDynamicInputSchema` flag);
  re-call after changing such a field.
- **Dynamic output**: `{appId, actionKey, inputMapping}` → `outputSchema`; bulk
  (`bulkGetActionDynamicOutputSchemas`, POST `/v1/actions/bulk/dynamic-output-schema`, ≤ 20 items) →
  `results[]{itemMetadata{success, error}, outputSchema}`. Only after that action's mapping is
  final. Safe for any action you place upstream of a step that reads its output (no public flag
  says which are dynamic); an error means "no dynamic output" — keep the static `outputSchema`.
  Merge into the static schema. A failed bulk item = unknown schema, not empty.
- **Generate Input Mapping From Intent** (`POST https://www.wixapis.com/v1/actions/generate-input-mapping-from-intent`)
  is AI-backed — don't call it. Actions you can't map from their schema are outside this stage; explain the limit.
- **Later stages only — email is outside stage 2:** **Email content of an existing Send an email step** — Get / Set Email Content; procedure in Automations Email Actions (not yet published).
- **Later stages only — email is outside stage 2:** **New Send an email step** — Generate Action Input Mapping; procedure in Automations Email Actions (not yet published).

Action objects: `appId`, `actionKey`, `displayName`, `description`, `inputSchema`, `outputSchema`,
`interfaceConfiguration{type: GENERIC\|WIDGET_COMPONENT, genericOptions.uiSchema}`,
`implementedMethods{validateConfiguration, getQuotaInfo}` (public). Resolve Actions has **no**
`basicFieldsOnly` option (only Resolve Triggers does). Mapping rules: [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration).

## 5. Activations (`activations`)

- **Later stages only — not in stage 2:** **Test Automation** — runs every action for real; published in stage 3.
- **Later stages only — not in stage 2:** **Run Automation / Report Event / Rerun Activation** — for the app that owns a trigger; never
  use them to build or "test".

## 6. Catalog discovery without flooding your context

1. **Browse cheaply.** Triggers: `resolveTriggers({basicFieldsOnly: true, query: {paging: {limit: 25,
offset: N}}})`. Actions: `resolveActions` with small pages; keep only `appId`, `actionKey`/
   `triggerKey`, `displayName`, `description`, `interfaceConfiguration.type`. Field projection (`fields`) may
   be ignored — strip locally in code before anything reaches your reasoning context. Even with
   `basicFieldsOnly`, 100 triggers is ~100 KB: keep pages ≤ 25 when results land in your context.
2. **Cache** that compact list per site for the session and search it locally. Fetch each catalog
   page and static schema once; never re-fetch one you already have. Dynamic schemas are the
   exception: re-call them after changing an `updateSchemaOnChange` field.
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

- Search by concept with a keyword ladder ("chat" → "message"). Common aliases: send a chat
  message = `send-message` (Inbox; not `inbox-send-message`); email to anyone, incl. the site
  owner = `triggered-emails` (never the deprecated `send-mail` / "Get an email"); task =
  `createTask`; labels = `addLabelsToContact` / `remove_labels_to_contact`; create a contact =
  `contacts-create_contact` (for triggers whose payload has no contact, e.g. webhooks).
- Near-duplicates exist (`booking_canceled` vs `bookings_canceled`; new Wix Forms app vs legacy
  "Form submitted"). Compare payload schemas and filters; prefer the one whose entities you can
  actually find on the site (Automations Entity and Provider Configuration (not yet published)).
- Enum-like fields often list legal values only in the field `description` (e.g. paymentStatus
  NOT_PAID / PAID). Read descriptions before mapping user words; never invent enum values.

## 7. Aggregated schema — computed locally (no API takes an unsaved graph)

Node N may read the trigger payload + each **ancestor**'s output (under its namespace) +
variables + identity enrichment. Recipe and fetch order: [Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4.

## 8. Selector options and APIs with limitations

> **Later stages only:** not available in stage 2; this section is published in stage 3.

**In this stage:** a "draft" is an automation created `INACTIVE` (builder drafts are invisible to the public API). To validate a saved automation, Get it and Validate the returned object. Check expressions locally, then with Validate Automation.

## Related API references

- [Automations V2](https://dev.wix.com/docs/api-reference/business-management/automations/automations/automations-v2/introduction)
- [Resolve Triggers](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-catalog/resolve-triggers)
- [Resolve Actions](https://dev.wix.com/docs/api-reference/business-management/automations/actions/action-catalog/resolve-actions)
- [Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/introduction)

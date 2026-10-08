---
name: "Automations Entity and Provider Configuration"
description: "Resolve entity identifiers using List Selector Options or vertical APIs, and find provider-owned automation configuration workflows."
---

> **Stage scope:** this stage covers only what [Build and Manage Wix Automations](https://dev.wix.com/docs/api-reference/business-management/automations/skills/build-and-manage-wix-automations) lists; do not perform anything marked "Later stages only", and follow the instruction attached to each guide marked "not yet published".

# Entity IDs and Provider APIs

Many trigger filters, action inputs and condition fields take the **id** of something that
already exists on the site — a form, label, service, product, coupon. This file covers how to
tell which entity a field needs, how to get real ids through public APIs, how the builder shows
them, and which components need special handling.

**TL;DR**

- The field's metadata tells you **what** entity it needs (§1). **List Selector Options** returns
  every entity field of a trigger or action with the site's options (§2). The vertical's own public
  API is also a valid choice; neither route is mandatory when the other resolves the correct ids.
- Put **ids** in the automation, never display names. A name validates as a string, never matches
  at runtime, and shows as a red "Item not found" tag in the builder.
- A failed or unauthorized lookup means the options are **unknown**, not that the entity doesn't
  exist. Ask the user; never guess an id and never conclude "you have no such form".
- You can select only entities that exist. Labels, coupons, forms, pipelines, badges and email
  templates can't be created for the user here — if one is missing, the user creates it first.
- Some components need a dedicated provider API or can't be configured publicly at all (§3).

## 1. Recognizing an entity field

- **Action `uiSchema`** (static or from the dynamic input schema): `"ui:widget": "EntitySelector"` +
  `entitySelectorOptions{selectorId | tag, filters, dynamicFiltersMapping}` → entity id(s).
  `selectorId` = `<appId>_<providerName>` (e.g. `…_couponsPicker`) names one kind; `tag` names a
  family — ids from any provider in it are valid.
- **Input / payload / aggregated schema field**: `itemsSelectionConfiguration{providerKey, tag}` →
  an entity id or key of that kind.
- **Trigger `filters[]` entry**: `valueInput.type: "ENTITY_SELECTOR"` +
  `entitySelector{id, multiSelect, queryFieldToFilterIdMapping, queryFieldToValueMapping}` → ids as
  **quoted string literals** in a literal array ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.1). `queryFieldToFilterIdMapping`
  = depends on another filter; `queryFieldToValueMapping` = fixed constraints (e.g.
  `{namespace: "wix.form_app.form"}`) — honor them in your lookup.

No marker (common on `WIDGET_COMPONENT` actions): infer the entity from the field name,
`title`/`description` and the owning app — e.g. `labelKeys` on the Contacts add-label action →
label keys; `contactId` → map it from the payload, not a lookup. Can't tell → ask.

**How the builder renders an action entity selector** (MUST follow):

- **Shape follows the schema type.** `type: "string"` → exactly one id (`"couponId": "<uuid-1>"`);
  never an array. `type: "array"` → array of ids, **max 50**; with no selection, omit the key
  (the picker writes nothing, not `[]`). Trigger filters use a literal array of quoted ids even for one value
  ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.1–4.2); conditions compare with `stringContains(["<id>"];var("field"))` ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)).
- **Exact id match.** The picker loads titles by querying the provider and matching
  `item.id === value` exactly. Use the identifier the entity's API returns, unchanged — not
  always a uuid (contact labels use a `key` such as `custom.vip`). Never reformat or lower-case it.
- **Unknown / stale id** (deleted entity, another site's id, a name, a lookup that failed) → red
  "Item not found" tag and a "some items were removed" warning; the value is kept but the step
  fails at runtime. On **update**, re-verify every existing id you keep through §2; replace or ask
  about missing ones — never carry ids across sites or from examples.
- **`dynamicFiltersMapping`** = `{"<filterKey>": {"pathToValue": "<field in this mapping>"}}`: the
  options are filtered by another field of the same mapping (stage ← pipeline, step ← program,
  ticket ← event). MUST set that parent field in the same mapping, and the child id MUST belong to
  that parent — the picker queries with the parent as filter, so a child from another parent shows
  "Item not found". With the parent empty the picker is disabled; when the user changes the parent,
  the child is cleared.
- Static `entitySelectorOptions.filters` restrict the options too; apply the same restriction in
  your own lookup.

## 2. Getting ids through public APIs

### List Selector Options

Call **List Selector Options** (Automations Skills API) once per trigger or action you configure:
it returns each entity field's path, value shape and options, with fixed and parent filters
already applied. Match the user's wording to option names and save the returned ids unchanged;
pass a parent's id in `selectedValues` to list a dependent field. Vertical APIs below remain
valid alternatives.

Load Automations Item Selection (topic guide not yet published; until it is published, resolve IDs with a vertical public API or ask the user) for the request, statuses, value shapes and permissions. A `FAILED` or
`INCOMPLETE` field, or a call you cannot make, means the options are unknown; never invent an id.

### Vertical APIs — supported alternatives

1. From the marker, identify the entity kind (provider name after `_`, field title, owning app).
2. Use a confirmed lookup below, or verify a candidate's provider compatibility first. Call it
   with the same auth as the automations calls (the
   vertical's read scope is needed too). Page small; keep only `{id, name}`.
3. Match the user's wording to the names. One clear match → use its id. Several → ask the user to
   choose. None → say it wasn't found and ask (it may be named differently, or need creating).
4. Record `{entityKind, id, name, source}` so you can show the user what you selected.
5. Endpoint fails (401/403/404/5xx/timeout) or the kind isn't listed → options unknown: ask for
   the exact entity (or its id). Never fall back to the display name.

### Confirmed lookup endpoints

Use the following lookups with the site's authorized vertical read scope. Still inspect the
returned entity and expected field type before saving an ID.

- **Wix Forms app forms** (`formAppSelectionProvider`, `formApp`) — `POST https://www.wixapis.com/form-schema-service/v4/forms/query`
  with `{"query": {"filter": {"namespace": {"$eq": "wix.form_app.form"}}}}` (namespace filter required).
  Form fields for field-level filters come from the form's `fields`.
- **Contact labels** (`LabelsItemsSelection`, `labels`) — `POST https://www.wixapis.com/contacts/v4/labels/query` or `GET https://www.wixapis.com/contacts/v4/labels`. Use the label `key`, not `displayName`.
- **Bookings services** (`bookingsServices`) — `POST https://www.wixapis.com/bookings/v2/services/query` → service `id`.
- **Events** (`eventId`) — `POST https://www.wixapis.com/events/v3/events/query`.
- **Business locations** (`LocationsProvider`) — `POST https://www.wixapis.com/locations/v1/locations/query`.

### Unverified provider mappings — confirm before use

**The following are investigation candidates, not verified configuration recipes.** A public
vertical API may exist without its IDs matching this selector provider. Before using any
returned ID, verify the public method contract and the provider's expected ID against a known
site entity or supported selector result. If that evidence is unavailable, ask for the exact ID
or leave an optional field unconfigured with an explanation. Do not treat an endpoint's existence
as proof of provider compatibility, and do not invent a gateway URL.

- **Legacy Wix Forms** (`<appId>_forms`) — use List Selector Options for its trigger; prefer the Wix Forms app trigger family when the site uses it.
- **Contact segments** (`ContactsSegmentsItemsSelection`).
- **Pricing plans** (`PricingPlansSelectionProvider`) — `POST https://www.wixapis.com/pricing-plans/v3/plans/query` → plan `id`.
- **Stores products** (`products`) — Catalog V3 `POST https://www.wixapis.com/stores/v3/products/query`; V1 `POST https://www.wixapis.com/stores-reader/v1/products/query`.
  Use the site's catalog version; order line items carry the product `id` as `rootCatalogItemId`.
- **Coupons** (`couponsPicker`) — `POST https://www.wixapis.com/stores/v2/coupons/query` → coupon `id`.
- **Ticket definitions** (`ticketDefinitions`) — candidate `POST https://www.wixapis.com/events-ticket-definitions/v3/ticket-definitions/query`, filtered by the chosen event. Provider ID compatibility is unverified.
- **Table reservation locations** (`tableReservations`) — `POST https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations/query`.
- **Online programs / steps** (`online_programs_provider`, `online_program_steps_provider`) —
  `POST https://www.wixapis.com/online-programs/v3/programs/query`; `POST https://www.wixapis.com/online-programs/v3/steps/query` within the chosen program.
- **Pipelines / stages** (`PipelinesItemSelectionProvider`, `PipelineStagesItemsSelectionProvider`) —
  `POST https://www.wixapis.com/crm/pipelines/v1/pipelines/query` or one pipeline `GET https://www.wixapis.com/crm/pipelines/v1/pipelines/{pipelineId}`;
  stages are `stages[].id` of the chosen pipeline.
- **Member badges** — `POST https://www.wixapis.com/badges/v4/badges/query`. **Groups** (`GroupsItemSelectionProvider`) —
  `POST https://www.wixapis.com/social-groups-proxy/groups/v2/groups/query`. **Loyalty tiers** (`TiersSelectionProvider`) — `GET https://www.wixapis.com/loyalty-tiers/v1/tiers`.
- **CMS collections** (`CmsItemSelectionAutomationTrigger`, `cmsFormDatasetSelectionService`) — `GET https://www.wixapis.com/wix-data/v2/collections` → collection `id`.
- Workflows/steps, assignees, invoices, price quotes, proposals, site pages, email campaigns,
  countries, reports, other app pickers — use List Selector Options, otherwise ask.
  For fixed-value lists the schema `enum` is authoritative.

- **Task assignee for "me" / "the team" / "front desk"**: if neither List Selector Options nor a
  verified vertical API resolves the required user id, and the field is optional,
  leave it empty and tell the user to pick
  the assignee in the builder; never invent an id. If it is required, ask.


List Selector Options belongs to the Automations Skills API, not the Automations catalogs
([Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §8); use it or a documented vertical endpoint. With near-duplicate triggers (two "form submitted"), the family whose entities you can
actually find on the site is the live one.

## 3. Provider APIs registry

Components needing handling beyond "map the input schema". Match by `appId` + key from Resolve.

**Send an email** — initialize each new `triggered-emails` action with **Generate Action Input
Mapping**, whether creating an automation or adding a step during Update; persist before content
edits. Existing email content edits use Get / Set Email Content without initialization.
See [Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) for the public endpoint, settings, sequence and recipient verification.

- **Unsupported / legacy — never add** ([Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §1–§2): `send-mail` ("Get an
  email" → `triggered-emails`); `send-coupon-action` (hidden, no selector → `wixcoupons-retrieve_coupon`
  feeding a message — confirm it delivers what the user wants); Velo and code-variable
  (data-manipulation-code) actions (Create is refused; alternatives [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4); site
  actions / Wix custom action `wix_automations-wix_api_integration` (not public — offer a built-in
  action; never invent its `inputMapping`). Leave existing ones untouched.
- **Webhook trigger** — Automations app `139ef4fa-c108-8f9a-c7be-d5f492a2c939` / `wix_automations-webhook_trigger`:
  generate a fresh uuid webhook id, set it per [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) / [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling), define
  `trigger.overrideSchema` with the posted fields (keep `webhookId`); give the user the URL
  ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6) — the builder shows the same one.
- **Custom trigger** — `wix_automations-custom_trigger`: define `overrideSchema`; the automation runs only
  when the user's site code calls Run Trigger (`hookId`, snippet and REST call: [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6).
- **Scheduled trigger** — `wix_automations-scheduled_trigger`: timing in `automationConfigMapping`;
  site time zone from Site Properties, else ask ([Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4).
- **Webhook action** (`webhooks-action`, "HTTP request") — collect URL, method and body fields from the
  user up front. Its input schema has **no header/auth input**: if the endpoint needs auth, it can go
  in the URL only if the receiving service supports that (e.g. a token query parameter) — otherwise
  tell the user it can't be configured here. `appDefinedInfo.overrideOutputSchema` only if a later
  step reads the response.
- **Generate or analyze text** (`wix_automations-llm_call`) / **Custom AI agent**
  (`ai_custom_agent_bm-delegate_to_agent`) — `overrideOutputSchema` when a later step consumes the
  result, per the per-action rules in [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3 (`enum` decision fields,
  concrete `{{var(…)}}` inputs in the prompt, agent schema matches its task). Delegate-to-assistant
  exposes only `summary`.
- **Manual-setup actions** (Google Sheets, OAuth/third-party apps) — add the node, map what you can,
  state the manual steps; expect `PROVIDER_ERROR` from Validate until the user connects the account.

Override output schemas are allowed only on the webhook and custom triggers and the webhook, LLM
and custom-agent actions ([Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling)).

### Email configuration

New email initialization, existing content edits, recipient encoding and the existing-owner
audience exception are documented in [Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions). Use that reference before configuring
any email step; do not hand-author or reuse an email's opaque mapping.

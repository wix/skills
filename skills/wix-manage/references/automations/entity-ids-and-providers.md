---
name: "Automations Entity and Provider Configuration"
description: "Resolve entity identifiers and provider-owned configuration, including existing automation email content and pending email initialization support."
---

# Entity IDs and Provider APIs

Many trigger filters, action inputs and condition fields take the **id** of something that
already exists on the site — a form, label, service, product, coupon. This file covers how to
tell which entity a field needs, how to get real ids through public APIs, how the builder shows
them, and which components need special handling.

**TL;DR**

- The field's metadata tells you **what** entity it needs (§1). There is no public generic
  "selector options" API: fetch ids from **that vertical's own public API** (§2), or ask the user.
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
  **quoted string literals** in a literal array ([triggers.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.1). `queryFieldToFilterIdMapping`
  = depends on another filter; `queryFieldToValueMapping` = fixed constraints (e.g.
  `{namespace: "wix.form_app.form"}`) — honor them in your lookup.

No marker (common on `WIDGET_COMPONENT` actions): infer the entity from the field name,
`title`/`description` and the owning app — e.g. `labelKeys` on the Contacts add-label action →
label keys; `contactId` → map it from the payload, not a lookup. Can't tell → ask.

**How the builder renders an action entity selector** (MUST follow):

- **Shape follows the schema type.** `type: "string"` → exactly one id (`"couponId": "<uuid-1>"`);
  never an array. `type: "array"` → array of ids, **max 50**; with no selection, omit the key
  (the picker writes nothing, not `[]`). Trigger filters use a literal array of quoted ids even for one value
  ([triggers.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §4.1–4.2); conditions compare with `stringContains(["<id>"];var("field"))` ([conditions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)).
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

1. From the marker, identify the entity kind (provider name after `_`, field title, owning app).
2. Call the vertical's list/query endpoint below with the same auth as the automations calls (the
   vertical's read scope is needed too). Page small; keep only `{id, name}`.
3. Match the user's wording to the names. One clear match → use its id. Several → ask the user to
   choose. None → say it wasn't found and ask (it may be named differently, or need creating).
4. Record `{entityKind, id, name, source}` so you can show the user what you selected.
5. Endpoint fails (401/403/404/5xx/timeout) or the kind isn't listed → options unknown: ask for
   the exact entity (or its id). Never fall back to the display name.

REST base `https://www.wixapis.com`. ✅ endpoint confirmed · ⚠️ public API exists, mapping to this
provider unconfirmed — verify returned ids against a known value, or ask · ❓ no public API — ask.

- ✅ **Wix Forms app forms** (`formAppSelectionProvider`, `formApp`) — `POST /form-schema-service/v4/forms/query`
  with `{"query": {"filter": {"namespace": {"$eq": "wix.form_app.form"}}}}` (namespace filter required).
  Form fields for field-level filters come from the form's `fields`.
- ❓ **Legacy Wix Forms** (`<appId>_forms`) — ask; prefer the Wix Forms app trigger family when the site uses it.
- ✅ **Contact labels** (`LabelsItemsSelection`, `labels`) — `POST /contacts/v4/labels/query` or `GET /contacts/v4/labels`. Use the label `key`, not `displayName`.
- ❓ **Contact segments** (`ContactsSegmentsItemsSelection`).
- ✅ **Bookings services** (`bookingsServices`) — `POST /bookings/v2/services/query` → service `id`.
- ⚠️ **Pricing plans** (`PricingPlansSelectionProvider`) — `POST /pricing-plans/v3/plans/query` → plan `id`.
- ⚠️ **Stores products** (`products`) — Catalog V3 `POST /stores/v3/products/query`; V1 `POST /stores-reader/v1/products/query`.
  Use the site's catalog version; order line items carry the product `id` as `rootCatalogItemId`.
- ⚠️ **Coupons** (`couponsPicker`) — `POST /stores/v2/coupons/query` → coupon `id`.
- ✅ **Events** (`eventId`) — `POST /events/v3/events/query`; ⚠️ **ticket definitions** (`ticketDefinitions`) —
  `POST /events-ticket-definitions/v3/ticket-definitions/query`, filtered by the chosen event.
- ✅ **Business locations** (`LocationsProvider`) — `POST /locations/v1/locations/query`.
- ⚠️ **Table reservation locations** (`tableReservations`) — `POST /table-reservations/reservation-locations/v1/reservation-locations/query`.
- ⚠️ **Online programs / steps** (`online_programs_provider`, `online_program_steps_provider`) —
  `POST /online-programs/v3/programs/query`; `POST /online-programs/v3/steps/query` within the chosen program.
- ⚠️ **Pipelines / stages** (`PipelinesItemSelectionProvider`, `PipelineStagesItemsSelectionProvider`) —
  `POST /crm/pipelines/v1/pipelines/query` or one pipeline `GET /crm/pipelines/v1/pipelines/{pipelineId}`;
  stages are `stages[].id` of the chosen pipeline.
- ⚠️ **Member badges** — `POST /badges/v4/badges/query`. ⚠️ **Groups** (`GroupsItemSelectionProvider`) —
  `POST /social-groups-proxy/groups/v2/groups/query`. ⚠️ **Loyalty tiers** (`TiersSelectionProvider`) — `GET /loyalty-tiers/v1/tiers`.
- ⚠️ **CMS collections** (`CmsItemSelectionAutomationTrigger`, `cmsFormDatasetSelectionService`) — `GET /wix-data/v2/collections` → collection `id`.
- ❓ Workflows/steps, assignees, invoices, price quotes, proposals, site pages, email campaigns,
  countries, reports, other app pickers — ask. For fixed-value lists the schema `enum` is authoritative.
- **Task assignee for "me" / "the team" / "front desk"**: no public API resolves the owner's or a
  team member's user id. If the assignee field is optional, leave it empty and tell the user to pick
  the assignee in the builder; never invent an id. If it is required, ask.

The Automations APIs don't expose selector options ([api-catalog.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §8); don't call undocumented
endpoints. With near-duplicate triggers (two "form submitted"), the family whose entities you can
actually find on the site is the live one.

## 3. Provider APIs registry

Components needing handling beyond "map the input schema". Match by `appId` + key from Resolve.

**Email creation dependency:** the default-input-mapping API is not available yet. Once its
contract is provided, the intended flow is: initialize the email's default mapping → persist
the first inactive automation containing that step → use the existing Get / Set Email Content
API to configure its content to the user's request → read back and validate. Do not invent an
initializer endpoint or use Generate Input Mapping From Intent in its place. Until then, use
the builder fallback below for new email steps; content editing of existing steps is available.

- **Send an email** — Triggered Emails `135c3d92-0fea-1f9d-2ba5-2a1dfb04297e` / `triggered-emails`
  (`WIDGET_COMPONENT`). Adding one: not possible through the public APIs — save the rest, the user
  adds it in the builder ([actions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1). Changing an existing one's subject / preview text /
  body: the **Automation Email Action API** (below). Saved shape and recipients: below.
- **Unsupported / legacy — never add** ([limitations-and-planning.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §1–§2): `send-mail` ("Get an
  email" → `triggered-emails`); `send-coupon-action` (hidden, no selector → `wixcoupons-retrieve_coupon`
  feeding a message — confirm it delivers what the user wants); Velo and code-variable
  (data-manipulation-code) actions (Create is refused; alternatives [special-actions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4); site
  actions / Wix custom action `wix_automations-wix_api_integration` (not public — offer a built-in
  action; never invent its `inputMapping`). Leave existing ones untouched.
- **Webhook trigger** — Automations app `139ef4fa-c108-8f9a-c7be-d5f492a2c939` / `wix_automations-webhook_trigger`:
  generate a fresh uuid webhook id, set it per [triggers.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) / [schemas-and-scheduling.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling), define
  `trigger.overrideSchema` with the posted fields (keep `webhookId`); give the user the URL
  ([triggers.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6) — the builder shows the same one.
- **Custom trigger** — `wix_automations-custom_trigger`: define `overrideSchema`; the automation runs only
  when the user's site code calls Run Trigger (`hookId`, snippet and REST call: [triggers.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6).
- **Scheduled trigger** — `wix_automations-scheduled_trigger`: timing in `automationConfigMapping`;
  site time zone from Site Properties, else ask ([schemas-and-scheduling.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4).
- **Webhook action** (`webhooks-action`, "HTTP request") — collect URL, method and body fields from the
  user up front. Its input schema has **no header/auth input**: if the endpoint needs auth, it can go
  in the URL only if the receiving service supports that (e.g. a token query parameter) — otherwise
  tell the user it can't be configured here. `appDefinedInfo.overrideOutputSchema` only if a later
  step reads the response.
- **Generate or analyze text** (`wix_automations-llm_call`) / **Custom AI agent**
  (`ai_custom_agent_bm-delegate_to_agent`) — `overrideOutputSchema` when a later step consumes the
  result, per the per-action rules in [schemas-and-scheduling.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §3 (`enum` decision fields,
  concrete `{{var(…)}}` inputs in the prompt, agent schema matches its task). Delegate-to-assistant
  exposes only `summary`.
- **Manual-setup actions** (Google Sheets, OAuth/third-party apps) — add the node, map what you can,
  state the manual steps; expect `PROVIDER_ERROR` from Validate until the user connects the account.

Override output schemas are allowed only on the webhook and custom triggers and the webhook, LLM
and custom-agent actions ([schemas-and-scheduling.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling)).

### Send an email — saved shape, content API and recipient encoding

**Saved shape.** The step's `inputMapping` is owned by the emails app. Typical keys: `messageId`
(the email) or `templateId` + `uniqueRuleId`, `contactId`, `selectedAudience`, `dynamicParams[]`,
`transactional`, `sendToUnsubscribed`, `notificationTopicId`, `disabledAttachments`,
`actionConfigVersion`. Keep all of them byte-for-byte on every Update — the one exception is the
site-owner `selectedAudience` replacement below; never write them into a new step or copy them to
another step ([actions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1).

**Change the content of an existing email step** — Automation Email Action API
(`https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/introduction.md`,
SDK `@wix/automations-email-actions`, scope _Manage Email Marketing_). The content is addressed by
the automation id and the step's action id — no `messageId`:

| Purpose           | REST                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Get Email Content | `GET /emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content`  |
| Set Email Content | `POST /emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content` |

1. Get Email Content (optional `language` query param) → `content{emailSubject, emailPreheader,
composer{composerDataJson, defaultValues.map}, editorType}`.
2. Change only what the user asked: `emailSubject`, `emailPreheader`, and text inside
   `composer.composerDataJson` (a proprietary JSON string for `WEB`, MJML wrapped as `{"mjml": …}`
   for `MJML`). Keep its structure, placeholders and `defaultValues` exactly; never switch
   `editorType`. Placeholders look like `${contact.phone}`; use only ones whose value the step
   already passes in `inputMapping.dynamicParams` (e.g. `{{var("contact.phone")}}`) — that link
   isn't documented, so a field not listed there is added by the user in the email editor.
3. Set Email Content with the WHOLE modified `content` (+ the same `language`). It replaces the
   content in full — anything left out is cleared.
4. Get Email Content again to confirm.

MUST before step 3: tell the user and get an OK — the new content is **live** for the next runs
immediately (even on an ACTIVE automation, and every draft translation is published), there is no
revision check (last write wins), and on a preinstalled automation the first write creates the
site's own copy. The API changes content only — not the recipients, and it can't create the step.

**Recipient encoding** — audit which people receive it:

Current shape — `selectedAudience.audienceSelectors[]`, one entry per audience:

```json
[
  {
    "providerId": "explicitData_triggerMainContact",
    "audienceParams": {
      "participants": [{ "type": "CONTACT", "value": "{{var(\"contactId\")}}" }]
    }
  },
  {
    "providerId": "<appId>_CollaboratorRoles",
    "audienceParams": { "roleIds": ["<role-id>"] }
  },
  {
    "providerId": "<contacts-app-id>_labels",
    "audienceParams": { "labelIds": ["custom.<key>"] }
  }
]
```

= trigger/ancestor contact · site owner / team by role · contacts with a label. Older flat shape (no `audienceSelectors`):
trigger contact = root `contactId: "{{var(…)}}"` with `triggerContactExcluded` absent or `false` **and no other audience** set;
owner/team = `selectedAudience.contributorRoleIds: ["<role-id>"]` **and**
`triggerContactExcluded: true`; label audience = `selectedAudience.labelIds`.

- With `audienceSelectors`, the recipients are **exactly** the listed selectors;
  `triggerContactExcluded: true` is normal there even for a contact email.
- A root `contactId` can appear in every shape (it gives the email its contact context and
  placeholders). It is **not** proof the contact receives it.
- Owner-only request → a role selector (or `contributorRoleIds` + `triggerContactExcluded: true`)
  and **no** trigger-contact recipient. Flat shape with roles but `triggerContactExcluded: false`:
  on a trigger **without** a contact (scheduled, …) that is owner/team-only — accept it; on a trigger that carries a contact, treat it as
  owner AND contact.
- A recipient that doesn't match the request is reported to the user; recipients are changed in the
  builder's email editor (the one exception: the site-owner shape below). Never report a wrong
  audience as correct.

**Rules that apply regardless of API**

- Recipients the action supports: the trigger contact; the site owner / contributors ("Can it go to
  the owner?" — yes); an existing contact. Custom addresses, CC/BCC, ad-hoc lists, addresses from
  variables and conditional recipients: [limitations-and-planning.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §3.
- **Existing email that must go to the owner** (the user said "me" / "the owner"): set the audience
  to the owner shape Wix's own templates use — keep the root `contactId` and every other key, and
  replace only `selectedAudience` (Update Automation):

  ```json
  "selectedAudience": { "contributorRoleIds": ["6601492336091027458"], "triggerContactExcluded": true,
    "audienceSelectors": [], "contactIds": [], "customRecipients": [], "labelIds": [],
    "recipientEmails": [], "segmentIds": [], "userIds": [] }
  ```

  (`6601492336091027458` = the site-owner role.) Then Validate and tell the user it's addressed to
  the site owner. This is the only audience edit allowed. If the user didn't say who receives it, ask.

- Email content (subject, preview text, body) of an existing step: Set Email Content (above), after
  the user's OK. New email steps: added by the user in the builder ([actions.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1).
- **Attachments are supported** but can't be added through the API: keep the email and tell the
  user to add files in the email editor — never call them impossible, swap in a link or recreate
  the email ([limitations-and-planning.md](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §3, also video). Templates can't be created via API.
  Never fabricate business content (hours, prices) — ask.

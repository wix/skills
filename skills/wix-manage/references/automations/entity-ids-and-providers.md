---
name: "Automations Entity and Provider Configuration"
description: "Resolve entity identifiers through verified vertical read APIs and find provider-owned automation configuration workflows."
---

# Entity IDs and Provider APIs

Many trigger filters, action inputs and condition fields take the **id** of something that
already exists on the site — a form, label, service, product, coupon. This file covers how to
tell which entity a field needs, how to get real ids through public APIs, how the builder shows
them, and which components need special handling.

**TL;DR**

- The field's metadata tells you **what** entity it needs (§1). Resolve it through the
  owning vertical's verified public read API (§2), retaining the returned id/key and all
  fixed or parent filters. If that lookup cannot establish a usable reference, ask the user.
- Put **ids** in the automation, never display names. A name validates as a string, never matches
  at runtime, and shows as a red "Item not found" tag in the builder.
- A failed or unauthorized lookup means the options are **unknown**, not that the entity doesn't
  exist. Ask the user; never guess an id and never conclude "you have no such form".
- You can select only entities that exist. Labels, coupons, forms, pipelines, badges and email
  templates can't be created for the user here — if one is missing, the user creates it first.
  Look entities up only with read methods (Query, List, Get). A find-or-create endpoint such as
  Find or Create Label is a write: never use it to resolve an id. Keep a supplied id or key as
  unresolved input until a successful read confirms it; do not save an unconfirmed reference.
  A successful, complete lookup with no match blocks that configuration: ask the user to choose
  an existing entity or create it first. A failed or incomplete lookup means unknown, not missing.
- **Before a configuration edit:** re-verify the entities and fields the requested update
  touches, following **Verifying updated selections** in §2 and [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence).
  Preserve untouched steps and fields as fetched; do not add entity lookups for them.
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
  fails at runtime. On **update**, re-verify IDs in the entity fields the request changes through
  §2; replace or ask about missing ones. Preserve untouched fields as fetched; never carry IDs
  across sites or from examples.
- **`dynamicFiltersMapping`** = `{"<filterKey>": {"pathToValue": "<field in this mapping>"}}`: the
  options are filtered by another field of the same mapping (stage ← pipeline, step ← program,
  ticket ← event). MUST set that parent field in the same mapping, and the child id MUST belong to
  that parent — the picker queries with the parent as filter, so a child from another parent shows
  "Item not found". With the parent empty the picker is disabled; when the user changes the parent,
  the child is cleared.
- Static `entitySelectorOptions.filters` restrict the options too; apply the same restriction in
  your own lookup.

## 2. Getting ids through public APIs

### Vertical APIs — default lookup path

1. From the marker, identify the entity kind (provider name after `_`, field title, owning app).
2. Use a confirmed lookup below, or verify a candidate's provider compatibility first. Call it
   with the same auth as the automations calls (the
   vertical's read scope is needed too). Page small; keep the provider's actual selectable value
   and display label: often `{id, name}`, but Contacts Labels return `{key, displayName}`.
3. Match the user's wording to the display labels. One clear match → use its returned selectable value unchanged. Several → ask the user to
   choose. None → say it wasn't found and ask (it may be named differently, or need creating).
4. Record `{entityKind, value, valueField, displayName, source}` so you can show the user what you
   selected. For Contacts Labels, `valueField` is `key`; keep that exact key for `labelKeys` rather
   than discarding it, guessing an `id`, or using `displayName` as the saved value.
5. Endpoint fails (401/403/404/5xx/timeout) or the kind isn't listed → options unknown: ask for
   the exact entity (or its id). Never fall back to the display name.

### Confirmed lookup endpoints

Use the following lookups with the site's authorized vertical scope. Each row is a complete
first-page POST: use the full endpoint shown with its JSON body, then read the response collection.
Names below are placeholders for the user's requested name. Match exactly, retain all matches,
and ask if more than one candidate remains. Apply the selector's additional fixed and parent filters;
a name match alone does not establish provider compatibility.

| Entity / provider                                     | POST endpoint                                                | Minimal first-page body                                                                        | Response values and official contract                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wix Forms app (`formAppSelectionProvider`, `formApp`) | `https://www.wixapis.com/form-schema-service/v4/forms/query` | `{"namespace":"wix.form_app.form","query":{"cursorPaging":{"limit":50}}}`                      | `forms[]`: select `id`, display `name`; field definitions are `formFields`. [Query Forms](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/query-forms), View Forms permission.                                                                                                                                                                                          |
| Contact labels (`LabelsItemsSelection`, `labels`)     | `https://www.wixapis.com/contacts/v4/labels/query`           | `{"query":{"filter":{"displayName":{"$eq":"<label name>"}},"paging":{"limit":50,"offset":0}}}` | `labels[]`: select `key`, display `displayName`. [Query Labels](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/query-labels), Manage Contact Labels permission. This lookup workflow does not authorize creating a label.                                                                                                                                |
| Bookings services (`bookingsServices`)                | `https://www.wixapis.com/bookings/v2/services/query`         | `{"query":{"filter":{"name":{"$eq":"<service name>"}},"paging":{"limit":50,"offset":0}}}`      | `services[]`: select `id`, display `name`. [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services), Read Bookings – Public Data permission.                                                                                                                                                                          |
| Events (`eventId`)                                    | `https://www.wixapis.com/events/v3/events/query`             | `{"query":{"filter":{"title":{"$eq":"<event title>"}},"paging":{"limit":50,"offset":0}}}`      | `events[]`: select `id`, display `title`. [Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events), Read Events permission. Set a positive limit: the default `0` returns no events. Drafts require separate permission and `includeDrafts:true`; without that scope, do not conclude the site has no matching draft. |
| Business locations (`LocationsProvider`)              | `https://www.wixapis.com/locations/v1/locations/query`       | `{"query":{"filter":{"name":{"$eq":"<location name>"}},"paging":{"limit":50,"offset":0}}}`     | `locations[]`: select `id`, display `name`. [Query Locations](https://dev.wix.com/docs/api-reference/business-management/locations/query-locations), Read Locations permission.                                                                                                                                                                                                       |

**Pagination is part of resolving ambiguity or absence.**

1. **Forms — cursor paging.** While `metadata.hasNext` is true, send
   `{"query":{"cursorPaging":{"cursor":"<metadata.cursors.next>"}}}` to the same endpoint,
   without repeating first-page filters/sort.
2. **Other rows — offset paging.** Advance `query.paging.offset` by `pagingMetadata.count`,
   preserving the filter and limit. For Locations, continue only while `pagingMetadata.hasNext`
   is true. For Labels, Bookings and Events, use `pagingMetadata.total` when available and
   reliable (`tooManyToCount` is not true); otherwise continue until a short/empty page establishes
   the end. An unknown total and a full page require another page.
3. **Incomplete evidence.** An interrupted lookup cannot prove no match or a unique match.
   Never save the placeholders above as identifiers: retain only the actual returned `id` or
   label `key`, shaped as the selector's string/array schema requires.

### Verifying updated selections

Follow the update scope in [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence): re-verify the entities and fields
the requested update touches. A recipient-only edit does not require resolving IDs in an
unchanged add-label step. Read-only status inspection and status-only deactivation do not
require entity lookups; follow the Activation Status guide for those operations.

1. Get the current saved automation and identify the entity fields being added or changed.
   Keep untouched steps and fields exactly as fetched. For a changed entity field, enumerate
   all static IDs/keys the new value will contain, including any selections the user keeps.
   Retain their exact returned values and parent/fixed filters.
   Runtime payload expressions such as `var("contactId")` and opaque provider content identifiers
   such as email message IDs are not static entity selections; preserve those through their owning
   workflow without inventing entity lookups.
2. After that Get and before the configuration write, make a fresh bounded read through an
   applicable read path permitted by this section for the selections in those changed fields.
   Compare each returned selectable ID/key with the intended value. The automation's own stored
   mapping does not prove that a selection still exists. One fresh lookup may verify several
   values of the same kind. Do not repeat unrelated lookups for untouched fields.
3. If a reference is missing, failed or unresolved, stop before writing and ask the user. Do not
   silently replace it, remove the step or claim it was verified. Report incomplete lookup evidence
   honestly using the paging rules above.
4. Build the candidate from the fetched mappings and change only the requested fields. When
   validating or checking the saved result, use the actual returned automation object rather
   than retyping its entity/provider IDs or reconstructing its opaque mappings.

**An unresolved selection blocks the write.** A request to keep existing labels or selections
does not authorize saving a reference that the fresh lookup cannot verify. Stop even when
Validate Automation returns `VALID_WITH_WARNINGS` or a provider warning says the configuration
can be saved as-is: validation severity does not establish entity existence or override this
precondition. Explain which selection is unresolved and ask the user whether to choose a valid
replacement, remove it, or leave the automation unchanged. Wait for their choice before any
configuration write; do not recreate an entity, silently remove its key, or claim the update
was saved. For example: “The selected label `<key>` could not be verified. Should I replace it
with an existing label, remove that selection, or leave this automation unchanged?”

**Changed-label-field verification example.**

When editing a Contacts add-label action's static `labelKeys` array, read kept keys from the
freshly fetched action and resolve any new selections. Verify every key in that edited array;
an untouched add-label step needs no fresh lookup. [Query Labels](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/query-labels)
supports `key.$in`: POST `https://www.wixapis.com/contacts/v4/labels/query` with the actual
keys intended for that edited field (at most 50 per batch), under the same authorized site context:

```json
{
  "query": {
    "filter": {
      "key": { "$in": ["<key kept or selected in the edited labelKeys>"] }
    },
    "paging": { "limit": 50, "offset": 0 }
  }
}
```

Compare keys, not names. A deleted/recreated label can have the same name and a different key;
a renamed label can retain the same valid key. This pure function builds compact evidence
from the candidate node's complete edited array and the fresh Query Labels response body.
Build the candidate from the fetched node, keeping requested selections and adding only verified
new keys; do not include removed selections in this check:

```js
function changedLabelFieldEvidence(candidate, actionId, queryResponse) {
  const selectedKeys =
    candidate.configuration?.actions?.[actionId]?.appDefinedInfo?.inputMapping
      ?.labelKeys;
  if (
    !Array.isArray(selectedKeys) ||
    selectedKeys.some(key => typeof key !== 'string') ||
    !Array.isArray(queryResponse.labels)
  ) {
    throw new Error(
      'Expected static labelKeys and an actual Query Labels response'
    );
  }
  return selectedKeys.map(selectedKey => {
    const match = queryResponse.labels.find(label => label.key === selectedKey);
    return {
      actionId,
      fieldPath: 'appDefinedInfo.inputMapping.labelKeys',
      selectedKey,
      returnedKey: match?.key ?? null,
      verified: match?.key === selectedKey,
    };
  });
}
```

Return these per-selection records from the lookup, including the actual `selectedKey` and
`returnedKey`; a successful call or an unchanged mapping alone is not existence proof.
Proceed only after every selection in the changed field is positively verified. A `false` record is unresolved,
not proof of deletion: finish applicable paging before claiming absence, and stop/ask when a
lookup is failed, incomplete or still unresolved. Preserve every unedited mapping field.
Runtime expressions and opaque provider identifiers remain outside this static-label example.

### Other entity kinds

For legacy forms, contact segments, pricing plans, products, coupons, event ticket definitions,
reservation locations, online programs/steps, pipelines/stages, badges, groups, loyalty tiers,
CMS collections and other app pickers, verify the owning vertical's official public **read**
method and confirm that its returned selectable ID/key matches this provider and all
parent/fixed filters before using it. No endpoint or ID shape for these kinds is assumed here.
Without that evidence, ask the user for an existing entity and a verifiable reference;
do not fabricate a URL or slug.
For fixed-value lists the field's schema `enum` is authoritative.

- **Task assignee for "me" / "the team" / "front desk"**: if no verified vertical
  read API resolves the required user id, and the field is optional,
  leave it empty and tell the user to pick
  the assignee in the builder; never invent an id. If it is required, ask.

With near-duplicate triggers (two "form submitted"), the family whose entities you can
actually find on the site is the live one.

## 3. Provider APIs registry

Components needing handling beyond "map the input schema". Match by `appId` + key from Resolve.

**Send an email** — initialize each new `triggered-emails` action with **Generate Action Input
Mapping**, whether creating an automation or adding a step during Update; persist before content
edits. Existing email content edits use Get / Set Email Content without initialization.
See [Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) for the public endpoint, settings, sequence and recipient verification.

**CUSTOM email recipients** — resolve recipient-provider IDs through [Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) §4,
using its site-scoped audience-provider discovery and schema-defined parameters, rather than an
entity-selector lookup. For a recipient-only Update Automation Email Action PATCH, verify the
new audience selections through that procedure and preserve unrelated saved steps and fields;
do not re-resolve an untouched add-label step's IDs.

**Preservation evidence is separate from entity lookups.** Retain the complete successful
pre-PATCH Automation Get and the complete fresh post-PATCH Get, alongside typed settings/content
snapshots and the PATCH acknowledgement. Return both complete Automation objects, or preferably
a compact executed comparison covering all preserved fields when the snapshots are large
([Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) §4). A creation-candidate comparison establishes only the fields it actually
compares; it does not establish preservation after the recipient PATCH.

- **Unsupported / legacy actions** — before adding an action, check the complete list and
  alternatives in [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §2.
  Never add an unsupported action; leave existing ones untouched.
- **Webhook trigger** — Automations app `139ef4fa-c108-8f9a-c7be-d5f492a2c939` / `wix_automations-webhook_trigger`:
  generate a fresh uuid webhook id, set it per [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) / [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling), define
  `trigger.overrideSchema` with the posted fields (keep `webhookId`); give the user the URL
  ([Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6) — the builder shows the same one.
- **Custom trigger** — `wix_automations-custom_trigger`: define `overrideSchema`; the automation runs only
  when the user's site code calls Run Trigger (`hookId`, snippet and REST call: [Automations Trigger Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-trigger-configuration) §6).
- **Scheduled trigger** — `wix_automations-scheduled_trigger`: timing in `automationConfigMapping`;
  site IANA time zone from current tool metadata for the exact site, with Site Properties as fallback; if neither supplies a valid zone, ask ([Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling) §4).
- **Webhook action** (`webhooks-action`, "HTTP request") — collect URL, method and body fields from the
  user up front. Its input schema has **no header/auth input**: if the endpoint needs auth, it can go
  in the URL only if the receiving service supports that (e.g. a token query parameter) — otherwise
  tell the user it can't be configured here. `appDefinedInfo.overrideOutputSchema` only if a later
  step reads the response.
  Body items marked `_UIRequired` must be mapped, even if absent from JSON Schema `required`.
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

New email initialization, existing content edits, recipient encoding and provider settings
updates are documented in [Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions). Use that reference before configuring
any email step; do not hand-author or reuse an email's opaque mapping.

---
name: "Automations Email Actions"
description: "Initialize new automation email actions, including additions during updates, then configure content and verify recipients while preserving existing emails."
---

# Automation Email Actions

Use the email provider's **Generate Action Input Mapping** for each NEW email action. It is a
non-AI initialization API, distinct from the action catalog's Generate Input Mapping From Intent
(which this skill does not use). Editing an existing email's content uses Get / Set Email Content
in place; do not initialize, delete, recreate or replace that action.

Choose the API by what changes: Generate Action Input Mapping creates a new action's content;
Get / Update Automation Email Action manage settings (§4); Get / Set Email Content manage
the message (§3). Sender assignment, preview and test delivery have separate endpoints (§5).
An existing action is addressed by its automation ID and APP_DEFINED node ID, not its message ID.

## 1. Initialize a new email action

[Generate Action Input Mapping](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/generate-action-input-mapping)
is **Developer Preview** and subject to change. It requires a Wix app or Wix user identity with
**Manage Email Marketing** (`SCOPE.DC-PROMOTE.EMAIL-MARKETING`) and the target site context. Also retain the
Automations permissions needed to persist the step. Initializing CUSTOM recipients also requires
`AUDIENCE.AUDIENCE_PROVIDER_READ`; validate the selected provider data before saving.

```http
POST https://www.wixapis.com/emails-automations/v1/automations/email-actions/generate-input-mapping
Authorization: <AUTH>
Content-Type: application/json
wix-site-id: <site-id>

{
  "action": {
    "emailType": "PROMOTIONAL",
    "recipients": {
      "recipientType": "TRIGGER_CONTACT",
      "triggerContactOptions": { "contactIdPath": "contactId" }
    }
  }
}
```

Here `contactId` is an EXAMPLE: resolve the actual trigger-schema contact identity path first.
Use a property path (`contactId`, `contact.id`, or `items[0].contactId`), not a mapping expression
such as `{{var("contactId")}}`, entity ID or email address. Array indexes are supported by this
recipient API; they do not enable array indexing in agent-authored automation `var()` expressions.
The initializer may return indexed expressions inside its opaque mapping: preserve that entire
response unchanged rather than removing or rewriting provider-generated fields. Verify the
recipient path against the trigger payload schema: the initializer does not check that it exists.
The response is `{appId, actionKey, inputMapping}`.

Equivalent SDK call:

```ts
import { automationEmailAction } from '@wix/automations-email-actions';

const generated = await automationEmailAction.generateActionInputMapping({
  action: {
    emailType: 'PROMOTIONAL',
    recipients: {
      recipientType: 'TRIGGER_CONTACT',
      triggerContactOptions: { contactIdPath: 'contactId' }, // resolved from this trigger's schema
    },
  },
});
```

Request settings (omit only when the default matches the user's request):

| Field                        | Meaning / default                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action.recipients`          | For a trigger contact, use `recipientType: "TRIGGER_CONTACT"` with `triggerContactOptions.contactIdPath`. Omit `recipients` for the SITE OWNER default, or set `recipientType: "SITE_OWNER"`; do not select the trigger contact just because one exists.                                 |
| `action.emailType`           | Defaults to `PROMOTIONAL`, which respects marketing subscription. `BUSINESS_TRANSACTIONAL` requires a transactional notification topic; `BUSINESS_CRITICAL` is for essential messages and forbids a topic. Choose according to actual purpose, never to bypass subscription preferences. |
| `action.notificationTopicId` | Real topic GUID. Promotional defaults to the general promotional topic; transactional requires an appropriate topic; critical must omit it. Never invent a topic.                                                                                                                        |
| `action.senderDetailsId`     | Real sender-details GUID if explicitly selected; otherwise site's default, or Wix-branded fallback.                                                                                                                                                                                      |
| `content`                    | Optional full email content in the Set Email Content shape. Omit for the provider's default template. Stored in the primary language; other site languages start from the default template.                                                                                              |

For a new email with requested copy on a verified single-language site and no requirement to
retain a particular template, prefer supplying initial `content` as `MJML`, the documented
format for writing from scratch. On a multilingual site, the initializer cannot change the
default template's editor format: omit initial content, persist, then Get / Set / Get while
preserving the returned format. Use that same default-template path if the site's language
configuration is unknown; do not assume that an initial MJML payload can change its format.
For example, beside the existing `action` object:

```json
{
  "content": {
    "emailSubject": "Welcome",
    "editorType": "MJML",
    "composer": {
      "composerDataJson": "{\"mjml\":\"<mjml><mj-body><mj-section><mj-column><mj-text>Thanks for joining us.</mj-text></mj-column></mj-section></mj-body></mjml>\"}"
    }
  }
}
```

Omit initial content when the user wants the default template. If starting from that template
and then applying requested copy, Get → Set → Get is the normal edit path; a valid default
template is not evidence that it already contains the requested subject and body.

For a site-owner email with the default type, keep the worked example's `action` wrapper and
omit `recipients`: `{"action": {"emailType": "PROMOTIONAL"}}`. The `action.*`
settings go inside `action`; optional initial `content` is the one top-level field, beside
`action`. This initializes email content; it does not
attach an action to an automation or send an email.

Each call creates **new email content**. Generated content stays a draft while the automation
is a draft or INACTIVE, and goes live when the automation is activated. Saving an INACTIVE
automation alone does not publish it. A later Set Email Content call publishes the content
and every draft translation immediately (§3); it does not activate the automation.
The response's `inputMapping` is opaque. Use it AS IS; do not inject recipients, edit message IDs,
strip unfamiliar keys, or infer a new mapping from an example. Use one response for exactly
ONE action. Two new emails, including copies on different branches, require two calls.
Reusing a mapping shares its content across actions; removing one action deletes the content
the others send.

## 2. Persist, configure and verify

1. Establish the requested recipient and actual trigger identity path. Resolve the email action
   in the site's catalog and check update locks before creating provider resources.
2. Call Generate Action Input Mapping once for each new email step. Omit `content` to start
   from the default template, then configure it after persistence. If supplying content now,
   use the documented content shape; do not invent the proprietary WEB composer structure.
3. Create a fresh APP_DEFINED node with normal `id`, `namespace` and graph edges. Set
   `appDefinedInfo.appId = response.appId`, `actionKey = response.actionKey`, and
   `inputMapping = response.inputMapping` unchanged. This is the only source of new
   provider-owned mapping data.
4. Validate the assembled automation, then persist it. NEW automation: Create with INACTIVE.
   ADDING to an existing automation: Get full configuration and overrides, merge only the
   requested new node/edges, Validate, Update with current revision/origin/settings, then Get.
   Preserve a complete before snapshot. After Get, apply the full before/after comparison in
   [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3: existing nodes' mappings/namespaces/display names and
   top-level configuration must match, except the intended attachment edge. Also compare the
   saved new node's complete opaque mapping with the initializer response. Report those actual
   comparisons; an edge/subject summary is insufficient. If ACTIVE, follow the live-edit authorization rule;
   offer deactivation while configuring the new email rather than promising the default content
   cannot run. Never silently change the user's status.
5. Once persisted, always Get Email Content using the returned automation ID and the new
   node's action ID, including when keeping the default template. Get Automation and typed Get
   Automation Email Action do not return the email content and cannot replace this read-back.
   - **Keep the default template:** verify the returned content, then stop content editing.
     Do not call Set Email Content merely to verify it: that would publish the content and
     draft translations. After the requested workflow, report the actual Get-confirmed status.
     For a verified INACTIVE save with no publishing Set or subsequent activation, report that
     generated content remains draft; saving alone did not publish it. An existing ACTIVE
     automation or a requested activation must not be reported as inactive or draft by default.
   - **Configure requested content:** modify the returned full content → Set Email Content →
     Get Email Content. Preserve editor format unless conversion was requested (§3). When
     optional initial `content` already matches on read-back, no redundant Set is needed.
6. Get the automation, confirm each new step retains its provider mapping and intended audience,
   validate the final configuration, and report status plus any manual setup still required.
   Do not activate or send a test email unless separately requested.

An existing email's content-only edit starts with Get Email Content, not step 2. A new email
added during Update uses this same initialization flow; the containing automation being old
does not make its new action an existing email.

Failures: `INVALID_CONTACT_ID_PATH` means correct the actual schema path;
`NOTIFICATION_TOPIC_REQUIRED` means resolve a transactional topic;
`NOTIFICATION_TOPIC_NOT_SUPPORTED` means omit the topic for a genuinely critical email.
A permission/rollout failure is a blocker, not permission to fabricate a mapping. Report any
already-created draft content or partially persisted configuration accurately; never claim an
atomic transaction. A timeout can have created content: don't blindly repeat this non-idempotent
initializer or discard a successful response after an unrelated revision conflict.
Preview and test delivery are separate, explicitly requested operations (§5), not routine
persistence checks. Mapping-copy flows remain outside scope.

## 3. Existing content and recipient verification

**Saved shape.** The step's `inputMapping` is owned by the emails app. Typical keys: `messageId`
(the email) or `templateId` + `uniqueRuleId`, `contactId`, `selectedAudience`, `dynamicParams[]`,
`transactional`, `sendToUnsubscribed`, `notificationTopicId`, `disabledAttachments`,
`actionConfigVersion`. Keep all of them byte-for-byte on unrelated Update Automation calls.
For requested recipient/type/topic/sender changes use the provider update in §4, rather than
editing these opaque fields yourself. For a NEW step pass the initializer's mapping unchanged;
never copy it to another action.

**Change the content of an existing email step** — Automation Email Action API
([API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/introduction),
SDK `@wix/automations-email-actions`, scope _Manage Email Marketing_). The content is addressed by
the automation id and the step's action id — no `messageId`:

| Purpose           | REST                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Get Email Content | `GET https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content`  |
| Set Email Content | `POST https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content` |

1. Get Email Content (optional `language` query param) → `content{emailSubject, emailPreheader,
composer{composerDataJson, defaultValues.map}, editorType}`. Retain that complete successful
   response and Get Automation with overrides before the content edit, so untouched content and
   the saved email node can be compared after it. Capture the complete pre-write content of any
   other email whose preservation must be checked. If existing nodes share content, explain that
   the edit affects them together and obtain authorization for that impact before writing; never
   reinitialize or replace an existing action merely to make its content independent.
2. For ordinary text edits, change only the requested `emailSubject`, `emailPreheader`, and text
   inside `composer.composerDataJson`; preserve its structure, placeholders, `defaultValues` and
   `editorType`. For WEB/MOBILE, edit an existing returned text region in place; never replace
   the `regions` array with a newly invented text-region object or guess a proprietary layout.
   If the returned template has no identifiable editable text region, report that limitation
   rather than fabricating one. For an explicit format-conversion request, follow the conversion rule below.
   Placeholders look like `${contact.phone}`; use only ones whose value the step
   already passes in `inputMapping.dynamicParams` (e.g. `{{var("contact.phone")}}`) — that link
   isn't documented, so a field not listed there is added by the user in the email editor.
3. Set Email Content with the WHOLE modified `content` (+ the same `language`). It replaces the
   content in full — anything left out is cleared, except an omitted `editorType` keeps the type.
   The content needs `emailSubject` and `composer.composerDataJson`. The encoded composer string
   is limited to 2,000,000 UTF-8 bytes. Invalid WEB structures are rejected with
   `CONTENT_NOT_PUBLISHABLE`; correct the returned structure or report the blocker, never
   retry a fabricated layout.
4. Get Email Content and Get Automation again after the write. Compare the requested content
   with the intended values, every untouched content field with its complete before snapshot,
   and the saved node’s complete `inputMapping`, identity, namespace and graph edges with the
   before Automation Get. Preserve other nodes and settings too. Keep the complete returned
   objects visible, or return comparisons computed from their actual fields with inspectable
   comparison code; action IDs, subjects and a claimed success flag cannot prove mapping
   preservation. For emails initialized during this task, compare each saved mapping with its
   own successful initializer response and verify that those new content identities are distinct.
   For pre-existing emails, compare complete before/after snapshots instead; do not require a
   historical initializer response. Read back the other emails being checked and compare their
   complete content with the snapshots captured before the write. No additional writes are
   needed for these checks.

**Requested format conversion:** [Set Email Content](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/set-email-content)
supports `WEB`, `MJML` and `HTML`. `WEB` → `MJML` is allowed in any language: the API first
converts all other languages to MJML too. That conversion retains base region content but
omits conditional sections, some repeating sections and unsupported regions. Explain that
loss and obtain authorization for the affected translations before conversion; never convert
as a side effect of an ordinary text edit. Every other editor-type change requires content
in a single language. Establish the current format and language count from site configuration
and existing content, or ask if unavailable; a default-language Get alone does not establish
that count. If the requested conversion's precondition is unmet, explain the restriction and
preserve the format. Never initialize a replacement action to bypass it. Set the requested `editorType` together
with correctly encoded content, retaining subject, preheader and placeholder defaults unless
the user asked to change them:

| `editorType` | `composer.composerDataJson` string contains                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB`        | Wix proprietary composer JSON; modify a valid returned structure, never invent one.                                                                                                                       |
| `MJML`       | `{"mjml":"<mjml>…</mjml>"}`                                                                                                                                                                               |
| `HTML`       | `{"html":"<p>…</p>"}`                                                                                                                                                                                     |
| `MOBILE`     | Legacy mobile subset of WEB, which may be returned; preserve it on text edits. The current method's supported-write list names WEB/MJML/HTML, so do not promise conversion to MOBILE from its enum alone. |

`composerDataJson` is a JSON-encoded string, not a nested object. An omitted `editorType` keeps
the stored type; it cannot convert the content. A mismatched format can fail silently during
preview or sending, so read back both type and content. For content written from scratch,
the API recommends MJML; do not guess WEB or MOBILE structures.

MUST before step 3: tell the user that content becomes live and obtain authorization (an explicit
request to configure this email already authorizes that edit; do not ask again). The new content is **live** for the next runs
immediately (even on an ACTIVE automation, and every draft translation is published), there is no
revision check (last write wins), and on a preinstalled automation the first write creates the
site's own copy. The API changes content only — not the recipients, and it can't create the step.
The documented exception is an unpublished builder draft: Set updates that draft without
publishing it or its translations. That is different from a saved INACTIVE automation.
This skill's public Automations V2 flows use saved automations, not unpublished builder drafts.

**Recipient verification:** Get Automation Email Action (§4) gives typed `recipients` and is the
primary settings read-back. The following opaque mapping encodings are useful for auditing
legacy automation snapshots and preserving unrelated configuration; do not hand-edit them.

**Recipient encoding** — audit which people receive it:

Current shape — non-empty `selectedAudience.audienceSelectors[]`, one entry per audience:

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

= trigger/ancestor contact · site owner / team by role · contacts with a label. Older flat shape
(`audienceSelectors` absent or empty):
trigger contact = root `contactId: "{{var(…)}}"` with `triggerContactExcluded` absent or `false` **and no other audience** set;
owner/team = `selectedAudience.contributorRoleIds: ["<role-id>"]` **and**
`triggerContactExcluded: true`; label audience = `selectedAudience.labelIds`.

- With a non-empty `audienceSelectors` array, the recipients are **exactly** the listed selectors;
  `triggerContactExcluded: true` is normal there even for a contact email.
- An absent or empty array uses the legacy fields below it; its owner role and exclusion flag
  still apply.
- A root `contactId` can appear in every shape (it gives the email its contact context and
  placeholders). It is **not** proof the contact receives it.
- Owner-only request → a role selector (or `contributorRoleIds` + `triggerContactExcluded: true`)
  and **no** trigger-contact recipient. Flat shape with roles but `triggerContactExcluded: false`:
  on a trigger **without** a contact (scheduled, …) that is owner/team-only — accept it; on a trigger that carries a contact, treat it as
  owner AND contact.
- A recipient that doesn't match the request is reported to the user and corrected through
  Get / Update Automation Email Action (§4), when authorized. Never report a wrong audience as correct.

**Rules that apply regardless of API**

- Recipients the action supports: the trigger contact; the site owner / contributors ("Can it go to
  the owner?" — yes); an existing contact. Custom addresses, CC/BCC, ad-hoc lists, addresses from
  variables and conditional recipients require an explicit supported contract; never invent CC/BCC headers or arbitrary recipient fields. For several recipients, use the verified CUSTOM audience contract in §4. A missing recipient contact requires a separate authorized contact-creation operation before it can be selected.
- **Existing email that must go to the owner** (the user said "me" / "the owner"): update
  `recipients` to its site-owner default with the explicit `null` reset in §4 and verify it. Do not hardcode
  owner-role IDs or hand-edit `selectedAudience`. If the user didn't say who receives it, ask.

- Email content (subject, preview text, body) of an existing step: Set Email Content (above), after
  the user's OK. New email steps: initialized separately as above, then persisted ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1).
- **Attachments are supported** but can't be added through the API: keep the email and tell the
  user to add files in the email editor — never call them impossible, swap in a link or recreate
  the email. Embedded playable video is unavailable; offer a link only with the user’s agreement.
  Never fabricate business content (hours, prices) — ask.

## 4. Update an existing email action's settings

[Get Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/get-automation-email-action)
and [Update Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/update-automation-email-action)
use **Manage Email Marketing**, separately from automation APIs. They read/update `recipients`,
`emailType`, `notificationTopicId` and `senderDetailsId`; content uses §3. `CUSTOM` recipients
also require `AUDIENCE.AUDIENCE_PROVIDER_READ`. The change applies from the next run, even when
ACTIVE: obtain the user's authorization for that live change (an explicit request suffices).
Respect existing origin/settings locks; do not use the provider endpoint to bypass them.

1. Get the automation to identify the existing email action and locks, then GET the provider
   resource below → `automationEmailAction` containing its current settings. Get Email Content
   (§3) too. Retain the full automation, settings and content as the before snapshots for
   preservation comparisons; identifying the subject alone is not a full content snapshot.
2. PATCH only the requested settings. Retain its successful response in the tool result; do not
   discard the returned acknowledgement and infer success only from a later read. Example:
   change that same email to site-owner delivery:

```http
GET https://www.wixapis.com/emails-automations/v1/automations/<automation-id>/email-actions/<action-id>
Authorization: <AUTH>
wix-site-id: <site-id>
```

```http
PATCH https://www.wixapis.com/emails-automations/v1/automations/<automation-id>/email-actions/<action-id>
Authorization: <AUTH>
Content-Type: application/json
wix-site-id: <site-id>

{"automationEmailAction":{"recipients":null}}
```

For owner delivery, `recipients: null` explicitly resets recipients to their documented
SITE_OWNER default. Omitting `recipients` leaves its current value unchanged. Verify typed
`recipients.recipientType: "SITE_OWNER"` on read-back; do not infer delivery from the null request.
This reset has been verified where an explicit SITE_OWNER object was rejected with
`fieldMask lists fields the action doesn't have: recipients.options`. Do not add guessed
`fieldMask` query/body fields or edit the opaque mapping to bypass that binding error. If a
TRIGGER_CONTACT or CUSTOM update hits it, report the blocker; resetting to owner would change
the requested audience and is not a fallback.

3. GET the provider resource again and compare requested settings and every untouched setting
   with the before snapshot. Get Automation again too: this API increments its `revision`.
   Verify the same node and content reference, unchanged status/trigger/unrelated configuration,
   and use the new revision before any later Update Automation; never replay the old opaque
   mapping over the provider change. Get Email Content again and compare the complete content
   with its pre-change snapshot, including subject, preheader, editor type, composer and
   placeholder defaults. Keep returned fields or explicit comparisons computed from them;
   summaries that omit IDs, mappings or content cannot prove preservation.
   Keep the same action/content IDs; no initializer, deletion, replacement, activation or test
   send is needed for a settings-only update.

For a recipient-only edit, compare the complete successful typed-settings and content GET
responses, not handpicked fields. Use the actual unwrapped `automationEmailAction` and `content`
objects as `beforeSettings`, `afterSettings`, `beforeContent`, `afterContent`; never substitute
empty objects for a missing or failed response. For example:

```js
// Recipient-only preservation check
if (
  ![beforeSettings, afterSettings, beforeContent, afterContent].every(
    value => value && typeof value === 'object' && !Array.isArray(value)
  )
)
  throw new Error('Missing successful before/after response');
const ordered = value =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, ordered(value[key])])
        )
      : value;
const same = (left, right) =>
  JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
const withoutRecipients = ({ recipients, ...rest }) => rest;
const preservation = {
  unrelatedSettingsUnchanged: same(
    withoutRecipients(beforeSettings),
    withoutRecipients(afterSettings)
  ),
  completeContentUnchanged: same(beforeContent, afterContent),
};
```

Execute and return both comparisons above; defining a helper without using it does not check
anything. Keep the complete already-fetched Automation Get objects visible, or return a complete
comparison of their preserved fields. A selected ID/subject projection is insufficient. This
needs no additional API calls.

Return these computed comparisons together with the fresh Automation Get checks from step 3:
same action ID/namespace/display name and content reference, unchanged name/status/trigger/roots,
settings and other nodes. Include the compared returned fields or inspectable comparison code.
An optional field absent from both complete responses is unchanged; do not invent a preheader
or placeholder map merely to verify one. Failed comparisons or omitted node/content identity
checks remain unverified, even when the recipient itself is correct.

The underlying field-mask semantics update only selected fields. The documented public REST
shape above and SDK `updateAutomationEmailAction({automationId, actionId}, {recipients: …})`
send only the changed action fields; follow that exposed signature rather than inventing a
transport `fieldMask` parameter. A selected empty field resets to its default (`senderDetailsId:
null` restores the site's default sender). A mask path may end at a repeated field but never
continue into its elements.

- Changing `emailType` also replaces `notificationTopicId`: supply the correct real topic when
  needed, or accept that type's documented default. Transactional requires a transactional
  topic; critical forbids a topic. Never change type to bypass subscription preferences.
- Updating any part of `recipients` replaces **all** recipients; send the complete requested
  recipient set, not one list entry to append. `TRIGGER_CONTACT` uses the verified literal
  `triggerContactOptions.contactIdPath` (§1); a site-owner reset needs no contact lookup.
- `CUSTOM` uses 1–10 `customOptions.audiences[]` entries with `audienceProviderId` and
  `audienceProviderData`. Resolve real providers through the public
  [List Audience Providers](https://dev.wix.com/docs/api-reference/business-management/notifications/audiences/audience-v1/list-audience-providers)
  contract and verify each provider's required data (for example, real label keys). Never
  invent provider IDs or bypass a failed/unauthorized lookup. Existing contact, label and role
  audiences are not categorically builder-only; use a verified provider or explain the specific
  missing configuration. The same recipients shape is accepted during initialization.
  Provider IDs are validated on save, but their data is not; verify the data against the
  selected provider's input schema yourself. A single trigger-contact or owner audience can
  read back as TRIGGER_CONTACT or SITE_OWNER rather than CUSTOM: verify the equivalent audience,
  not literal enum equality with the request.
- There is no revision/concurrency parameter for this provider write; last write wins. Report
  errors or partial changes honestly and re-read before retrying, rather than blindly repeating.

**CUSTOM audience discovery example — contacts with a label.** List the site's CONTACT
providers (requires **Set Up Automations**, separately from the email update scope):

```http
GET https://www.wixapis.com/audience-service/v1/list-audience-providers?scope=SPECIFIC_SITE&participantTypes=CONTACT
Authorization: <AUTH>
wix-site-id: <site-id>
```

The REST response is `audienceProviders[]`; retain each provider's `id`, `displayName`,
`participantType`, `scopes` and `inputSchema`. The SDK uses `_id` for the provider identifier.
For a label provider whose returned `inputSchema` requires `labelIds: string[]`, resolve the
existing label through a read-only Contacts Labels query (`POST https://www.wixapis.com/contacts/v4/labels/query` with `{"query":{"paging":{"limit":25}}}`; inspect the returned `key` and `displayName`, and page as needed),
then use its actual returned key as the label value. Example response projection (placeholders
must be replaced with returned values):

```json
{
  "audienceProviders": [
    {
      "id": "<returned-label-provider-id>",
      "displayName": "Contact Labels",
      "participantType": "CONTACT",
      "scopes": ["SPECIFIC_SITE"],
      "inputSchema": {
        "type": "object",
        "required": ["labelIds"],
        "properties": {
          "labelIds": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  ]
}
```

PATCH the existing action at the §4 URL with this complete replacement recipient set:

```json
{
  "automationEmailAction": {
    "recipients": {
      "recipientType": "CUSTOM",
      "customOptions": {
        "audiences": [
          {
            "audienceProviderId": "<returned-label-provider-id>",
            "audienceProviderData": { "labelIds": ["<returned-label-key>"] }
          }
        ]
      }
    }
  }
}
```

Bind the selected provider and exact matched label directly from their successful lookup
responses; do not transcribe or reconstruct either identifier in the PATCH body. For REST,
use the returned provider's `id` (SDK: `_id`) and label's `key`. Before PATCH, assert that the
provider ID belongs to that returned provider list and the label key belongs to the exact
lookup result. Keep those values in variables through request construction. A corrected typo
after a rejected provider ID is still a failed-call detour, not a clean discovery path.

Do not copy an example provider ID or label slug. `participantTypes` accepts `CONTACT`,
`WIX_USER` or `ANONYMOUS`; request only the type needed by the chosen audience. For role/team
audiences, discover the appropriate `WIX_USER` provider and follow its returned `inputSchema`
rather than reusing the contact-label payload. `SPECIFIC_SITE` selects site providers;
`NON_SPECIFIC_SITE` selects account-level providers and is not a substitute for a missing site
provider. A failed discovery or unresolved required provider input is a blocker.

## 5. Sender assignment, preview and test delivery

All four methods use the same automation ID + email action ID and **Manage Email Marketing**
permission. These are distinct from settings and content writes:

| Purpose                     | REST                                                                                                                                   | Minimal request / response                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Get Assigned Sender Details | `GET https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/sender-details`                 | Response `{senderDetailsId}` when explicitly assigned; an absent value means the site's default or Wix-branded fallback, not a missing sender error. |
| Assign Sender Details       | `POST https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/sender-details`                | Body `{"senderDetailsId":"<verified-sender-details-id>"}`; response `{}`.                                                                            |
| Preview Email Content       | `POST https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content/preview`         | Body `{}` (optional `customPayload` uses verified trigger data); response `{html,emailSubject}`. No email is sent.                                   |
| Send Test Email             | `POST https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content/send-test-email` | Body `{"toEmail":"<explicitly-authorized-address>"}`, optionally the same `customPayload`; response `{}`. Sends one actual email.                    |

For an authorized sender-only edit, discover the site's existing senders with
[List Sender Details](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/sender-details/list-sender-details).
This lookup separately requires **Access Verticals by Automations**
(`SCOPE.CRM.ACCESS-VERTICALS-BY-AUTOMATIONS`), in addition to **Manage Email Marketing**
for assigning the sender to the action:

```http
GET https://www.wixapis.com/sender-details/v1/sender-details
Authorization: <AUTH>
wix-site-id: <site-id>
```

Read `senderDetails[]`, match the requested `fromName` / `fromEmailAddress`, and retain the
returned REST `id` (SDK: `_id`). If needed, follow `pagingMetadata.cursors.next` using the
documented `paging` parameter. A denied or incomplete lookup is not evidence that a sender
does not exist: report the permission or lookup blocker rather than inventing an ID.

Assign the verified sender once, then Get Assigned Sender Details to confirm the returned ID. Assignment
increments the automation's revision: Get Automation again before any subsequent Automation
Update. Compare all unrelated settings and complete content as in §4, excluding only the
intended sender change. A PATCH of `senderDetailsId` in §4 is an alternative to assignment,
not an additional required write. To reset the default, use that PATCH with
`{"automationEmailAction":{"senderDetailsId":null}}`; Assign requires an existing sender ID.

Only preview when asked; it is not a replacement for Get Email Content or persisted
configuration checks. Optional `language` selects a translation. Placeholder values come only
from `customPayload` (a `triggerPayload` or explicit `placeholders` map), not automatically
from the live trigger. With no payload they remain unresolved; preview-only
`removeUnresolvedPlaceholders: true` removes them instead of supplying real values.

Send Test Email requires explicit authorization for the recipient address; an instruction to
configure, preview or activate an automation does not authorize a test send. A preinstalled
action still sharing template content can be read and previewed, but a test send requires
site-owned content. Explain that prerequisite and obtain authorization before a first content
write; do not silently publish a copy just to test. Report `CONTENT_NOT_CONFIGURED` or
`TEST_EMAIL_LIMIT_REACHED` and stop rather than repeatedly sending. A successful empty test
response acknowledges the request; do not claim inbox delivery without evidence.

## Related API references

- [Generate Action Input Mapping](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/generate-action-input-mapping)
- [Get Email Content](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/get-email-content)
- [Set Email Content](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/set-email-content)
- [Get Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/get-automation-email-action)
- [Update Automation Email Action](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/update-automation-email-action)
- [Get Assigned Sender Details](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/get-assigned-sender-details)
- [Assign Sender Details](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/assign-sender-details)
- [Preview Email Content](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/preview-email-content)
- [Send Test Email](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/send-test-email)

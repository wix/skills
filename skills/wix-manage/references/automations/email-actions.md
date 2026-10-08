---
name: "Automations Email Actions"
description: "Initialize new automation email actions, including additions during updates, then configure content and verify recipients while preserving existing emails."
---

This publication is being released in stages. Where a topic guide is not yet published, consult the official Automations API reference and method schemas before using that feature; do not guess its contract.

# Automation Email Actions

Use the email provider's **Generate Action Input Mapping** for each NEW email action. It is a
non-AI initialization API, distinct from the action catalog's Generate Input Mapping From Intent
(which this skill does not use). Editing an existing email's content uses Get / Set Email Content
in place; do not initialize, delete, recreate or replace that action.

## 1. Initialize a new email action

[Generate Action Input Mapping](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/generate-action-input-mapping)
is **Developer Preview** and subject to change. It requires a Wix app or Wix user identity with
**Manage Email Marketing** (`SCOPE.DC-PROMOTE.EMAIL-MARKETING`) and the target site context. Also retain the
Automations permissions needed to persist the step.

```http
POST https://www.wixapis.com/emails-automations/v1/email-actions/generate-action-input-mapping
Authorization: <AUTH>
Content-Type: application/json
wix-site-id: <site-id>

{
  "action": {
    "emailType": "PROMOTIONAL",
    "triggerSchemaContactIdPath": "contactId"
  }
}
```

Here `contactId` is an EXAMPLE: resolve the actual trigger-schema contact identity path first.
Use a plain path (`contactId` or `contact.id`), not a bracket expression, entity ID or email
address. The response is `{appId, actionKey, inputMapping}`.

Equivalent SDK call:
```ts
import { automationEmailAction } from '@wix/automations-email-actions';

const generated = await automationEmailAction.generateActionInputMapping({
  action: {
    emailType: 'PROMOTIONAL',
    triggerSchemaContactIdPath: 'contactId', // resolved from this trigger's schema
  },
});
```

Request settings (omit only when the default matches the user's request):

| Field | Meaning / default |
| --- | --- |
| `action.triggerSchemaContactIdPath` | Trigger contact identity path. OMIT to send to the SITE OWNER; do not fill it just because the trigger has a contact. |
| `action.emailType` | Defaults to `PROMOTIONAL`, which respects marketing subscription. `BUSINESS_TRANSACTIONAL` requires a transactional notification topic; `BUSINESS_CRITICAL` is for essential messages and forbids a topic. Choose according to actual purpose, never to bypass subscription preferences. |
| `action.notificationTopicId` | Real topic GUID. Promotional defaults to the general promotional topic; transactional requires an appropriate topic; critical must omit it. Never invent a topic. |
| `action.senderDetailsId` | Real sender-details GUID if explicitly selected; otherwise site's default, or Wix-branded fallback. |
| `content` | Optional full email content in the Set Email Content shape. Omit for the provider's default template. Stored in the primary language; other site languages start from the default template. |

For a site-owner email with the default type, keep the worked example's `action` wrapper and
omit `triggerSchemaContactIdPath`: `{"action": {"emailType": "PROMOTIONAL"}}`. The `action.*`
settings go inside `action`; optional initial `content` is the one top-level field, beside
`action`. This initializes email content; it does not
attach an action to an automation or send an email.

Each call creates **new email content**, initially a draft until the automation is saved.
The response's `inputMapping` is opaque. Use it AS IS; do not inject recipients, edit message IDs,
strip unfamiliar keys, or infer a new mapping from an example. Use one response for exactly
ONE action. Two new emails, including copies on different branches, require two calls.

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
   Preserve existing nodes and mappings. If ACTIVE, follow the live-edit authorization rule;
   offer deactivation while configuring the new email rather than promising the default content
   cannot run. Never silently change the user's status.
5. Once persisted, use the returned automation ID and the new node's action ID for Get Email
   Content → modify the returned full content → Set Email Content → Get Email Content.
   Configure the requested subject/body, preserve editor format and unrelated values, and verify
   the returned content. Supplying `content` during initialization does not require a redundant
   Set when read-back already matches the request.
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
initializer or discard a successful response after an unrelated revision conflict. Preview and
mapping-copy flows remain outside scope.

## 3. Existing content and recipient verification

**Saved shape.** The step's `inputMapping` is owned by the emails app. Typical keys: `messageId`
(the email) or `templateId` + `uniqueRuleId`, `contactId`, `selectedAudience`, `dynamicParams[]`,
`transactional`, `sendToUnsubscribed`, `notificationTopicId`, `disabledAttachments`,
`actionConfigVersion`. Keep all of them byte-for-byte on every Update — the one exception is the
site-owner `selectedAudience` replacement below for an EXISTING step. For a NEW step pass the
initializer's mapping unchanged; never copy it to another action.

**Change the content of an existing email step** — Automation Email Action API
([API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/introduction),
SDK `@wix/automations-email-actions`, scope _Manage Email Marketing_). The content is addressed by
the automation id and the step's action id — no `messageId`:

| Purpose           | REST                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Get Email Content | `GET https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content`  |
| Set Email Content | `POST https://www.wixapis.com/emails-automations/v1/automations/{automationId}/email-actions/{actionId}/email-content` |

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

MUST before step 3: tell the user that content becomes live and obtain authorization (an explicit
request to configure this email already authorizes that edit; do not ask again). The new content is **live** for the next runs
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
  variables and conditional recipients: [Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §3.
- **Existing email that must go to the owner** (the user said "me" / "the owner"): set the audience
  to the owner shape Wix's own templates use — keep the root `contactId` and every other key, and
  replace only `selectedAudience` (Update Automation):

  ```json
  "selectedAudience": { "contributorRoleIds": ["6601492336091027458"], "triggerContactExcluded": true,
    "audienceSelectors": [], "contactIds": [], "customRecipients": [], "labelIds": [],
    "recipientEmails": [], "segmentIds": [], "userIds": [] }
  ```

  (`6601492336091027458` = the site-owner role. It is a fixed Wix role id, not a per-site value:
  Wix's own owner-addressed email templates use it on every site. If an existing owner-addressed
  email step on the same site uses a different owner role id, copy that one instead.) Then Validate
  and tell the user it's addressed to the site owner; ask them to confirm in the builder's email
  editor that the recipient reads "Site owner". This is the only audience edit allowed. If the user didn't say who receives it, ask.

- Email content (subject, preview text, body) of an existing step: Set Email Content (above), after
  the user's OK. New email steps: initialized separately as above, then persisted ([Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §5.1).
- **Attachments are supported** but can't be added through the API: keep the email and tell the
  user to add files in the email editor — never call them impossible, swap in a link or recreate
  the email ([Automations Feasibility and Planning](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-feasibility-and-planning) §3, also video).
  Never fabricate business content (hours, prices) — ask.

## Related API references

- [Generate Action Input Mapping](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/generate-action-input-mapping)
- [Get Email Content](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/get-email-content)
- [Set Email Content](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/automation-email-action/set-email-content)

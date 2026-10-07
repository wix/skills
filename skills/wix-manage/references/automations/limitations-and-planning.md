---
name: "Automations Feasibility and Planning"
description: "Assess automation feasibility, supported action configuration, update locks and planning constraints before promising or changing a workflow."
---

This publication is being released in stages. Where a topic guide is not yet published, consult the official Automations API reference and method schemas before using that feature; do not guess its contract.

# Limitations & Planning

**TL;DR**

- Two failure poles — both are defects: **false-impossibility** (refusing something the platform supports: email attachments, site-owner recipient, SPLIT parallelism, rate limiting, variables) and **false-success** (saving something that can't work: unverified entity, missing payload field, unrenderable shape, unsupported action). Verify before refusing AND before promising.
- For an unfulfillable ask: state the limit accurately, offer the real alternatives, let the user choose. Don't force one scripted outcome.
- Check limitations WHILE planning, not after building.
- Updates: read `origin` + `settings` first; ACTIVE automations change live; email content is changed with Set Email Content (§4), recipients and design by the user in the email editor.
- Ask the user only about business meaning (which form? who receives it? what's the goal?). Resolve availability, ids and paths yourself from the catalogs, Item Selection and vertical APIs.

---

## 1. What you cannot do with the public APIs

- **Hidden drafts / separate publish step** → create with `status: INACTIVE` (your "draft");
  activate on request ([Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3).
- **Dry-run / simulate** → none exists. Test Automation runs the actions FOR REAL — only with
  explicit user consent ([Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §5). Validate checks shape, not runtime
  behavior; never claim runtime results from validation.
- **Run logs and run diagnosis** are not covered by this skill. For what happened in a run,
  point the user to the activity view in the Wix dashboard.
- **Generate site actions / "API integration" steps** (`wix_automations-wix_api_integration`) →
  not public; don't create them. Offer an existing app action, a webhook action, or "Generate or analyze
  text" (`wix_automations-llm_call`). An existing one in an automation you update: leave it untouched, don't rename it.
- **New Send an email steps** have a dedicated Generate Action Input Mapping API
  ([Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) §1). Use it for new automations and for new email nodes in
  updates, then persist before Get / Set Email Content. Availability during rollout must be
  checked through the documented method; a missing binding or permission is a concrete blocker,
  not permission to invent a mapping. Never save an email step without its app-created email.
- **Code variables** (`wix_automations-data_manipulation_code`) → Create refuses them; use the
  alternatives in [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4.
- **Item Selection** is PUBLIC/BETA: discover installed providers and query their items
  ([Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2). Vertical public APIs are also valid. Missing binding,
  permission or provider means options are unknown; it does not mean the API is private.
- **Create labels / coupons / forms / pipelines while building** → out of scope. They must exist
  first: tell the user, list what exists, and treat creation as a blocking prerequisite (create it
  via the vertical's API only if the user explicitly asks).
- **Configure email attachments** → the email DOES support attachments; the user adds them in the
  email editor (§3).

## 2. Unsupported actions — never add them

Enforce by `appId` + `actionKey`. Why: these are configured by a builder widget that also creates things outside the automation (the Velo action creates and publishes site code files and stores their `spiId`; WhatsApp picks an approved template), so an API-written step points at something that doesn't exist and fails at run time. `send-mail` is a deprecated widget with a free-text/owner recipient; the legacy `send-coupon-action` is a hidden widget whose coupon can't be selected.

**On updates:** keep existing steps of these kinds byte-for-byte; never copy one into a new step or reuse its `spiId` — deleting one of two steps that share it can remove the other's code. If the requested change would need such a step on more than one path (e.g. a new condition before an existing Velo step, whose tail must be duplicated per branch), **stop and ask**: offer keeping the step on one branch only, or having the user add a second Velo step in the builder.

| Action                 | Key                                                                          | Use instead                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Velo action            | `wix_automations-velo_action` (appId `139ef4fa-c108-8f9a-c7be-d5f492a2c939`) | An app action, an LLM action, or the HTTP request action (`webhooks-action`) calling a Velo http-function URL the user exposes.              |
| Data manipulation code | `wix_automations-data_manipulation_code` (same appId)                        | Code variable — not creatable via the public API. Formulas, SET_VARIABLES, a code condition or an LLM step ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4).          |
| Send a coupon (legacy) | `send-coupon-action` (appId `14d7032a-0a65-5270-cca7-30f599708fed`)          | "Add a coupon" `wixcoupons-retrieve_coupon` — selects the coupon by entity selector and outputs the code for later steps (e.g. an email).    |
| Get an email           | `send-mail` (appId `139ef4fa-c108-8f9a-c7be-d5f492a2c939`)                   | "Send an email" `triggered-emails` — recipient is the trigger's contact, the site owner, or an existing contact.                             |
| WhatsApp message       | `whatsapp-send-message` (hidden)                                             | Its approved WhatsApp template can only be picked in the builder. Use chat (`send-message`) or email, or let the user add it in the builder. |
| Connect to Zapier      | `forward-to-zapier` (hidden)                                                 | Needs a Zapier-side connection. Use the HTTP request action (`webhooks-action`) to a URL the user provides.                                  |

- Recognize the request immediately; don't try to make the unsupported action work. Don't disguise it as a code condition or another node type.
- Explain, offer supported alternatives, ask which one, and only then build. If it's the only change and no alternative is accepted, change nothing.
- An existing unsupported action in an automation you update is valid — leave it alone; update other parts; remove/replace it only if the user asks for a supported replacement.

## 3. Capability facts and per-action limits

Say YES to these (common false-impossibilities):

- Variables (SET_VARIABLES) and rate limiting are available on every USER automation even when absent from the catalog list (not on APPLICATION/PREINSTALLED ones — §4). Variables are alpha: confirm by read-back ([Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches)).
- Parallel steps: SPLIT. Calendar logic without payload dates (today's month, weekday, birthdays): a CODE_CONDITION with `new Date()`, or a boolean SET_VARIABLES step (formulas may use `now()`, `day()`, `month()`, `year()`) tested with `boolEq` — the condition panel itself has no date-part or `now()` functions ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions) §4).
- Email recipients: the trigger's contact, the **site owner**, or an **existing contact** — regardless of how contact-centric the input schema looks. Picking the specific contact happens during configuration.
- Preferred language: map `contact.locale` into the email; no language field needed.

Email ("Send an email"):

- Can't be configured from here: several ad-hoc recipients / CC / BCC, addresses from variables, distribution lists, conditional recipients (label/role audiences exist, but only the user sets them in the email editor). "CC accounting@…" → say the email can't CC; offer a second email to that address as its own contact. That needs an existing contact — create one via the public Contacts API (`POST /contacts/v4/contacts`) only with the user's explicit OK. Several recipients → one email action per recipient.
- Gather recipient, goal/purpose and key content. Initialize supported new recipients (trigger contact or site owner), persist the step, then configure subject/body through the content API. Other audiences need the email editor; don't alter an opaque generated mapping to invent them.
- Embedded playable video: no — offer a link (ask first).
- **Attachments**: supported by the email; only you can't configure them. Tell the user to add the files in the email editor; keep the email unchanged. Never say "not supported", never swap in links, never delete/recreate the email to carry files. Attachments-only request = no automation change.

SMS: text only. No files/photos/PDFs. Offer text-only SMS, an email, or a link.

Chat message: recipient is the trigger contact (the default when none is named — don't ask) or a contact output by a prior step. Not the site owner, staff, teams or coworkers. For "notify me / my team": keep that intent, explain, offer an email to the site owner, build only after agreement.

Existing-item actions (labels, badges, coupons, pipelines…): select existing items only. "badge" → `assignBadge`; "label"/"tag" → `addLabelsToContact` — never swap them. Coupons: confirm the coupon exists before planning.

Manual-configuration actions (Google Sheets, third-party integrations, OAuth-based apps): you can add the node, but the user completes auth/selection in the builder. Say so upfront; collect every static value you CAN (URLs, tokens, exact resource names) before building; an uncollectable required value is a stated blocker, not a placeholder.

AI actions (which one: the AI ladder in [Automations Action Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-action-configuration) §2 — Aria passes only a `summary` downstream; the custom agent `ai_custom_agent_bm-delegate_to_agent` when a later step needs structured output; "Generate or analyze text" `wix_automations-llm_call` over data already in the payload). Use agents ONLY when the user explicitly wants agentic behavior — never as a fallback for a missing built-in action (a built-in action is always more reliable). "Generate or analyze text" is different: it may be used without being asked when it is the only way to derive a value the user needs (extraction/computation the formula list can't do — [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4); say so in your answer.

Scheduling patterns (last day of month, days 29–31, sub-daily…): [Automations Schemas and Scheduling](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-schemas-and-scheduling).

## 4. Update restrictions

Before any update: Get Automation, read `origin`, `settings`, `configuration.status`, `revision`.

Locks apply only to `origin` `APPLICATION` / `PREINSTALLED` (a `USER` automation has none):

- **Fully read-only** — `settings.readonly === true`: nothing can change; every action counts as
  read-only and permanent.
- **Trigger locked** — `settings.triggerSettings` absent, or
  `.disableConfigurationModification === true`: no trigger or filter changes. These are internal
  fields public responses may omit, so for these origins **assume the trigger is locked**.
- **Read-only actions** — id ∈ `settings.actionSettings.readonlyActionIds`: can't edit them.
- **Permanent actions** — id ∈ `settings.actionSettings.permanentActionIds`: can't delete them or
  change their `skipActionExpression`.
- **Last action** — always: can't delete the last remaining action.
- **No new action nodes** — always for these origins: only new CONDITION and DELAY nodes may be
  added — no new app actions, variables or splits. `actionSettings.disableConditionAddition` /
  `disableDelayAddition` (internal, may be missing) forbid those too; if an Update or the builder
  rejects a new condition/delay, report the lock instead of retrying.
- **No status change** — `settings.disableStatusChange`: can't activate/deactivate.
- **No delete** — `settings.disableDelete`: can't delete the automation.
- Send `settings` back exactly as fetched; never edit it to lift a lock.

Explain what's locked and why (installed by Wix or an app), say what IS editable, never work around a lock.

Every update:

- **Live edits**: if `status` is `ACTIVE`, Update Automation changes the running automation immediately. Tell the user and confirm before writing. (Or offer: deactivate, edit, re-activate.) If the request already contains that consent ("it's live, change it anyway"), don't ask again — record in your answer that it was a live edit made on their stated consent.
- **Procedure** (builder edits published or discarded first → Get → merge → Validate → Update with the current `revision`, `origin`, `settings` → read-back; revision conflict → re-Get, re-merge, re-validate): [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3.
- Touch only what was asked; keep untouched nodes, ids, namespaces and SPLIT paths exactly as they are. A new step's namespace number = 1 + the largest number among the steps that REMAIN ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §3): numbers of removed steps are not reserved, so removing the highest-numbered step frees its number for the next new step. Re-point or remove every `var()` that read a removed step before reusing its namespace. The single-parent tree rules still apply to any restructuring.
- Re-verify every entity and field the change touches — they may have been renamed or deleted since creation.
- **Email content of an existing step** (subject, preview text, body text — "add the phone number to the email") → edit it in place with Get / Set Email Content ([Automations Email Actions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-email-actions) §3), after the user's OK: it goes live immediately. Recipient or design changes → the user does them in the email editor (site-owner audience: the one allowed edit). Do not initialize or recreate an existing step for content-only changes. Adding a distinct new email uses Generate Action Input Mapping, subject to the origin's new-node restrictions.
- **Deleting a node needs the user's explicit OK**: name the nodes you'll remove (recreating an email creates a different content resource, not restoration) and get a yes before the Update. Then connect its parent to its child and fix or ask about any downstream `var()` that read its outputs.

## 5. Planning heuristics (recurring real failure modes)

### Entities

1. Generic reference ("my contact form", "a specific service") → ask for the NAME before planning. Never ask the user for ids.
2. Verify EVERY named entity (form, label, badge, coupon, service, pipeline + stage, CMS collection + fields) against the site's real options — the user saying it exists isn't proof. Not found → say so, list what exists, let the user pick / create it first / broaden scope. Several matches → the user picks. Never save with an unverified name, a placeholder, or "select it later", and never silently drop the scoping filter.
3. Ids go into entity-selector fields and filters, never display names (they break on rename). Keep your own evidence of which API call confirmed each entity.
4. The requested **trigger event or action doesn't exist** on the site (e.g. "when a contact is updated" with no such trigger in Resolve Triggers — check the global Query Triggers too: absent there = the platform has no such event; present there only = its app isn't installed, or — for a trigger whose `maturity` is `CREATED` / not GA (common for domain-event triggers) — it isn't available to sites yet; say that, not "install the app"). Don't silently substitute. Tell the user, offer the closest real triggers with what each would change — including its **required filters** (e.g. "label added" needs one specific label; "contact enters segment" needs one segment; "new contact created" needs none) — and wait for their choice. Same for a missing action (e.g. "post to Slack" with no Slack app): say so, offer real alternatives (HTTP request/webhook action to a URL the user provides, another installed app's action that Resolve Actions returns and §2 doesn't list, an email/chat instead), and don't save a placeholder.

### Data flow

5. Trace every REQUIRED input to a concrete source — trigger field, ancestor output, identity enrichment, variable, or user literal — with exact path, type and format, present in that node's aggregated schema ([Automations Graph and Data Model](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-graph-and-data-model) §4). "Use the payment method from the payload" is not verification.
6. Dynamic schemas: verify only after the determining choice is made (which form, service, template). Display labels ≠ keys.
7. Arrays: never assume indexing. A value only inside an array needs an extraction step — "Generate or analyze text" with a named scalar output (code variables can't be created publicly; [Automations Delays Variables and Branches](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-delays-variables-and-branches) §4), or a code condition when it only decides a branch. Plain variables are transformation, not extraction.
8. Follow object containers to scalar leaves (`paymentMethodName.buyerLanguageName`, not `paymentMethodName`).
9. Identifier types must match: an email address doesn't satisfy a contact-id input. Use the id field or a supported lookup step.
10. Trigger lacks the needed data (order number, payment method…) → switch to a trigger that has it (compare candidate payload schemas), don't degrade the request.
11. Trigger names are ambiguous ("Session booked" vs "Appointment request approved") — read the payload and filters, not just the name.

### Structure & capability

12. Every trigger and action must exist in the site catalog (appId + key). Don't confuse triggers with actions.
13. Verify an action supports the requested configuration/optional fields before promising them.
14. Trigger-filter entities must exist, or the automation can't be configured.
15. "Do A and B" → a chain by default; SPLIT when they must run at the same time — decide during planning.
16. Prefer shapes the builder can render: visual conditions only for renderable operators, otherwise CODE_CONDITION ([Automations Conditions](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-conditions)).

### Conversation

17. Watch for limitation triggers early and surface the constraint + alternatives immediately: "last day of month", "quarterly", "send to sales@…", "CC my team", "create a new label", "connect my Google Sheet", "run this script", "attach the file", "test it without sending".
18. Be transparent, explain why, offer alternatives, confirm before proceeding, and list any manual steps left for the user after creation.

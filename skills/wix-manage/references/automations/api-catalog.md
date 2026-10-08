---
name: "Automations API Catalog"
description: "Discover installed automation triggers and actions and inspect their schemas through site-scoped public catalog APIs."
---

# Discover installed automation capabilities

Check the site's installed trigger/action catalogs, then inspect the chosen components'
schemas. This recipe is read-only: do not create an automation, install an app, generate email
content, or run an action to establish availability.

## Authentication

Use an authorized site-scoped client with Set Up Automations permission. REST calls use
`Authorization: <token>`. An API key also needs `wix-site-id: <metaSiteId>`; do not combine it
with `wix-account-id`. OAuth app tokens are bound to a site instance. Never print credentials.
A 401/403 is an access failure, not evidence that a catalog component is unavailable.

## Resolve, select, inspect

1. Use a known key only as a search hint. Resolve an exact candidate first; if it is absent,
   browse small pages and compare names/semantics locally. Do not conclude that a remembered
   key exists on this site without a successful Resolve response.
2. For triggers, request `basicFieldsOnly: true` while browsing, then hydrate only the chosen
   trigger with Get Trigger By App Id And Key. Compare its payload and filters to the intent.
3. Actions already include schemas in Resolve. Retain the chosen returned identity and
   required input fields; avoid repeating the whole catalog just to read display names.
4. Summarize the available pair and required configuration, distinguishing what the trigger
   supplies from values the user would need to choose. Do not mutate anything to prove it.

### Trigger discovery

`POST https://www.wixapis.com/v1/triggers/resolve`

```json
{"basicFieldsOnly":true,"query":{"filter":{"triggerKey":"contacts-new_contact_was_created"},"paging":{"limit":25,"offset":0}}}
```

Read `results[]` and `paging`. A nonempty matching result establishes an installed trigger;
use its returned `appId` and `triggerKey` in:

`GET https://www.wixapis.com/v1/triggers/apps/<appId>/keys/<triggerKey>`

Read `trigger.payloadDataSchema`, `trigger.filters` and `trigger.automationConfigSchema`.
The contact-created key above is a discovery hint; names and availability may vary by site.

### Action discovery

`POST https://www.wixapis.com/v1/actions/resolve`

```json
{"query":{"filter":{"actionKey":"addLabelsToContact"},"paging":{"limit":25,"offset":0}}}
```

Read `actions[]`, `paging`, and each chosen action's `appId`, `actionKey`, `inputSchema`,
`outputSchema` and `interfaceConfiguration`. Inspect required properties, types, enums and
field descriptions before explaining configuration. For an existing runtime version use
`GET https://www.wixapis.com/v1/actions/apps/<appId>/keys/<actionKey>` and read `action`.
A site may have Add label to contact without Create task; never substitute one for the other.

### Bounded fallback

Remove the exact-key filter to browse; use offset pages of at most 25 entries, with no sort.
Resolve Actions has no `basicFieldsOnly` option and rejects displayName filters; search names
locally. Compact each page to identities and display names before adding it to reasoning
context. Fetch each catalog page and static schema once, cache it for this site, and hydrate only a
shortlist; never re-fetch a page or schema you already have. Pages can overlap;
de-duplicate by appId+key. Only a complete scan with distinct count equal to `paging.total`
proves absence; state the evidence ("scanned N distinct of `paging.total` N"). Without that
proof, say the component was "not found in the installed catalog", never that it is not
installed. Either way, list the closest related actions you did find, as findings rather than
substitutes, with their returned `appId`/`actionKey` and what their schemas require.

Resolve is site-scoped; global Query catalogs can include uninstalled apps and do not prove
availability. The method schemas below confirm the full public URLs; do not invent a private
transport or guess a new path if access fails.

Official contracts: [Resolve Triggers](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-catalog/resolve-triggers),
[Resolve Actions](https://dev.wix.com/docs/api-reference/business-management/automations/actions/action-catalog/resolve-actions).
For current automation status use [Automations Activation Status](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-activation-status).

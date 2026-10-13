---
name: "Automations Activation Status"
description: "Read an automation’s current ACTIVE or INACTIVE status and distinguish it from historical run outcomes."
---

# Inspect activation status

An automation's current state is `configuration.status`: ACTIVE is eligible for new trigger
events; INACTIVE is not. Neither value proves that a historical run succeeded or that a
pending activation has stopped.

1. Resolve the requested name with one Query Automations call filtered by that exact name
   (below); don't page through other automations. If the ID is already supplied, go to Get.
   If several match, open your answer by listing each match's full returned ID and asking
   which one the user means; don't report a single status. If none match, say so and ask the
   user to check the name or site; never guess an ID.
2. Get the matching returned ID and read `configuration.status`.
3. Answer briefly and completely in one reply. Start with the automation's exact name, its
   returned ID and ACTIVE/INACTIVE from that response, then say what it means for new trigger
   events. If the user asks whether the status says anything about past runs, answer it
   directly in the next sentence: status does not show whether past runs succeeded; they are
   visible in the automation's activity view in the site dashboard.
4. If Get returns not found, do not state a status. Open with: the automation wasn't found on
   this site, so its status can't be determined, and ask the user to confirm the site and the
   automation ID. This question is required. Then give the possible causes below.

Use an authorized site-scoped client with Set Up Automations permission. REST calls use
`Authorization: <token>`. An API key also needs `wix-site-id: <metaSiteId>`; do not combine it
with `wix-account-id`. Never print credentials.

`POST https://www.wixapis.com/automations-service/v2/automations/query`

```json
{"query":{"filter":{"name":"<automation name>"},"cursorPaging":{"limit":25}}}
```

Read `automations[]` and `pagingMetadata.cursors.next`; continue pages if needed. Retain the
returned `id` and exact name. Then:

`GET https://www.wixapis.com/automations-service/v2/automations/<automationId>`

Read `automation.configuration.status` from the Get response. Never infer status from the
name or a previous mutation. Do not validate, change configuration, toggle status or test-run
an automation to answer this read-only request.

Not-found causes (step 4): unpublished builder drafts do not appear
through this API, but a 404 can also mean deletion or a changed ID after overriding a
preinstalled automation. When the user's history supports an unpublished builder draft as the
cause, ask the owner to publish or discard it rather than reproducing its edits.

Official contracts: [Query Automations](https://dev.wix.com/docs/api-reference/business-management/automations/automations/automations-v2/query-automations),
[Get Automation](https://dev.wix.com/docs/api-reference/business-management/automations/automations/automations-v2/get-automation).

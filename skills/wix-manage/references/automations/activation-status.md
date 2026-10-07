---
name: "Automations Activation Status"
description: "Read an automation’s current ACTIVE or INACTIVE status and distinguish it from historical run outcomes."
---

# Inspect activation status

An automation's current state is `configuration.status`: ACTIVE is eligible for new trigger
events; INACTIVE is not. Neither value proves that a historical run succeeded or that a
pending activation has stopped.

1. Resolve the requested name within the selected site with Query Automations. If several
   match, ask which one; do not choose arbitrarily. If none match, say so and ask the user to
   check the name or site; never guess an ID. If the ID is already supplied, go to Get.
2. Get the matching returned ID with override schemas and read `configuration.status`.
3. Answer briefly and completely in one reply. Start with the automation's exact name, its
   returned ID and ACTIVE/INACTIVE from that response, then say what it means for new trigger
   events. If the user asks whether the status says anything about past runs, answer it
   directly: status does not show whether past runs succeeded. Do not fetch or request logs
   for that; use [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis) only when the user wants a particular run diagnosed.

Use an authorized site-scoped client with Set Up Automations permission. REST calls use
`Authorization: <token>`. An API key also needs `wix-site-id: <metaSiteId>`; do not combine it
with `wix-account-id`. Never print credentials.

`POST https://www.wixapis.com/automations-service/v2/automations/query`

```json
{"query":{"filter":{"name":"<automation name>"},"cursorPaging":{"limit":25}}}
```

Read `automations[]` and `pagingMetadata.cursors.next`; continue pages if needed. Retain the
returned `id` and exact name. Then:

`GET https://www.wixapis.com/automations-service/v2/automations/<automationId>?fields=OVERRIDE_SCHEMA`

Read `automation.configuration.status` from the Get response. Never infer status from the
name or a previous mutation. Do not validate, change configuration, toggle status or test-run
an automation to answer this read-only request.

If Get returns nothing (not found), say plainly that the status can't be determined and ask
the user to confirm the site and the automation ID. Unpublished builder drafts do not appear
through this API, but a 404 can also mean deletion or a changed ID after overriding a
preinstalled automation. Only diagnose an unpublished draft when the user's history supports
it. Ask the owner to publish or discard their builder draft when appropriate, rather than
reproducing its edits.

Official contracts: [Query Automations](https://dev.wix.com/docs/api-reference/business-management/automations/automations-v2/query-automations),
[Get Automation](https://dev.wix.com/docs/api-reference/business-management/automations/automations-v2/get-automation).

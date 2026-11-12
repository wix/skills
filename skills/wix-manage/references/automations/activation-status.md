---
name: "Automations Activation Status"
description: "Inspect or change active status with lock checks, revision handling and read-back, without requiring unrelated repairs before deactivation."
---

# Activation status and lifecycle

**What the public API can see.** An automation's live state is `configuration.status` —
`ACTIVE` (eligible for new trigger events) or `INACTIVE` (not eligible for new trigger events).
Status does not show whether past runs succeeded. There is no separate
"published" flag and no public draft API:

- **Status check** = Query by name (if no ID) → Get the single matching ID → read that Get response’s `configuration.status`. Query is discovery only: never answer from its status projection, even if it includes one. Use the status-answer format below;
  never infer it from the name or from your own earlier writes. If several automations match the
  supplied name, list each returned ID and ask a direct question such as "Which one do you mean?"
  before any further Get. Do not fetch statuses for disambiguation or report one status as the
  answer; include a per-match status only if an earlier successful Get already established it. If no automation matches the supplied name, say
  so and ask the user to check the name or site; never guess an ID.
- **Builder drafts are invisible to you**: if the user says "it doesn't show my latest changes",
  tell them to publish (or discard) in the builder first — don't reproduce their edits.
- **NOT_FOUND is ambiguous.** Open the answer by saying the status can't be determined and
  asking the user to confirm the site and the automation ID; then give the possible causes. A never-published builder draft is absent
  from Get/Query, but deletion and a replaced preinstalled id can also explain a 404. The first
  update of a preinstalled automation can create an override with a new id; use the mutation's
  returned id, or Query to find the current automation and confirm its identity. When the
  user's history supports an unpublished builder draft as the cause, ask the owner to publish or
  discard it rather than reproducing its edits.

**Keep site and automation IDs separate.** A `siteId` or `metasiteId` selects the site context;
it is never the automation resource ID in a Get URL. When the user supplies only a name,
Query that exact name first. Skip Query only for an automation ID explicitly supplied as
such or returned by a successful automation Query/Create/Update. Do not probe Get with the
site ID, an example ID or a name-derived value.

**Status answer for one confirmed automation.** After a successful Get, include all three returned
fields in the answer:

`<automation.name> (automation ID: <automation.id>) — <configuration.status>.`

Fill the template with the actual Get values; the site ID is not the automation ID. Explain
`ACTIVE` as eligible for new trigger events and `INACTIVE` as not eligible. This format applies
only when that Get established the status; it does not replace the ambiguity or missing-ID
procedures above. Never use it to imply that previous runs succeeded.

**Calls** (auth as in [Automations API Catalog](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-api-catalog) §1). A status question needs only Query and Get — no catalogs, Validate or writes.

- Find by name: `POST https://www.wixapis.com/automations-service/v2/automations/query` with
  `{"query":{"filter":{"name":"<automation name>"},"cursorPaging":{"limit":25}}}` → `automations[]`
  with each `id` and exact `name`. Follow `pagingMetadata.cursors.next` by repeating the
  same filter with `query.cursorPaging.cursor` until no next cursor remains, de-duplicating
  returned IDs before deciding whether the name is unique. Bound this traversal to five pages
  and stop on a repeated cursor or failed request. If a bound is reached while another page
  remains, the lookup is incomplete: do not claim absence or uniqueness; ask for the automation
  ID or a more specific name. Skip this lookup only for a confirmed automation ID as above.
- Read: `GET https://www.wixapis.com/automations-service/v2/automations/<automationId>` → `automation.configuration.status`. Add
  `?fields=OVERRIDE_SCHEMA` before activating or deactivating.
- Activate / deactivate: `PATCH https://www.wixapis.com/automations-service/v2/automations/<automationId>` with
  `{"automation": <the object exactly as fetched, with only configuration.status changed>}` — it
  carries `id`, the current `revision`, `origin` and any `settings` the Get returned.

**Activate** (only when the user asks):

1. Get Automation with `fields: ["OVERRIDE_SCHEMA"]` → current `revision`, `origin`, `settings`.
   If `settings.disableStatusChange`
   or `settings.readonly` is true, stop and report the lock: the owning app doesn't allow it
   ([Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) §3, **Update restrictions**).
2. Already `ACTIVE` → report it and stop (idempotent; no write).
3. Set only the candidate's status to `ACTIVE`, then apply the §4 checklist in [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) and full Validate — never activate
   an automation that doesn't validate. Preserve existing supported configurations as the §4 checklist in [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) explains.
4. Explicit activation instructions authorize this change; do not ask again. If the user only
   asked to build or inspect it, obtain authorization before making it eligible for real runs.
5. Update Automation with the object exactly as fetched, `configuration.status: "ACTIVE"`, and
   its `revision`. Nothing else changes.
6. Capture the returned id (a preinstalled override can change it), Get that id again with
   override schemas, and confirm `configuration.status` is `ACTIVE` and all other requested
   content is unchanged. Report "active" only then.

**Deactivate** (on explicit request): Get the complete object with override schemas; check
`settings.disableStatusChange` and `settings.readonly`; already INACTIVE means no write.
Otherwise change only `configuration.status` to `INACTIVE`, preserving origin, settings,
revision, schemas and all nodes, then Update and read back the returned id. **Do not run the §4 checklist in [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) or
Validate as a prerequisite**, and do not repair or remove unrelated invalid/legacy steps.
An explicit request to turn it off is sufficient authorization. Deactivating prevents new
triggered runs; it is not proof that every pending/running activation has stopped or will finish.

**Revision conflicts** (someone published from the builder meanwhile): re-Get and retry once;
if the fresh object differs in ways that matter, tell the user instead of overwriting.

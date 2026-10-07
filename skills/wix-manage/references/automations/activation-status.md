---
name: "Automations Activation Status"
description: "Inspect or change active status with lock checks, revision handling and read-back, without requiring unrelated repairs before deactivation."
---

This publication is being released in stages. Where a topic guide is not yet published, consult the official Automations API reference and method schemas before using that feature; do not guess its contract.

# Activation status and lifecycle

**What the public API can see.** An automation's live state is `configuration.status` —
`ACTIVE` (eligible for new trigger events) or `INACTIVE` (not eligible for new trigger events).
Status is not evidence that an individual run succeeded; see [Automations Run Diagnosis](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-run-diagnosis). There is no separate
"published" flag and no public draft API:

- **Status check** = Get Automation → read `configuration.status`. Report exactly that value;
  never infer it from the name or from your own earlier writes.
- **Builder drafts are invisible to you**: if the user says "it doesn't show my latest changes",
  tell them to publish (or discard) in the builder first — don't reproduce their edits.
- **NOT_FOUND is ambiguous.** Check the site/id first. A never-published builder draft is absent
  from Get/Query, but deletion and a replaced preinstalled id can also explain a 404. The first
  update of a preinstalled automation can create an override with a new id; use the mutation's
  returned id, or Query to find the current automation and confirm its identity. Only diagnose
  an unpublished draft when the user's builder history supports that explanation.

**Activate** (only when the user asks):

1. Get Automation with `fields: ["OVERRIDE_SCHEMA"]` → current `revision`, `origin`, `settings`.
   If `settings.disableStatusChange`
   or `settings.readonly` is true, stop and report the lock: the owning app doesn't allow it
   (Automations Feasibility and Planning (topic guide not yet published; consult the [Automations API reference](https://dev.wix.com/docs/api-reference/business-management/automations)) §4).
2. Already `ACTIVE` → report it and stop (idempotent; no write).
3. Set only the candidate's status to `ACTIVE`, then apply the §4 checklist in [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) and full Validate — never activate
   an automation that doesn't validate. Preserve existing supported configurations as the §4 checklist in [Automations Validation and Persistence](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-validation-and-persistence) explains.
4. Explicit activation instructions authorize this change; do not ask again. If the user only
   asked to build or inspect it, obtain authorization before making it eligible for real runs.
5. Update Automation with the object exactly as fetched, `configuration.status: "ACTIVE"`, and
   its `revision` (field mask `configuration,name` if your client takes one). Nothing else changes.
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
Inspect individual logs when that matters: pending runs can record `AUTOMATION_DEACTIVATED`.

**Revision conflicts** (someone published from the builder meanwhile): re-Get and retry once;
if the fresh object differs in ways that matter, tell the user instead of overwriting.

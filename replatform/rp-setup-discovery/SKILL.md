---
name: rp-setup-discovery
description: >-
  Derives Wix environment prerequisites (apps, collections, schemas) from an approved
  mapping plan. Use after mapping review and before import code generation.
---

# rp-setup-discovery

Determine the Wix-side setup required before import can run safely.

## Purpose

This skill analyzes the approved mapping plan and derives environment prerequisites such as installed apps, SMC collections, extended-fields schemas, references, permissions, and any other target-system configuration dependencies.

## Required inputs

- `migrations/<project>/mapping-plan.md`
- `migrations/<project>/mapping-summary.md`
- any Wix environment constraints or destination account details provided by the user

## Workflow

1. Confirm the mapping review checkpoint has been accepted, then read the mapping plan and
   mapping summary and identify every non-native requirement.
2. Determine which Wix apps must be installed or enabled.
3. Determine which SMC collections must exist.
4. Determine which extended-fields schemas, references, enums, or validation rules must exist.
5. Capture dependency ordering where setup steps depend on each other.
6. Write a setup artifact that downstream execution can verify.

## Artifact to create or update

- `migrations/<project>/setup-requirements.md`

Treat `mapping-summary.md` as the user-facing statement of intent and `mapping-plan.md` as
the detailed contract. If they materially disagree, halt and send the workflow back to
`rp-mapper` to correct them before deriving setup requirements.

## Minimum contents

- required Wix apps
- canonical crosswalk requirement name when native Wix entities need resume/dedupe
- required collections and schemas
- required field definitions
- permissions or access prerequisites
- setup order
- manual steps vs. steps that can be automated
- verification criteria for each requirement

## Optional source reachability setup for media

If the mapping imports media by URL and the source profile shows `localhost`,
`127.0.0.1`, or another private-only source URL, add an optional setup note for media
reachability. This is **not** a blocker for non-media entities and should not be framed as
a required Wix-side app/setup item. As far as we know today, it only affects Wix Media
import because Wix's import-from-URL API fetches files from Wix servers.

Offer two options in `setup-requirements.md`:

- Expose the local source through a public HTTPS tunnel before live media import.
- Skip/defer media import for the first live run and continue non-media entities.

For ngrok, include:

```bash
brew install ngrok
ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
ngrok http 8090
export WP_BASE_URL=https://<id>.ngrok-free.app
```

Tell the user to use the HTTPS forwarding URL as `WP_BASE_URL` / `SOURCE_URL`, or ensure
generated code rewrites source media URLs from the local base URL to the tunnel base URL.

## Verifying Wix APIs

Confirm that the apps, collections, field types, and references you require actually
exist in Wix with the names/types you state — never invent them.

- **When the Wix MCP is available, verification is mandatory, not optional** — verify at
  the moment you write the requirement, don't defer it. Verify **enum values**, not just
  names: confirm each `Field.type` against the Create Data Collection schema. (Common
  trap: there is no `SLUG` type — a Wix slug is a `TEXT` field.)
- **When the Wix MCP is expected but missing, treat that as a missing prerequisite first.**
  Before falling back to docs, first try to ensure the Wix MCP is installed/connected in
  the current runtime. If the environment supports connector/plugin install flows, use
  them. Otherwise halt to needs-user with exact install/connect instructions for the Wix
  MCP and resume once it is available.
- `unverified` is reserved for when the MCP is genuinely **unavailable** — not a way to
  pass an unchecked internal-catalog name downstream while the MCP is right there.
- **Fallback when no Wix MCP is available is degraded mode, not the default path.**
  Use it only when the user explicitly asks for a provisional setup draft without the Wix
  MCP, or when an upstream orchestrator explicitly routed this step in provisional mode.
  In that mode, rely on published Wix REST/SDK documentation and conservative, known-good
  names, and mark the requirement `unverified` so a human confirms it before
  `rp-execute-setup` runs.

## Crosswalk naming

When setup requirements include a durable `sourceId -> targetId` side table for native
Wix entities, the canonical collection name is **`ImportCrosswalk`**. If the mapping plan
uses older prose such as `MigrationRefs`, normalize it here and call out the rename in the
artifact so downstream setup/codegen share one contract.

## Classifying manual vs. automatable

Do not assert "manual" / "cannot self-provision" by assumption — check the API surface.

- Enabling a Wix app (Blog, Members, etc.) **is** automatable via the App Installation
  API; classify it automatable and cite the method. (Common trap: do not mark Blog or
  Members "cannot self-provision" — both are installable via the API.)
- Creating CMS collections is automatable; enabling Wix Data itself is automatable by
  installing the **Wix Data app `appDefId e593b0bd-b783-45b8-97c2-873d42aacaf4`** via the
  App Installation API, after which `POST /wix-data/v2/collections` creates NATIVE
  collections with no `WDE0110` (verified live 2026-06-10; see `rp-execute-setup`).
- Only storage-plan upgrades, external-system credentials, and account billing are
  genuinely manual. Mark something manual only after confirming no API covers it.

## Runtime policy

Verify names and enums against the Wix MCP rather than emitting `unverified` by default.
Classify automatability by checking the API surface (see above), not by assumption. If the
MCP is genuinely unavailable, use the documented fallback only for an explicitly
provisional artifact and mark the requirement `unverified` so downstream steps surface it
before execution.

## Guardrails

- Separate required setup from optional optimizations.
- Avoid embedding import logic here; this file is about prerequisites.
- Be explicit about which requirements come from which mapping decision.
- Do not produce a docs-only setup artifact as the normal path when the Wix MCP
  prerequisite is missing. That mode must be explicitly marked provisional.

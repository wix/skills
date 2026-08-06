---
name: rp-setup-discovery
description: >-
  Derives Wix environment prerequisites (apps, collections, schemas) from an approved
  mapping plan. Use after mapping review and before import code generation.
---

# rp-setup-discovery

Determine the Wix-side setup required before import can run safely.

## Purpose

This skill analyzes the approved mapping artifacts and derives environment prerequisites
such as installed apps, SMC collections, extended-fields schemas, references,
permissions, and any other target-system configuration dependencies.

## Required inputs

- `migrations/<project>/mapping/mapping-plan.json`
- `migrations/<project>/mapping/review/mapping-gaps.json`
- `migrations/<project>/mapping/review/mapping-summary.md`
- `migrations/<project>/orchestration/approvals.json`
- any Wix environment constraints or destination account details provided by the user

## Workflow

1. Confirm the mapping review checkpoint has been accepted, then read the mapping plan and
   mapping summary and identify every non-native requirement.
2. For mapped entities with `targetRef`, load compact domain/entity summaries through
   `rp-target-wix/scripts/domain-knowledge.js summarize-entities` and include
   `wixAppsRequired`, `setupRequirements`, target classification, and write verification
   level in setup analysis.
3. Determine which Wix apps must be installed or enabled.
4. Determine which SMC collections must exist.
5. Determine which extended-fields schemas, references, enums, or validation rules must exist.
6. Capture dependency ordering where setup steps depend on each other.
7. Write a setup artifact that downstream execution can verify.

## Artifact to create or update

- `migrations/<project>/setup/run.json`
- `migrations/<project>/setup/setup-plan.json`
- `migrations/<project>/setup/setup-requirements.json`
- `migrations/<project>/setup/setup-blockers.json`
- `migrations/<project>/setup/llm-handoff.json`
- `migrations/<project>/setup/review/setup-summary.md`
- `migrations/<project>/orchestration/checkpoints.json`

Treat `mapping/review/mapping-summary.md` as the user-facing statement of intent and
`mapping/mapping-plan.json` as
the detailed contract. If they materially disagree, halt and send the workflow back to
`rp-mapper` to correct them before deriving setup requirements.

## Minimum contents

- required Wix apps
- local crosswalk authority and optional CMS mirror requirements
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

Offer two options in `setup/review/setup-summary.md` and preserve the machine-readable
effect in `setup/setup-blockers.json` or `setup/setup-requirements.json`:

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

- Verify at the moment you write the requirement; do not defer it. Verify **enum
  values**, not just names: confirm each `Field.type` against the Create Data Collection
  schema. (Common trap: there is no `SLUG` type — a Wix slug is a `TEXT` field.)
- If a Wix tool surface such as Wix MCP is available, use it as a fast verification aid.
- If no Wix tool surface is available, rely on `rp-target-wix`'s verified contracts plus
  published Wix REST/SDK documentation and conservative, known-good names, and mark the
  requirement `unverified` so a human confirms it before `rp-execute-setup` runs.

## Standing requirement: mute site notifications (spec 0012)

Emit a **`mute-site-notifications`** requirement into `setup/setup-plan.json` and
`setup/setup-requirements.json` whenever mute is in effect:

- `WIX_SITE_STRATEGY=new` — **always**, as a standing rule keyed on the strategy value
  alone. Not derived from mapping decisions, domain knowledge, or agent judgment, and not
  conditional on `WIX_MUTE_NOTIFICATIONS` (for new sites the mute is unconditional).
- `WIX_SITE_STRATEGY=existing` — only when the owner explicitly opted in with
  `WIX_MUTE_NOTIFICATIONS=on`. Under the existing-site default (`off`), emit no
  requirement.

Requirement contents: severity **blocker**, automation mode `automatable`, ordered
**first among setup writes** (before app installs, collection creation, and any other
provisioning), executed via the `muteSiteNotifications` primitive in
`rp-target-wix/lib/wix-writers.js` (VERIFIED 2026-08-04) with a project-identifying
`reason` (`RePlatform migration — <project>`). Verification criterion:
`getSiteMuteState` returns `muted: true`. Auth note for the requirement: the call must
use the CLI-minted site token (`WIX_AUTH_TOKEN`) — an account API key gets 403.

**Config validation (fail fast):** `WIX_MUTE_NOTIFICATIONS=off` together with
`WIX_SITE_STRATEGY=new` is a validation error — halt with the config conflict recorded
rather than emitting artifacts. (`rp-import-codegen` re-validates the same rule.)

## Crosswalk authority and CMS mirror

Local files under `migrations/<project>/state/crosswalk/` are the durable
`sourceId -> targetId` authority for native Wix entities. Do not make CMS setup a minimum
requirement for native-entity idempotency.

Create/provision CMS **`ImportCrosswalk`** only when the approved mapping plan explicitly
requests a CMS mirror (`cmsMirror: "download" | "upload" | "download-and-upload"`). The
mirror is compact site-local reference data and a pre-execution seed source for
existing-site flows when valid local crosswalk state does not already exist. Add a CMS
quota warning whenever a mirror is requested.

If older artifacts call the optional mirror `MigrationRefs`, normalize it to
`ImportCrosswalk` and call out the rename in the artifact so downstream setup/codegen
share one contract.

## Classifying manual vs. automatable

Do not assert "manual" / "cannot self-provision" by assumption — check the API surface.

- Enabling a Wix app (Blog, Members, etc.) **is** automatable via the App Installation
  API; classify it automatable and cite the method. (Common trap: do not mark Blog or
  Members "cannot self-provision" — both are installable via the API.)
- When the migration carries a product catalog, emit a **`stores-catalog-v3` requirement**
  alongside the Wix Stores app install: expected state `catalogVersion: V3_CATALOG`, verified
  read-only via `GET https://www.wixapis.com/stores/v3/provision/version`, severity
  **blocker**, automation mode `automatable` (it is provisioned by scaffolding the site from
  the `commerce` template — see `replatform` → "Headless site creation"). A Stores install
  alone does not imply V3; a `blank`-scaffolded site comes up `V1_CATALOG` and cannot be
  converted, so this must be a first-class requirement rather than an assumption.
- Creating CMS collections is automatable; enabling Wix Data itself is automatable by
  installing the **Wix Data app `appDefId e593b0bd-b783-45b8-97c2-873d42aacaf4`** via the
  App Installation API, after which `POST /wix-data/v2/collections` creates NATIVE
  collections with no `WDE0110` (verified live 2026-06-10; see `rp-execute-setup`).
- Only storage-plan upgrades, external-system credentials, and account billing are
  genuinely manual. Mark something manual only after confirming no API covers it.

## Runtime policy

This phase is deterministic planning work. It does not create a second approval gate.
`setup/review/setup-summary.md` is supporting execution-planning context, not a separate
user approval checkpoint.

Verify names and enums rather than emitting `unverified` by default. Classify
automatability by checking the API surface (see above), not by assumption. If a direct
verification aid is unavailable, use the documented fallback and mark the requirement
`unverified` so downstream steps surface it before execution.

## Guardrails

- Separate required setup from optional optimizations.
- Avoid embedding import logic here; this file is about prerequisites.
- Be explicit about which requirements come from which mapping decision.
- Do not guess setup names or enum values when you cannot verify them. Mark them
  `unverified` and surface the risk before execution.

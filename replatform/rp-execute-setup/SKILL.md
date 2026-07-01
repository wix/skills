---
name: rp-execute-setup
description: >-
  Verifies and provisions Wix-side setup required before import. Use after codegen when
  setup-requirements.md must be validated or executed against the target site.
---

# rp-execute-setup

Verify that required Wix-side setup exists and is ready for import.

## Purpose

This skill validates the prerequisites discovered by `rp-setup-discovery`. It can also drive the setup work when the environment and permissions allow it.

## Required inputs

- `migrations/<project>/setup-requirements.md`
- `migrations/<project>/config/wix.env` or equivalent environment values
- access to the target Wix environment or to exported evidence from that environment

## Config

Prefer project-local config over ad hoc shell state. `config/wix.env` should exist before
setup verification/provisioning and contain:

```bash
WIX_SITE_ID=
WIX_AUTH_TOKEN=
```

If either required value is missing after loading config plus process env, halt to
needs-user with the missing key name. Never print the token.

Treat `migrations/<project>/config/*.env` as secret-bearing once they may contain real
values. Do not verify them with whole-file reads that echo contents into tool output.
Only check existence plus `present` / `blank` / `missing` status for required keys.

## Workflow

1. Resolve the active project.
2. Read the setup requirements artifact.
3. Verify each required app, collection, schema, field, and permission.
4. Record pass, fail, or blocked status for each item.
5. If execution is allowed, perform missing setup steps carefully and re-verify.
6. Save the verification results.

## Provisioning — exhaust programmatic options before declaring anything "manual"

Default to provisioning via API. Do **not** label a requirement "manual" or "owner
action" until you have confirmed no API can do it.

> **Transport (interim decision):** setup provisioning writes — app installs, Wix Data
> enablement, collection/field creation — **may be performed by the agent via the Wix MCP**
> (`CallWixSiteAPI`) for now. This differs from **import**, which must run the generated
> script and never use MCP as its write transport (`rp-execute-import` → "Execute the
> generated scripts — never an agentic MCP flow"). The reason setup is treated differently:
> it's a small, finite, mostly one-time set of calls with little per-project logic (the
> variance is *which* apps/collections — data, not code), not a bulk restartable pipeline.
> This is an interim choice; other options (e.g. a shared, parameterized provisioner library
> in `rp-target-wix` driven by `setup-requirements.md`) are still under discussion. The
> approval gate is unchanged: no setup write before the user accepts the execution plan.

If the Wix MCP / `CallWixSiteAPI` transport expected for setup verification/provisioning
is missing from the runtime, treat that as a prerequisite gap before assuming you must
work blind:

- first try to ensure the Wix MCP is installed/connected in the current runtime
- if the environment supports connector/plugin install flows, use them
- otherwise halt to needs-user with exact install/connect instructions for the Wix MCP and
  explain which setup verification/provisioning capabilities are blocked without it

Only proceed in a docs-only/read-only posture when the MCP is genuinely unavailable and
the step can still produce useful non-destructive output.

Concrete mechanisms:

- **Installing / enabling Wix apps (Blog, Members, etc.) IS automatable.** Use the
  App Installation API:
  1. Pre-check with `POST /apps-installer-service/v1/app-instance/is-permitted-to-install`
     (read-only) to see whether the identity may install the app.
  2. If permitted, install with `POST /apps-installer-service/v1/app-instance/install`.
     Body (all fields required — confirmed by live 400s): `{ appInstance: { appDefId,
     enabled: true }, tenant: { tenantType: "SITE", id: <siteId> }, installType:
     "INSTALL_TYPE_SITE", appsInstallOptions: {} }`. (The `is-permitted-to-install`
     pre-check uses a *different*, oneof-based body and is informational only — if its
     validation fights you, skip it and rely on `/install`.)
  3. List current state with `GET /apps-installer-service/v1/app-instances`.
  - **Ground `appDefId` from the official "Apps Created by Wix" table**
    (`/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix`),
    NOT from a docs *example* — e.g. the install-app example uses
    `1380b703-…`, which is **Wix eCommerce**, not Blog. Installing the wrong app on a
    live site is a real hazard; verify the ID maps to the app you intend.
- **Wix Data / CMS collections (the `WDE0110: Wix Code not enabled` case).** Enable Wix
  Data by **installing the Wix Data app `appDefId e593b0bd-b783-45b8-97c2-873d42aacaf4`**
  via the App Installation API (same `/install` body shape as any other app; it also
  auto-installs a dependency app `1a711f05-2040-47df-a9f0-4f9cddb4c3c6`). Once installed,
  plain REST `POST /wix-data/v2/collections` creates **NATIVE** collections with no
  `WDE0110` — no code editor toggle, no custom app needed. **Verified live 2026-06-10**
  on a fresh free site (install → 200; collection create → 200 `collectionType: NATIVE`).
  - This is the preferred path. The older data-collections-extension app (authoring a
    custom app that declares collections, FR-005) is now a **fallback** — only needed if
    you must declare collection schemas at install time, and it still can't express
    `REFERENCE` fields (FR-004; add those after install via `create-field`).
  - Note: the standalone "Wix CMS" app (`appDefId 675bbcef-…`) is **not** installable
    (`is-permitted-to-install` → `false`) — do **not** use it; use `e593b0bd-…`.
- **Import crosswalk collection (idempotency, FR-010).** Native blog/CMS entities have no
  client-settable source id and Wix rewrites slugs, so a re-run can't dedupe without a
  side table. After enabling Wix Data, provision a native **`ImportCrosswalk`** collection
  (`POST /wix-data/v2/collections`) with fields `entityType` (TEXT), `sourceId` (TEXT),
  `targetId` (TEXT), `targetType` (TEXT). The generated importer seeds from it
  (`queryAllDataItems`) before writing and records each created entity, so continues/re-runs
  skip done records instead of creating duplicates. Provision this whenever the plan writes
  native entities that must be idempotent.
  If upstream artifacts still call this `MigrationRefs`, normalize them here rather than
  creating both collections.
- **Genuinely manual (no API exists):** upgrading the storage plan, generating
  external-system credentials (e.g. a WordPress Application Password), and
  account-level billing. These are the only categories that may be reported as manual —
  and only after confirming no API covers them.

## Artifact to create or update

- `migrations/<project>/setup-verification.md`

## Verification output format

For each requirement capture:

- requirement name
- expected state
- observed state
- status: passed, failed, blocked
- remediation needed

## Optional media reachability verification

When the migration includes media import by source URL, check whether discovered media
URLs are publicly reachable by Wix. If the source URL is `localhost`, `127.0.0.1`, or a
private-only host, mark **media import** as `blocked` or `deferred`, but do not block
unrelated non-media entities. This is optional setup and, as far as we know today, affects
only Wix Media import.

Record the user's chosen path in `setup-verification.md`:

- **Tunnel media URLs:** ask the user to expose the source through a public HTTPS tunnel,
  then use that URL for `WP_BASE_URL` / `SOURCE_URL` or rewrite media URLs to that base.
- **Skip/defer media:** proceed only if the execution plan clearly says media and any
  media-dependent references (hero images, galleries, downloads) will be skipped or
  deferred.

Ngrok quick setup for macOS:

```bash
brew install ngrok
ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
ngrok http 8090
export WP_BASE_URL=https://<id>.ngrok-free.app
```

## Runtime policy

Split this skill's work by side effect:

- **Verification is read-only** — checking what's installed, what's missing, and what's
  genuinely manual. It runs **before** the execution-plan acceptance gate and feeds the
  plan.
- **Provisioning writes** — installing apps, enabling Wix Data (via the data-collections
  enabler), creating collections, adding fields — happen **only after** the user accepts
  the execution plan. **No site write before acceptance.** Once accepted, the "Migrate"
  consent covers the individual writes, so don't re-prompt per app/collection. Halt to
  needs-user only for genuinely manual items (storage-plan upgrade) or a
  missing/invalid credential.

## Guardrails

- Never report setup as complete without evidence.
- Before marking an item blocked or manual, confirm no API can perform it (see
  Provisioning above). Reserve "manual" for storage/billing/external-credential steps.
- If credentials or permissions are genuinely missing, mark the item blocked and state
  the exact API that was refused and why.
- Do not start import execution from this skill.

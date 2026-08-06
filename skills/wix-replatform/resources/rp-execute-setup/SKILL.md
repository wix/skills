---
name: rp-execute-setup
description: >-
  Verifies and provisions Wix-side setup required before import. Use after codegen when
  machine-readable setup artifacts must be validated or executed against the target site.
---

# rp-execute-setup

Verify that required Wix-side setup exists and is ready for import.

## Purpose

This skill validates the prerequisites discovered by `rp-setup-discovery`. It can also drive the setup work when the environment and permissions allow it.

## Required inputs

- `migrations/<project>/setup/setup-plan.json`
- `migrations/<project>/setup/setup-requirements.json`
- `migrations/<project>/execution/execution-manifest.json`
- `migrations/<project>/config/wix.env` or equivalent environment values
- access to the target Wix environment or to exported evidence from that environment

Prefer the machine-readable setup artifacts above. Markdown setup summaries are secondary
renderings for humans, not the primary execution contract.

## Config

Prefer project-local config over ad hoc shell state. `config/wix.env` should exist before
setup verification/provisioning and contain:

```bash
WIX_SITE_STRATEGY=
WIX_SITE_ID=
WIX_AUTH_TOKEN=
```

`WIX_SITE_STRATEGY` is always required. `WIX_SITE_ID` is required before setup
verification/provisioning begins. If the strategy is `new` and no site has been created
yet, halt to needs-user and route back to the site-creation step rather than asking for an
existing site ID. `WIX_AUTH_TOKEN` is the canonical Wix credential key for this project
flow; for CLI-scaffolded headless sites it holds the site write credential (a CLI token
sent as a Bearer token). **Never print secret values.** Mint the token without printing it
to the transcript by running `scripts/mint-token.sh` from the migration project root:

```bash
bash migrations/<project>/scripts/mint-token.sh
```

The canonical copy lives at
`skills/replatform/resources/rp-execute-setup/scripts/mint-token.sh`.
`rp-import-codegen` copies it into `migrations/<project>/scripts/` at scaffolding time —
do not write it from scratch. The script reads `WIX_SITE_ID` from `config/wix.env`, calls
`npx @wix/cli@latest token --site "$WIX_SITE_ID"`, captures stdout (token shape:
`OauthNG.JWS.<base64>.<base64>.<sig>`), writes it directly into `config/wix.env` as
`WIX_AUTH_TOKEN`, and prints only a char-count confirmation. Do NOT run the token command
raw in a Bash tool call — it prints the credential to transcript.

If `WIX_SITE_ID` is missing for a RePlatform `new site` + `headless` flow, the recovery
path is the **Wix CLI headless scaffold** step defined in `replatform` → "Headless site
creation" (`npm create @wix/new@latest headless`). The account-level Projects API is
deprecated for this workflow. **Note:** the scaffold does not install Wix Stores — this
skill (setup) is where Wix Stores and other required apps get installed (via the
`wix-manage` skill / app-install path), then verified, before import.

Treat `migrations/<project>/config/*.env` as secret-bearing once they may contain real
values. Do not verify them with whole-file reads that echo contents into tool output.
Only check existence plus `present` / `blank` / `missing` status for required keys.

## Workflow

1. Resolve the active project.
2. Read the machine-readable setup artifacts.
3. Verify each required app, collection, schema, field, and permission through the shared
   setup runtime contract.
   If setup requirements came from domain knowledge, preserve the originating `targetRef`
   in verification output so later execution warnings can be traced back to the selected
   entity guidance.
4. Record pass, fail, or blocked status for each item.
5. If execution is allowed, perform missing setup steps through the shared setup runtime
   and re-verify.
6. Save the verification results and setup execution artifacts.

## Execute the setup artifacts — do not re-derive setup from prose

Setup execution should follow the approved machine artifacts and the shared setup runtime.
It should not rebuild setup decisions from markdown or ad hoc reasoning when
`setup/setup-plan.json`, `setup/setup-requirements.json`, and `execution/execution-manifest.json`
already exist.

This skill owns execution of those artifacts. It does not own redefining the setup plan
or creating a separate setup approval checkpoint.

Dry-run setup uses the same setup plan and setup executor as live setup. When `DRY_RUN`
is enabled by config or `--dry-run`, every setup step must first be reduced to a
structured intent describing the REST request, SDK operation, MCP tool call, or CLI
command that live setup would use. The shared setup runtime then captures that intent,
marks the step `planned_dry_run`, and must not invoke Wix MCP tools, Wix CLI commands,
SDK calls, or fetch calls that access or mutate Wix account/site state.

Do not override `DRY_RUN=true` with `--no-dry-run` for setup verification or provisioning
unless the user has explicitly approved leaving dry-run for setup. Prefer to avoid that
override entirely when a dry-run or plan/report can answer the question. The one allowed
live action while a project otherwise remains in dry-run mode is the separate new-site
creation step handled upstream by `replatform`; this skill must not treat that exception
as permission to run live setup writes or live setup verification probes.

Dry-run setup must not update `setup/setup-verification.json` in a way that claims a Wix
capability, app installation, collection, or site exists. Write a separate dry-run setup
report or clearly dry-run-scoped observations instead.

## Provisioning — exhaust programmatic options before declaring anything "manual"

Default to provisioning via API. Do **not** label a requirement "manual" or "owner
action" until you have confirmed no API can do it.

The preferred contract is a **shared setup runtime** owned by `rp-target-wix`, executed
against the machine setup artifacts produced upstream. This skill may use available Wix
API/MCP surfaces as the transport beneath that runtime, but the contract at the
RePlatform level is:

- setup execution consumes machine setup artifacts
- setup execution follows shared runtime behavior
- setup provisioning is not re-planned live by the agent

The approval gate is unchanged: no setup write before the user accepts the execution
plan.

If a helpful Wix tool surface is available in the runtime, it may be used beneath the
shared setup runtime for verification or transport. If no such surface is available, do
not treat that alone as a blocker; continue with the shared setup/runtime contract and
verified `rp-target-wix` behavior, marking unverified items where needed.

Only proceed in a docs-only/read-only posture when the MCP is genuinely unavailable and
the step can still produce useful non-destructive output.

Concrete mechanisms:

- **Mute site notifications FIRST (spec 0012).** When the setup artifacts carry the
  `mute-site-notifications` requirement (always for `WIX_SITE_STRATEGY=new`; opt-in for
  existing sites), execute it **before every other setup write** — immediately after the
  target site is available and `WIX_AUTH_TOKEN` is minted, and before app installs,
  collection creation, or any other provisioning — so setup writes themselves cannot
  fire notifications. Use the `muteSiteNotifications` primitive from
  `rp-target-wix/lib/wix-writers.js` (VERIFIED 2026-08-04) with a project-identifying
  reason (`RePlatform migration — <project>`); verify via `getSiteMuteState` →
  `muted: true` (verification method `status-read`; an idempotent re-mute is only a
  documented fallback, method `idempotent-recall`). Record the result in
  `setup/setup-verification.json` on the requirement at call time — status
  (`pass`/`fail`/`blocked`), timestamp, and verification method — like any other
  verified item; downstream reports read this recorded state, never infer it. **AUTH
  TRAP:** the endpoints accept user tokens only — the CLI-minted `OauthNG` site token
  works; an account API key gets an empty-body 403. **A failed mute is a blocker, not a
  warning:** the run halts to needs-user and never proceeds to import writes — no
  degraded mode, no continue-anyway. Never call `unmuteSiteNotifications` from this
  skill — unmute is an explicit owner request handled at the orchestrator level.
  Record the provision outcome through the standard `rp-telemetry` recorder like any
  other notable boundary (an `error` event with `error_code` on failure; the
  existing-site opt-in surfaces via the approval gate's `user_decision` event) — no new
  telemetry surface.
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
  - **After installing Wix Stores, verify the catalog is V3 — before any Stores write.**
    Installing Stores does **not** guarantee Catalog V3: on a site scaffolded from the
    `blank` headless template, the install comes up **`V1_CATALOG`**, which the V3 Stores
    primitives cannot write to (verified the hard way on a live migration, 2026-07-30).
    Catalog version is fixed at provisioning — there is no in-place V1 → V3 switch. Check it
    with the read-only Catalog Versioning API:

    ```bash
    curl -s -H "Authorization: Bearer $WIX_AUTH_TOKEN" -H "wix-site-id: $WIX_SITE_ID" \
      https://www.wixapis.com/stores/v3/provision/version
    ```

    `catalogVersion` is `V3_CATALOG` (proceed), `STORES_NOT_INSTALLED` (install, re-check),
    or `V1_CATALOG` — record it as a **blocker** in `setup/setup-verification.json`, write
    nothing to Stores, and halt to needs-user. The prevention lives upstream of this skill
    (`replatform` → "Headless site creation": scaffold with `--site-template commerce`); the
    recovery is a user-approved replacement site, **never** a silently created one, and
    never a throwaway probe site.
- **Wix Data / CMS collections (the `WDE0110: Wix Code not enabled` case).** Enable Wix
  Data by **installing the Wix Data app `appDefId e593b0bd-b783-45b8-97c2-873d42aacaf4`**
  via the App Installation API (same `/install` body shape as any other app; it also
  auto-installs a dependency app `1a711f05-2040-47df-a9f0-4f9cddb4c3c6`). Once installed,
  plain REST `POST /wix-data/v2/collections` creates **NATIVE** collections with no
  `WDE0110` — no code editor toggle, no custom app needed. **Verified live 2026-06-10**
  on a fresh free site (install → 200; collection create → 200 `collectionType: NATIVE`).
  - This is the preferred path. The older data-collections-extension app (authoring a
    custom app that declares collections) is now a **fallback** — only needed if
    you must declare collection schemas at install time, and it still can't express
    `REFERENCE` fields (add those after install via `create-field`).
  - Note: the standalone "Wix CMS" app (`appDefId 675bbcef-…`) is **not** installable
    (`is-permitted-to-install` → `false`) — do **not** use it; use `e593b0bd-…`.
- **Optional import crosswalk CMS mirror.** Native Wix entities use local crosswalk state
  under `migrations/<project>/state/crosswalk/` for idempotency. Provision a native
  **`ImportCrosswalk`** collection only when the approved setup artifacts explicitly
  request a CMS mirror for existing-site seeding or site-local reference. After enabling
  Wix Data, create it with `POST /wix-data/v2/collections` and fields such as
  `entityType` (TEXT), `sourceId` (TEXT), `sourceStableKey` (TEXT), `targetId` (TEXT),
  `targetType` (TEXT), and `updatedAt` (DATETIME/TEXT). Do not provision this collection
  as the default native-entity idempotency mechanism. If upstream artifacts still call the
  optional mirror `MigrationRefs`, normalize them here rather than creating both
  collections.
- **Genuinely manual (no API exists):** upgrading the storage plan, generating
  external-system credentials (e.g. a WordPress Application Password), and
  account-level billing. These are the only categories that may be reported as manual —
  and only after confirming no API covers them.

## Artifact to create or update

- `migrations/<project>/setup/setup-verification.json`
- `migrations/<project>/setup/review/setup-verification.md`
- audit/report artifacts emitted by the shared setup runtime
- dry-run request captures in `migrations/<project>/state/attempts/wix-request-captures.ndjson`
  when setup is run with dry-run enabled

Stores live setup checks that require a probe record must use the shared rp-target-wix
verification CLI, not ad hoc snippets. For subscription support, run:

```bash
node skills/replatform/resources/rp-target-wix/scripts/verify-stores.js stores subscription-create \
  --artifact migrations/<project>/setup/stores-subscription-verification.json \
  --proposal-artifact migrations/<project>/setup/contract-ledger-proposal.json
```

Keep the JSON verification artifact and contract-ledger proposal alongside setup
verification. The proposal is not itself shared product knowledge; the orchestrator must
promote accepted proposal data into `rp-target-wix/domains/**/entities/*.json` in the same
session or record a deferral reason. If cleanup fails, do not mark the probe as clean;
preserve the warning and run the emitted `stores delete-probe` recovery command after
permissions or target state are fixed.

## Verification output format

For each requirement capture:

- requirement name
- expected state
- observed state
- status: passed, failed, blocked
- remediation needed

The machine-readable verification artifact should also preserve:

- stable requirement ID
- checkpoint/provisioning step ID when applicable
- verification evidence reference
- automation mode: `automatable | manual | blocked | unverified`

## Optional media reachability verification

When the migration includes media import by source URL, check whether discovered media
URLs are publicly reachable by Wix. If the source URL is `localhost`, `127.0.0.1`, or a
private-only host, mark **media import** as `blocked` or `deferred`, but do not block
unrelated non-media entities. This is optional setup and, as far as we know today, affects
only Wix Media import.

Record the user's chosen path in `setup/setup-verification.json` and render it into the
review markdown:

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

The execution behavior itself should come from the shared setup runtime and approved
setup artifacts, not from improvised per-run logic in this skill.

## Guardrails

- Never report setup as complete without evidence.
- Prefer machine-readable setup verification artifacts over prose-only reporting.
- Before marking an item blocked or manual, confirm no API can perform it (see
  Provisioning above). Reserve "manual" for storage/billing/external-credential steps.
- If credentials or permissions are genuinely missing, mark the item blocked and state
  the exact API that was refused and why.
- Do not start import execution from this skill.
- Do not reinterpret setup requirements from markdown when machine artifacts exist.

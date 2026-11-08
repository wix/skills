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
existing site ID.

**Studio/Harmony destinations.** A new Editor site is bound only after
`orchestration/destination.json` is `verified` (actual editor and an `unpublished` readback).
Setup treats it like any new site: mint `WIX_AUTH_TOKEN` for that `WIX_SITE_ID` through
`mint-token.sh`, confirm it with a harmless target read before the first write, mute site
notifications first (`WIX_SITE_STRATEGY=new` regardless of site type), and install/verify
every required app — never infer installed apps, Catalog version or backend readiness from the
editor type or template. Never publish the Editor site; its website and publication remain
operator handoff items.

**Any Wix app can be installed by a setup step that carries its app id** — `{ "id": "<unique id>", "kind": "installApp", "appDefId": "<app id>" }` — with no code change; the named
`install-wix-*` steps are the same call under a name the planner already uses.

**On a Harmony site every app is installed through the editor's installation service**, not the
generic app installer: that installer lists an app but leaves the Harmony editor without the pages the
app adds. Each install step reads the site's editor type (then the destination record) and, on Harmony,
sends the app's id to the service with the editor switch it needs, then reads the installed-apps list
back. An app the service says has no editor part is installed
with the generic installer instead. The service installs an app's own dependencies. A small
companions table in the writers lists apps an app's widgets need that it does not add (Wix Stores: the
rich-text viewer app, installed first). Every other editor keeps the generic install. If the installer refuses an app because another app already owns its page paths (Wix installs two
apps that add the same eCommerce pages, such as Stores and Bookings, only one at a time), the earlier
step wins: the later app is left uninstalled, its step ends with `installed: false` and `deferred`, setup
goes on, and the destination hand-off asks the site owner to add it once Wix fixes the conflict. Order
the install steps by importance (Stores before Bookings). Setup cannot read a Harmony page list, so it records `appPages: "not-read"` and the
destination hand-off asks the site owner to confirm each app's pages. The route and the switch are a
temporary workaround for an eCommerce feature closed on Harmony: re-check both once it reopens.

**When `WIX_SITE_ID` names a site this run did not create, setup changes posture: verify
and fill gaps, never provision from scratch.** The site is already in use, so treat
everything in it as pre-existing state to work around rather than a blank slate:

- **Expect apps, collections and fields to exist already.** Install only the delta the
  mapping actually needs. An app that is already installed is a PASS, not a step to redo,
  and re-provisioning is how a working site acquires duplicate collections.
- **Never delete or recreate an entity to "fix" a mismatch.** A collection whose schema
  differs from what the mapping expects is a `blocked` requirement with a remediation note
  — the owner decides, not this skill.
- **A `V1_CATALOG` verdict is terminal here.** The replacement-site recovery in
  `resources/rp-destination/` applies only to a site this run scaffolded. Record the
  blocker, write nothing to Stores, halt to needs-user.
- **When the approved plan requests a CMS mirror, provision the on-site `ImportCrosswalk`
  collection** (see "Import crosswalk CMS mirror" below). Whether a mirror is requested at all
  is the owner's call and the mapper's setting — it is optional by design. Once it *has* been
  requested, two things follow and neither one counts as the other: provisioning is a required
  setup step **even on a destination the owner already had** (an existing site is not a reason
  to treat it as already satisfied), and provisioning is **not the deliverable** — the run still
  owes the post-execution snapshot pass that keeps the collection current.
- Record which requirements were already satisfied versus newly provisioned in
  `setup/setup-verification.json`. On a site the user owns, "we changed nothing here" is
  itself a result worth reporting.

`WIX_AUTH_TOKEN` is the canonical Wix credential key for this project
flow; for CLI-scaffolded headless sites it holds the site write credential (a CLI token
sent as a Bearer token). **Never print secret values.** Mint the token without printing it
to the transcript by running `scripts/mint-token.sh` from the migration project root:

```bash
bash migrations/<project>/scripts/mint-token.sh
```

The canonical copy lives at
`skills/wix-replatform/resources/rp-execute-setup/scripts/mint-token.sh`.
`rp-import-codegen` copies it into `migrations/<project>/scripts/` at scaffolding time —
do not write it from scratch. The script reads `WIX_SITE_ID` from `config/wix.env`, calls
`npx --no-install wix token --site "$WIX_SITE_ID"`, captures stdout (token shape:
`OauthNG.JWS.<base64>.<base64>.<sig>`), writes it directly into `config/wix.env` as
`WIX_AUTH_TOKEN`, and prints only a char-count confirmation. Do NOT run the token command
raw in a Bash tool call — it prints the credential to transcript.

Setup and import clients renew the token through this script while they run, for the same
`WIX_SITE_ID` only, so one mint before a long run is enough. When renewal fails, setup records
the blocker `wix_auth_expired` and exits 75 with the same Import Operator action as the import
(see `rp-execute-import`).

If `WIX_SITE_ID` is missing for a RePlatform `new site` + `headless` flow, the recovery
path is `resources/rp-destination/`, which scaffolds via
`npm create @wix/new@latest headless`. The account-level Projects API is
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
7. **Carry the source store's own configuration.** See the section below — this is a
   required step, not an optional extra, and it is the one every run before it skipped.

## Carry the source store's own configuration

A migrated site that publishes with a blank business address is not a cosmetic miss: it is a
whole class of source data that no run ever read, because two independent obstacles each made
the route look like a dead end (the REST index advertises only the parameterized settings
route, and the WooCommerce consumer key 401s on it while the WordPress application password
succeeds). Nothing reported it missing, because no domain owned it.

Three steps, in order:

1. **Capture.** Run `rp-source-wordpress/scripts/capture-store-settings.js <projectDir>`.
   Deterministic; writes `data/store-settings-general.json`. Do not hand-roll the fetch — the
   script exists specifically because the credential and the route shape are both traps.
2. **Write the business address.** Build the payload with
   `rp-target-wix/lib/store-config-build.js`'s `buildBusinessContactInput`, write it with
   `wix-writers.js`'s `updateBusinessContact`, then read it back with `getSiteProperties` and
   compare. The read-back is not optional: the update returns an empty body, so a 200 proves
   only that the request was accepted. See `domains/site/entities/business-contact.json`.
   NEVER assemble the `fields.paths` mask by hand — a path listed but not sent is CLEARED, and
   Wix's own documented example demonstrates that hazard rather than the safe pattern.
3. **Report the rest at the gate.** `collectReportOnlySettings` returns currency, selling
   countries, ship-to countries, tax on/off, coupons on/off and price format, each with its
   source value and why it matters. These are NOT written by this pipeline — surfacing them
   beside the destination's current values is what turns "we didn't migrate it" from an
   invisible omission into a decision the merchant can make in one look.

The captured address also feeds the shipping step: with it, a collection point whose source
carries no address is proposed ("your store address is X — is that where customers collect?")
instead of prompting blank. See `shipping-build.js`'s `resolvePickupAddressSource`.

## Execute the setup artifacts — do not re-derive setup from prose

Setup execution should follow the approved machine artifacts and the shared setup runtime.
It should not rebuild setup decisions from markdown or ad hoc reasoning when
`setup/setup-plan.json`, `setup/setup-requirements.json`, and `execution/execution-manifest.json`
already exist.

This skill owns execution of those artifacts. It does not own redefining the setup plan
or creating a separate setup approval checkpoint.

The shared executor uses `startSetupRun` and `bindSetupStep` to issue a capability bound to
the current plan, destination and named step. It admits registered setup operations and
writes for that step's `entityRefs`; it cannot import records or send arbitrary requests.
Setup, import, quick and disposable-probe process marks are exclusive. Do not pass a
caller-authored phase or substitute a general import/probe client for a setup client.

For a step declaring `referenceKeys`, capture `referenceBindings` on its passed requirement
in `setup/setup-verification.json` from the capability-bound executor's actual target
read-back. Reuse a successful operation's read result when available; otherwise perform the
bounded read for each distinct declared target. Bind the receipt to `siteId`, `planDigest`
and the source keys/paths. Guessed IDs, copied source IDs, raw/unrelated reads and write-only
responses are not verified bindings. Imports resolve these values through the gate only
after every bound setup step passes; successful partial setup never unlocks a dependent.

Every passed requirement in the receipt carries `verification: { method, checkedAt, observed }`
for the check `execute-setup.js` actually ran — for example `status-read` (mute state read
back), `installed-apps-read` or `install-response` (an install with no read-back),
`collection-read`, `catalog-version-read`. The shared validator rejects a passed row without
a known method, a valid timestamp and an observed-state object. A receipt written before
these fields existed is invalid: re-run setup; never add the fields by hand.

Each live attempt records the receipt it replaces as `replaces: { sha256, generatedAt }`
(or `null`) in the new receipt, and carries it through failed attempts in
`setup/setup-blockers.json`. Import-plan freshness uses it: re-running setup after the
approved setup already produced a receipt makes the approved plan stale, so present the
regenerated plan or delta before importing.

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
creation step handled upstream by `wix-replatform`; this skill must not treat that exception
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

- **Mute site notifications FIRST.** When the setup artifacts carry the
  `mute-site-notifications` requirement (always for `WIX_SITE_STRATEGY=new`; for existing
  sites only when the operator answered mute at intake), execute it **before every other setup write**. Then run `import-site-locale` (which writes site properties
  only and sends nothing) — immediately after the
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
  existing-site answer is the `notificationMute` decision recorded at intake) — no new
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
     **An install call that returns 200 is not a pass.** The executor records an app step as
     passed only when this list, read back after the install, names the `appDefId` and it is
     enabled (`APP_INSTALL_NOT_VERIFIED` otherwise). Wix Stores is `215238eb-…`; the quick-mode
     `wix-stores` step and the standard `install-wix-stores` step install the same app. Wix
     eCommerce (`1380b703-…`) is only Stores' dependency and does not make Stores installed.
  4. **Installing Wix Stores adds sample products and categories** (12 products on the Tuti
     runs; no Wix marker identifies them). The Stores step (`install-wix-stores` or
     `wix-stores`) handles them itself (owner decision 2026-10-26):
     - It reads products and categories (each on its own) just before the install, then
       after it until two reads agree. Ids that appear in between are `install_seeded`. If a
       pre-install read fails on a site this run did not create, nothing in that collection is
       treated as seeded. If the catalog is still changing after every read, or new items
       appear while it deletes, the step is blocked with `CATALOG_NOT_SETTLED` before (or
       instead of further) deletes; re-run setup to finish.
     - The record is written before any delete call, so a crash or failed check keeps it.
     - On a site this run created (destination receipt `verified`, `strategy: new`), it
       deletes exactly the `install_seeded` items, keeping the built-in `All Products`
       category, then reads the catalog again and records each id as `deleted` or
       `delete_failed`. It asks nothing. On any other site it deletes nothing: a reinstall
       there may bring back the owner's earlier catalog, which looks like samples. Those
       items stay protected and become the same cutover item. A failed delete does not fail setup; it becomes the
       cutover item `STORES_INSTALL_SEEDED_NOT_DELETED`, and a re-run of setup tries again.
     - If Stores was already installed, it deletes nothing and records every item as
       `pre_existing`. A re-run keeps the baseline the first run recorded.
     - It writes `setup/destination-catalog-baseline.json` (ids, slugs, kind, status; no
       prices or customer data). The step's `installed-apps-read` check carries
       `observed.catalogBaseline` with the file's digest and counts. If a catalog read fails
       the step is blocked with `CATALOG_BASELINE_UNREADABLE`.
     - Never delete products or categories by hand or with a project-local script. A dry run
       makes no delete call.
  - **Ground `appDefId` from the official "Apps Created by Wix" table**
    (`/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix`),
    NOT from a docs *example* — e.g. the install-app example uses
    `1380b703-…`, which is **Wix eCommerce**, not Blog. Installing the wrong app on a
    live site is a real hazard; verify the ID maps to the app you intend.
  - **Installing Wix Stores on a site this run created provisions Catalog V3
    unconditionally** — Catalog V3 is now guaranteed at provisioning regardless of
    scaffold template, so there is no
    verification step here for that case. This does not apply to an existing site this
    run did not create — see "A `V1_CATALOG` verdict is terminal here" above for that
    case, which is unchanged.
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
- **Import crosswalk CMS mirror — OPTIONAL, provisioned only when a mirror mode is
  requested.** Native Wix entities use local crosswalk state under
  `migrations/<project>/state/crosswalk/` as the sole runtime authority for idempotency; a
  CMS mirror is never a substitute for it and never required for correctness. Do not
  provision `ImportCrosswalk` by default for every project — Wix CMS quotas are plan-based
  and shared across every custom collection on the site, so an unconditional mirror can
  spend a meaningful fraction of a lower-tier plan's total item quota on operational
  migration state the site owner never asked to store. Provision it only when the mapper's
  `cmsMirror` setting for the project is something other than `none` (typically an
  existing-destination flow where the user opted into site-local reference data, so a later
  re-import from another project or a different surface can see "what has already been
  imported here" instead of duplicating it). When a mirror IS requested, provisioning alone
  is not the deliverable: the mirror is a compact snapshot uploaded AFTER
  execution, not written to inline during it. `rp-import-codegen` generates that snapshot as a
  distinct post-execution step, gated on the same `cmsMirror` mode, which reads the finished
  local crosswalk and uploads it through
  `rp-target-wix/lib/wix-writers.js`'s `syncImportCrosswalk` (see `rp-execute-import`'s
  "Import & idempotency"). LIVE-VERIFIED a project whose collection was provisioned early and
  never written to again left every already-imported record with no on-site trace at all until
  a one-time backfill caught it up, so provisioning must not be treated as satisfied by
  itself — a provisioned collection is only trustworthy once that post-execution pass has run
  over the local crosswalk. A mirror requested but never snapshotted is a reportable
  shortfall, not a completed setup. After enabling
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

## Inventory prerequisites for product imports

For planned variant inventory, resolve the intended Stores location with
`rp-target-wix/lib/stores-inventory.js` → `resolveInventoryLocation(wix, locationId?)`.
Do not create a location if the lookup is empty or ambiguous. Verify inventory-read access.
Inventory create and update require their own write permissions in addition to product
create; a token field or configured scope name is not proof that those permissions work.

On an explicitly selected, already-muted disposable target, run:

```bash
node resources/rp-target-wix/scripts/verify-stores.js stores inventory-import --env <test-target-config> --artifact <verification-json>
```

This creates hidden synthetic products, verifies bulk stock create, tracked/untracked updates,
inline stock, and a no-write rerun, then deletes only those probe products. It does not mute
or unmute a site. Record actual target, token context, timestamp, assertions, and cleanup in
the setup receipt; a failed probe cannot satisfy the inventory requirement. A disposable-site
receipt verifies that token/site only: run the authorized canary under the real destination's
own setup approval before its full import. Reuse current evidence rather than probing per product.

## Artifact to create or update

- `migrations/<project>/setup/setup-verification.json`
- `migrations/<project>/setup/review/setup-verification.md`
- audit/report artifacts emitted by the shared setup runtime
- dry-run request captures in `migrations/<project>/state/attempts/wix-request-captures.ndjson`
  when setup is run with dry-run enabled

Stores live setup checks that require a probe record must use the shared rp-target-wix
verification CLI, not ad hoc snippets. For subscription support, run:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores subscription-create \
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

## Wix site locale: `import-site-locale`

The first imported entity after notification safety, for any source. It reads the site's settings, compares currency, time zone, language
and locale with `discovery/source-locale.json` (each source adapter maps its own settings into that file),
writes only what differs, and reads every value back. The Wix call stores whatever it is sent (a
made-up currency and time zone were both stored with a 200), so values are validated before sending and a 200
is never evidence; a repeated write bumps the site version, so a matching site gets zero write calls.

- **A site this run created** (destination receipt `verified`, `strategy: new`, same site id) is set directly.
- **An existing site** is probed for orders and products only. No orders and no products means set directly.
  Any order, any product, an unreadable installed-apps result, or a failed probe raises **one** durable question
  for all differences; never answer it for the owner, one-click included. No sample-product heuristic ships.
  `change` applies every difference. `keep` is a passed receipt: neutral entities continue, while money-bearing
  tasks and wall-clock tasks whose relevant setting differs are held under `SITE_LOCALE_KEPT`. Unclassified refs
  fail closed. The answer survives partial apply for the immutable rows originally shown and is replaceable.
- The pre-change values are kept in `setup/site-locale-before.json` so a re-run after a crash still reports the
  true before and after.
- `SOURCE_LOCALE_REQUIRED` means one or more source values are still `unknown`. Full adapters update
  their adapter discovery file and promote it. Quick adapters and SFCC have no promote step: ask the
  merchant, record each missing canonical field in `discovery/source-locale.json` as `state: supplied`
  with a validated `value`, `evidence`, and `suppliedBy`, re-run the quick plan when applicable, then
  rerun setup. Public re-capture preserves a valid supplied value while that field remains unknown.
- Any rejected write or read-back mismatch is a blocker. When payment currency changes, create one durable
  payment-method confirmation action and preserve it across matching reruns until acknowledged.
- The receipt is the `regional` object on the step's row in `setup/setup-verification.json`; import tasks
  read it (files only) to decide whether they may start. Dry run reduces the step to an ordered intent and
  calls nothing.

## Provisioning user-defined extended fields (Data Extension Schema)

Never build a Data Extension Schema update by hand. Use
`rp-target-wix/lib/data-extension-schema.js` and send the request it returns.

The reason is a single API property: **Update Data Extension Schema is a `PUT` that overrides the
stored schema**, and `jsonSchema` is required. Sending only the fields this migration needs
therefore DELETES every field the merchant created, silently and permanently, on their own data.
`planDataExtensionSchemaProvisioning()` reads the existing schema, merges into it, and refuses the
update when it would drop, retype, narrow or re-classify anything already there.

The order it enforces:

1. List the existing schema with `fields=ARCHIVED` — archived fields are hidden by default, and an
   archived key cannot be reused, so the collision check is blind without them.
2. Select the schema by `namespace` (`_user_fields`). List returns global and app schemas
   alongside the user-defined one; picking by position merges into somebody else's schema.
3. Plan. The result is `create`, `update`, `noop` or `blocked` — `noop` is what a repeated run
   returns, and `blocked` carries the reason.
4. Send the returned request. An update carries the schema `id` and the **current** `revision`;
   the API uses the revision to reject conflicting changes.
5. Re-read and verify each field with `verifyDataExtensionSchemaFields()`, and persist the
   evidence. A create or update can report success without producing the field.
6. Generated import code writes an extended-field value only after verification passed for that
   exact field — `validateExtendedFieldWriterReferences()` enforces it.

Use `writers.provisionExtendedFieldRequirement()`; it routes each requirement by `schemaKind` and
the `provision-extended-fields` step already calls it. Scope: orders, products
and Contacts V5 through the Data Extension Schema; Contacts V4 through CRM Extended Fields only when
the requirement says `contactWriteSurface: "contacts-v4"`. Everything else is refused before any
network call. Types: `string` (DES) and `TEXT` (V4); the helpers refuse an unverified type.

Named blockers and what they mean:

- `CONTACTS_V5_DES_UNVERIFIED` — the gating List for `wix.contacts.*.contact` was refused. Setup
  does **not** fall back to V4. Wait for the path to be verified, or re-route the mapping to
  `contacts-v4` explicitly; that is a mapping decision, not a recovery step.
- `EXTENDED_FIELD_SCHEMA_CONFLICT_EXHAUSTED` — three Update attempts in a row hit a revision
  conflict. Each retry re-listed and re-merged, so the concurrent change was kept, not overwritten.
  Re-run once the concurrent edits stop.
- `schema-budget-exceeded` (under `EXTENDED_FIELD_SCHEMA_BLOCKED`) — the namespace byte budget cannot
  hold the fields. Checked before create too, against the observed 10,000-byte limit. Route the
  excess to CMS; never pick fields to drop.
- `CONTACT_EXTENDED_FIELD_MISMATCH` — V4 Find Or Create matched a field by name with another type,
  returned no or another namespace than `custom`, or returned a key different from the one an
  earlier run verified. Keys cannot change and approving a migration action does not fix it;
  decide with the owner rather than creating a second field.
- `PRIOR_EXTENDED_FIELD_RECEIPT_UNREADABLE` — a contacts-v4 run found
  `setup/extended-field-verification.json` but could not read it, so key continuity cannot be
  proved. The file is kept; restore it, or remove it only if no earlier import wrote V4 values.

Contacts V4 receipts record each `displayName`, the returned `key` and the write path
`info.extendedFields.<key>`; V5 contact values go only under `extendedFields.namespaces._user_fields`.
Live proof for products and both contact paths is still pending on a disposable site.

The inventory verification token also needs Catalog read access to hidden products and variants. The canary must verify default-location availability in both Inventory and Catalog before the inventory path is marked verified.

## CMS collection compatibility

The existing create-cms-collections executor reads every planned collection definition after creation/reuse (including a concurrent-create 409). Its REST collection fields, reference metadata, required/writable flags and all access roles must match the planned write; extra required business fields need explicit mappings. Missing or incompatible definitions remain CMS_COLLECTION_INCOMPATIBLE setup blockers. Never delete/recreate a collection to obtain a compatible definition.

CMS definition read-back uses documented `GET /wix-data/v2/collections/<id>?consistentRead=true`
to avoid immediately reading a stale replica after create. Compatibility enforces planned
metadata keys, types, required fields and permissions; unplanned server defaults are not a
conflict. This comparison has local/schema evidence; it is not a live verification claim.

## Public multilingual setup

Run `scripts/multilingual-setup.js` after the verified `site/locale` step and before translation
inventory or writes. It snapshots every locale visibility choice. A destination proven to have
been created by this migration may install Multilingual, enable multilingual mode, and add missing
additional locales hidden. Every other destination first emits an exact setup proposal and makes
zero setup requests until a current `confirm-setup` decision exists; `decline-setup` leaves the
sidecar blocked while default import continues. The script never changes an existing locale's
visibility or the default locale, and every mutation is refused until its versioned disposable-site
contract evidence exists. Site origin is recomputed from the verified
`orchestration/destination.json` receipt and its exact `WIX_SITE_ID` binding; callers cannot assert
`created` through a flag. Setup gate/read-back failures are written to `setup.json` for completion
report projection before the script exits nonzero.

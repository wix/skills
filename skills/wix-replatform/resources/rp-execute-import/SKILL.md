---
name: rp-execute-import
description: >-
  Runs the generated extract/import pipeline and records execution results. Use when setup
  and codegen are complete and the user has approved the execution plan.
---

# rp-execute-import

Execute the generated migration pipeline and capture import results.

## Purpose

This skill runs the generated extract/import pipeline for the active project once setup and code generation are complete.

## Required inputs

- generated code under `migrations/<project>/src/`
- `migrations/<project>/execution/execution-manifest.json`
- `migrations/<project>/execution/llm-handoff.json`
- `migrations/<project>/execution/review/import-plan.md`
- `migrations/<project>/execution/review/code-safety-review.md` when `SAFE_MODE=true` or
  `DRY_RUN=true`
- `migrations/<project>/setup/setup-verification.json`

## Preconditions

Do not proceed until:

- setup verification shows required items are passed or accepted; an unrecovered blocker
  halts to needs-user
- reader, transform, and writer code exist for the intended entities
- execution artifacts define batching, retries, checkpoints, and write order clearly
- when `SAFE_MODE=true` or `DRY_RUN=true`, the post-codegen code-safety review exists and
  has been accepted before execution approval is sought
- the **execution plan report has been presented and the user has accepted it** (see
  below)

Prefer the machine-readable execution artifacts above. `execution/review/import-plan.md`
is a human-facing review artifact, not the primary execution contract.

Before live import and again before final reporting, validate
`execution/review/import-plan.freshness.json` with the deterministic freshness helper:

```bash
node skills/replatform/scripts/artifact-freshness.js check migrations/<project> \
  --domains-dir skills/replatform/resources/rp-target-wix/domains \
  --delta execution/review/import-plan-delta.md
```

If the check is stale, do not silently continue from the old approval text. Regenerate
`execution/review/import-plan.md` or append and present
`execution/review/import-plan-delta.md`; completion reports must reference the latest
accepted plan or delta.

## Execution plan & user acceptance (required gate)

This gate precedes **all** writes to the user's site — both `rp-execute-setup`
provisioning and this import. Before writing anything, produce a human-readable
**execution plan report** and obtain explicit user acceptance. Do not write anything until
the user accepts. The report must show:

- **Setup changes to be made first:** apps to install (Blog / Members / Wix-Data enabler),
  Wix Data enablement, and collections to create — so the user sees the site changes, not
  just the content writes.
- **What will be imported and where:** each source entity → its Wix target (app or
  collection) with record counts — e.g. posts → Wix Blog (1088); episodes →
  `PodcastEpisodes` (86); categories/tags → Blog taxonomies; media → Media Manager (~1499).
  Make media reporting explicit:
  - referenced media imported through entity-native background ingestion
  - referenced media imported through Media Manager first
  - unattached media skipped by default unless explicitly in scope
- **What will NOT migrate cleanly / needs manual action:** the lossy and blocked items,
  drawn from the mapping plan's faithfulness ledger and any `setup/setup-verification.json` items
  still manual or blocked — e.g. category hierarchy flattened, comments anonymized,
  drafts absent without auth, storage-plan upgrade required. **This must also include any
  target with no verified Wix primitive** — state whether it falls back to a generic CMS
  collection, to an `unverified`/best-effort runtime-derived call, or is skipped. Nothing
  unverified or lossy may be written without first appearing here for consent.
  Coupons follow the same native-first rule as other native Wix entities: prefer native
  Wix Coupons, and mention CMS fallback only for truly unsupported coupon semantics.
  - **Always state the analytics-data exclusion explicitly.** Historical analytics data —
    traffic / visitor stats accumulated on the source — is **out of scope** and is **not**
    imported (see "Out of scope" below). Call this out in the plan so the user knows before
    accepting that analytics data will not migrate; do not let it pass silently.
- **Order & idempotency:** the write order and how re-runs dedupe. Be explicit that
  source IDs are the stable migration key, while many native Wix target IDs are
  server-assigned. The plan must state whether each entity re-run resolves via a
  client-controlled source-id field on the target or via the durable local
  `sourceId -> targetId` crosswalk. The plan must state the crosswalk authority
  (`local`) and CMS mirror mode (`none`, `download`, `upload`, or `download-and-upload`).
- **URL preservation:** for public routed entities, state that source URL artifacts will
  be captured locally under `state/url-preservation/`. List the public entity types whose
  base paths and slugs will be tracked, any entity whose target route is deferred to the
  website-builder phase, and whether redirects will be recorded as plans. The current
  import phase must say that redirects and site routing are **not applied**.
- **Notification mute (spec 0012).** State that site notifications will be muted before
  migration writes begin when mute is in effect. For a **new site** this is a one-line
  factual disclosure (the mute is unconditional). For an **existing site that opted in**
  (`WIX_MUTE_NOTIFICATIONS=on`) the disclosure is **mandatory and prominent** and must
  state all three points:
  - all site notifications will be muted before migration writes begin;
  - visitor activity during the migration window (e.g. contact-form submissions,
    Back in Stock alerts) will **not** generate notifications;
  - the flow does **not** unmute automatically — after the migration the owner must
    re-enable notifications themselves, or simply ask the agent to unmute at any point.

  The owner accepting the plan is the consent for muting their live site. If the owner
  rejects the mute line, revert to the existing-site default (`off`) and regenerate the
  affected artifacts before seeking acceptance again.

Persist this in `execution/review/import-plan.md` (or a sibling report). This is the defined approval
checkpoint: the job pauses, surfaces the plan to the user, and resumes **only** on
accept. Nothing is written before acceptance.

If `SAFE_MODE=true` or `DRY_RUN=true`, this execution-plan approval gate comes only after
the separate post-codegen code-safety review checkpoint has passed. Do not merge the two
checkpoints into one prompt.

## Out of scope — analytics (future enhancement)

**Do not attempt to import analytics data.** Historical traffic / visitor statistics —
the accumulated analytics records on the source (page views, sessions, visitor counts,
time-series reports) — are **not** part of the migration. Do not generate readers,
transforms, or writers for them. (This is about the *data*, not analytics
configuration/setup such as tracking tags — that is a separate concern and not what this
exclusion covers.)

- **Surface it before execute.** This exclusion must appear in the execution-plan report's
  "What will NOT migrate" list (see the gate above) so the user is told **before** they
  accept and we begin writing — not discovered afterward.
- **Future enhancement.** Analytics migration is a deferred scope item, not a permanent
  limitation. If/when a faithful source→Wix analytics path exists, revisit and lift this
  exclusion. Until then, treat analytics as explicitly skipped.

## Execute the generated scripts — never an agentic MCP flow (required)

The **import** is performed by **running the generated artifact** (`node` the project's
entrypoint under `migrations/<project>/src/`), which writes to Wix via its own transport
(`fetch` + injected credentials to `www.wixapis.com`, or the Wix client SDK). The agent
**must not** perform the import writes itself by issuing per-record Wix MCP calls
(`CallWixSiteAPI`) and hand-translating shapes.

(Scope: this rule is **import-specific**. Setup execution (`rp-execute-setup`) may
currently use the agent+MCP for provisioning writes — an interim decision, with other
options still under discussion.)

Why the import must run the artifact:

- **Reproducibility & idempotency.** Re-runs, resume-from-checkpoint, write ordering, and
  dedup keyed by source ID live in the artifact. For native Wix entities whose target IDs
  are server-assigned, that means the artifact must maintain and consult the local
  `state/crosswalk/crosswalk.ndjson` authority. An agent reconstructing writes ad hoc
  bypasses all of it — a bulk, restartable data pipeline can't be driven by hand per
  record.
- **Verified shapes.** The artifact calls `rp-target-wix`'s verified primitives. An agent
  rebuilding request bodies live re-opens the exact shape-bug class we eliminated
  (Ricos plugin enum case, oversized-HTML tag body, `heroImage.id`).
- **MCP may be absent at runtime.** Interactively-authenticated MCP servers can be missing
  in headless/cron runs, so MCP can't be depended on as the write transport regardless of
  whether the runtime is a pure script-runner or an agent. Either way the writes should
  flow through the tested artifact, not be reconstructed by the model.
- **Validation honesty.** Writing by hand via MCP leaves the artifact's own auth, request
  execution, async-media polling, retry, and checkpoint code unexercised — a green test
  then says nothing about the path real users get. The Wix MCP's role here is
  grounding/verification at codegen time and the one-time live contract test in
  `rp-target-wix`, **not** the import transport.

Consequence for credentials: the artifact needs real Wix write credentials to run. If they
are absent, **halt to needs-user** — do **not** substitute the agent's MCP account auth to
"get the writes done." Missing credentials is a blocker to surface, not a path to route
around.

This skill should execute the machine import artifacts and generated entrypoints. It
should not re-decide write strategy live when `execution/execution-manifest.json`
already defines the ordered task graph and write contract.

## Config files

Before running the generated entrypoint, verify the project-local config files exist and
contain required values:

- `migrations/<project>/config/wix.env`
  - `WIX_SITE_STRATEGY`
  - `WIX_SITE_ID`
  - `WIX_AUTH_TOKEN` or another generated-code-supported Wix auth key
  - `DRY_RUN`
  - `SAFE_MODE`
  - `SAFE_MODE_PHONE_NUMBER` when `SAFE_MODE` is enabled
- `migrations/<project>/config/source.<platform>.env`
  - platform-specific source values, for example WordPress:
    `WP_BASE_URL`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`

The generated script should load these files and then allow process env to override them.
`WIX_SITE_STRATEGY` is always required. `WIX_SITE_ID` is required before execution writes
begin; if the strategy is `new` and the site has not been created yet, halt to needs-user
and return to the site-creation step rather than assuming an existing-site flow. Never
print secret values.

`WIX_AUTH_TOKEN` is the canonical Wix auth key in project-local config. It may have been
used earlier for account-level site creation and may also power site-level writes when
the generated runtime supports that same key. If the generated import path needs a
different Wix credential, name that key explicitly in the generated artifacts.

If execution is blocked because a RePlatform `new site` + `headless` target was never
created, route back to the **Wix CLI headless scaffold** step defined in `replatform` →
"Headless site creation" (`npm create @wix/new@latest headless`). The account-level Projects
API is deprecated for this workflow (it produced non-headless sites).

When the accepted next run is dry-run, missing or blank `WIX_AUTH_TOKEN` and
`WIX_SITE_ID` are not blockers unless a local artifact requires the site ID as a stable
namespace. Report them as `would_block_live`, do not mint a Wix CLI token for dry-run, and
make the execution plan state that a later live run needs separate acceptance and valid
credentials.

If `DRY_RUN=true`, do not override it with `--no-dry-run` for setup probes, setup
provisioning, demo-catalog cleanup, extraction-side verification against Wix, or import
writes unless the user has explicitly approved leaving dry-run for that step or phase.
Prefer to avoid that override when a dry-run artifact or report can be produced instead.
The upstream new-site creation exception does not authorize this skill to make any other
live Wix API call.

Treat `migrations/<project>/config/*.env` as secret-bearing once they may contain real
values. Do not inspect them with whole-file reads that print contents into tool output;
check only existence and required-key status (`present`, `blank`, `missing`).

For CLI-scaffolded headless sites, acquire the site write token from the scaffolded
frontend folder with:

```bash
npx @wix/cli@latest token --site "$WIX_SITE_ID"
```

Persist the returned token as `WIX_AUTH_TOKEN` and send it as a Bearer token. The same Wix
CLI account should create the site and mint this token.

## Workflow

1. Resolve the active project.
2. Review the machine execution artifacts and generated code; present the execution plan
   report and obtain acceptance (see above) before any write.
2b. Prepare deterministic local execution state before any setup/import write:

   ```bash
   node skills/replatform/scripts/execution-state-prepare.js migrations/<project>
   ```

   This validates `execution/execution-manifest.json`, initializes or validates
   `state/crosswalk/crosswalk.ndjson`, rebuilds crosswalk indexes, initializes
   `state/attempts/write-attempts.ndjson`, initializes `state/url-preservation/`
   artifacts when URL preservation is enabled, and blocks CMS mirror download flows unless
   local state is absent and explicit CMS mirror rows have been provided to seed it.
3. Run a safe validation path first when possible, such as dry-run, sample batch, or read-only validation.
   For dry-run, invoke the same generated setup/import entrypoints with `DRY_RUN=true` or
   `--dry-run`. Do not use an agent/MCP hand-built substitute. The shared Wix runtime must
   skip Wix calls at `wix.send`, write `state/attempts/wix-request-captures.ndjson`, and
   keep placeholder target IDs out of `state/crosswalk/crosswalk.ndjson`.
   Do not switch to `--no-dry-run` unless the user explicitly approves leaving dry-run for
   that phase.
   If media import is in scope and source media URLs are local/private (`localhost`,
   `127.0.0.1`, Docker-only hosts, etc.), do not treat a successful dry-run as proof that
   live media import can work. Wix Media import fetches URLs from Wix servers, so the user
   must either expose the source through a public HTTPS tunnel or skip/defer media. This
   is optional and, as far as we know today, only affects media import.
   For Stores products carrying `subscriptionDetails`, the generated dry-run must execute
   the same transform path as live import and call the vendored
   `validateStoresProductSubscriptionDetails` helper before writes. Known contract
   failures such as missing cadence or an invalid required nested field are record-level
   preflight failures/deferred outcomes; they must be counted and reported without sending
   that record to Wix.
   If the run needs live Stores evidence during setup or recovery, use the shared
   verification CLI and persist its JSON artifact:
   `node skills/replatform/resources/rp-target-wix/scripts/verify-stores.js stores product-count --artifact migrations/<project>/execution/stores-product-count-verification.json`
   or `stores product-by-source-marker --marker-path <path> --marker-value <value>`.
   Do not write migration-local verification snippets for Stores product counts,
   source-marker lookups, subscription probes, or probe cleanup.
3b. **Clear the default demo catalog first.** A freshly provisioned Wix Stores catalog (and
   `wix-headless`'s seed) ships ~12 placeholder demo products + demo categories. Delete them
   before importing (keep the system `All Products` category) so the final store holds only
   the migrated data — otherwise a clean 100-product import reads as 112. Applies in both
   delivery modes.
4. **Run source extraction first** using the generated extraction entrypoint (for example
   `node src/extract/run-extract.js`). This step writes durable source files under the
   project and must complete before the write phase unless the extraction artifacts are
   already present and accepted for resume.
5. **Execute the import by running the generated import entrypoint** (for example
   `node src/import/run-import.js`) with credentials injected via config/env. The import
   must read from the extracted files on disk — not by re-reading the source into memory,
   and not by issuing writes through the agent/MCP.
   For targeted recovery, run the generated main import entrypoint with its selective
   resume flags rather than writing a migration-local one-off script:
   - `--entity <entity>`
   - `--source-type <subtype>`
   - `--missing-only`
   - `--failed-only`
   - `--deferred-only`

   `--missing-only`, `--failed-only`, and `--deferred-only` are mutually exclusive. The
   runner must print or persist the selected record set summary before writes begin. For
   native Wix entities, a local crosswalk hit must skip the create idempotently even if the
   record was selected earlier.
   If the execution manifest enables CMS mirror download, fetch CMS rows before this step
   and pass them to the deterministic state-preparation layer; the generated import may use
   only local crosswalk state after preparation succeeds.
6. Capture compact reports, audit-log references, errors, retries, skipped records, and
   checkpoint information from the shared runtime outputs. If a dependency phase has
   systemic failures, stop before downstream writes that depend on it. Example:
   product-category failures must block product writes unless the accepted execution plan
   explicitly says category assignment is best-effort.
   Safe-mode outputs must be summarized by counts and paths only: include skipped
   safe-mode blocked record counts, the project-relative
   `state/safe-mode/blocked-records.ndjson` path when present, and the
   `state/safe-mode/email-replacements.ndjson` row count/path when replacement rows were
   written. Do not print original email addresses or phone numbers from the recovery
   ledger.
7. Save durable execution artifacts, including the authoritative completion artifact and
   deterministic user-facing completion summary.

## Required final report contents

When execution finishes, the deterministic completion outputs must explicitly include:

- the destination site's **dashboard URL**
- the destination site's **editor URL** only when editor work was actually performed or
  the next required step is explicitly in the editor
- the current **preview URL** only when public route/site verification is relevant to the
  completed work
- whether store routes such as product/cart/checkout were verified or still unverified
- URL preservation counts: base paths captured, URL ledger rows written, redirect plans
  recorded, unresolved public URLs, and manual-review URL rows
- safe-mode counts: email fields replaced, phone fields replaced, records skipped with
  `SAFE_MODE_SUSPICIOUS_EMAIL`, and the project-relative safe-mode ledger paths. Do not
  include original email addresses or phone numbers.
- dry-run counts when `dryRun: true`: requests built, Wix calls skipped, would create,
  would update, would delete, would require live lookup, and local validation failures.
  Do not report dry-run rows as created, updated, imported, installed, published, or
  verified in Wix.
- an explicit statement that URL redirects/site routing were not applied in the current
  import phase when `urlPreservation.applyRedirects` is `false`
- a plain-language distinction between:
  - **catalog/data imported successfully**
  - **website/homepage built successfully**
- **notification-mute state (spec 0012) — in every terminal report** (completed, halted
  to needs-user, or aborted; an aborted run is exactly the case where the owner is least
  likely to remember the mute happened). Derive "was muted" **only from recorded state**
  — the `mute-site-notifications` item in `setup/setup-verification.json` and the import
  run's preflight log entries — never from strategy/config inference. When a successful
  mute is recorded, state in plain language that **all site notifications are currently
  muted** and stay muted until re-enabled; that the owner can **simply ask the agent to
  unmute them** (on request the agent calls `unmuteSiteNotifications` and confirms
  `muted: false` via `getSiteMuteState`); and how to re-enable manually. For existing
  sites this line is mandatory and prominent. If no successful mute is recorded, do not
  claim the site is muted — for a run where mute was in effect, that is a blocker that
  should already have stopped the import at the preflight.

Do not report a successful catalog import as if it automatically means a finished
website. If the homepage/root preview is still blank or no site shell has been built,
say that explicitly in the final report.

State the **delivery mode** explicitly (see `replatform` → "Delivery mode"):

- **`management` mode (default):** report that the deliverable is a **Wix-managed headless
  backend** — data migrated and manageable from the dashboard, with **no customer-facing
  website built (by design)**. Do not frame the missing storefront as an incomplete result.
  You may note that a storefront can be generated on request (website mode, via
  `wix-headless`), but do not build one unless the user asks.
- **`website` mode:** report the **storefront URL** produced by `wix-headless` and confirm
  the released site serves the migrated catalog (not demo data).

## Completion artifact authority

At the end of the run, artifact authority should be explicit:

1. `execution-log.md` is authoritative for chronology and operator/debug context only
2. `execution/completion-report.json` is authoritative for final outcome
3. `execution/review/completion-summary.md` is the deterministic user-facing rendering of
   `execution/completion-report.json`

This skill should not treat `execution-log.md` as the canonical source for final
imported/skipped/failed counts when `completion-report.json` exists.

## Localhost media before live import

When source media URLs are local/private, ask the user to choose one path before live
media writes:

- Expose the source with a public HTTPS tunnel such as ngrok:

  ```bash
  brew install ngrok
  ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
  ngrok http 8090
  export WP_BASE_URL=https://<id>.ngrok-free.app
  ```

- Or skip/defer media import and record the effect on hero images, galleries, downloadable
  files, and other media-dependent references.

Non-media entities may continue if the execution plan clearly excludes or defers media.

## Artifact to create or update

- `migrations/<project>/execution-log.md`
- `migrations/<project>/execution/live-import-summary.json`
- `migrations/<project>/execution/completion-report.json`
- `migrations/<project>/execution/review/completion-summary.md`
- `migrations/<project>/execution/recovery-log.json` for every resumed, partial,
  missing-only, failed-only, or deferred-only run
- audit/report artifacts emitted by the shared import runtime

## Recovery artifact contract

Targeted recovery is a first-class import mode, not a side script. Every selective,
resumed, partial, missing-only, failed-only, or deferred-only run must append one entry to
`execution/recovery-log.json` and update `execution/live-import-summary.json` through the
same shared summary writer used by the main import path.

Each recovery entry must include:

- recovery id
- timestamp
- selection filters
- reason
- records selected
- records attempted
- imported
- already present
- failed
- deferred
- crosswalk changes
- summary changes
- operator-visible outcome
- links to detailed logs

Do not overwrite earlier recovery entries. Failed or deferred records from an earlier
attempt must remain visible after a later successful recovery; the newer recovery entry and
summary delta explain what changed.

## Completion report contract

This skill should expect the shared import runtime to emit a machine-readable completion
artifact and should preserve it as the primary post-run result.

`execution/completion-report.json` should be the authoritative source for:

- final run status:
  `complete | complete_with_warnings | complete_with_recovered_records |
  complete_with_deferred_records | incomplete_with_failures |
  incomplete_with_mismatches | aborted`
- final completeness counts by entity and subtype: extracted, in-scope, attempted,
  imported, already present by crosswalk, deferred, failed, skipped out of scope, and
  unexpected skipped
- grouped skipped/deferred outcomes
- grouped failure outcomes
- mismatch rows where source, import, and crosswalk counts do not reconcile
- URL preservation summary counts and artifact paths when URL preservation is enabled
- dashboard/editor/preview destinations
- artifact references for logs and diagnostics

`execution/live-import-summary.json` should carry the same `entityCompleteness` accounting
contract during/after the live import so short imports are visible before any manual count
comparison. For every mapped entity/subtype row, the runtime must reconcile:

```text
imported + alreadyPresentByCrosswalk + deferred + failed == inScope
```

Any non-zero deferred, failed, or unexpected skipped count for an in-scope mapped entity
class must appear in the completion headline. Any mismatch must set the final status to
`incomplete_with_mismatches` unless the run was already `aborted`.

When more than one status applies, choose the highest-severity status in this order:

1. `aborted`
2. `incomplete_with_mismatches`
3. `incomplete_with_failures`
4. `complete_with_deferred_records`
5. `complete_with_recovered_records`
6. `complete_with_warnings`
7. `complete`

The user-facing completion summary should be rendered deterministically from that artifact.
The completion report should be produced from the runtime's in-memory counters for the
current `runId`, with audit-log aggregation used only as a verification/fallback path.
When audit events are read, filter by `runId`; never infer final counts by counting every
line in an append-only `import-audit.ndjson` that may include dry-runs, retries, and
previous recovery passes.

## Minimum execution log contents

- run timestamp
- command or entrypoint used
- extracted source location / manifest used
- entities processed
- records read, transformed, written, skipped, failed
- retry behavior
- blocking errors
- follow-up remediation
- member activation status, when members are in scope (activation automation created and
  enabled post-window? label waves applied — which label, how many contacts per wave?) —
  see rp-target-wix members guidance; never mass-send set-password emails
- dashboard URL
- editor URL when relevant
- preview URL when relevant
- post-import route verification status (for example product/cart/checkout reachable or
  not yet installed)
- URL preservation artifact paths and counts, including redirect plans and unresolved
  public URLs
- explicit state classification: `catalog imported`, `site shell built`, or both
- references to machine-readable report and audit artifacts

The execution log may mention outcome summaries, but it is not the authoritative source
for final imported/skipped/failed counts.

## Guardrails

- **Import writes go through the executed artifact, not the agent.** Never perform import
  writes via `CallWixSiteAPI`/MCP as a substitute for running the script. MCP is
  verification-only here (see the section above). (Setup execution is out of scope for this
  rule — see `rp-execute-setup`.)
- Prefer `execution/execution-manifest.json` over markdown when
  deciding what to run.
- Prefer `execution/completion-report.json` over `execution-log.md` when reporting final
  outcome to the user.
- Prefer `execution/recovery-log.json` over migration-local recovery scripts when
  explaining targeted recovery outcomes.
- Prefer dry-runs or sample batches before full import.
- Stop on systemic mapping or write failures rather than amplifying bad writes.
- Preserve enough logging to support replay and debugging.

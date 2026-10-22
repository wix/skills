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
  below). In explicit user-requested `1-click mode` (`automationMode=one_click`,
  `source=user`), the same report is still required, but it is recorded as accepted by the
  agent once all blockers/gaps are surfaced and no unresolved hard stop remains.

Prefer the machine-readable execution artifacts above. `execution/review/import-plan.md`
is a human-facing review artifact, not the primary execution contract.

Before live import and again before final reporting, validate
`execution/review/import-plan.freshness.json` with the deterministic freshness helper:

```bash
node skills/wix-replatform/scripts/artifact-freshness.js check migrations/<project> \
  --domains-dir skills/wix-replatform/resources/rp-target-wix/domains \
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
  `sourceId -> targetId` crosswalk. Local `state/crosswalk/crosswalk.ndjson` is the sole
  runtime authority for resume/idempotency — never CMS. The plan must state the crosswalk
  authority (`local`) and the mapper-selected CMS mirror mode (`none`, `download`, `upload`,
  or `download-and-upload`); CMS `ImportCrosswalk` is OPTIONAL by design, not a default,
  because Wix CMS quotas are plan-based and shared across every custom collection on the
  site — a large migration's full crosswalk can be many times a lower-tier plan's total item
  quota, so treating the mirror as mandatory risks spending site data capacity the migration
  has no business claiming by default. Only enable a mirror mode when the user opted into
  site-local reference data (see `rp-execute-setup` → "Import crosswalk CMS mirror").
  When a mirror mode other than `none` IS selected: provisioning the collection is not the
  same thing as keeping it in sync — a run can provision the
  collection at setup time and then never write to it again during import, leaving every
  entity's crosswalk invisible on the site itself until a one-time backfill catches it up.
  `rp-target-wix/lib/wix-writers.js`'s `syncImportCrosswalk` (batches of up to 1000 through
  `bulkSaveDataItems`, item id the row's own `sourceStableKey`, matching the approved
  download-side dedupe contract exactly — see the KNOWN, UNRESOLVED LIMITATION comment on
  `buildImportCrosswalkItem`: sourceStableKey is only unique within one migration, so two different projects against the same source system that happen to import the
  same entityType+sourceId still collide, and closing that gap needs its own approved
  identity/schema decision, not an ad hoc id prefix) is the primitive that keeps it current, and
  `rp-import-codegen` wires it in: a generated run with a mirror mode of `upload` or
  `download-and-upload` performs **exactly one snapshot pass, after the last entity write**,
  projecting the finished local crosswalk through `local-state.js`'s
  `crosswalkRowsToMirrorItemInputs` and uploading it with `syncImportCrosswalk`. The pass is
  never inline per entity and never a per-batch checkpoint: a mirror write riding alongside
  each record multiplies the calls the site absorbs during the run and makes a slow collection
  a drag on the import it only describes. With `none` or `download` the generated run touches
  the collection zero times — no reads, no writes, no empty pass reported as success — because
  site storage is a shared plan-based allowance and a large ledger can be a meaningful
  fraction of a smaller plan's whole quota.
  Never make native-entity import correctness
  depend on the mirror succeeding: a non-zero `totalFailures`, or a thrown transport error,
  marks the mirror step failed and is reported as a shortfall in the execution artifacts, while
  every imported record stays imported and the run itself is not failed.
- **Destination and collisions — required whenever `WIX_SITE_STRATEGY=existing`.** Name
  the destination site, and say plainly that it is a site the user already owns and that
  this import will change it. Then quantify the overlap: for each entity type, how many
  source records match something already on the site (by crosswalk, then by the mapping's
  natural key), and what will happen to each — **skipped** or **augmented**, never replaced
  and never deleted. A user accepting "Migrate" on their live store is accepting these
  specific writes; a plan that reports only "120 products" is asking them to consent to
  something they cannot see. If the overlap cannot be computed before writing, say that
  too, and say what the import will do when it meets one.
- **URL preservation:** for public routed entities, state that source URL artifacts will
  be captured locally under `state/url-preservation/`. List the public entity types whose
  base paths and slugs will be tracked, any entity whose target route is deferred to the
  website-builder phase, and whether redirects will be recorded as plans. The current
  import phase must say that redirects and site routing are **not applied**.
  Backend import stays plan-only: it records source URLs and source-authored redirect
  definitions (`node skills/wix-replatform/scripts/url-redirects.js sources`), then runs the
  offline `url-redirects.js report` and passes its projection
  (`execution/url-preservation-report.json`, status `pending_website_build` until final routes
  exist) as `completion-report.json.urlPreservation`. It never runs `apply` or `verify`, never
  probes the public website and never changes DNS; those are post-build helper operations the
  cutover step schedules.
- **Notification mute.** State that site notifications will be muted before
  import when required by the resolved site strategy/config, and how the owner can later
  ask for an unmute. State that site notifications will be muted before migration writes
  begin when mute is in effect. For a **new site** this is a one-line
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

In explicit user-requested `1-click mode`, do not skip this report. Generate it, make sure it
reflects the real setup changes / data writes / blockers, record it as accepted by the agent,
and continue without waiting for a human response. A missing mode or a non-user-authored
`one_click` value must follow the normal user-approval path.

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
    `WP_BASE_URL`; `WP_USERNAME` and `WP_APPLICATION_PASSWORD` for authenticated REST
    reads; and `WMH2_MIGRATION_KEY` when the generated bridge reader selected signed auth

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
created, route back to `resources/rp-destination/`, which scaffolds via
`npm create @wix/new@latest headless`. The account-level Projects API is deprecated for
this workflow (it produced non-headless sites).

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
2b. **Precondition, not a step you can skip by not reading this line.** The import path checks
   that execution state was prepared and refuses to write without it. Prepare deterministic
   local execution state before any setup/import write:

   ```bash
   node skills/wix-replatform/scripts/execution-state-prepare.js migrations/<project>
   ```

   This validates `execution/execution-manifest.json`, initializes or validates
   `state/crosswalk/crosswalk.ndjson`, rebuilds crosswalk indexes, initializes
   `state/attempts/write-attempts.ndjson`, initializes `state/url-preservation/`
   artifacts when URL preservation is enabled, and blocks CMS mirror download flows unless
   local state is absent and explicit CMS mirror rows have been provided to seed it.
2d. Verify the generated import entrypoints satisfy the entry contract, before any entity
   write:

   ```bash
   node skills/wix-replatform/scripts/import-contract-verify.js migrations/<project>
   ```

   For a filtered run, pass its identical selection after `--` (for example
   `-- --entity <entity> --failed-only`). For selected bridge-backed entities/dependants,
   the verifier first checks actual generated wiring and helper versions against the
   committed emitter, before running any generated entrypoint. An unrelated native-only
   selection does not check another plugin's artifact readiness. Source preparation/full
   manifests are checked by the shared runtime at selected dispatch; missing preparation
   holds only affected scopes with existing Import Operator tasks. Follow
   `rp-source-wordpress/PLUGIN-READ-PLANS.md`; do not bypass those wrappers.

   This then spawns each generated import entrypoint with `--describe`, parses the single JSON
   object it prints, and checks it against the generated-importer contract. It writes no state
   and touches no target. A non-zero exit **aborts the import** and routes back to codegen —
   no degraded mode, no skip flag — naming every missing selection mode and every misplaced
   ledger path at once.

   The selective modes (`--entity`, `--source-type`, `--missing-only`, `--failed-only`,
   `--deferred-only`, `--unresolved-only`) are a **requirement on the generated importer**, not
   an operator option: an importer that cannot offer targeted recovery is one whose only
   recovery is an unfiltered full re-pass, which is how a journal ends up with several rows per
   record. The importer also checks itself, as the first statement of its `main()`; this step
   is what catches an importer that never emitted that check at all.

2c. Resolve every request under `state/blocked-data-requests/` with the shared
   `lib/blocked-data-requests.js` helper before normal extraction. Reuse a current immutable
   snapshot within `fulfillment.freshnessWindowHours` without probing the source. After the
   window, attempt exactly one refresh: write the next version on success; on failure keep the
   prior snapshot and mark it `stale: true`. With no snapshot, `csv-upload` checks and parses
   `expectedInputPath`, while `bridge-plugin` probes the live `/wp-json` namespace list and then
   calls `extractionRoute`; never check a local path for a bridge request. Reconciled data is
   merged into that capability's extraction input. Present-but-invalid or partial data is
   discarded and marked `invalid`; missing data uses the target entity's existing default.
   Never create `declined` unless a human explicitly declined during an interactive review.
   Stamp every write attempt using real blocked data with the snapshot version, extraction
   timestamp, and checksum it actually consumed.
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
   `node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores product-count --artifact migrations/<project>/execution/stores-product-count-verification.json`
   or `stores product-by-source-marker --marker-path <path> --marker-value <value>`.
   Do not write migration-local verification snippets for Stores product counts,
   source-marker lookups, subscription probes, or probe cleanup.
3b. **Clear the default demo catalog first — only when all three conditions hold.** A
   freshly provisioned Wix Stores catalog (and `wix-headless`'s seed) ships ~12 placeholder
   demo products + demo categories. Wiping them before importing is correct ONLY on a site
   you created on this turn from a live source — never as a general cleanup step. All three
   must hold; check them before deleting anything:

   1. `WIX_SITE_STRATEGY=new`, **and**
   2. the source is a **live site**, not supplied files (`sourceMode=files_only`), **and**
   3. **you created the destination site on this turn.**

   Each one guards against a different way of destroying data that is not template seed:

   - **Existing site ⇒ never.** The catalog belongs to the owner; a bulk delete here is
     data loss this pipeline cannot undo.
   - **File-provided run ⇒ never, whatever the strategy.** File drops are recurring by
     design — they can accumulate onto one site over multiple runs, so wiping on drop 2..N
     would delete what an earlier drop imported, and the wipe cannot tell template seed
     from migrated data.
   - **A later turn ⇒ never.** This is the condition most likely to be missed: on turn two
     of a new-site run, `WIX_SITE_STRATEGY` still reads `new` and the source is still a
     live site, so only "did I create the destination on this turn" separates clearing the
     template's placeholders from deleting the previous turn's import.

   When in doubt, skip it — leaving a few template products behind is a cosmetic defect the
   owner can fix later; deleting their catalog is not recoverable. When all three hold,
   delete the default demo products and categories (keep the system `All Products`
   category) so the final store holds only the migrated data — otherwise a clean
   100-product import reads as 112. Applies in both delivery modes.
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
5b. **App routes and internal links.** After relevant apps are
   installed, inspect/configure only the schema-backed per-family routes supported by
   `rp-target-wix` capability knowledge; store saved-state read-back under
   `state/url-preservation/app-page-routes.json`. After backend import, run the generated
   `internal-link-audit.js plan` input over the complete captured inventory. It performs
   local counting with no destination request or model call and writes
   `state/url-preservation/link-audit.json`. A backend-only run leaves destinations pending
   and unresolved occurrences without invented paths. Do not call the post-frontend
   `verify` entrypoint until the frontend exists. That step first makes at most 20 read-only
   calibration checks inside a two-minute sub-cap, records the estimate against the
   approved 30-minute live-work and 100,000 exception-review-token ceilings, then checks
   samples and destinations and invokes only compatible non-blog writers. Unknown or
   incompatible writer ownership blocks affected writes before mutation, while disjoint
   safe fields may proceed. Blog-post link writes remain pending until a dedicated writer
   can consume verified destinations through its checkpointed post-frontend lifecycle.
   Supply planned destination content revisions with containing record identities. The
   shared verifier applies structured patches once per logical record and field through
   its durable write journal; adapter callbacks supply revisioned read/write and rendered
   checks, not direct per-link repair. A budget hold survives re-planning and resumes only
   after the plan records the owner's decision reference and approved ceilings.
   Refresh the audit, completion report and website handoff after the post-frontend step
   and after affected source catch-up. Keep incomplete writer integration and unverified
   link coverage pending in those artifacts.
6. Use `lib/dependency-readiness.js` immediately before each dependent batch, including
   selective recovery. The generated importer binds its task, evaluates current readiness,
   and calls `gateBatch`; only its `send` payloads may reach a task-capability Wix client,
   carrying `sourceStableKey` and the current `readinessGrant`. A task-level unknown or
   unapproved exclusion stops before its first batch. A permitted partial per-record
   dependency defers only records whose required references are unresolved. Setup is
   all-or-nothing: every bound step must pass on the current destination before any
   setup-derived reference can resolve. An empty dependency passes only with a current
   complete zero-row extract and full task-pass evidence. Never infer readiness from task
   order, a success count, a crosswalk row alone, dry-run state, or prose best-effort consent.
   Capture compact reports, audit-log references, errors, retries, skipped records, and
   checkpoint information from the shared runtime outputs.
   Safe-mode outputs must be summarized by counts and paths only: include skipped
   safe-mode blocked record counts, the project-relative
   `state/safe-mode/blocked-records.ndjson` path when present, and the
   `state/safe-mode/email-replacements.ndjson` row count/path when replacement rows were
   written. Do not print original email addresses or phone numbers from the recovery
   ledger.
6b. **Reconcile bearer-voucher drift against a fresh source read — required, before cutover.**
   Run this after every write pass has finished and before anything declares the run
   complete. It is required whenever the accepted scope included coupons **and** the source
   carried at least one coupon with a usage limit. When neither holds, record
   `voucherReconciliation: "not-applicable"` in the completion report and do nothing else — a
   source with no usage-limited coupons still answers out loud, because silence and success look
   identical in a report.

   **Deadline: before cutover, while the source is still the system of record.** Two reasons,
   and together they are why running it late is the same as never running it:

   1. the step compares a **fresh read of the source** against the target, and once the source
      stops being the system of record that fresh source read stops existing; and
   2. the **target exposes no redemption count** for a coupon on any surface, so the question
      cannot be answered from the target alone afterwards.

   Miss the deadline and which codes were already spent becomes permanently unknowable, on an
   instrument made of money.

   **Use the shipped module, `rp-target-wix/lib/coupon-redemption-drift.js`.** A
   migration-local reimplementation of the classification, the plan, the request builder or the
   verification is forbidden: each one carries a trap that stays invisible until it costs money.

   1. Re-read the source coupon rows **now** — never the discovery snapshot, which is precisely
      what went stale — and read each imported coupon back from the target.
   2. Per import receipt: `classifyPostImportDrift({ receipt, freshCoupon, targetCoupon })`. It
      returns exactly five post-import outcomes: `voucher-drift-reconciled`,
      `voucher-drift-remedy-pending`, `voucher-source-row-missing`, `voucher-target-row-missing`
      and `voucher-target-state-unreadable`. An unsupported face-value precision is the boolean
      `verdict.facePrecisionUnsupported` riding alongside whichever of those five applies —
      wire on that flag; it is never `verdict.outcome`, so a branch for it in a
      `switch (verdict.outcome)` is a branch nothing can ever reach.
   3. `buildVoucherDriftPlan({ verdicts, ordersByCouponCode, currency })` turns the verdicts into
      the owner-approval plan: `counts`, one `rows` entry per code carrying its face value, the
      orders that reference it and the proposed remedy, and `liability` — the money still live.
      The plan is `readOnly: true` and has no apply path, by construction. Run twice on the same
      inputs it produces the same plan.
   4. **The owner rules per code, including in one-click mode.** One-click is a promise about how
      little the operator has to decide, never a licence to decide on the merchant's behalf about
      their money: deactivating a code a customer legitimately holds destroys value too, and the
      merchant might already have honoured a voucher off-system. Nothing in this step writes
      without an explicit per-code decision.
   5. Build an approved remedy **only** with `buildRemedyRequest({ couponId, remedy, setTags })`.
      It emits the one request shape that actually writes — a specification carrying only the
      changed fields plus the matching field mask. **Never build the body from the coupon you
      just read:** the full specification alongside a narrow field mask is accepted with `200`,
      an empty body, and no write at all. Record the response status; do not interpret it.
   6. Wait a settle, read the coupon back, and let
      `verifyRemedyApplied({ remedy, responseStatus, readBackAfterSettle, settleMs })` decide. A
      2xx is not evidence. No read-back, a read-back that still shows the coupon live, and a
      read-back with no readable `active` flag are each `remedy-unverified` — reported unknown,
      never applied. For a deactivation, a coupon that does not read back at all is unknown too,
      never success.

   ⚠️ **This is not the coupon pass and must not be folded into it.** The coupon pass writes
   coupons; this step re-reads the source *afterwards*, which is the entire point. Run inside the
   import, it returns the answer the import already had.

   ⚠️ **It is not the rerun pass either** (see "Rerunning an import for new and modified
   records"). A rerun covers new and changed records; a voucher spent since the write is neither
   — nothing the rerun compares changed. They are separate obligations at an agreed cutover.

   ⚠️ **Expect to run this step more than once.** It is idempotent and safe at the end of every
   execution, but its deadline is cutover, so re-invoke it close to actual cutover. The
   completion record from the **last invocation before cutover** is the authoritative answer; an
   earlier `not-run` or `plan-pending-owner` is a warning that the obligation is still open, not
   a verdict that it was skipped.

   Record the result in `execution/completion-report.json` as `voucherReconciliation`, one of
   `not-applicable | reconciled | plan-pending-owner | remedied | not-run` (see "Completion
   report contract").

7. Save durable execution artifacts, including the authoritative completion artifact and
   deterministic user-facing completion summary.

## Contacts/Members disposition (safe-mode vs. real, live at the destination)

LIVE-VERIFIED: when `SAFE_MODE=true` covers `crm/contact`, every created Contact carries a
mock `replatform+contact_<id>@wix.com` email (see `mockEmailForEntity` in
`rp-target-wix/lib/wix-writers.js`). What that means for login identity depends on whether
`members/member` is itself a generated import target for this run, per `rp-import-codegen`'s
member pass:

- **`members/member` NOT in the generated scope:** the contact-import pass alone builds no
  Wix Members (`memberCrosswalk` is stubbed to always return `null` so order/blog author
  resolution has something safe to call), so no customer gets a real, usable login identity
  from this run at all — safe-mode or not. Promoting a contact to real-email-plus-Member is
  then a distinct, separate, later write (see `rp-target-wix/lib/wix-writers.js`'s
  `ensureMember` composite: read the contact's current revision, update its email/phone from
  the real source values only when the current email still matches the safe-mode mock
  pattern, then call `ensureMember` with the same real loginEmail so the created Member lands
  on that same contact rather than a duplicate).
- **`members/member` IS in the generated scope:** the generated member pass runs `ensureMember`
  directly against each registered customer's REAL email in its own loop before order history,
  regardless of the `crm/contact` SAFE_MODE setting — that pass does not read or wait on the
  safe-mode mock email at all, it goes straight to `ensureMember({loginEmail: customer.email, ...})`.
  In this case customers DO get a real Member from the entity-import pass itself; a contact
  left on a safe-mode mock email from a separate `crm/contact` pass is not the same customer
  state as "no Member exists" and must not be reported as if it were.

Do not state either version as the migration's blanket behavior without checking which one
this run's actual generated scope produces.

Two requirements follow, both non-negotiable when `crm/contact` is in scope:

1. **Ask before the contact import runs, in plain language — but only offer a choice the
   generated scope can actually honor, not by assuming a SAFE_MODE default:**
   - If `members/member` is NOT a generated target for this run: this pass never creates a
     Member either way (see above), so do not offer "create a Wix Member directly" as an
     option — that path does not exist without a member pass. Ask instead: "Import contacts
     with their real email now, or with temporary safe-mode emails for review first? Either
     way, no customer gets a Member or a login identity from this run alone — that is always
     a distinct, later step (add `members/member` to the scope, or run the separate
     promotion write afterward)." Record the answer in the execution plan/consent artifact
     next to the SAFE_MODE decision; do not let an unset `SAFE_MODE` env var (which defaults
     to `true`) decide this silently.
   - If `members/member` IS a generated target: do **not** offer the safe-mode-contacts
     choice at all. The member pass creates each registered customer's Member
     directly against their REAL email regardless of `crm/contact`'s own SAFE_MODE setting,
     and reconciles by that real loginEmail — a contact the SAFE_MODE pass created earlier
     under the mock email will not match it, so the member pass creates a SECOND, separate
     contact on the real email instead of landing on the existing one. This is a real
     duplicate-contact gap, not a hypothetical: the ordering rule needed to prevent it (never
     pre-create a safe-mode contact for someone who will become a member) is tracked as an
     open, unresolved decision, not something already implemented. Until that ordering is
     implemented, `crm/contact` must run in real-email mode whenever `members/member` is
     also in scope, and the plan must say so plainly rather than presenting a safe-mode
     choice it cannot deliver.
2. **Every completion/status summary that touches contacts must report the disposition
   explicitly and by count**, whichever path was chosen: how many contacts still carry a
   safe-mode temp email with no Member (and therefore need a follow-up promotion run before
   they have a real email on file or can log in), vs. how many were promoted to a real email
   + Member. A status report that only says "N contacts imported" without this breakdown is
   incomplete — the operator cannot tell from that alone whether any customer can currently be
   reached or log in.

## Email marketing consent

When the source records a real per-record consent signal for marketing email (e.g. a
WooCommerce order's checkout consent-checkbox meta, not mere presence as a customer), do not
write it to Wix Email Subscriptions yet. `crm/email-subscription`'s `bulkUpsertEmailSubscriptions`
writer (`rp-target-wix/lib/wix-writers.js`) is mechanically live-verified — keyed by email
address, covers guest-checkout consent with no Contact behind it, sets a status only with no
confirmation/marketing email triggered — but the entity's `preferredWrite.importSafe` stays
`false` because two product decisions are still unresolved: how several orders for one email
fold to a single subscription state (`order-scoped-consent-has-no-decided-fold-rule`), and
whether Email Subscriptions or the separate Marketing Consent API is the authoritative write
target (`email-subscriptions-vs-marketing-consent-api-unresolved`). Surface the gap and these
two open questions to the user rather than deciding either one inside an import run; only
proceed once both are resolved and `importSafe` reflects that.

## Rerunning an import for new and modified records

The source keeps trading after an import finishes: newer records arrive, earlier
records change, earlier failures are still missing. A rerun reuses the same project,
destination, mapping, generated importer and crosswalk — it is not a fresh migration, and any
mapping or scope change goes back through the existing gates.

Catch-up may extend the end of the range to the new capture time. It does **not** pull older
history the accepted scope excluded, and it does **not** propagate deletions.

⚠️ A rerun does **not** cover bearer-voucher drift, and must never be reported as having done
so. A voucher spent at source since the import is neither a new record nor a changed one in
anything `selectRerunRecords` compares. That obligation is workflow step 6b, it is separate,
and it is deadlined at cutover.

**Selection.** Refresh the agreed scope and bucket it against the crosswalk with
`lib/import-recovery.js`'s `selectRerunRecords` — create missing, skip unchanged, update
changed, and report `unknown` where there is no usable comparison evidence. The pre-existing
`--missing-only` and `--failed-only` filters are **not** a delta between them: missing-only
excludes every crosswalk hit, so a changed record is never seen, and failed-only only revisits
what was already attempted. Read refreshed files covering the whole agreed scope; a
modified-since optimization is allowed only when it still includes boundary records, older
retries and unresolved decisions.

**The version pair.** Every confirmed write records the source's version (`sourceVersionField`
+ `sourceVersion`, or a declared `sourceHash` fallback) and the Wix `targetRevision` returned by
that write, via `nextCrosswalkBaseline`. A confirmed write that returns **no** revision does not
advance the pair at all — **including a first create**. Half a pair is not a baseline: a source
version saying "applied" with no revision leaves the next update with no concurrency guard, and
on a re-write it would pair a new source version with a pre-write revision and self-conflict.
Both reconcile instead. A linked record with no saved revision is likewise reported `unknown`
rather than updated, which also covers legacy rows written before the pair existed. Treat both as opaque; never increment a revision
locally. A failed, conflicted, dry-run or skipped write **must not** advance the pair — that is
what keeps the record eligible for recovery instead of recorded as applied. Missing metadata on
an old row is `unknown`, never "unchanged".

**Conflicts are a user decision, including in one-click mode.** When Wix rejects an update
because its revision moved, stop updating that record and show the user the error, the record,
and the source changes proposed for it — `lib/rerun-conflicts.js` builds that review and
classifies the error. Ask once per record, not per field. **Never silently fetch a newer
revision and retry**; there is deliberately no such helper. Unrelated records continue; work
depending on the unresolved update stays blocked.

⚠️ **The conflict-code list is incomplete by design.** Only `INVALID_REVISION` has been
observed live (on a delivery profile). Products v3 and Contacts v5 conflict codes
are **not** known, so they are absent rather than guessed. Two things keep that safe: the
accepted mapping can declare an entity's real codes (`entityConflictCodes`), and an
unrecognized 409 on a revision-carrying update classifies as `possible_revision_conflict` —
which goes to a human, never to an auto-retry and never silently into an ordinary failure. When
a real conflict code is observed, record it in the entity's declared codes and in
`OBSERVED_REVISION_CONFLICT_CODES` with its evidence.

On **override**, read the latest Wix record, show which values would be replaced, and write
against the revision the user actually reviewed. A further conflict is another decision. On
**keep**, leave Wix alone and record the choice against that exact source version and reviewed
revision in the recovery log — never as a crosswalk baseline, because the source version was
never applied — persist it through the recovery entry's `conflictDecisions[]` and read it back
with `latestConflictDecisionFor`, so a later rerun does not re-ask a question the user already
answered or silently overwrite what they chose to keep. `loadRecoveryLog` returns an **array**;
pass it straight in. Do not report a kept change as imported,
and do not retry it silently later.

**Dependencies and safety.** Resolve contacts, products and other dependencies before their
dependants. A record with an uncertain prior attempt (`deferred`, `needs_verification`,
`succeeded_unverified`, `started`) is reconciled before it is written — `selectRerunRecords`
routes it to `needsReconciliation` whether it is linked or not. Unlinked, an unconfirmed earlier
write may already exist and creating again would duplicate it. **Linked, the danger is subtler:**
if the previous write landed and the process died before saving its baseline, the saved revision
is already stale, so re-sending it makes the importer collide with its own write and report that
to the user as a merchant edit.

Updates touch only the fields the accepted mapping covers and preserve unrelated Wix values.
Each entity needs a verified update operation **and** conflict protection; without both,
`updateSupportFor` returns `report_for_review` and the record is reported rather than pushed
through a create/import operation. This is **enforced in code**, not only documented: the
accepted mapping declares `{ writerId, revisionParam }` per entity, and an entity missing
either is refused. It **fails closed** — a rerun that does not declare `targetEntityRef` at all
gets `report_for_review` for every changed record, because an absent declaration is not evidence
that an update is safe. The order family (`ecom/order` and its child entities) is denied outright
with `neverFallBackToCreate` — Update Order exposes a restricted field set and no general
revision parameter, and a same-id Import Order is an unguarded whole-body replacement that
clears omitted fields.

**Scope and deletions.** Pass the accepted scope as `inScope`; excluded records are reported
`outOfScope` and never actioned. Deletions need no rule beyond the refreshed set: a record
absent from the source is never iterated, so absence can never become a delete instruction.

**Reporting.** Before writes, show the selected scope with counts of new, changed, unchanged
and unresolved. Afterwards report created, updated, unchanged, kept-in-Wix-by-user-choice,
conflicted, failed, blocked and out-of-scope, with errors and affected records. Unknown counts
are not zero. Name the source capture time: a trading source may need another rerun or an
agreed cutover.

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
- blocked-data request outcomes from `completion-report.json`, including every dependent
  entity/field outcome, the worst-severity aggregate, whether a used snapshot is stale, and the
  exact snapshot version/extraction timestamp/checksum. A 1-click `missing` request must say the
  run did not pause to ask; an invalid input that fell back successfully is a warning, not a
  write failure.
- an explicit statement that URL redirects/site routing were not applied in the current
  import phase when `urlPreservation.applyRedirects` is `false`, the old-link status from
  `completion-report.json.urlPreservation`, and that old emails and bookmarks may fail until
  redirects are applied and verified on the public domain
- a plain-language distinction between:
  - **catalog/data imported successfully**
  - **website/homepage built successfully**
- **the voucher-reconciliation answer — in every terminal report of a run whose accepted
  scope included coupons** (workflow step 6b). State in plain language which of
  `not-applicable`, `reconciled`, `plan-pending-owner`, `remedied` or `not-run` the run
  recorded, and say what it means: `plan-pending-owner` means money is still redeemable a
  second time on the merchant's live store and the owner has decisions outstanding per code;
  `not-run` means the step was due and did not happen, and that the answer expires at cutover
  because the fresh source read stops existing and the target exposes no redemption count.
  Never infer this from the coupon write counts — report the recorded field, and report a
  missing field as `not-run`.
- **notification-mute state — in every terminal report** (completed, halted
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

State the **delivery mode** explicitly (see `wix-replatform` → "Delivery mode"):

- **`management` mode (default):** report that the deliverable is a **Wix-managed headless
  backend** — data migrated and manageable from the dashboard, with **no customer-facing
  website built (by design)**. Do not frame the missing storefront as an incomplete result.
  You may note that a storefront can be generated on request (website mode, via
  `wix-headless`), but do not build one unless the user asks.
- **`website` mode:** report the **storefront URL** produced by `wix-headless` and confirm
  the released site serves the migrated catalog (not demo data).

## Inventory completion and resume

Run the generated inventory reconciliation for new AND previously crosswalked products.
Require the current inventory setup/canary receipt before stock writes, retaining the run's
notification guard. After each batch persist stock outcomes separately from product success.
If stock failed, resume only stock using existing product/variant IDs; never recreate a
product or increment a quantity to recover it.

Include `state/inventory-report.json` in the completion inputs: intended variant denominator,
reconciled/created/updated, failed/unverified, and source decision-needed counts. Unknown stock
and missing variants remain visible. Any unresolved inventory makes catalog completion partial;
a product count or HTTP 200 cannot clear it. Compare source versus verified target availability
per variant and summarize out-of-stock counts. A source with available variants cannot pass
with an entirely unavailable target. Dry-run inventory outcomes are simulated, never live proof.

## Completion artifact authority

At the end of the run, artifact authority should be explicit:

1. `execution-log.md` is authoritative for chronology and operator/debug context only
2. `execution/completion-report.json` is authoritative for final outcome
3. `execution/review/completion-summary.md` is the deterministic user-facing rendering of
   `execution/completion-report.json`

This skill should not treat `execution-log.md` as the canonical source for final
imported/skipped/failed counts when `completion-report.json` exists.

That ordering is unchanged. What changed is that all four artifacts now actually get written,
by shipped code, rather than being required by this document and produced by nothing:

- `execution-log.md` — `appendExecutionLog(projectDir, entry)` in `lib/execution-log.js`.
  Append-only: a resumed or recovery pass adds entries and never truncates or regenerates the
  file, and every entry carries its own `runId` so a later pass's entries are distinguishable
  from the first pass's without reading timestamps. Append one entry per lifecycle event: each
  import step started and finished, every batch flush, every recovery pass, the completion
  write, and the handoff generation.
- `execution/completion-report.json` and `execution/review/completion-summary.md` —
  `writeCompletionReport(projectDir, report)` in `lib/completion-report.js`. The summary is
  **rendered from the report object**, never composed independently and never derived from
  `execution-log.md`. The writer itself joins source coverage (below); pass it the report from
  `createCompletionReport` unchanged and never add `sourceCoverage` yourself — it refuses that.
- `execution/live-import-summary.json` — `writeLiveImportSummary` in `lib/import-recovery.js`,
  called after **every batch**, not once at the end. See "Per-batch accounting" below.

For order history, use the generated accounting block from `rp-import-codegen`: collect the
final per-order stage outcomes with `collectOrderStageResiduals` and pass its rows to
`createCompletionReport` before calling `writeCompletionReport`. Omitted stage accounting is
refused for order reports. Persist these compact outcomes with batch accounting and restore
them on resume; a retry is not a second imported order, and a recovered stage must replace
its earlier failure. Check the saved report and summary for both the incomplete status and
the affected source keys when any payment, refund, or invoice stage failed.

`appendExecutionLog` is not a heartbeat. Liveness and progress output for watching a running
script is `lib/progress-log.js`, writes to a caller-supplied path, and is a separate contract.

### Poll the health-check script, and redispatch on a stalled verdict

Do not drive a long-running generated `run-import.js`/`run-extract.js` by raw `tail -n 1`
alone once it has been launched. After dispatching the script, poll
`skills/wix-replatform/scripts/execution-health-check.js <projectDir> [--script <name>]
[--stale-after <duration>]` on an interval — default every 3 minutes; a shorter interval is
fine for a small run — instead of, or in addition to, the raw last-line tail. The
script reads `execution/progress.ndjson` and `execution/completion-report.json` and
answers exactly one question: `healthy`, `stalled`, or `complete`.

On a `stalled` verdict, treat it **exactly like a crashed process already found in
`execution/progress.ndjson`** — the same recovery as any other abnormal exit: redispatch a
fresh run from the last durable checkpoint. Never wait indefinitely on a subagent's own
promised resume ("it will pick back up on its own") once the health check reports
`stalled`; a subagent's own claim about its future behavior is not evidence, and what
this check exists to catch is a healthy run mistaken for one that would
never call back. A `healthy` verdict is not itself proof of eventual completion — keep
polling on the same interval until the verdict is `complete` or `stalled`.

Before redispatching on a `stalled` verdict, confirm the project's `run-import.js` (or
`run-extract.js`) was actually generated with the heartbeat wrapping — a project
codegen'd before this instruction existed may have entity-pass functions that never call
`withHeartbeat`/`startHeartbeat` at all, in which case `stalled` reflects an instrumentation
gap in that generated file, not the process. Grep the generated script for `withHeartbeat` /
`startHeartbeat`; if a write loop is missing it, retrofit that loop the same way
`rp-import-codegen/SKILL.md` describes for newly generated code before trusting the verdict
enough to kill and redispatch.

### Entity-by-entity QA is mandatory before treating an import phase as done

`wix-replatform`'s router requires a phase-level QA subagent at the end of the import phase
(its "Route before acting" step 5). For import, that review must be entity-by-entity against
the accepted mapping plan (`mapping/entity-decisions/*.json`), not a read of the top-level
`status` field in `execution/completion-report.json` or a paragraph of prose asserting the run
went well. A dedicated QA subagent — never the Developer subagent that produced the report,
and never the routing agent's own read of the summary — must, for every mapped entity/subtype:

- confirm its `completion-report.json` row reconciles (`imported + alreadyPresentByCrosswalk +
  deferred + failed == inScope`) and is backed by real rows in `state/attempts/write-attempts.ndjson`
  or `state/crosswalk/crosswalk.ndjson` — a bare counter with no corresponding ledger rows is a
  swallowed error, not a clean pass;
- for any entity reported blocked, deferred, or skipped, independently re-verify the stated
  reason is still true right now (spot-check the live source data or the live destination API,
  not the report's own prose) — a blocked reason written on an earlier pass can go stale the
  moment its underlying cause is fixed elsewhere, and nothing re-checks it automatically;
- treat "the user already decided to defer this" as a real answer only when a decision file
  actually records that choice; an assumption that a gap must be a deferred product decision,
  invented to explain why nothing ran, is not a substitute for checking.

If QA finds a stale reason, an unverified blocked status, or a swallowed failure, it must
demand a fresh Developer dispatch for that entity before the phase is reviewed — a plausible
top-level status string never closes this out on its own. Repeat this full entity-by-entity
pass after every resumed or recovery run, not only the first: a dispatch that fixes one
entity's crash or slowness does not certify any other entity's completeness, and a phase
already marked reviewed goes back to "needs review" the moment a later pass changes its
completion report.

**Finish the pass by writing the attestation, not by saying so in prose**. Once
every mapped entity/subtype above has been checked, compile the per-entity results (the ten
`completion-report.js` fields for a full-mode row, or `imported`/`skipped` for a quick-mode
row, plus `blockedReasonsReverified` for any row with a blocked, deferred, failed, unresolved
or skipped count) into a JSON array and run:

```
node skills/wix-replatform/scripts/entity-qa-attestation.js <projectDir> \
  --entities-file <path to the compiled per-entity results> \
  --verified-by <QA subagent label>
```

This computes the completion report's own digest, resolves the independent mapped-entity
coverage source (`mapping/mapping-plan.json`, or `quick-mode/plan.json` for quick mode), and
writes `execution/qa/entity-qa-attestation.json` only if it validates. Finalization
(`orchestration-router.js` / `scripts/migration-completion.js`) now refuses without a fresh,
complete attestation matching the report that is shipping — a missing, stale or failed
attestation routes the run back to this pass, never to a silent "completed". A count the
writer reports as mismatched is the same defect this section already requires: send that
entity back to a fresh Developer dispatch, then re-run the full pass and the writer.

## Per-batch accounting

Flush the run's accounting into the project after every batch, through the same shared writer
that produces the final record. An importer that holds its counters until the end loses them to
any interruption, and a long import redirected to a temporary file loses them to the shell; a
run that dies halfway must still leave a truthful partial account.

**Counts are held, never re-derived.** The figures come from the importer's own counters for the
current run. A count recovered by re-reading the append-only attempt ledger afterwards sweeps in
dry-run passes, retried batches and earlier recovery passes — that is how a run's counts inflate well past the number of records.

### Coverage check against the attempt journal

Every `writeLiveImportSummary` flush that names a run id checks its held counters against that
run's own rows in `state/attempts/write-attempts.ndjson`, and adds the result as `coverageCheck`
on the written summary. The held counters are never replaced; a disagreement is reported, not
hidden, and the write still completes.

At the end of the run, pass the run's own `coverageCheck` to `createCompletionReport` — read it
back from `execution/live-import-summary.json` and use it only when its `runId` equals the run
being completed (`input.runId`); `live-import-summary.json` is one file shared by every run,
so "the last `coverageCheck` in the file" is never a safe substitute for checking the run id. Also
pass `coverageCheckExpected: true` whenever this run called `writeLiveImportSummary` with a run id
at least once, so an omitted or rejected-run-id check is recognized as this run's own unresolved
gap rather than silently ignored. This is opt-in: an existing importer that
has not adopted this contract never sets `coverageCheckExpected`, and a missing check there changes
nothing — do not set it for a project that never calls `writeLiveImportSummary` with a run id.

Do not present a held count as confirmed before this check runs: `coverageCheck.status` is
`"agrees"`, `"mismatch"`, or `"unchecked"`, and only `"agrees"` means the journal
corroborates it.

## Reporting records that did not arrive

Records that did not arrive go into four separate sections of the completion report, never
merged into one list of issues, because they need four different responses:

| Field | Meaning |
| --- | --- |
| `losses[]` | Permanent losses — the destination cannot represent the record and no retry changes that |
| `exclusions[]` | Deliberate exclusions — we chose not to import these, with a count, a rationale, and whether an operator gate was recorded |
| `unresolved[]` | Written to the destination but not mapped, or mapped but unaccounted |
| `droppedFields[]` | The record arrived in a degraded form — the one that vanishes most easily, because the record count reconciles perfectly |

Each section renders even when empty, with an explicit "None." An omitted section is
indistinguishable from one nobody checked.

Anything the operator must do by hand goes in `operatorActions[]`, which renders **above** the
counts, each entry carrying a severity and a deadline reason.

`writeCompletionReport` also appends source access that outlives the migration
(`lib/source-access.js`). For a Shopify private-data run that connected, that is
`shopify-staff-account-removal` (`high`, entity the store domain): the store owner removes the
migration staff account after cutover and after the last Shopify read. It is listed on every
report, including an otherwise complete one, until the Import Operator records the owner's
confirmation with `rp-source-shopify` `scripts/shopify-session-check.js --confirm-staff-removal
owner-removed-account`; when the record is unreadable or missing the action says so and
`--repair-staff-access` rebuilds it as pending. It never changes the report's status.

For a Shopify run with any `shopify:customer-<kind>`, `shopify:order-<kind>` or
`shopify:customers-withheld-identity` coverage row, the writer also appends
`shopify-withheld-details-export` (`high`). A loss disposition does not close it: Shopify still
holds the only copy. After the final catch-up, the merchant exports customers and orders from
Shopify Admin; **Requires Import Operator** to run `rp-source-shopify`'s
`shopify-discovery.js --project <project> --confirm-withheld-export owner-exported`, regenerate
the report and verify the action is gone. A later extract `readAt` or a new withheld row reopens
it. The catch-up/checklist integration is not wired yet; the completion report is the
current durable handoff.

Shopify extract stop codes (`rp-source-shopify`), each a stop, never a retry loop. A source
catch-up (rerun for new and modified records) runs `shopify-extract.js --catch-up`, which reads
the whole store again in full; its **final re-read after Shopify activity stops** is a cutover
task for the Import Operator (check that `data/source-extract/extract-manifest.json` is
`complete` and every `readAt` is after the time activity stopped):

| Code | Meaning / next step |
| --- | --- |
| `source_auth_expired` | The CLI session lapsed. The stopping script creates a `manual_action` (`stage: execution`); run the session check (with `--connect` if asked), answer it, and the extract resumes from its manifest. **Requires Import Operator** |
| `shopify_throttled` | Shopify throttled one read on all 6 calls (31 s of backoff); re-run the extract later |
| `shopify_bulk_overdue` | A Shopify bulk export is still preparing after 4 hours. The extract holds at `awaiting_user_action` (exit 3) with one `question` action: answer `wait` (4 more hours) or `abort`, then run `shopify-extract.js` again. No duplicate question is created on restart |
| `shopify_bulk_overdue_aborted` | The operator answered `abort`: that dataset is `failed` with its `capture-failed` row `shopify:<entity>`; Shopify's operation is not cancelled. **Requires Import Operator**: `shopify-extract.js --retry-failed` reads it again |
| `shopify_bulk_failed` | A bulk dataset failed twice, was refused with `ACCESS_DENIED` and an unattributed cause, or is still `failed` from an earlier start. The extract stops on every start until the operator runs `shopify-extract.js --retry-failed` after fixing the cause in the message; then record the coverage decision `provided` for `shopify:<entity>`, or show the merchant the row at mapping. **Requires Import Operator** |
| `shopify_protected_fields_withheld` | A customer/order denial was re-probed with four ordinary 3-record reads and one or more error paths named a newly withheld kind, or a customer had no readable identity after projection. The new row is already upserted and promoted. Return through mapping for that exact coverageId; after mapping, the denied query resets with the narrower projection and finished queries do not rerun. A pathless or unrelated diagnostic uses `shopify_bulk_failed` instead and never narrows the projection |
| `shopify_bulk_download_failed` | The bulk file could not be downloaded whole (wrong status, size, final newline or a line that does not parse; or expired links) after the bounded retries. Same recovery as `shopify_bulk_failed` |
| `shopify_bulk_orphan_child` | A bulk file had a child row with no parent, or of a type the adapter does not fold. Same recovery; report it, because the bulk format may have changed |
| `shopify_extract_count_short` | The extract received fewer customers or orders than Shopify's exact count. The row `shopify:customers` / `shopify:orders` goes back through mapping for the merchant's decision; `--retry-failed` reads the dataset again |
| `shopify_extract_count_inexact` | Shopify gave only an "at least" count (or the count read failed). Never a pass: same row and recovery |
| `shopify_gift_card_codes_unreadable` | Gift cards first appeared during extract. `shopify:gift-card-codes` was added and promoted; return to mapping for its disposition before continuing |
| `shopify_gift_card_count_short` | The gift-card bulk read contains fewer cards created by its start than Shopify's exact count. The entry is `failed`; fix the cause and run `shopify-extract.js --retry-failed` for a new gated read. **Requires Import Operator** |
| `shopify_gift_card_count_inexact` | Shopify returned a non-`EXACT` count, rejected the read-bound filter, or the count still failed after its bounded retries. Same failed-entry recovery; never treat it as zero or nothing owed |
| `shopify_gift_card_amount_invalid` | A gift-card balance or initial value was not a plain decimal. The gated read failed before `done`; fix/report the source shape and use `--retry-failed` |
| `shopify_extract_store_mismatch` / `shopify_extract_files_missing` | The extract manifest belongs to another store, or says `complete` but its final files are gone (run `shopify-extract.js --catch-up`). Nothing was read or changed |
| `shopify_cli_node_unsupported` | Node.js older than 22.12: switch this terminal to Node.js 22.12 or later (for example the current LTS), check `node --version`, run the session check again. Nothing was installed or read. **Requires Import Operator** |
| `shopify_cli_version_changed` | The adapter's CLI is not 4.8.3; reinstall through the session check with `--install` (operator consent) |
| `shopify_cli_incompatible` | The adapter's CLI install is damaged; reinstall with `--install` |
| `shopify_api_version_unsupported` | Shopify no longer accepts the pinned API version; stop and report — moving the pin is a tested code change |

### CMS fallback for recognized plugin capabilities

A recognized plugin capability reaches CMS only with a signed eligibility entry **and** this
migration's merchant approval (`pluginCmsFallback:<capability>`, recorded at the mapping
review). Apply only the CMS fallbacks the merchant approved; write nothing for pending or
declined ones; never delete or overwrite CMS data an earlier run wrote.

**Write-time guard (before any CMS write of a recognized capability).** Run it with the
capability the plan is about to write, and write zero records for it unless it is allowed:

```bash
node skills/wix-replatform/scripts/cms-fallback.js guard --project-dir <project> --capability <capability>
```

Exit `2` means refused: the coverage row is not an approved CMS fallback, the approval fails
the shape check or no longer matches the register, or the current resolution digest differs
from the one in `plugin-coverage.json`, the mapping plan or the setup plan. Generated import
code may call `cmsFallbackWriteGuard(projectDir, { attempted })` from
`skills/wix-replatform/lib/plugin-cms-fallback.js` directly. The router is the primary gate;
this is defence in depth.

**Completion.** Pass `cmsFallback: { coverage, refusals, writes, previousReport }` to
`createCompletionReport` — `coverage` is `discovery/plugin-coverage.json`, `refusals` the
guard's refusals, `writes` this run's CMS writes per approved capability
(`{ capability, collections[], count }`), `previousReport` the prior
`execution/completion-report.json` when one exists. It derives one operator action per case
and persists `cmsFallbackWrites` for the next run:

| `code` | Severity | When |
| --- | --- | --- |
| `plugin-cms-fallback-feature-absent` | medium | an approved fallback: records archived in CMS; the plugin's feature is not restored — rebuild or replace it in Wix |
| `plugin-cms-fallback-undecided` | high when records exist | eligible but pending (awaiting, stale, quarantined, or target knowledge unavailable): records were not migrated |
| `plugin-cms-fallback-declined` | high when records exist | the merchant declined: records were not migrated |
| `plugin-cms-fallback-withdrawn` | high | CMS records written by an earlier run under an answer that no longer applies (declined, stale, superseded by a native target, no longer eligible): names the collection(s) and count; the Cutover Operator keeps or removes them by hand |
| `plugin-cms-fallback-write-refused` | high | the write-time guard refused a write. **Requires Import Operator:** rerun from the router so coverage and both plans are regenerated, then import again |

Resolution stays split: a reconciled CMS collection resolves *storage* only; the
`feature-absent` item is resolved only by a manual check that the replacement feature works on
the Wix site.

## Cause attribution

A failure carried into the completion report or the handoff takes one of exactly three shapes.
There is no fourth, and no bare free-text cause:

| `causeConfidence` | Requires | Renders as |
| --- | --- | --- |
| `verified-source` | a named destination-side check that ruled the destination out, recorded with its result | the cause, followed by the check |
| `verified-target` | a named destination-side check that confirmed a destination or same-run cause | the cause, followed by the check |
| `unverified` | nothing | `cause unverified`, and **no cause text at all** |

The check is recorded as `{ kind, target, result }`. An `unverified` row must not carry a
`cause` string — `writeCompletionReport` refuses one that does. A hypothesis printed next to the
word "unverified" is read as a finding by everyone skimming. A migration must not copy a source
defect forward, and it must equally not invent one: an unchecked "the source data is bad" costs
the merchant a trip into their old platform to fix data that was never broken, and it closes the
only investigation that would have found the real cause.

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
- `migrations/<project>/execution/review/migration-handoff.md` and its
  `migration-handoff.json` sidecar — the run's account of the migration, generated **after the
  last write** from the final outcome record. `generatePostExecutionHandoff` refuses and returns
  a typed reason when there is no `execution/completion-report.json`; it never writes a clean
  document from the plan
- `migrations/<project>/execution/recovery-log.json` for every resumed, partial,
  missing-only, failed-only, deferred-only, or unresolved-only run
- `migrations/<project>/execution/unresolved-writes.ndjson` — the re-read queue: one row per
  record whose latest journal status is unresolved (`succeeded_unverified`, or a `started` row
  with no terminal follow-on). A projection rebuilt from the attempt journal, never a source of
  truth; deleting it loses nothing
- `migrations/<project>/state/attempts/write-attempts.ndjson` — the append-only per-record
  ledger. Never rewritten, trimmed or rotated; a validation pass writes to
  `state/sample/attempts/write-attempts.ndjson` instead and never opens this file
- audit/report artifacts emitted by the shared import runtime

## Dependency recovery and cutover handoff

Read `execution/dependency-readiness.json` for task blockers, affected source keys and the
named recovery. The gate derives it from current site-bound task passes, latest attempt
outcomes, verified local mappings, setup receipt and approved census/field rules; editing
the projection cannot unlock writes. Preserve `state/readiness/task-passes.ndjson` across
resumes. Legacy or foreign-site evidence requires the named reconciliation/read-back.
Never adopt an unverified candidate ID or resend an order to repair dependency evidence.

Retain record deferrals in the existing attempt journal and reference-fidelity/cardinality
gaps in `mapping/review/mapping-gaps.json`. Generate the shared completion report so its
`operatorActions` carry the affected work, prerequisites, next action, resolution evidence
and **Requires Import Operator** / **Copy prompt for Import Operator** instructions.
The Cutover Operator works on another machine: recovery requiring the original project
must name that role and prompt. Resolve the underlying producer/approval/reference,
reevaluate, then resume only eligible deferred records. These artifacts preserve the handoff;
future cutover UI ingestion is not yet wired.

## Recovery artifact contract

Targeted recovery is a first-class import mode, not a side script. Every selective,
resumed, partial, missing-only, failed-only, deferred-only, or unresolved-only run must append one entry to
`execution/recovery-log.json` and update `execution/live-import-summary.json` through the
same shared summary writer used by the main import path.

Each recovery entry must include:

- recovery id
- run id — the id the importer minted at process start, so the entry is attributable to a pass
- timestamp
- selection filters
- reason
- records selected
- records attempted
- imported
- already present
- failed
- deferred
- unresolved — its own count, **never** summed into `failed`. A write whose outcome we do not
  know is read back, not re-sent, and a recovery record that folds it into the failure count
  reconciles arithmetically and is wrong
- crosswalk changes
- summary changes
- operator-visible outcome
- links to detailed logs

Do not overwrite earlier recovery entries. Failed or deferred records from an earlier
attempt must remain visible after a later successful recovery; the newer recovery entry and
summary delta explain what changed.

## Shipping delivery estimates on a finished project

Before the delivery-estimate fix, generated importers sent the delivery estimate under a name Wix drops, so
their shipping options show no delivery time. Earlier migrations are reported, **never edited**.
For a finished project whose importer predates that fix, run:

```bash
node skills/wix-replatform/resources/rp-execute-import/scripts/shipping-estimate-audit.js --project-dir <projectDir>
```

- It only reads Wix (GET); it never POSTs or PATCHes. It reads the crosswalk, the attempt
  journal, `orchestration/decisions.json`, the extract if present, and Site Properties once.
- It writes `execution/shipping-estimates.json`, replaces the shipping `operatorActions` in
  `execution/completion-report.json`, and regenerates the post-execution handoff.
- The only other local write is one crosswalk upsert when a recorded
  `shipping-option-target-missing:<optionKey>` decision of `recreated:<id>` adopts a new id.
- Rerun it after a decision is recorded or a delivery time is entered in Business Manager. That is
  how a finished project closes its shipping items.
- `--list <code>` prints every option recorded under that code, with no Wix call. Use it to relay
  a list of more than 15 options to the Cutover Operator.

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
- `voucherReconciliation` — the answer to workflow step 6b, exactly one of:

  | Value | Meaning |
  | --- | --- |
  | `not-applicable` | the accepted scope excluded coupons, or the source carried no usage-limited coupon |
  | `reconciled` | the step ran and every voucher reconciled |
  | `plan-pending-owner` | a plan was produced and is awaiting the owner's decisions per code |
  | `remedied` | approved remedies were applied and each was confirmed by a post-settle read-back |
  | `not-run` | the step was due and did not run |

  There is no default. For a run whose scope included coupons, a **missing field reads as
  `not-run`, never as `not-applicable`** — an absent answer is exactly the state this field
  exists to make visible, and defaulting it to the benign value rebuilds the defect. `not-run`
  and `plan-pending-owner` are named in the completion headline and raise the final status to
  at least `complete_with_warnings` under the highest-severity rule below.
- dashboard/editor/preview destinations
- `sourceCoverage[]` and `sourceCoverageRecorded` (report schema v2) — what the source held
  that was never captured. `writeCompletionReport` joins `discovery/source-coverage.json`,
  `mapping/review/mapping-gaps.json` and `orchestration/decisions.json` by `coverageId` and folds
  the result into the one status. An open row is a gated exclusion (no floor; one grouped
  headline line), an ungated exclusion (`complete_with_warnings`), an accepted loss
  (`incomplete_with_failures`), or unresolved data — auth-gated, unsupported, skipped by rule,
  failed or declared-not-observed with a gap or a `declined` decision —
  (`incomplete_with_mismatches`, one headline line per capability). In-scope auth-gated,
  capture-failed and declared-not-observed rows also add a `high` `operatorActions[]` row: the
  source is still the only copy. The writer refuses when a stamped project's coverage file is
  missing or does not reconcile. A project whose `source-schema.json` has no
  `sourceCoverageContract` stamp (discovery from before this contract) records
  `sourceCoverageRecorded: false` and at least `complete_with_warnings`. Recovering a source
  route or credential is Import Operator work before execution; the handoff's *Not migrated
  from the source* section only tells the Cutover Operator what to recreate or confirm in Wix.
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

### On a destination the run did not create, the import is ADDITIVE — always

Every rule below is unconditional when `WIX_SITE_STRATEGY=existing`. The site holds the
owner's live business data, and nothing in this pipeline can undo a bulk write.

- **Never delete a pre-existing entity.** No products, categories, collections, posts,
  media or coupons — not to clear a failed partial import, not to "start clean" before a
  retry, not to resolve a collision. There is no reason good enough; a failed import is
  recovered by re-running an idempotent one, not by clearing the target.
- **Never wipe the demo catalog.** That cleanup exists for a template's placeholder
  products on a site this run just scaffolded (see `resources/rp-destination/`). On an
  existing site those products are the owner's.
- **Skip, do not overwrite.** A record already present — by crosswalk, then by the
  mapping's natural key — is skipped and counted as `skipped`, not rewritten. Only augment
  a pre-existing entity when the plan the user accepted says so for that entity type.
  **One narrow exception: a rerun's accepted update path.** A linked record whose
  source version changed may be updated through its entity's verified update writer, carrying
  the crosswalk's saved `targetRevision`. The crosswalk check still runs before every create;
  what the exception replaces is only the blanket skip of linked records, and only for the
  accepted update path. Matching a *pre-existing* Wix record by natural key never authorizes
  updating it — that stays the collision policy above.
- **Never blank a field the source does not carry.** A source without a field means "no
  information", not "empty" — writing the empty value deletes data the owner entered by
  hand. Send partial updates; never a full replace built from source-only fields.
- **Report what was left alone.** The completion report must count `skipped` alongside
  `imported` and `failed`, so the user can reconcile the plan's collision inventory against
  what actually happened. "Nothing was touched here" is a result, not an omission.

Default-location inventory completion requires both the Inventory item and the same Catalog variant to agree on availability. The reconciler checks this on fresh writes and no-write reruns. A Catalog disagreement or failed read stays unverified; retain it for recovery without blindly rewriting stock.


## Contact/product verification before completion

Execute generated contact/product callers through the shared verified import wrappers.
Use the verification-state loader to read `state/write-verification.json` plus atomic
batch checkpoints in `state/write-verification-journal/`. It replays committed checkpoints
after interruption; the final snapshot compacts them. Published crosswalks carry receipt
references, while expected/actual entities remain in protected verification state. Candidate IDs are recovery information, not usable mappings. A crosswalk hit
or a `--missing-only` selection still requires target identity/value verification.
Preserve uncertain write outcomes and reconcile before retrying; do not create again
because the response was lost. Never repair historical contamination by blanket clearing.

Shared completion inputs must include `siteId`, each contact/product row's intended
`sourceKeys`, `verificationKind: "contact"` or `"product"` from the accepted mapping,
and `verification[entity]` from the wrapper. Declare `verificationKind: "none"` explicitly
for entities outside these comparators; an unknown name without a policy stays incomplete. Count-only completion cannot
satisfy these entities. Missing or conflicting evidence yields incomplete status and a
reconciliation action. Explicitly empty source sets have no data; empty reports cannot
cover a nonempty set. Quick Shopify separately records its product read-back results and
keeps stock permission failures partial and resumable; setup still does not write stock.


The mere presence of `state/.lock/` does not mean an importer is running. Each importer
owns a uniquely named PID/host claim there, and a resume automatically removes claims
whose local process is dead (including after SIGKILL). A live process continues to block
concurrent imports. For a claim from another host, an unrecognized legacy file, or a reused
PID, first confirm that its importer is stopped on the owning host, then remove only that
claim file and rerun the same command. Do not remove a live owner's claim or the whole state
folder. An empty legacy `.lock` directory needs no manual cleanup.

A failed target read keeps the previous verified crosswalk mapping and receipt reference.
The current verification report remains partial, so that retained mapping does not turn a
failed read into a new completion claim. Revoke mappings when identity is contradicted;
value-only differences require the existing update/review flow.

## Discovered-set outcome handoff

After writing the final completion report and before generating the post-execution handoff, run `node scripts/discovered-set-status.js build <projectDir>` in standard mode. It joins the approved discovered scope to actual outcomes, with unknown counts retained as unknown. Its Import Operator prompts stay in the handoff under Urgent Operator Actions; send those prompts to the Import Operator for recovery in the original migration environment. Do not resolve partial, failed, deferred or pending scope by ticking a manual acknowledgement. Only a merchant or Cutover Operator may record completed `manual-open` work through `scripts/discovered-set-status.js resolve`, with short evidence containing no record values. Quick mode keeps its existing path.

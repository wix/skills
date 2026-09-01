---
name: rp-mapper
description: >-
  Maps discovered source entities and fields to Wix targets and documents lossiness. Use
  when creating machine-readable mapping artifacts and review markdown after discovery.
---

# rp-mapper

Create a mapping plan from the discovered source schema into Wix entities and Wix data structures.

## Purpose

This skill translates source entities and fields into Wix targets. It should define what each source record becomes in Wix, how fields transform, and where custom schemas or extended fields are required.

## Required inputs

- `migrations/<project>/source-schema.json`
- `migrations/<project>/source-profile.md` when available
- `migrations/<project>/orchestration/checkpoints.json`
- `migrations/<project>/orchestration/decisions.json`
- any existing Wix target-model constraints supplied by the user

Read **only** these canonical artifacts by default. Do not ingest the raw discovery dump
(`migrations/<project>/data/...`) wholesale — it is platform-specific and large. Instead, when an
entity's mapping is ambiguous, follow that entity's `rawFile` pointer in `source-schema.json` to open
just that one raw file for verification. Skip entities whose `inUse` is `false` (advertised by the
source but holding no records).

### Adapter-supplied hints in `sourceMeta`

A source adapter may pre-fill part of the mapping when it recognizes the source format. Two
`sourceMeta` keys carry that, and both are optional — a schema without them maps exactly as
before:

- **`sourceMeta.mappingHints[]`** (`{ column, wixTarget, matchedAlias }`) — an **advisory**
  pre-fill, e.g. from a recognized vendor's CSV profile. Seed the corresponding
  `fieldMappings[]` entries from it so the user reviews and corrects instead of authoring from
  scratch, and record `decisionProvenance: source_platform_rule`. It is never authoritative:
  the source's own field list still governs, and every hint still passes through the mapping
  review checkpoint.
- **`sourceMeta.drift.unmappedColumns[]`** — real source columns the adapter's profile did not
  recognize. Each one must be explicitly mapped or explicitly recorded as skipped; leaving
  them unaddressed is how a stale profile turns into silently dropped data.

In addition to the project artifacts above, consult the relevant bundled adapter resource
when the mapping depends on platform behavior that should not be guessed:

- source-side read/entity semantics from `wix-replatform/resources/rp-source-<platform>/SKILL.md`
- Wix target constraints and domain behavior from `wix-replatform/resources/rp-target-wix/SKILL.md`
- Wix target entity suitability from
  `wix-replatform/resources/rp-target-wix/scripts/domain-knowledge.js`

Treat those adapter resources as the authoritative home for platform knowledge. Do not
copy source/Wix behavioral rules into the mapping plan as if they originated there; cite
and apply them there.

## Deterministic first — resolve before you reason

**Do not author field mappings by hand when a vendor overlay already knows them.** Run the
deterministic resolver first and let it do the mechanical join; your judgement is needed only for
what it cannot decide.

```
node scripts/resolve-mapping.js --fileset <migrations-root>/<project>/data/csv-discovery/fileset.json \
  --out <migrations-root>/<project>/mapping
```

It joins three inputs that are all already data — the header set discovery actually observed, the
vendor overlay's `columnMap`, and `rp-target-wix`'s `lib/wix-target-spec.js` — and writes
`mapping/mapping-resolution.json` plus `mapping/mapping-residue.json`. Exit code `2` means blocked:
a required Wix input is unfilled, or an overlay names a canonical field that does not exist.

What it decides, so you don't:

- **which column feeds which canonical field**, and via which alias (recorded for review)
- **which columns nothing claims** → `residue.unmappedColumns`
- **which mapped columns have no Wix home**, with the declared reason → `residue.unsupportedTargets`
- **which required Wix inputs nothing feeds** → `residue.unfilledRequired` (a blocker)
- **which overlay entries reference an absent column** → `overlayDrift` (the profile is stale)
- **which entities arrive by derivation** rather than by a column → `derivedEntities`, including
  `requiresFaithfulnessLedgerEntry` when the source taxonomy is hierarchical

**Your job is `residue`, and only `residue`.** Each entry needs an explicit decision — map it to a
canonical field, or record it as intentionally skipped with a reason. Leaving an entry undecided is
how a stale overlay turns into silently dropped data.

Two rules keep this honest:

- **The header row read at discovery time is authoritative, not the overlay.** An overlay can only
  claim columns that actually exist; a column it does not know is surfaced, never dropped.
- **When you resolve a residue entry that the overlay *should* have known, fix the overlay** —
  `rp-source-csv/vendors/<vendor>.json` plus a header fixture in `tests/fixtures/csv/headers/`. That
  is a data edit with no skill-logic change, and it means the next run resolves it deterministically
  instead of asking a model again. A mapping decision made twice is a missing overlay entry.

### Do not regenerate the payload builder

`rp-target-wix/lib/wix-build.js` turns a canonical record into a Wix Stores V3 create body
deterministically, and `lib/wix-target-spec.js` declares every field, constant and trap it relies
on. This layer is **vendor-independent** — Shopify, WooCommerce, Magento and BigCommerce all
converge on it — so codegen must **vendor and call it**, exactly as the reader vendors `csv-parse.js`.
Do not emit a per-project `to-wix.js` re-deriving money objects, slug sanitization, choice-by-name
variant references, or the empty `physicalProperties` trap. Those are settled, tested, and
regression-locked against 220 payloads from two live-verified imports
(`tests/mapping/wix-build-oracle-test.js`).

The spec also settles the one price decision that recurs on every vendor: see
`STORES_V3_TARGET.priceResolution`. A (regular, sale) pair is **resolved** into Wix's
`actualPrice`/`compareAtPrice`, not mapped field-for-field — getting it backwards silently
overcharges every discounted product.

## Workflow

1. Read the source discovery artifacts.
2. **Run the deterministic resolver** (above) and read its residue.
3. Identify the target Wix entities for each source entity using the domain knowledge
   reader first. Start from `sourceMeta.candidateTargetRefs[]` when discovery supplied it;
   otherwise run `domain-knowledge.js resolve-source`; use semantic reasoning only when no
   candidate exists and record `unverified` confidence.
4. Decide the resolver residue only, then define any remaining transformations and defaults.
5. Mark gaps where native Wix entities are insufficient — the resolver's `unsupportedTargets`
   already names them with reasons; carry those into the faithfulness ledger rather than restating.
6. Identify requirements for custom collections, extended fields, references, media handling, and rich content normalization.
7. Save the mapping plan.
8. Detect authored `blockedSourceDependencies` on the selected target entities, aggregate them
   by `sourceEntityRef`, and write the blocked-data request state and review artifact below.
9. Write a concise user-review summary after the plan is complete.
10. Pause for a mapping review checkpoint before downstream setup/codegen work begins.

## Artifacts to create or update

- `migrations/<project>/mapping/run.json`
- `migrations/<project>/mapping/mapping-plan.json`
- `migrations/<project>/mapping/entity-decisions/<entity>.json`
- `migrations/<project>/mapping/llm-handoff.json`
- `migrations/<project>/mapping/review/mapping-gaps.json`
- `migrations/<project>/mapping/review/mapping-plan.md`
- `migrations/<project>/mapping/review/mapping-summary.md`
- `migrations/<project>/mapping/review/blocked-data-requests.md`
- `migrations/<project>/state/blocked-data-requests/<sourceEntityRef-slug>.json`
- `migrations/<project>/orchestration/checkpoints.json`
- `migrations/<project>/orchestration/approvals.json`

## Blocked source dependencies

Read only authored `blockedSourceDependencies[]` from selected target entity knowledge; never
infer a request from `db-only`, `admin-page-only`, or another channel by itself. Use the shared
`lib/blocked-data-requests.js` builder to aggregate one request per `sourceEntityRef`, appending
all dependent target entity/field rows. Resolve each source entity's `blocked[].fulfillment`
through `rp-source-wordpress/lib/blocked-data-handlers.js`; offer it only when its fixture
self-test passes and, for `bridge-plugin`, the matching manifest case is production-ready.

Persist the request under `state/` as the authority and render
`mapping/review/blocked-data-requests.md` as a passive review section. This adds no new blocking
prompt. At an interactive mapping pause, set `askedInteractively: true` only if the request is
actually shown and a human can decline it. In 1-click mode set it to `false`; an unanswered
request remains `missing`, never `declined`, because the run did not pause to ask.

## Minimum contents of the mapping plan

Include for each source entity:

- source semantics in this project, especially when the entity name is generic
  (`comment`, `item`, `entry`, `record`, `media`, `user`, etc.). State what the entity
  actually contains here, based on the discovered data, not just the route name.
- target Wix entity or collection
- selected `targetRef`, `targetDomain`, `targetEntity`, `targetClassification`,
  `importReliability`, `preferredWrite`, and `knowledgeEvidence` when the decision uses a
  bundled domain entity record
- when `targetClassification` is `manual-mapping`: the entity's `manualSteps`
  verbatim (prerequisite, actor-tagged steps, mechanism, evidence) instead of field
  mappings/transformation/validation rules below — there is no transform to author, only a
  runbook to carry over unchanged
- primary key and deduplication strategy
- field mapping table
- transformation rules
- validation rules
- URL preservation policy for public routed entities
- unresolved questions
- setup implications for Wix-side configuration
- media policy when the entity carries media: whether only referenced media is in scope,
  whether the target accepts external URLs directly, and whether media must exist in Wix
  before create/update
- `safeModeReplacements[]` when safe mode is enabled, listing every mapped email or phone
  field that enters an outbound Wix payload. Write the same array in both
  `mapping/mapping-plan.json` for the entity decision and
  `mapping/entity-decisions/<entity>.json`.
- a human-visible safe-mode note in the review markdown whenever any entity has
  `safeModeReplacements[]`, so email/phone replacement coverage is visible without opening
  the JSON artifacts

When a source entity is generic or overloaded, the mapping plan must name the concrete
subtypes or usage contexts it observed. Examples:

- `comment`: blog post comments, product reviews, page comments
- `item`: order line items, catalog items, CMS rows
- `media`: blog hero images, product gallery assets, downloadable files

Do not leave a generic entity label unexplained if the discovered data shows multiple
real-world meanings.

## Safe-mode contact replacement metadata

Safe mode is enabled by default through `config/wix.env` unless the user explicitly sets
`SAFE_MODE=false` before mapping. When enabled, mapping artifacts must emit semantic
contact-channel metadata so generated imports can replace outbound email and phone values
through deterministic shared writer code.

For every mapped entity, mark fields for safe-mode replacement when source evidence,
target-Wix domain knowledge, target field semantics, user-directed mappings, CMS/custom
fields, extended fields, form submissions, metadata, or plugin fields indicate an email or
phone contact channel.

Each `safeModeReplacements[]` entry must include:

```json
{
  "kind": "email",
  "sourcePath": "billing.email",
  "targetPath": "billingInfo.email",
  "required": true,
  "reason": "source and target are email fields"
}
```

`targetPath` is relative to the Wix-shaped object or request body defined by the mapping
decision. Use the shared safe-mode path grammar: object fields (`billingInfo.email`,
`contact.email.email`) and array wildcards (`lineItems[].buyerInfo.email`,
`contact.additionalEmails[].email`). When the same source value is copied to multiple
Wix fields, list each target path.

Load target-side hints from selected `rp-target-wix` entity records'
`safeModeContactFields[]` and merge them with source-side evidence and user mapping
decisions. If `SAFE_MODE=false` before mapping, do not require this metadata for execution.

This metadata must be surfaced in **both** machine and human mapping artifacts:

- write `safeModeReplacements[]` into `mapping/mapping-plan.json`
- write the same `safeModeReplacements[]` into `mapping/entity-decisions/<entity>.json`
- render a per-entity safe-mode line in `mapping/review/mapping-plan.md`
- when any replacements exist, include a short `Safe mode replacements` section in
  `mapping/review/mapping-summary.md` listing the affected entities and the mapped
  email/phone paths

Do not leave safe-mode contact replacement coverage implicit in field tables or only in
JSON. A reviewer should be able to confirm from the review markdown which outbound
email/phone fields will be replaced in safe mode.

## Identity and deduplication rules

Be explicit about the difference between a **source ID** and a **Wix target ID**.

- Preserve the **source ID** in the migration artifacts, generated code, local crosswalk
  state, and any optional CMS mirror collections needed for site-local traceability.
- Do **not** assume native Wix entity IDs can be client-assigned or preserved. For most
  Wix APIs, the target ID is server-assigned.
- When a target is a native Wix entity whose ID cannot be controlled by the client,
  the mapping plan must define a **local crosswalk strategy**:
  `crosswalkAuthority: "local"`, a per-entity `crosswalkStrategy`, and a
  `reconciliationStrategy` used for dedupe, resume, and relationship resolution.
- CMS `ImportCrosswalk` is optional. Use `cmsMirror: "none" | "download" | "upload" |
  "download-and-upload"` to request it explicitly. It is a copy/seed adapter for
  existing-site or handoff reference flows, not the required resume authority.
- Only say an ID is "preserved" when the destination actually has a client-controlled
  field that stores the source ID. Otherwise say the source ID is **tracked** or
  **crosswalked**.

### When the destination already exists, map against its LIVE schema

`WIX_SITE_STRATEGY=existing` means the target is not an empty site provisioned to this
mapping's shape — it is a site in use, with its own collections, fields and records. Map
against what is actually there:

- **Read the destination's current schema before proposing a target shape.** A collection
  the site already has, with fields the owner added, is the target — not a new collection
  that happens to fit the source better. Two collections holding the same entity is the
  failure mode here, and it is one the owner has to untangle by hand.
- **A field that exists but does not match is a GAP, not a migration.** Record it in the
  faithfulness ledger and surface it in the mapping summary; do not plan a schema change
  to a live site, and never plan to drop or retype an existing field.
- **Every entity needs a natural key, not just a crosswalk entry.** The local crosswalk is
  empty on the first import into a site that already has data, so dedupe has to fall back
  to something the site itself carries — SKU, handle, slug, email. State that key per
  entity in the mapping plan; without it the import cannot tell "already there" from "new"
  and will duplicate the owner's catalog.
- **Set `cmsMirror: "download-and-upload"`.** On an existing destination the on-site
  `ImportCrosswalk` is not an optional convenience: it is the only record of prior imports
  visible to a run that does not share this project's local state.
- **Say so in the mapping summary.** The user reviewing the plan must see that it targets a
  site they already own, and which of their existing entities it expects to match.

## URL preservation policy

For every in-scope source entity that appears on the public website, include an explicit
`urlPolicy` in `mapping/mapping-plan.json` and the relevant
`mapping/entity-decisions/<entity>.json` artifact.

Minimum `urlPolicy` fields:

- `public`: `true` for public routed entities; `false` for entities intentionally outside
  URL preservation.
- `sourceBasePath`: the observed source base path, such as `/shop/products`; use `null`
  only when the source URL cannot be derived and record that risk.
- `sourceSlugField`: source field holding the slug, when present.
- `sourceUrlField`: source field holding the full/permalink URL, when present.
- `targetBasePath`: known Wix destination base path, or `null` when website-builder route
  selection is deferred.
- `targetSlugField`: planned target slug field, when applicable.
- `preserveBasePath`: whether the future website-builder phase should try to preserve the
  source base path.
- `preserveSlug`: whether generated code should preserve the source slug unless target
  validation or collision handling forces a change.
- `redirectMode`: `record-if-different`, `manual-review`, or `none`.

If the same source entity type has multiple public route shapes, record each observed
route class separately instead of guessing one base path. Slugs are identity and SEO data,
but slug preservation alone is not URL preservation; route/base-path intent must be
captured as data for the future website-builder phase.

Mapping review artifacts must include a short `URL preservation` section listing:

- public entity types with source base paths
- whether base paths should be preserved
- entities whose target route is deferred to the website-builder phase
- known slug normalization, collision, route, or redirect risks

## Verifying Wix APIs

Confirm exact Wix entity/collection/field names before mapping a source field onto
them — never invent a Wix API or field name.

When the mapping depends on Wix runtime behavior rather than just field names, verify and
follow the relevant `rp-target-wix` contract as well. Examples include create ordering,
native tag handling, category assignment requirements, member prerequisites, and whether a
product/media field should be sent as an external URL for Wix-side ingestion.

For entity suitability, do not grep or paste whole domain files into the plan. Use:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/domain-knowledge.js summarize-entities --refs <domain/entity,...>
```

Load full entity records only for selected candidates that materially affect the current
project.

- Verify enum **values**, not just names: every `Field.type` you assign must be a real
  member of the Create Data Collection `Type` enum. (Common trap: there is no `SLUG`
  type — a slug maps to a `TEXT` field. Never assign a guessed enum value and flag it
  `unverified`; resolve it or omit it.)
- If a Wix tool surface such as Wix MCP is available in the runtime, use it as a fast
  verification aid for entity, field, enum, app, and setup names.
- If no Wix tool surface is available, rely on `rp-target-wix`'s verified contracts plus
  published Wix REST/SDK documentation and conservative, known-good names. Mark anything
  you could not verify directly as `unverified` in the mapping plan so it is surfaced
  before execution.

## Runtime policy

Resolve ambiguous mappings using the documented default, record the decision and rationale
under the machine mapping artifacts and render them into `mapping/review/mapping-plan.md`,
and keep going. Known fidelity forks
(e.g. comments anonymize vs. skip) should already be answered by the submission intake;
apply those answers rather than re-asking. If a required input is truly missing, surface it
as a blocker rather than silently guessing.

If the source entity name is generic but the observed data disambiguates it, record that
disambiguation explicitly in the machine mapping artifacts and review plan. Do not force later stages to infer what
"comments", "items", or similarly broad labels meant in this specific migration.

## Faithfulness ledger (detect lossiness here, early)

The mapping stage is where lossiness and coverage gaps are *discovered*, so it is where
they must be *recorded* — not at execute time, which is too late to do anything but
report. Maintain a **faithfulness ledger** in `mapping/review/mapping-gaps.json` and render it
into `mapping/review/mapping-plan.md`, listing everything that
will not migrate cleanly, including:

- fields/relationships flattened or dropped (e.g. hierarchy → flat),
- entities skipped (e.g. gated PII),
- **targets with no verified Wix primitive** — if Wix has a native entity, record that
  codegen must use an `unverified` native REST path and notify the RePlatform team about
  the missing writer. Use CMS only when no suitable native Wix entity exists, or when the
  native entity is rejected for fidelity/side-effect reasons.

**Mandatory trigger — plugin coverage.** Every row in `discovery/plugin-coverage.json` whose
status is not `migration-planned` must produce a `mapping/review/mapping-gaps.json` entry
carrying the capability, the status, and the row's user-facing impact line — and so must a
`migration-planned` row that is lossy or carries `blocked[]` entries. This is what makes
plugin loss visible: a capability the pipeline discovered but could not deliver has to reach
the execution-plan report, and the ledger is the only path there.

Each such entry must also carry a `severity`, because a plugin-heavy site produces far more
rows than it has real problems — on a 55-plugin store, 26 rows were "we don't recognise this
plugin", which would bury the entries that matter if they all read alike. Use the same
vocabulary as profile pitfalls:

| `severity` | Means | Typical rows |
| --- | --- | --- |
| `blocker` | data the user would care about is not coming across | `requires-development`; a `blocked[]` entry still unresolved or declined |
| `warning` | it migrates lossily, or we are not sure yet | `pending` (including `cannot-tell`); `migration-planned · via cms` where the source is semantically richer |
| `info` | accounted for, nothing lost that we know of | `no-need-to-migrate` with `basis: proposed`; `migration-planned · proposed` with no known loss |

The execution-plan report leads with `blocker` and `warning` and summarizes `info` as a count
with a pointer. Severity is a **rendering** aid, not permission to omit: every row still gets
an entry, so the audit trail stays complete and a mis-severitied row can be found later.

Additional plugin rules:

- Resolve targets from `sourceMeta.candidateTargetRefs[]` first, then
  `domain-knowledge.js resolve-source`, then the target knowledge base's capability index
  keyed on `sourceMeta.capability`.
- **Derived entities (`sourceMeta.recognized: false`) may only be mapped to a native Wix
  entity when the domain knowledge confirms the capability.** Otherwise map them to CMS. The
  proposed capability from discovery is recorded with `confidence: proposed`, never a
  target decision — treating a guess as native is how a silent, lossy write happens.
- **Every capability, recognized or derived, needs its pairing written down: plugin details
  against Wix details.** In `mapping/review/mapping-plan.md`, per capability: the source
  entity and the fields it actually carries, the target entity and the fields it expects,
  which source field lands in which target field, and which carry nowhere. In
  `mapping/review/mapping-summary.md`, one line naming the source, the target, and the single
  consequence that matters. For a derived capability, say in both that the mapping is
  **proposed** rather than confirmed — a reviewer must be able to tell a guess from an
  authored match. Without the pairing the user is approving a target name, not a mapping.
- A `no-need-to-migrate` row with `basis: proposed` (the agent's own reading, not a list
  entry) is also listed in `mapping-summary.md` — automation deciding there is nothing to
  move is a decision worth seeing.
- Carry each plugin entity's profile `pitfalls[]` into the plan, and surface `blocker`
  severities in `mapping/review/mapping-summary.md`.
- **A capability read through a plugin-specific credential is disclosed up front.** When a
  profile declares `credentials[]` (a plugin's own API key or secret, beyond the platform
  admin credential — e.g. Subscriptions For WooCommerce's plugin-generated
  `consumer_secret`), the capability's row in `mapping/review/mapping-plan.md` states the
  credential prerequisite (what key, where the user finds or enables it in the source
  admin), and `mapping-summary.md` carries one line listing every capability that will ask
  for such a key. The user learns this at the mapping review, not first as a surprise
  `blocked: credential` ask mid-run; the run-time collection still goes through the
  standard batched blocked-and-recoverable ask.
- Any capability landing in CMS adds two setup implications to the summary: the **Wix Data app
  install**, and **creating each collection** (no verified writer yet, so it is manual). A CMS
  row presented without them reads as more automatic than it is.
- `requires-development` and `pending` rows belong in the summary's gaps section in plain
  language, even though there is no mapping to make for them.
- A `targetClassification: "manual-mapping"` entity gets its own section in
  `mapping-summary.md`, separate from both the gaps section above and the review-gate list
  below — carry over its `manualSteps.steps[]` as a numbered list, not a one-line summary; the
  point of this section is to hand over a runbook, not to compress it. **Do not** put these
  rows in the pending/gaps section: unlike `pending`, a manual-mapping row is a complete,
  decided mapping the moment it is authored with real evidence — there is nothing left for a
  human to decide, only steps for the merchant to execute. It needs no verdict at the review
  gate below.

**Mandatory step — pending rows are decided at the review gate.** The mapping review is the
single human gate and **the only exit from Pending**: every `pending` row is put to the user
for a decision, none may survive the gate undecided. Four verdicts, each with a producer:

- **"We can migrate it"** — record the chosen target and move the row to *Migration planned*
  in the plan (its `confidence` stays `proposed` until a profile is authored).
- **"Nothing to move"** — the row becomes *No need to migrate* with `basis: decision` and the
  user's stated reason as its `rationale`.
- **"Wix has no surface — build it first"** — the row becomes *Requires development*: write it
  to `mapping/review/mapping-gaps.json` with severity `blocker`, emit an `api_gap` telemetry
  event, and record the verdict in the human-signed register
  (`plugins/requires-development.json`, `decidedBy` = the user) citing the recorded search.
- **"The surface exists, we did not know it"** — telemetry only (`source_plugin_coverage`
  carries the decision); the profile or domain entity is authored between runs, never during
  this one.

Record each decision in `orchestration/decisions.json`; blocked-row asks batched at discovery
use the key `pluginBlocker:<capability>:<kind>` with value `provided` or `declined`.

**Mandatory trigger — hierarchical source taxonomy → flat Wix target.** When a source
entity carries `"hierarchical": true` (or any `parent` self-relation) in
`source-schema.json` and maps to a flat Wix target such as Blog categories, you **must**
write a faithfulness-ledger entry recording that the parent/child hierarchy is dropped on
import (the Wix Blog category target is flat — it has no parent/child relationship). This
is not optional discipline: the flag exists precisely so
the warning is data-driven. Do not map such a taxonomy without the ledger entry. (If
hierarchy must be preserved, the alternative is a CMS-collection taxonomy with a `parent`
reference field — note that trade-off in the ledger instead.)

This ledger is the source the execution-plan report draws from to surface "what we won't
do" to the user **before** consent (`rp-execute-import`). If it isn't recorded here, the
user can't be warned there.

Every selected entity whose domain knowledge includes `IMPORT_UNRELIABLE` must create a
`mapping/review/mapping-gaps.json` entry with the same fixed flag string, the selected
`targetRef`, a project-specific summary, and the chosen fallback or review action.

**Mandatory check — every in-scope entity's dependencies are also in scope.** Run it directly, do
not re-derive it by reading prose:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/domain-knowledge-validate.js \
  --check-scope <comma-separated domain/entity refs in the mapping plan>
```

Pass only the plan's own selected refs — `checkScope` walks the `dependsOn` transitive closure
itself starting from that list, so do not pre-expand it by hand. It fails closed on three distinct,
named problems, any one of which is a gap the user must resolve at the gate before proceeding:

- **Unknown ref** — something in your selected list doesn't resolve to a real `domain/entity`
  file (typo, stale ref). Fix the ref.
- **Missing dependency** — an entity reachable from your selection (directly or transitively)
  names a `dependsOn` that isn't in your original selection (e.g. importing orders without also
  importing gift cards). Add the missing entity to scope, or accept and record the consequence
  (e.g. orders referencing unresolvable gift cards) — not something codegen should discover later
  by producing broken references.
- **Unreviewed** — an entity reachable from your selection has never had `dependsOn` authored at
  all (distinct from "reviewed, no dependencies"). `--list-missing-deps` shows the same backlog
  outside the context of any one plan.

A clean `--check-scope` result means only this plan's own reachable set is fully reviewed and
in scope — it says nothing about entities outside that reachable set. `checkScope` walks from
your selected refs, not from the whole domain tree, so an unrelated entity with no `dependsOn`
authored at all stays invisible to this gate until some plan actually reaches it. Run
`--list-missing-deps` (unscoped, whole-repo) separately to see the standing backlog.

**As of this pass, only 19 of 62 entities in this repo have `dependsOn` authored** — expect to hit
**Unreviewed** on most real plans today, not just as an edge case. That is not this gate failing;
it is the gate doing its job on a knowledge base that is still mid-backfill. When it happens:
author `dependsOn` on the reachable entity now, as part of the mapping work you are already
doing — deciding a mapping plan already means knowing what that entity depends on, so this is
recording that decision, not new research — then re-run `--check-scope`. Do not treat Unreviewed as
a reason to skip the gate or fall back to reading prose by hand for that entity.

This is the check that was missing when `ecom/order.json` first needed `gift-cards/gift-card` (see
spec 0042). **Corrected 2026-08-18 (PR #142 review):** an earlier version of this guidance told
callers to expand to the full transitively-reachable set by hand before calling `--check-scope`,
because the check only examined one hop per call. That burden is now the tool's job, not yours —
`checkScope` performs the walk itself; pass it your plan's actual selection and nothing more.

## Default media scope

Default to importing only media referenced by in-scope entities such as posts, products,
collections, categories, or CMS rows that are actually being migrated. Unattached
source-library media is out of scope by default unless the user explicitly asks for a
library/archive migration.

When an entity carries media, consult `rp-target-wix` for the target behavior:

- if the target accepts external URLs and ingests them in the background, prefer that
  path
- otherwise require media import to Wix first, then attach the resulting Wix media id

## Mapping summary for user review

After `mapping/mapping-plan.json` is written, create
`migrations/<project>/mapping/review/mapping-summary.md` as a
short review artifact for the user. Its purpose is to make the mapping decision easy to
review without forcing the user through the full plan.

The summary should:

- explicitly say that full details live in `mapping/review/mapping-plan.md`
- list each in-scope source entity and its planned Wix target
- call out the main gaps, lossy transformations, skipped entities, and `unverified`
  target paths from the faithfulness ledger
- summarize public URL preservation: source base paths, deferred target routes, and slug
  or redirect risks that affect approval
- mention the biggest setup implications the user should know now (for example: required
  Wix apps, required CMS collections, optional CMS crosswalk mirror, media reachability
  caveat)
- when safe mode is enabled and any replacements exist, include a short summary of which
  entities have outbound email/phone replacements and where they apply
- surface unresolved questions only when they materially affect whether the user should
  approve the mapping

Keep it concise. The user should be able to decide "yes, this is the right migration
shape" from this file alone, then consult `mapping/review/mapping-plan.md` only when they want detail.

Recommended structure:

- one-sentence purpose / pointer to `mapping/review/mapping-plan.md`
- `Source -> Wix targets`
- `Plugin coverage` (when the source reported plugins): one line per capability that is not
  `migration-planned · confirmed`, in the user's terms, plus anything they must supply or
  accept losing
- `URL preservation`
- `Main gaps / lossiness`
- `Important setup implications`
- `Safe mode replacements` when applicable
- `Questions or risks to confirm`

Do not restate full field tables or detailed transformation rules here unless a specific
field-level issue is central to the approval decision.

## Mapping review checkpoint

Once both mapping artifacts exist, reset `orchestration/approvals.json` so
`mapping.status=pending`, then stop and ask the user to review
`migrations/<project>/mapping/review/mapping-summary.md`. The checkpoint should make clear:

- this is a semantic review of what will be migrated where
- the full technical detail remains in `mapping/review/mapping-plan.md`
- downstream setup discovery and code generation will wait for acceptance

Do not proceed to `rp-setup-discovery` or `rp-import-codegen` until the user accepts this
mapping review checkpoint, unless the user explicitly asks to continue provisionally. In
explicit user-requested `1-click mode` (`automationMode=one_click`, `source=user`), still
write the same review artifacts, but record the checkpoint as accepted by the agent and
continue immediately. A missing mode or a non-user-authored `one_click` value is normal
interactive mode and must pause here; file upload does not imply one-click.

## Guardrails

- Do not collapse multiple source concepts into one Wix field without documenting lossiness.
- Call out data that cannot be migrated faithfully — record it in the faithfulness ledger above.
- Do not describe a source entity only by a generic label when the observed data is more
  specific; name the concrete subtype(s) present in the project.
- Keep business rules explicit so `rp-import-codegen` can implement them deterministically.
- Do not guess Wix field, enum, or app names when you cannot verify them. Mark them
  `unverified` and surface the risk before execution.

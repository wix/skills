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

- source-side read/entity semantics from `replatform/resources/rp-source-<platform>/SKILL.md`
- Wix target constraints and domain behavior from `replatform/resources/rp-target-wix/SKILL.md`
- Wix target entity suitability from
  `replatform/resources/rp-target-wix/scripts/domain-knowledge.js`

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
8. Write a concise user-review summary after the plan is complete.
9. Pause for a mapping review checkpoint before downstream setup/codegen work begins.

## Artifacts to create or update

- `migrations/<project>/mapping/run.json`
- `migrations/<project>/mapping/mapping-plan.json`
- `migrations/<project>/mapping/entity-decisions/<entity>.json`
- `migrations/<project>/mapping/llm-handoff.json`
- `migrations/<project>/mapping/review/mapping-gaps.json`
- `migrations/<project>/mapping/review/mapping-plan.md`
- `migrations/<project>/mapping/review/mapping-summary.md`
- `migrations/<project>/orchestration/checkpoints.json`
- `migrations/<project>/orchestration/approvals.json`

## Minimum contents of the mapping plan

Include for each source entity:

- source semantics in this project, especially when the entity name is generic
  (`comment`, `item`, `entry`, `record`, `media`, `user`, etc.). State what the entity
  actually contains here, based on the discovered data, not just the route name.
- target Wix entity or collection
- selected `targetRef`, `targetDomain`, `targetEntity`, `targetClassification`,
  `importReliability`, `preferredWrite`, and `knowledgeEvidence` when the decision uses a
  bundled domain entity record
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
node skills/replatform/resources/rp-target-wix/scripts/domain-knowledge.js summarize-entities --refs <domain/entity,...>
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
mapping review checkpoint, unless the user explicitly asks to continue provisionally.

## Guardrails

- Do not collapse multiple source concepts into one Wix field without documenting lossiness.
- Call out data that cannot be migrated faithfully — record it in the faithfulness ledger above.
- Do not describe a source entity only by a generic label when the observed data is more
  specific; name the concrete subtype(s) present in the project.
- Keep business rules explicit so `rp-import-codegen` can implement them deterministically.
- Do not guess Wix field, enum, or app names when you cannot verify them. Mark them
  `unverified` and surface the risk before execution.

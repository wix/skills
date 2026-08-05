---
name: rp-mapper
description: >-
  Maps discovered source entities and fields to Wix targets and documents lossiness. Use
  when creating mapping-plan.md and mapping-summary.md after discovery.
---

# rp-mapper

Create a mapping plan from the discovered source schema into Wix entities and Wix data structures.

## Purpose

This skill translates source entities and fields into Wix targets. It should define what each source record becomes in Wix, how fields transform, and where custom schemas or extended fields are required.

## Required inputs

- `migrations/<project>/source-schema.json`
- `migrations/<project>/source-profile.md` when available
- any existing Wix target-model constraints supplied by the user

Read **only** these canonical artifacts by default. Do not ingest the raw discovery dump
(`migrations/<project>/data/...`) wholesale — it is platform-specific and large. Instead, when an
entity's mapping is ambiguous, follow that entity's `rawFile` pointer in `source-schema.json` to open
just that one raw file for verification. Skip entities whose `inUse` is `false` (advertised by the
source but holding no records).

## Workflow

1. Read the source discovery artifacts.
2. Identify the target Wix entities for each source entity.
3. Define field-by-field mappings, including transformations and defaults.
4. Mark gaps where native Wix entities are insufficient.
5. Identify requirements for custom collections, extended fields, references, media handling, and rich content normalization.
6. Save the mapping plan.
7. Write a concise user-review summary after the plan is complete.
8. Pause for a mapping review checkpoint before downstream setup/codegen work begins.

## Artifact to create or update

- `migrations/<project>/mapping-plan.md`
- `migrations/<project>/mapping-summary.md`

## Minimum contents of the mapping plan

Include for each source entity:

- source semantics in this project, especially when the entity name is generic
  (`comment`, `item`, `entry`, `record`, `media`, `user`, etc.). State what the entity
  actually contains here, based on the discovered data, not just the route name.
- target Wix entity or collection
- primary key and deduplication strategy
- field mapping table
- transformation rules
- validation rules
- unresolved questions
- setup implications for Wix-side configuration

When a source entity is generic or overloaded, the mapping plan must name the concrete
subtypes or usage contexts it observed. Examples:

- `comment`: blog post comments, product reviews, page comments
- `item`: order line items, catalog items, CMS rows
- `media`: blog hero images, product gallery assets, downloadable files

Do not leave a generic entity label unexplained if the discovered data shows multiple
real-world meanings.

## Identity and deduplication rules

Be explicit about the difference between a **source ID** and a **Wix target ID**.

- Preserve the **source ID** in the migration artifacts, generated code, and any custom
  CMS collections needed for traceability and resume.
- Do **not** assume native Wix entity IDs can be client-assigned or preserved. For most
  Wix APIs, the target ID is server-assigned.
- When a target is a native Wix entity whose ID cannot be controlled by the client,
  the mapping plan must define a **crosswalk strategy**: store `sourceId -> targetId`
  in a dedicated CMS collection or equivalent durable artifact used for dedupe, resume,
  and relationship resolution.
- The canonical collection name for that crosswalk is **`ImportCrosswalk`**. If older
  notes or mappings call it `MigrationRefs`, normalize them to `ImportCrosswalk` rather
  than inventing a second side table.
- Only say an ID is "preserved" when the destination actually has a client-controlled
  field that stores the source ID. Otherwise say the source ID is **tracked** or
  **crosswalked**.

## Verifying Wix APIs

Confirm exact Wix entity/collection/field names before mapping a source field onto
them — never invent a Wix API or field name.

- **When the Wix MCP is available, verifying at write-time is mandatory.**
  Verify enum **values**, not just names: every `Field.type` you assign must be a real
  member of the Create Data Collection `Type` enum. (Common trap: there is no `SLUG`
  type — a slug maps to a `TEXT` field. Never assign a guessed enum value and flag it
  `unverified`; resolve it or omit it.)
- **When the Wix MCP is expected but missing, do not silently downgrade first.** First
  try to ensure the Wix MCP is installed/connected in the current runtime. If the
  environment supports connector/plugin install flows, use them. Otherwise halt to
  needs-user with exact instructions: install/connect the Wix MCP for Wix API docs/schema
  access, then resume this step.
- **Fallback when no Wix MCP is available is degraded mode, not the default path.**
  Use it only when the user explicitly asks for a provisional draft without the Wix MCP,
  or when an upstream orchestrator explicitly routed this step in provisional mode. In
  that mode, rely on published Wix REST/SDK documentation and conservative, known-good
  names. Mark anything you could not verify as `unverified` in the mapping plan so a
  human confirms it before execution.

## Runtime policy

Resolve ambiguous mappings using the documented default, record the decision and rationale
under "Unresolved questions" in `mapping-plan.md`, and keep going. Known fidelity forks
(e.g. comments anonymize vs. skip) should already be answered by the submission intake;
apply those answers rather than re-asking. If a required input is truly missing, surface it
as a blocker rather than silently guessing.

If the Wix MCP is missing and this run was **not** explicitly authorized as provisional,
halt instead of writing a lower-confidence mapping artifact.

If the source entity name is generic but the observed data disambiguates it, record that
disambiguation explicitly in the mapping plan. Do not force later stages to infer what
"comments", "items", or similarly broad labels meant in this specific migration.

## Faithfulness ledger (detect lossiness here, early)

The mapping stage is where lossiness and coverage gaps are *discovered*, so it is where
they must be *recorded* — not at execute time, which is too late to do anything but
report. Maintain a **faithfulness ledger** in `mapping-plan.md` listing everything that
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
import, citing **FR-006**. This is not optional discipline: the flag exists precisely so
the warning is data-driven. Do not map such a taxonomy without the ledger entry. (If
hierarchy must be preserved, the alternative is a CMS-collection taxonomy with a `parent`
reference field — note that trade-off in the ledger instead.)

This ledger is the source the execution-plan report draws from to surface "what we won't
do" to the user **before** consent (`rp-execute-import`). If it isn't recorded here, the
user can't be warned there.

## Mapping summary for user review

After `mapping-plan.md` is written, create `migrations/<project>/mapping-summary.md` as a
short review artifact for the user. Its purpose is to make the mapping decision easy to
review without forcing the user through the full plan.

The summary should:

- explicitly say that full details live in `mapping-plan.md`
- list each in-scope source entity and its planned Wix target
- call out the main gaps, lossy transformations, skipped entities, and `unverified`
  target paths from the faithfulness ledger
- mention the biggest setup implications the user should know now (for example: required
  Wix apps, required CMS collections, crosswalk collection, media reachability caveat)
- surface unresolved questions only when they materially affect whether the user should
  approve the mapping

Keep it concise. The user should be able to decide "yes, this is the right migration
shape" from this file alone, then consult `mapping-plan.md` only when they want detail.

Recommended structure:

- one-sentence purpose / pointer to `mapping-plan.md`
- `Source -> Wix targets`
- `Main gaps / lossiness`
- `Important setup implications`
- `Questions or risks to confirm`

Do not restate full field tables or detailed transformation rules here unless a specific
field-level issue is central to the approval decision.

## Mapping review checkpoint

Once both mapping artifacts exist, stop and ask the user to review
`migrations/<project>/mapping-summary.md`. The checkpoint should make clear:

- this is a semantic review of what will be migrated where
- the full technical detail remains in `mapping-plan.md`
- downstream setup discovery and code generation will wait for acceptance

Do not proceed to `rp-setup-discovery` or `rp-import-codegen` until the user accepts this
mapping review checkpoint, unless the user explicitly asks to continue provisionally.

## Guardrails

- Do not collapse multiple source concepts into one Wix field without documenting lossiness.
- Call out data that cannot be migrated faithfully — record it in the faithfulness ledger above.
- Do not describe a source entity only by a generic label when the observed data is more
  specific; name the concrete subtype(s) present in the project.
- Keep business rules explicit so `rp-import-codegen` can implement them deterministically.
- Do not produce a docs-only mapping artifact as the normal path when the Wix MCP
  prerequisite is missing. That mode must be explicitly marked provisional.

---
name: rp-ui-implementation
description: Implement a Wix Headless clone from generated source evidence.
---

# UI implementation

Load this resource only when `extraction/latest.json`, its frozen manifest, and the matching
`build/build-plan.json` exist and pass integrity verification. It owns implementation, not
final comparison or fix-loop acceptance.

Read `references/interaction-runtime-contract.md`,
`references/layout-blueprint-contract.md`,
`references/control-and-visual-fidelity-contract.md`, and
`references/ui-normalization-contract.md`.

Build only from frozen accepted or provisional specs named by the build plan. Do not read raw
observations or browse the source to fill gaps. When implementation exposes a missing fact,
create an owned extraction-gap request. Use remaining scoped recovery budget; after exhaustion
implement the reliable portion provisionally and continue unrelated units.

Build global CSS, tokens, exact local font declarations, and the shared chrome from frozen
specs first. Shared chrome includes every utility/promo bar, header, navigation, and footer.
The footer is a first-class implementation and QA unit even though it is normally represented
by `shared-chrome.spec.json` rather than a numbered section. Use exact logos and
materialized assets; never recreate branding as text. Preserve dropdown hierarchy, source
direction, header viewport footprint and scroll behavior, first-viewport visible copy, footer
information architecture, and control-state ownership (including pseudo-elements and nested
icons).

## Required section-by-section method

For the home route, create or refresh `docs/site-clone/build/section-implementation.json`.
It is keyed by the manifest and unit hashes and contains foundation, metadata, shared chrome,
recursive components, and sections in dependency order. Status is `implemented`, `verified`,
`provisional`, or `user-accepted`. Do not mark an entry verified from code inspection alone.

Implement exactly one entry at a time:

1. Read only that entry's frozen spec and its declared frozen dependencies.
2. Build one discrete clone root/component for that unit. Do not merge separate source bands
   into a generic parent section, and do not use a later source band's media or copy as a
   substitute for the current unit.
3. Match its canvas, background layers, container, semantic regions, relationships, text
   geometry, media role, and responsive reflow before decorative polish. Composition and
   background-media role are identity locks.
4. Apply the exact `data-rp-section` / `data-rp-layout` markers for numbered sections;
   use `data-rp-chrome` markers for shared chrome. Implement required scene markers and the
   public interaction bootstrap before optional motion.
5. Check the rendered unit at the captured desktop, tablet, and mobile viewports. Mark it
   `verified` only when it matches its source artifact closely enough to proceed; otherwise
   fix that same unit before beginning the next one.

After every entry is verified, run the full-page gap loop. Triage every finding to its owning
section or `shared-chrome` ledger entry and fix in that unit; never paper over an earlier
section mismatch with global styling or an unrelated section rewrite. Load the normalization
stylesheet only within its declared identity locks; it may improve local geometry and
accessibility but may not redesign source identity.

Use Astro for static/content-heavy UI and React only for useful interactive islands. Select
only pinned items from the local human-approved registry and record the decision/rejections in
`build/component-selection.json`. Deterministic selection matches the frozen component request
against the approved, hash-pinned capabilities and writes the resolved axes, slots, states,
composition, and `contractRef`. Read the selection artifact first. Only when it selects an item,
read that exact selected `contract.md` for concise binding/adaptation guidance. Do not scan the
registry or read capability JSON, approvals, licenses, component source, candidate reviews,
provenance, or live documentation for reasoning. When no item qualifies, use the bounded custom
builder. Never guess a nearby variation or fetch a floating registry dependency during a
migration.

Do not report the UI as complete after writing it, and never label a provisional unit verified.
Leave a runnable project and all runtime markers/contracts in place, then return to the root
supervisor for verification.

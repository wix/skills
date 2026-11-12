---
name: rp-source-evidence
description: Produce fresh browser-derived source evidence and implementation contracts for a headless clone.
---

# Source evidence

Load this resource only after project context is valid and when source evidence is missing
or stale. It owns extraction and generated planning artifacts; it does not implement the
clone.

Read `references/workflow.md`, `references/extraction-schema.md`,
`references/interaction-runtime-contract.md`,
`references/layout-blueprint-contract.md`,
`references/control-and-visual-fidelity-contract.md`, and
`references/ui-normalization-contract.md`.

Run `site-clone.mjs` using the active mode and refresh canonical `docs/site-clone/`
artifacts before generating new ones. Emit stage-level progress. Browser extraction is
mandatory: capture source screenshots at required viewports and use browser evidence for
shared chrome and first-viewport content, not SEO metadata or an HTML-only fallback.

Resolve the home page before capture. This resource implements home scope only; do not
accept explicit additional URLs or silently run the previous multi-page artifact flow.
An ambiguous or unreachable home identity is a global blocker with an exact unblock action.

Capture observations, then project and freeze the source-of-truth tree under
`docs/site-clone/extraction/<capture-id>/`: page resolution/capture, foundation, metadata,
shared chrome, recursively owned section/component specs, gap records, spec index, and the
immutable extraction manifest. Write `extraction/latest.json` as the stable pointer. The
builder receives only the manifest-derived build plan, never observations or the source.

Preserve evidence rather than inference: source `@font-face` tuples and files, exact logo
variants/rendered dimensions, structured navigation hierarchy, visible hero text, repeaters,
core interaction scenes and timelines, background-media roles, composition geometry, and
responsive behavior. Safe probing is public/unauthenticated and presentation-only; block and
record navigation, forms, commerce/account actions, mutation, and unclassified controls.

Local gaps never block unrelated units. Use at most two distinct targeted recovery attempts,
then freeze the affected dependency closure provisionally with explicit assumptions and
omissions. Only a global blocker prevents manifest freeze. Once the manifest passes integrity
verification, return to the root supervisor so it can load implementation instructions.

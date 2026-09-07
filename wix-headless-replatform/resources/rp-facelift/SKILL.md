---
name: rp-facelift
description: Apply an explicitly requested, identity-preserving UI/UX refinement after clone acceptance.
---

# Optional post-clone facelift

Load this resource only when `docs/site-clone/frontend-automation-state.json` records
`checkpoints.facelift.requested: true` and the migration website receipt is complete or
`done_with_gaps`. A `done_with_gaps` receipt must reference a finalized visual review and
the configured cycle cap. Never load it as part of ordinary cloning.

Invoke the installed `ui-ux-pro-max` skill for this pass. If it is unavailable, record a
specific `facelift` blocker with the required install/enable action; do not silently replace
it with an unconstrained redesign or claim the selected deliverable is complete.

Before changes, treat extracted brand colors/fonts/logos/assets, route plan, visible copy,
section order, core interaction contract, SEO, and dynamic data bindings as identity locks.
Preserve them. UI/UX Pro Max may improve hierarchy, spacing, responsive layout,
accessibility, component/control states, and restrained purpose-driven motion/interactions.
It must not change the brand, information architecture, page content, URLs, source assets,
or required core behavior.

Build and browser-test the changed site. Write `docs/site-clone/facelift-review.json` with
the request, changed routes/components, evidence that all identity locks were retained,
accessibility/interaction checks, before/after screenshot references, and an `accepted` or
`blocked` decision. For `done_with_gaps`, include the completion receipt and residual-gap
context; do not claim normal clone acceptance, visual parity, or resolution of those gaps.
Update `frontend-automation-state.json` facelift checkpoint to
`accepted` only after that review passes. Then return to the root supervisor so it can write
the completion receipt. In one-click mode the stored request authorizes this stage after the
gate; it does not waive the review.

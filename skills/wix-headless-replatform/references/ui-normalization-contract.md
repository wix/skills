# Identity-Preserving UI Normalization Contract

Use this contract after page sections and interaction scenes are extracted. It improves
implementation quality inside the source design; it is not a redesign step.

## Priority

Identity locks always outrank best-practice rules. Preserve:

- source content and section order;
- section kind/variant and layout archetype;
- source palette, typography, imagery, and media;
- CTA hierarchy;
- interaction primitive and state model.

Allowed normalization includes local spacing/alignment, repeated-item consistency,
responsive reflow inside the same archetype, subtle hover/focus feedback, eased state
transitions, accessibility, and reduced motion.

## Generated handoff

`ui-normalization.json` is the machine-readable source of truth.
`ui-normalization.md` is its compact implementation view. Load the neutral primitives once:

```html
<link rel="stylesheet" href="/site-clone/rp-ui-normalize.css">
```

Each section must use its exact `data-rp-section` and `data-rp-layout` markers. Repeated
components use `data-rp-item`, `data-rp-media`, `data-rp-body`, and `data-rp-action` as
declared. Use `data-rp-motion="micro"` for hover/focus feedback and
`data-rp-motion="state"` for click/activation transitions.

## Repeated cards

When source evidence says peer cards share a height:

- set `data-rp-equal-height="true"` on the collection;
- set `--rp-item-block-size` to the extracted shared height;
- allow active state to change inline size but not block size unless evidence says it does;
- reserve a stable media region and let the body fill remaining space;
- align equivalent actions to the same block edge;
- keep rail overflow local to its viewport.

Do not solve long content by hiding source text. Reflow or adjust internal regions while
keeping peer geometry and content intact.

## Motion hierarchy

Hover and focus are micro-interactions. Prefer color, shadow, opacity, or a small transform;
do not unexpectedly reflow siblings. Click and activation may expand a card, reveal a panel,
or scroll only when the interaction contract requires it.

Captured transition timing overrides defaults. Without captured timing, micro motion uses
140–240ms and state motion uses 240–600ms with eased timing. Rapid actions may cancel an
animation, but final semantic state, focus, and content must remain correct. A
`prefers-reduced-motion` rule must expose that final state without non-essential interpolation.

## Verification

`verify-interactions.mjs` reads the normalization contract when present. Its report checks:

- section markers;
- page-level horizontal overflow;
- reduced-motion CSS availability;
- declared repeated-item height spread;
- whether activation preserves block size.
- whether hover preserves peer layout and marked motion uses non-zero easing.

Fix every failed normalization check before reporting completion.

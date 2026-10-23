# Section Layout Blueprint Contract

`layout-blueprint.json` is the source of truth for how every section is composed. It sits
between source/scene extraction and UI normalization. Implement one section at a time in
this order:

1. canvas width, height, positioning context, overflow, and pinning;
2. ordered background layers (`base`, `media`, `scrim`, `decoration`);
3. foreground container;
4. semantic regions and their normalized rectangles;
5. important text geometry, observed line count, and wrapping policy;
6. region relationships and responsive reflow;
7. interaction mechanics, then UI normalization.

## Controlled vocabulary

Use the vocabulary embedded in the artifact. Composition is one of `layered-overlay`,
`split`, `stack`, `grid`, `rail`, `scroll-narrative`, or `freeform`. Background is `none`,
`color`, `gradient`, `image`, `video`, or `composite`. Regions use roles such as `heading`,
`body-copy`, `media`, `action`, and `tabs`, with a nine-position placement anchor.
Text wrapping uses `single-line`, `wrapped`, or `clipped-or-overflowing`.

The terms make implementation consistent; normalized rectangles preserve distinctive
source geometry. Do not replace the measurements with a generic layout merely because its
name sounds similar.

## Identity rules

- Composition, background-media role, layer order, and declared relationships are identity
  locks.
- `layered-overlay` and `scroll-narrative` media must not become a peer column beside copy.
- `fallback-only` posters disappear when primary video/iframe media is ready.
- Scene evidence overrides static DOM evidence for animated or pinned phases.
- A measured single-line desktop heading must remain one line at the canonical desktop
  viewport; preserve its inline-size constraint before adjusting typography.
- Responsive reflow may stack a declared split, but it must retain content hierarchy and
  media role.

New best-practice rules should consume this artifact from UI normalization. Extend
`scripts/lib/layout-blueprint/` classifiers or vocabulary independently; bump the vocabulary
version when controlled terms change.

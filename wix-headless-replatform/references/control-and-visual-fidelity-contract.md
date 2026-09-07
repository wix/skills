# Control and Visual Fidelity Contract

This layer sits beside the scene and layout contracts. It is deliberately modular:

- `control-state-contract.json` owns representative control states and transition owners;
- `visual-assets.json` owns identity-bearing logos/icons, their variants, usage, and size;
- `layout-blueprint.json` owns text geometry and wrapping;
- `scene-contract.json` owns initial interactive state, item separation, and motion scope.

## Control terminology

Use `rest`, `hover`, `focus-visible`, `pressed`, `activated`, `current`, and `disabled`.
Implement the recorded delta on the element that owns it: target, `::before`, `::after`, or
nested icon. Source-observed states outrank normalization defaults. If source focus evidence
is absent, add a perceivable `:focus-visible` treatment without replacing source hover or
current styling.

## Text geometry

Important text records include `inlineSize`, `blockSize`, `lineCount`, `wrapPolicy`,
`maxWidth`, `fontSize`, and `lineHeight`. At the canonical desktop viewport, a captured
`single-line` heading is an identity lock. Match its container width before shrinking type.

## Stateful collections

Respect `initialState` and `initialActiveIndexes`. `all-collapsed` means no item may be
opened during runtime initialization. Reproduce `separation.mechanism`: it distinguishes
track gaps, geometric gaps, margins, dividers, inner insets, and flush items.

## Motion ownership

`data-rp-visual` marks the measured visual transform owner. `data-rp-content` marks copy
whose geometry is verified separately. Never nest static content inside a scaling visual
wrapper unless source evidence explicitly says the content scales.

## Logos and icons

Logo priority is exact source file or materialized source SVG. Preserve all observed
variants and usage sizes. Never recreate a logo as text or substitute a library mark.

Icon priority is exact source asset, then the source sprite/library, then a style-matched
established library such as Iconify. Library fallback is only allowed when no source icon
exists and never applies to logos.

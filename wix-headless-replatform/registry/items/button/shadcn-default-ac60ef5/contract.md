# Button contract

Read this file only after `component-selection.json` selects
`button@shadcn-default-ac60ef5`. The approved `capabilities.json` is the machine
authority; this file explains how to bind and adapt those declared capabilities.
Do not inspect candidate reviews, upstream snapshots, or live documentation
while building a site.

## Use when

Use this primitive for a native button or anchor whose extracted contract can be
represented by the selected `variant`, `size`, and composition. Preserve the
source action, label, URL, icon, disabled state, and accessible name exactly.

Do not use it for a toggle, disclosure, menu trigger with managed state, loading
control, or grouped-control behavior unless separately approved components own
those contracts.

## Axes

- `variant`: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`.
- `size`: `default`, `sm`, `lg`, `icon`.

Use the exact resolved values from `component-selection.json`. Do not infer a
new value from current shadcn documentation or substitute the nearest variation.

## Compositions

- `text`: bind the exact visible label.
- `leading-icon`: bind an approved/source-backed icon before the label.
- `trailing-icon`: bind an approved/source-backed icon after the label.
- `icon-only`: bind an icon and an evidence-backed accessible name; omit visible
  label text only when the source is genuinely icon-only.
- `as-link`: render a native anchor through `asChild` and preserve its exact
  `href` and label. Do not turn navigation into a button action.

## Adaptation boundary

Foundation tokens may change colors, radius, typography, and spacing to match
the frozen source spec. Local layout may position the control. Do not remove
native semantics, disabled behavior, keyboard focus, the forced-colors outline,
or the accessible name. Do not add hydration to this statically rendered item.

## Unsupported

The following require another approved primitive or the bounded custom path:
loading spinners, button groups, client-managed toggles, and any axis value or
composition absent from the approved capability manifest.

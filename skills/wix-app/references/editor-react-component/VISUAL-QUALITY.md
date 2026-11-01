# Visual Quality

Use this reference for a component's default look: hierarchy, spacing, and
foreground/background contrast.

**Visual intent.** When the request specifies how the component should look —
mood, palette, layout style, or a reference — follow that direction; for code,
a design, or images the user supplies, follow `USER-SOURCES.md`. Default to a modern, refined look — intentional layout, pleasing proportions, polished and deliberate styling.

## Design Concept

Before writing CSS, decide in one sentence how the component should feel for
its subject. When the component is themed, the Balanced level of
`BRANDED-COMPONENTS.md` supplies identity by default; the component supplies
its shape. A requested own look keeps the same composition, spacing,
contrast and interaction quality with its own palette; brand font families
and buttons stay unless they clash with that look.

### Quality Floor

Every component:

- Real controls, never bare browser defaults: unless a native dropdown is
  requested, two to five choices become segments, cards, tiles or ruled rows;
  fields are 48px or taller; steppers for small counts. A requested native
  control still takes the field role, spacing and focus treatment of the
  component's styling.
- A star rating draws empty stars as outlines and chosen ones filled in the
  accent, never color alone; arrow keys move the choice, as in a radio group.
  Keep stars on one row; move Clear below when space is tight.
- One focal point: the key value, open item or featured entry. A title is
  optional; when present it does not outrank the main content.
- Several components in one request: build each to this guide, one at a time,
  in its own folder with no shared helper files.
- A new component's defaults look finished: real names, figures and three to
  six items from the request's subject, never an empty list, "Item 1" or a
  one-line body. An empty view is a state, not the default. Edits keep the
  existing copy.
- In a themed component, new conventional actions use a complete primary,
  secondary or tertiary button token set, radius and fill/ink pair included;
  otherwise they share one coherent button style. Separate accents and progress
  use the theme's action color when themed (`BRANDED-COMPONENTS.md`), or the
  component's own accent otherwise; never derive a text-bearing fill from an
  arbitrary accent or its tint.
  Honor Styling Scope and Character-led exceptions in `BRANDED-COMPONENTS.md`.
  Selection uses a readable fill and a label, icon or shape cue.
- Themed titles keep their token tracking; custom titles take tight tracking.
  Money and counts use
  `font-variant-numeric: tabular-nums`.
- Line icons drawn inline as SVG where they carry meaning for the subject; no
  decorative step numbers.
- Previous/next arrows are inline SVG in `currentColor`, not text characters.
  Their button keeps its `aria-label` (`ACCESSIBILITY.md`) and also holds a
  visually hidden, `aria-hidden` copy of it: a button with text gets the Color
  control that recolors the arrow (`--icon-*` there would move to the root,
  since previous/next render twice).
- A decorative text mark (a quote mark, an ornament, a symbol) is not text.
  It is an `aria-hidden` named `span` part (`PARTS.md`) whose font and size
  are chosen for its role, theme or not, with `line-height: 1` and no fixed
  height: the one named text part exempt from `BRANDED-COMPONENTS.md`'s
  unmodified font token. Real text keeps its theme token.
- Wrap content in a card only when grouping helps the task; insets share its
  edges. Open sections are fine.
- Sizes follow the token-by-role table in `BRANDED-COMPONENTS.md` (its sizes
  only, without tokens, when not themed), at card scale and step up from
  `@container (min-width: 900px)`; the frame, padding and grid sit on an inner
  element, since `@container` styles only descendants.
- When the root carries the component's background or card, its padding and
  the frame sit on the root, so Background and Padding edit them; the 900px
  step-up then measures the width inside that padding. Otherwise both stay on
  the inner element.
- Text on a filled panel, muted details included, uses that panel's text
  color; a chip or avatar there inverts the pair instead of tinting it.

### Composition

These rules describe the initial width; reflow at narrow widths per
`OVERFLOW.md`.

- A form is a coherent column of labelled fields and one aligned action row;
  group related fields, and let the action span the column when narrow.
- An accordion gives readable questions generous toggle targets, separates
  rows with space or rules, and insets an open answer.
- A quote pairs a readable text measure with its author. Put its font (the theme
  font when themed) on the named quote part.
- A standalone action is the root, with its effect positioned inside it.
  Preserve native semantics and SDK callbacks instead of adding a wrapper.
- A default action (a card's call to action, a form's submit) always renders
  at full strength: an `<a>` when it has a link, else a native `<button>` in
  the same style. An empty link never fades it or swaps it for a `<span>`; an
  action that is really unavailable renders a native `<button disabled>`, even
  when it has a link, since `<a>` ignores `disabled` (`DISABLED-INVALID.md`).
- A new component's `initialSize.width` fits the composition: a lone button 160–280px, a card
  or quote 340–420px, a form 400–520px, tabs, a list or an accordion
  560–720px, a grid, schedule or slider 980px or wider. Never keep the
  scaffold's 250px for anything with rows or fields.
- A hero needs a deliberate visual anchor and relationship to its text. Choose
  the reading rhythm and media treatment for its subject; do not make every
  hero a split or text-over-photo layout. Keep ring wrappers transparent so
  their strokes remain visible.
- Keep grid rows full: three items take three columns, or one featured item and
  two; never a lone last card.
- A single card or form uses its space deliberately. When it has a featured
  value and enough room, split it up to 880px wide with that value beside the
  details. Otherwise keep one coherent layout; never invent a value or panel.
- A carousel track starts flush with its container; only the trailing card is
  cut. Its arrows and play/pause sit together in the header row.
- Default copy matches the default images (`COMPONENT-CONTRACT.md` says what
  each pool image shows); text on a photo sits on a dark scrim.
- Headings and labels fit their column without breaking inside a word;
  headings use `text-wrap: balance` and step down in a narrow column, and
  segments that do not fit stack. In a selectable row, move the price or
  secondary detail below the name before fixed padding and controls squeeze
  the copy. A page with no sideways scroll can still have an unusable layout.

A component that owns its palette uses its own colors. Small accent text
passes contrast only on the page background; on a filled surface give it the
paragraph color.

## Default Visual Quality

Create a clear hierarchy with at least two techniques that fit the component:
a defined surface, border or soft shadow, type scale or weight, spacing, an
accent, or visible interaction states. Keep these minimums unless the request
or existing design provides better values:

- 16px or larger body text, 14px or larger labels, and 600–700 weight for titles
- 8–16px spacing inside controls and 16–32px spacing inside containers
- control radii from the selected theme button variant when themed, or the
  component's own coherent styling otherwise; `50%` for circular media
- a subtle border or soft shadow when a card, panel, or control needs separation;
  a surface on a same-color surface needs a different fill, a shadow or a border
- touch targets at least 44 by 44px and visible keyboard focus states

Theme tokens do not waive the size, spacing, target and contrast limits;
themed titles keep the theme's weight.

### Foreground and Background Ownership

If the component is a self-contained block (card, panel, banner, accordion item), give the root a background. An inline control meant to blend in (link, ghost button, icon button) may leave it transparent.

- On a transparent root, don't hardcode text or icon colors; inherit them from the parent.
- Set the background and main text/icon color together on the same element. Any secondary text (captions, hints, icons) must still be readable against that same background.
- If an interactive state changes the background, set the foreground color in that state too. Don't assume a color inherited from a parent or from a previous state will still look right on the new background.
- In every default and interactive state, meet WCAG AA contrast: 4.5:1 for body text and 3:1 for large text and UI controls.

A neutral owned surface may use a light background with dark primary and
secondary foregrounds, plus one accessible accent. The exact colors are not a
contract; the contrast relationship is.

## Checklist

- [ ] Visual containers have deliberate hierarchy rather than bare scaffolding.
- [ ] The patterns fit the content, and the Quality Floor holds.
- [ ] One named signature move is visible at first glance.
- [ ] Every explicit foreground has a known contrasting background; transparent
      components inherit foregrounds from their host.

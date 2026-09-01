# Design States

Use this reference when a named part changes appearance through interaction or
a selectable value. A design state styles an element differently for an
eligible interaction (`hover`, `focus`, `disabled`, `invalid`) or per a
selectable value in its data (`selected`, `active`, `open`, …). Author states
in the component's `.tsx` and `.module.css`.

## Contents

- [Choose Supported States](#1-choose-supported-states)
- [Name the State Class](#2-name-the-state-class)
- [Author CSS](#3-author-css)
- [Wire React](#4-wire-react)
- [Use Prop-Triggered States on the Root Only](#5-use-prop-triggered-states-on-the-root-only)
- [Checklist](#checklist)

## 1. Choose Supported States

| Element | Author these states |
|---|---|
| Interactive — `button`/`a`/`input`/`select`/`textarea`/`summary`, an interactive `role`, or an interactive handler (`onClick`/`onMouseEnter`/`onFocus`/…) | `hover` |
| Input field — `select`/`textarea`; `input` except `hidden`/`button`/`submit`/`reset`/`image`; or an input-widget `role` (`checkbox`/`radio`/`switch`/`slider`/`spinbutton`/`textbox`/`searchbox`/`combobox`/`listbox`) | `focus` |
| Other interactive element whose editable focus appearance the user explicitly requests | `focus` |
| Disableable — `button`/`input`/`select`/`textarea`/`fieldset` or a disableable role | `disabled` (+ `invalid` for `input`/`select`/`textarea`) |
| Has a selectable/variant value in its data — `selected`/`active`/`current`/`open`/`expanded`/`checked`/`featured` | that custom state |
| None of the above | no states — resting style only |

An explicit `role` overrides the tag's implicit semantics: `<input role="button">`
is a non-input control, while `<div role="checkbox">` is an input field.

A `focus` design state is an editor styling control, not the keyboard focus
indicator itself. Do not add a global `--focus` modifier to a non-input control
unless the user explicitly requests editable focus styling. A control that
restyles its own outline, background, or border must still carry a standalone
`:focus-visible` rule as its keyboard affordance.

A custom state may also be driven by a root-level boolean prop (e.g.
`isFeatured`) instead of by markup or item data — see §5. For an active-item
component, drive each item's `--active` class by comparing its index with the
active-index prop rather than storing a per-item boolean.

## 2. Name the State Class

Flat: the element's own global class + `--<state>`. Because inner-part
global classes are prefixed with the component name, the state class is prefixed too —
e.g. `pricing-card-cta--hover`, `pricing-card-plan-row--selected`. Never bare
(`cta--hover` would collide with other components on the page) and never
nested (`card__row--selected`).

## 3. Author CSS

Put the resting value in the bare class; put only the state override in the
state selector.

- **Native design state** — pair the pseudo-class with the `:global` modifier.
  Every exposed native state needs both selectors in the same rule; do not
  split the pair across states. A standalone `:focus-visible` accessibility
  rule on a non-input control is not an editor design state and has no global
  modifier.
- **Custom** — the `:global` modifier alone.

The bare selector is the short **module** class (`.cta`); the `:global(...)`
state class is the **prefixed** global one.

```css
.cta {
  background: #6366f1;
} /* resting */
.cta:global(.pricing-card-cta--hover),
.cta:hover {
  background: #4f46e5;
}
.cta:global(.pricing-card-cta--disabled),
.cta:disabled {
  opacity: 0.5;
}
.cta:focus-visible {
  outline: 2px solid currentColor;
} /* keyboard indicator only; not an editor design state */
.plan-row:global(.pricing-card-plan-row--selected) {
  border-color: #6366f1;
}
```

## 4. Wire React

- **Native** — render the correct interactive element (`<button>`, an
  interactive `role`, or a handler). No custom state class is needed, but the
  element must still satisfy the accessibility contract for its semantics.
- **Custom** — toggle the global state class from the element's data.
- **Inner elements** — every named inner element gets an `elementProps` entry;
  spread it so editor-driven states reach it. On a raw HTML element also merge
  `elementProps?.<key>.className` inline; on a skill-built sub-component the
  spread alone suffices (it merges `className` itself). The `elementProps` key
  stays the **short** part name (`cta`) even though the element's global class
  is prefixed (`pricing-card-cta`) — don't rename the key to match the class.

Wire native and custom states as follows:

```tsx
<button
  type="button"
  {...elementProps?.cta}
  className={classNames('pricing-card-cta', styles.cta, elementProps?.cta?.className)}
>
  {label}
</button>

<li
  {...elementProps?.planRow}
  className={classNames(
    'pricing-card-plan-row',
    styles.planRow,
    row.selected && 'pricing-card-plan-row--selected',
    elementProps?.planRow?.className,
  )}
>
  {row.label}
</li>
```

## 5. Use Prop-Triggered States on the Root Only

A **prop-triggered** state is a custom state switched by a single boolean
**prop**, rather than by interactive markup (native) or a per-item data flag
(class-triggered). Use it only when one component-level boolean should flip the
whole component's appearance — e.g. `isLoading`, `isFeatured`.

Mark the prop with the `ElementState<boolean>` type from
`@wix/react-component-utils`. It is an identity alias — the prop still behaves
as a plain `boolean` at runtime and stays a normal boolean in the component's
data — but the manifest generator detects the marker and emits a custom state
on the **root element**.

```tsx
import type { ElementState } from '@wix/react-component-utils';

export type PricingCardProps = {
  // …other props…
  isFeatured?: ElementState<boolean>;
};
```

Rules:

- **Boolean only, root only.** A prop trigger always attaches to the component
  root — never to an inner element. Inner-element states must be native or
  class-triggered (§1–§4).
- The state name is the prop name in **kebab-case** (`isFeatured` →
  `is-featured`; no `is`/`has` stripping). The manifest records
  `props: { isFeatured: true }` as the trigger.
- To give the state styling, pair the root's **module** class with a prefixed
  `:global(.<component-name>--<state>)` rule. With a matching class the manifest
  entry carries that `className`; with none it is props-only (the editor still
  toggles the prop, but nothing restyles).

```css
.pricingCard:global(.pricing-card--is-featured) {
  border-color: #f5a623;
}
```

Prefer a native state (interactive markup) or a class trigger (per-item data
such as `row.selected`) whenever one fits — those are the common cases and work
at any depth. Reach for a prop trigger only for a root-level boolean switch.

## Checklist

- [ ] Each named part declares only states its semantics or data supports.
- [ ] Eligible native design-state selectors pair the pseudo-class with the
      prefixed global modifier.
- [ ] Non-input controls retain a standalone `:focus-visible` keyboard indicator.
- [ ] Custom state classes are flat, global, and prefixed by component and part.
- [ ] Named inner parts spread and merge their `elementProps` entry.
- [ ] `ElementState<boolean>` is used only for a component-level root state.

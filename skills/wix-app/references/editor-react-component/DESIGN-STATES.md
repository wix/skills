# Design States

A design state styles an element differently per interaction (`hover`,
`focus`, `disabled`, `invalid`) or per a selectable value in its data
(`selected`, `active`, `open`, …). Author states in the component's `.tsx`
and `.module.css`.

## 1. Which states each element supports

| Element | Author these states |
|---|---|
| Interactive — `button`/`a`/`input`/`select`/`textarea`/`summary`, an interactive `role` (`button`/`link`/`tab`/`switch`/`checkbox`/`radio`/`menuitem`/`option`), or an interactive handler (`onClick`/`onMouseEnter`/`onFocus`/…) | `hover`, `focus` |
| Disableable — `button`/`input`/`select`/`textarea`/`fieldset` or a disableable role | `disabled` (+ `invalid` for `input`/`select`/`textarea`) |
| Has a selectable/variant value in its data — `selected`/`active`/`current`/`open`/`expanded`/`checked`/`featured` | that custom state |
| None of the above | no states — resting style only |

A custom state may also be driven by a root-level boolean prop (e.g.
`isFeatured`) instead of by markup or item data — see §5.

## 2. Name the state class

Flat: the element's own global class + `--<state>`. Because inner-part
global classes are prefixed with the component name (see
[`CSS-GUIDELINES.md`](CSS-GUIDELINES.md)), the state class is prefixed too —
e.g. `pricing-card-cta--hover`, `pricing-card-plan-row--selected`. Never bare
(`cta--hover` would collide with other components on the page) and never
nested (`card__row--selected`).

## 3. CSS

Put the resting value in the bare class; put only the state override in the
state selector.

- **Native** — pair the pseudo-class with the `:global` modifier.
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
.cta:global(.pricing-card-cta--disabled) {
  opacity: 0.5;
}
.plan-row:global(.pricing-card-plan-row--selected) {
  border-color: #6366f1;
}
```

## 4. React

- **Native** — render the correct interactive element (`<button>`, an
  interactive `role`, or a handler). Nothing else needed.
- **Custom** — toggle the global state class from the element's data.
- **Inner elements** — every named inner element gets an `elementProps` entry;
  spread it so editor-driven states reach it. On a raw HTML element also merge
  `elementProps?.<key>.className` inline; on a skill-built sub-component the
  spread alone suffices (it merges `className` itself). The `elementProps` key
  stays the **short** part name (`cta`) even though the element's global class
  is prefixed (`pricing-card-cta`) — don't rename the key to match the class.
  See [`COMPONENT-API.md`](COMPONENT-API.md).

```tsx
<button
  type="button"
  {...elementProps?.cta}
  className={classNames('pricing-card-cta', styles.cta, elementProps?.cta?.className)}
>
  {label}
</button>

<li className={classNames('pricing-card-plan-row', styles.planRow, row.selected && 'pricing-card-plan-row--selected')}>
  {row.label}
</li>
```

## 5. Prop-triggered states (root only)

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


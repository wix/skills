# Design States

Wire **design states** into an Editor React component's source files so the Wix editor surfaces a state-switcher in the design panel (Hover, Focus, Disabled, Invalid, Selected, custom keys) and applies the user's state styling on top of the component's defaults.

A design state is declared via **two source signals** the editor / manifest extractor reads together:

1. **CSS pairs** in the component's CSS module — a pseudo-class (or state attribute) selector **and** a matching BEM modifier class (`.<component>--<state>` for the root, `.<component>__<element>--<state>` for inner elements) on the same base element.
2. **TSX markers** on the rendered element — `aria-checked`, `aria-selected`, `aria-disabled`, `aria-invalid`, or `data-state="<key>"`.

Both signals are required for non-pseudo keys (`disabled`, `invalid`, `selected`, custom). `hover` and `focus` only need the CSS pair — pseudo-classes fire natively from native pointer / focus events.

`npx wix generate manifest` reads the paired CSS rules + the rendered TSX attributes and emits the manifest `states` block. **Never hand-write the `states` block into the manifest — the generator is the only writer.**

> ⚠️ This is the **exception** to the "platform owns state styling" rule called out in [`CSS-GUIDELINES.md`](CSS-GUIDELINES.md) and [`REACT-PATTERNS.md`](REACT-PATTERNS.md). For components that opt into design states using the contract below, the component declares the state surface (paired rules + ARIA / data-state markers) and the platform layers the user's state styling on top via the `<component>--<state>` modifier class. For everything else, the no-state-CSS rule still applies.

---

## CSS signal (in `<ComponentName>.module.css`)

For each state on a given target, write a paired selector rule with sensible default styling. Because the project uses CSS Modules, the `.<component>--<state>` class must be wrapped in `:global(...)` so it stays unhashed — the editor injects the literal class name (e.g. `profile-card--hover`, `profile-card--disabled`) onto the DOM at runtime, and the generated manifest references that literal string.

```css
.root:hover,
.root:global(.<component>--hover) {
  /* populated default styling — see Default styling */
}
```

- **Native keys** (`hover` / `focus` / `disabled` / `invalid`) emit both the pseudo-class (or state attribute) **and** the `:global(.<component>--<state>)` modifier class. These map 1:1 to `NATIVE_STATE_TYPE` from `@wix/react-component-schema`.
- **Custom keys** (`selected`, `featured`, anything else) emit only the `:global(.<component>--<state>)` modifier class (no pseudo-class):
  ```css
  .root:global(.<component>--selected) {
    /* populated default styling */
  }
  ```
- The state suffix follows `--` verbatim in kebab-case — `hover` → `--hover`, `in-progress` → `--in-progress`. No casing transform.
- `<component>` is the component's public block class (kebab-case, e.g. `profile-card`, `button`, `accordion-component`). For inner-element targets the modifier class is `<component>__<element>--<state>` (e.g. `.toggle__thumb--selected`).
- The base class (`.root`, `.thumb`, …) is the CSS-Module class applied to the same element that carries the TSX markers. See [Picking the base class](#picking-the-base-class).

### Picking the pseudo-class for `disabled` and `focus`

The pseudo-class chosen depends on the rendered root element. Picking the wrong one means the rule never matches in the live site.

| Rendered root | `disabled` pseudo | `focus` pseudo |
|---|---|---|
| Native form element (`<input>`, `<button>`, `<select>`, `<textarea>`) | `:disabled` | `:focus-visible` |
| `<label>` wrapping an input (Switch / Checkbox library primitive) | `[aria-disabled='true']` | `:focus-within` |
| Generic element with `role` + `tabindex` | `[aria-disabled='true']` | `:focus-visible` |
| Anything else | `[aria-disabled='true']` | `:focus-visible` |

`:disabled` and `:focus-visible` only match on native form elements (or a `<label>`'s child input). Choose the right selector for the actual rendered tag.

---

## TSX signal (in `<ComponentName>.tsx`)

For each state on a given target, add the matching attribute on the JSX element that carries the base class. Some libraries emit equivalent attributes automatically when you set their props (`isSelected`, `isDisabled`), but write the markers explicitly anyway so the manifest generator can read them as deterministic signals.

| State | TSX marker | Notes |
|---|---|---|
| `disabled` | `aria-disabled={isDisabled \|\| undefined}` | Ensure the component's props interface has an `isDisabled` (or detected equivalent) `boolean` prop; add it if missing. |
| `invalid` | `aria-invalid={isInvalid \|\| undefined}` | Add an `isInvalid` prop if missing. |
| `selected` (switch / checkbox role) | `aria-checked={isSelected \|\| undefined}` | Use when the rendered element has `role="switch"` / `role="checkbox"` (native `<input type="checkbox">` or library primitive that sets it). |
| `selected` (tab / option / treeitem / gridcell / row / columnheader / rowheader role) | `aria-selected={isSelected \|\| undefined}` | Use when the role permits `aria-selected`. |
| `selected` (anything else) | `data-state={isSelected ? 'selected' : undefined}` | Fallback when neither `aria-checked` nor `aria-selected` fits the role. |
| custom key (`featured`, `in-progress`, …) | `data-state={state}` where `state` reflects the current key | One `data-state` attribute per target; comma-joined when more than one custom state is active (`data-state="selected,featured"`). |
| `hover` / `focus` | no TSX change — pseudo-classes fire natively. | |

These markers are what the manifest generator keys off — see [How the manifest gets generated](#how-the-manifest-gets-generated).

---

## Default styling

Write **real default styling** for each state — never empty bodies. The site owner can override every value in the editor; defaults exist so the state is visibly distinct on stage out of the box.

| State | Default styling |
|---|---|
| `hover` | `filter: brightness(1.05);` |
| `focus` | `outline: 2px solid currentColor; outline-offset: 2px;` |
| `disabled` | `opacity: 0.5; pointer-events: none; cursor: not-allowed;` |
| `invalid` | `outline: 2px solid #d32f2f; outline-offset: 2px;` |
| `selected` | `filter: brightness(0.95); font-weight: 600;` |
| Other custom keys | `filter: brightness(0.95);` |

Chosen so they:
- Don't depend on theme colors (work against any background).
- Are minimal — not the component's *intended* design, just enough that the state is visibly distinct on stage.
- Don't break layout (no padding / margin / size changes).

For inner elements with their own role (e.g., interactive list items), the same defaults apply against the inner element's base class.

---

## Picking the base class

The state-switcher in the design panel injects `<component>--<state>` (or `<component>__<element>--<state>` for inner elements) onto the rendered element. The paired CSS rule's prefix must be a class that lives on that same element. Read the JSX `className` composition; pick by case:

| Case | When | Base class |
|---|---|---|
| A | Self-rendering component — `styles.root` on the outer element | `.root` |
| B | Wraps a library primitive (e.g. React Aria `<Switch>`) — different `styles.X` lands alongside the unscoped global string (e.g. `styles.button` + `'button'`) | `.<the local class>` (e.g. `.button`) |
| C | Inner named part (`heading`, `label`, `thumb`, …) | `.<part>` — the local class on the inner element |

Inner-element TSX markers are limited to `data-state` / `aria-selected` / `aria-checked`; `aria-disabled` / `aria-invalid` inverted-prop wiring belongs on the component **root**.

---

## What states each component should support

Read the component's React + props to infer which states each target should carry.

### Role → suggested states

| Role | Suggested states |
|---|---|
| Form control with `disabled` semantics | `hover`, `focus`, `disabled` |
| Form input with validation | `hover`, `focus`, `disabled`, `invalid` |
| Clickable interactive control (button, link, card with click) | `hover`, `focus` |
| Self-contained interactive surface (handles its own UX internally) | no states on root |
| Decorative / pure-display (line, divider, static image) | no states |
| Container of interactive children (states live on the children, not the container) | no states on root |

If a component has a discriminating prop (`isSelected`, `variant`, `featured`) that controls a meaningful visual variant, add a matching custom state (typically `selected`).

### Per-state relevance

Native states map 1:1 to CSS pseudo-classes. Available native keys come from `NATIVE_STATE_TYPE` (`@wix/react-component-schema`): `hover`, `focus`, `disabled`, `invalid`.

| State | Suggest when… | Don't suggest when… |
|---|---|---|
| `hover` | the component reacts visually to mouse-over (button feedback, hoverable card, menu item highlight). | the component is decorative, a host surface, or interactivity is delegated to children. |
| `focus` | the component is keyboard-targetable (natively focusable or `tabindex`-ed). | the component isn't focusable — `:focus-visible` will never match on the live site. |
| `disabled` | the component has a UX concept of "off / not interactable" (`isDisabled` prop or similar). | the component has no off-state. |
| `invalid` | the component accepts user input that can be validated. | the component is not a form control. |

### What is NOT a state signal

These look related but don't indicate design-state need:

- Event-handler props (`onClick`, `onMouseEnter`, `onFocus`) — those signal "developers can listen for events", not "the component has a visual state when hovered/focused."
- Generic motion / animation props (`isAnimated`, `transitionDuration`) — orthogonal to the state surface.

### Inner-element rules

Many components carry per-child states more than root states:

- An inner element rendering a list of interactive sub-items (links, cards, list items) → infer **`hover`, `selected`** on the item.
- An inner element rendering an action button (close, navigation, expand) → infer **`hover`** (and `disabled` if the React renders a disabled state for it).
- An inner element that's structural (positions / groups its children) → infer **no states**.

---

## Key collision rule

If a state's CSS rule already exists in the module (any selector that targets `<base>:<pseudoClass>` or `<base>:global(.<component>--<state>)`), **leave it alone**. Existing wins — no merge, no overwrite.

Same rule applies to the TSX side: if the target element already has the matching `aria-*` or `data-state` attribute, leave it alone.

---

## Procedure

Apply immediately after `<ComponentName>.tsx` + `<ComponentName>.module.css` exist. The manifest does **not** need to exist yet — `npx wix generate manifest` reads the source signals and produces the `states` block later.

1. **Infer the state list per target** (§ [What states each component should support](#what-states-each-component-should-support)). Root from JSX + props; inner elements from each named part inside the component.

2. **Resolve the base class and rendered tag per target.** Cases A–C for the base class. Rendered tag (`<input>` / `<button>` / `<label>` / generic) drives `:disabled` vs `[aria-disabled='true']` and `:focus-visible` vs `:focus-within` per § [Picking the pseudo-class](#picking-the-pseudo-class-for-disabled-and-focus).

3. **Patch the CSS.** For each inferred state on each target: build the paired selector (`<base>:<pseudo>` + `:global(.<component>--<state>)`, or `:global(.<component>__<element>--<state>)` for inner elements), populate with default styling (§ [Default styling](#default-styling)), append. Collision check on `<base>` + key — skip silently. No comments.

4. **Patch the TSX.** Per § [TSX signal](#tsx-signal-in-componentnametsx) — for native gated keys (`disabled` / `invalid`), add the matching inverted prop (`isDisabled` / `isInvalid`) to the props interface if missing. For inner elements, only `data-state` / `aria-selected` / `aria-checked` apply. Collision check on the attribute. No comments.

5. **Regenerate the manifest.**
   ```
   npx wix build && npx wix generate manifest
   ```
   The generated `<ComponentName>.generated.ts` now contains a `states` block. **Do not hand-edit it.**

---

## How the manifest gets generated

`npx wix generate manifest` reads the source signals you wrote and emits the manifest `states` block in this shape:

```ts
import { NATIVE_STATE_TYPE } from '@wix/react-component-schema';

// Example for a Button component (block name 'button'):
states: {
  hover: {
    displayName: 'Hover',
    className: 'button--hover',
    pseudoClass: NATIVE_STATE_TYPE.hover,
  },
  disabled: {
    displayName: 'Disabled',
    className: 'button--disabled',
    pseudoClass: NATIVE_STATE_TYPE.disabled,
    props: { isDisabled: true },
  },
  selected: {
    displayName: 'Selected',
    className: 'button--selected',
  },
}
```

The deterministic mapping: each key in the emitted `states` block comes from a CSS pair on `<base>` (per § [CSS signal](#css-signal-in-componentnamemodulecss)) **confirmed by** its TSX marker on the same element (per § [TSX signal](#tsx-signal-in-componentnametsx)). The native keys (`hover` / `focus` / `disabled` / `invalid`) emit `pseudoClass: NATIVE_STATE_TYPE.<key>`; custom keys (incl. `selected`) emit just `className`. Root `disabled` additionally emits `props: { isDisabled: true }` — inner-element `disabled` omits `props` (inverted-prop wiring is root-only). Custom-key names are the verbatim kebab-case `data-state` token (`data-state="in-progress"` → key `'in-progress'`).

**Gating:** for non-pseudo keys, a CSS pair without a confirming TSX marker is skipped silently (treated as stale CSS). A TSX marker without a CSS pair is skipped too. This catches drift between the two source files.

---

## Out of scope

- Hand-writing the `states` block in the manifest — the generator owns it.
- Removing states or modifying existing CSS / TSX (collision rule — existing wins).

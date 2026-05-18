# Design States

Wire **design states** into an Editor React component's source files so the Wix editor surfaces a state-switcher in the design panel (Hover, Focus, Disabled, Invalid, Selected, custom keys) and applies the user's state styling on top of the component's defaults.

A design state is declared via **two source signals** the editor / manifest extractor reads together:

1. **CSS pairs** in the component's CSS module — a pseudo-class (or state attribute) selector **and** a matching `.elem<PascalKey>` class on the same base element.
2. **TSX markers** on the rendered element — `aria-checked`, `aria-selected`, `aria-disabled`, `aria-invalid`, or `data-state="<key>"`.

Both signals are required for non-pseudo keys (`disabled`, `invalid`, `selected`, custom). `hover` and `focus` only need the CSS pair — pseudo-classes fire natively from native pointer / focus events.

`npx wix generate manifest` reads the paired CSS rules + the rendered TSX attributes and emits the manifest `states` block. **Never hand-write the `states` block into the manifest — the generator is the only writer.**

> ⚠️ This is the **exception** to the "platform owns state styling" rule called out in [`CSS-GUIDELINES.md`](CSS-GUIDELINES.md) and [`REACT-PATTERNS.md`](REACT-PATTERNS.md). For components that opt into design states using the contract below, the component declares the state surface (paired rules + ARIA / data-state markers) and the platform layers the user's state styling on top via the `elem<PascalKey>` class. For everything else, the no-state-CSS rule still applies.

---

## CSS signal (in `<ComponentName>.module.css`)

For each state on a given target, write a paired selector rule with sensible default styling. Because the project uses CSS Modules, the `.elem<PascalKey>` class must be wrapped in `:global(...)` so it stays unhashed — the editor injects the literal class name (`elemHover`, `elemDisabled`, …) onto the DOM at runtime, and the generated manifest references that literal string.

```css
.root:hover,
.root:global(.elemHover) {
  /* populated default styling — see Default styling */
}
```

- **Native keys** (`hover` / `focus` / `disabled` / `invalid`) emit both the pseudo-class (or state attribute) **and** the `:global(.elem<PascalKey>)` class. These map 1:1 to `NATIVE_STATE_TYPE` from `@wix/react-component-schema`.
- **Custom keys** (`selected`, `featured`, anything else) emit only the `:global(.elem<PascalKey>)` class (no pseudo-class):
  ```css
  .root:global(.elemSelected) {
    /* populated default styling */
  }
  ```
- `<PascalKey>` capitalizes the key with PascalCase on word boundaries — `hover` → `elemHover`, `in-progress` → `elemInProgress`.
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

The state-switcher in the design panel adds `elem<Key>` classes to the rendered element. For the CSS rule to fire, its prefix must be a class that lives on that same element.

### Case A — self-rendering component (default)

The component applies `styles.root` to the outer rendered element. Base class = `.root`.

```tsx
<div className={classNames(className, 'profile-card', styles.root)}>
```

```css
.root:hover,
.root:global(.elemHover) { /* … */ }
```

### Case B — component wraps a library primitive

The component composes a library primitive (e.g., React Aria `<Switch>`) and applies `styles.X` (where `X` is something other than `root`) to that primitive. Base class = the local class that IS applied alongside the primitive.

```tsx
<Switch className={classNames(styles.button, 'button')}>
```

```css
.button:hover,
.button:global(.elemHover) { /* … */ }
```

### Case C — inner elements

Inner named parts (`heading`, `label`, `item`, …) follow the same pattern, each with their own base class. State markers (`data-state`, `aria-checked`, `aria-selected`) live on the inner element that carries the base class. `aria-disabled` / `aria-invalid` inverted-prop wiring belongs on the component **root**, not on inner elements.

```tsx
<span className={classNames('thumb', styles.thumb)} data-state={isSelected ? 'selected' : undefined} />
```

```css
.thumb:global(.elemSelected) { /* … */ }
```

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

If a state's CSS rule already exists in the module (any selector that targets `<base>:<pseudoClass>` or `<base>:global(.elem<PascalKey>)`), **leave it alone**. Existing wins — no merge, no overwrite.

Same rule applies to the TSX side: if the target element already has the matching `aria-*` or `data-state` attribute, leave it alone.

---

## Procedure

Apply when generating new Editor React components, immediately after `<ComponentName>.tsx` + `<ComponentName>.module.css` exist. The manifest does **not** need to exist yet — `npx wix generate manifest` reads the source signals and produces the `states` block later.

1. **Infer the state list per target.**
   - **Root**: read `<ComponentName>.tsx`. Match against the [role → states](#role--suggested-states) and [per-state relevance](#per-state-relevance) tables.
   - **Inner elements**: for each named part inside the component, apply the [inner-element rules](#inner-element-rules) against its rendered React.

2. **Resolve the base class and rendered tag per target.** Read the component's `className` composition (Cases A–C above). Identify the rendered tag (`<input>` / `<button>` / `<label>` / generic) — this drives `:disabled` vs `[aria-disabled='true']` and `:focus-visible` vs `:focus-within` per [Picking the pseudo-class](#picking-the-pseudo-class-for-disabled-and-focus).

3. **Patch the CSS (root).** For each root state in the inferred list:
   - Build the paired selector with the right pseudo (per Step 2) **plus** `:global(.elem<PascalKey>)`.
   - Populate the body with default styling from [Default styling](#default-styling).
   - Collision check (skip if matching `<base>:<pseudo>` or `<base>:global(.elem<PascalKey>)` already exists).
   - Append the new rule. Don't emit comments.

4. **Patch the TSX (root).** For each root state that has a TSX marker:
   - `disabled` → ensure an `isDisabled` (or detected inverted prop) typed `boolean` exists on the props interface; add it if missing. Add `aria-disabled={isDisabled || undefined}` on the root element.
   - `invalid` → same pattern with `isInvalid`.
   - `selected` → pick the marker based on the rendered role (`aria-checked` for switch/checkbox role; `aria-selected` for tab/option/treeitem/gridcell/row/columnheader/rowheader; `data-state` otherwise). Add the matching prop if missing.
   - Other custom keys → add `data-state` on the root element if not present.
   - Skip if the attribute is already wired. Don't emit comments.

5. **Patch the CSS + TSX (inner elements).**
   - For each inner-element target with a non-empty inferred state list:
     - Resolve its base class and rendered tag (Step 2).
     - Append paired-selector rules with default styling to the same CSS module.
     - For TSX markers on inner elements: only `data-state`, `aria-selected`, and `aria-checked` apply — `disabled` / `invalid` inverted-prop wiring lives on the component root.

6. **Regenerate the manifest.**
   ```
   npx wix build && npx wix generate manifest
   ```
   The generated `<ComponentName>.generated.ts` now contains a `states` block. **Do not hand-edit it.**

---

## How the manifest gets generated

`npx wix generate manifest` reads the source signals you wrote and emits the manifest `states` block in this shape:

```ts
import { NATIVE_STATE_TYPE } from '@wix/react-component-schema';

states: {
  hover: {
    displayName: 'Hover',
    className: 'elemHover',
    pseudoClass: NATIVE_STATE_TYPE.hover,
  },
  disabled: {
    displayName: 'Disabled',
    className: 'elemDisabled',
    pseudoClass: NATIVE_STATE_TYPE.disabled,
    props: { isDisabled: true },
  },
  selected: {
    displayName: 'Selected',
    className: 'elemSelected',
  },
}
```

The deterministic mapping the generator applies:

| Source signal | Manifest output |
|---|---|
| `<base>:hover` paired with `<base>:global(.elemHover)` | `hover: { className: 'elemHover', pseudoClass: NATIVE_STATE_TYPE.hover }` |
| `<base>:focus-visible` / `:focus-within` paired with `:global(.elemFocus)` | `focus: { className: 'elemFocus', pseudoClass: NATIVE_STATE_TYPE.focus }` |
| `<base>:disabled` or `<base>[aria-disabled='true']` paired with `:global(.elemDisabled)` **+** TSX `aria-disabled` | `disabled: { className: 'elemDisabled', pseudoClass: NATIVE_STATE_TYPE.disabled, props: { isDisabled: true } }` *(props only on root)* |
| `<base>:invalid` or `[aria-invalid='true']` paired with `:global(.elemInvalid)` **+** TSX `aria-invalid` | `invalid: { className: 'elemInvalid', pseudoClass: NATIVE_STATE_TYPE.invalid }` |
| `<base>:global(.elemSelected)` **+** TSX `aria-checked` *(switch/checkbox role)* | `selected: { className: 'elemSelected' }` |
| `<base>:global(.elemSelected)` **+** TSX `aria-selected` *(tab/option/treeitem/etc.)* | `selected: { className: 'elemSelected' }` |
| `<base>:global(.elemSelected)` **+** TSX `data-state="selected"` | `selected: { className: 'elemSelected' }` |
| `<base>:global(.elem<PascalKey>)` **+** TSX `data-state="<key>"` | `<key>: { className: 'elem<PascalKey>' }` |

**Gating:** for non-pseudo keys, a CSS pair without a confirming TSX marker is skipped silently (treated as stale CSS). A TSX marker without a CSS pair is skipped too. This is how the generator catches drift between the two source files.

**Custom-key manifest key** uses the verbatim `data-state` token (e.g. `data-state="in-progress"` → manifest key `'in-progress'`, paired with `className: 'elemInProgress'`). The TSX side is the source of truth for naming.

The same shape applies to inner-element `states` blocks — inner-element `disabled` omits the `props` field (inverted-prop wiring is root-only).

---

## Self-checks before considering the wiring done

| Check | How |
|---|---|
| Every inferred key produced a paired CSS rule at the correct scope with populated default styling | Read the CSS module |
| `aria-*` / `data-state` markers present on the right JSX element when required | Read `<ComponentName>.tsx` |
| New props (if any) typed on the component's props interface | `npx wix build` passes type-check |
| Generated manifest contains the expected `states` entries | `npx wix build && npx wix generate manifest`, then read `<ComponentName>.generated.ts` |

---

## Out of scope

- Writing or updating the `states` block in the manifest manually — the generator owns it.
- Removing states — this procedure only adds.
- Modifying existing CSS rules or TSX attributes (collision rule).

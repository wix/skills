# CSS Guidelines

Use these rules for the scaffolded `<component-name>.module.css` file and any
colocated CSS Modules owned by internal sub-components.

## Contents

- [Classes and Named Parts](#classes-and-named-parts)
- [Selector Rules](#selector-rules)
- [Root Layout](#root-layout)
- [Sizing Through the Tree](#sizing-through-the-tree)
- [Responsiveness and Direction](#responsiveness-and-direction)
- [Editable Values](#editable-values)
- [Interaction and Motion](#interaction-and-motion)
- [Checklist](#checklist)

## Classes and Named Parts

Apply classes with `clsx` (`import clsx from 'clsx'`):

| Element | Classes |
| --- | --- |
| Elected root | `'<component-name>'`, `styles.root`, incoming `className`, fallback-direction class |
| Named inner part | `'<component-name>-<part-name>'`, its module class, injected `elementProps` class |
| Structural/decorative non-part | Module class only |

The global class lets zero config create an editor element. Prefix every inner
part with the component name to avoid collisions. The
module class carries the component's default CSS. Preserve the scaffolded root
pattern. For a new named part, add only the wiring the scaffold cannot infer:
spread its `elementProps` entry and merge the injected class.

```tsx
<h2
  {...elementProps?.profileCardHeading}
  className={clsx(
    'profile-card-heading',
    styles.heading,
    elementProps?.profileCardHeading?.className,
  )}
>
  {heading}
</h2>
```

If a component reduces to one meaningful control, link, media surface, or list,
that semantic element is the root. Do not wrap it just to host root props.

## Selector Rules

Use flat, top-level selectors. Each selector must target one class plus an
optional state pseudo-class or global state modifier.
Put state overrides before bare classes so the manifest keeps resting defaults.

```css
.heading {
  font-weight: 600;
}

.cta:global(.profile-card-cta--hover),
.cta:hover {
  text-decoration: underline;
}
```

Do not use compound selectors, tag selectors, child/sibling combinators, or CSS
nesting for editable styling. They make an element's editor surface depend on
DOM context.

Narrow exceptions, neither defining editable appearance: a relationship
selector for behavior-only visibility that needs ancestor state (a
hover-revealed play/pause control), and an icon part's layout-only `svg` rule
(`VECTOR-ART.md`). Keep each control's size, color, border, typography, and state
styling on its own single-class rules.

## Root Layout

The root must fill the available inline size and use border-box sizing:

```css
.root {
  --display: flex;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
}
```

Add `height: 100%` only when the editor extension gives the component a pixel
height or the requested behavior requires a bounded height. Omit it when the
extension uses `LAYOUT.SIZING_TYPE.content`; the component's content must then
establish its block size.

Set `--display` on the root; do not set root `display` directly. Inner
elements use `display` normally.

Choose the simplest root shape that fits the component:

- column: `--display: flex; flex-direction: column`
- row: `--display: flex; flex-direction: row`
- split layout: `--display: grid; grid-template-columns: repeat(2, minmax(0, 1fr))`
- responsive collection: `--display: grid; grid-template-columns: repeat(auto-fit, minmax(...))`

Do not hardcode the root's pixel dimensions. Installation defaults belong in
the extension file.

Reset native margins on semantic roots (`figure`, headings, lists); their
browser margins otherwise sit outside `width: 100%` and can overflow the slot.

## Sizing Through the Tree

- Put `box-sizing: border-box` on every component selector.
- In a bounded axis, use `flex: 1` with `min-width: 0` or `min-height: 0` for
  children that grow.
- Use `flex: 0 0 auto` for controls that retain intrinsic size.
- Ensure every wrapper between the root and bounded growing content
  participates in the sizing chain. Do not create a block-axis sizing chain for
  a content-height component.

```css
.content {
  box-sizing: border-box;
  display: flex;
  flex: 1;
  min-width: 0;
}

.control {
  box-sizing: border-box;
  flex: 0 0 auto;
}
```

## Responsiveness and Direction

Respond to the component container, not the browser viewport. Prefer intrinsic
flex/grid sizing and tracks that can shrink below content size. Do not add
viewport `@media` rules; Wix owns page breakpoints.

Use logical inline-axis properties so layout flips automatically in RTL:

```css
.content {
  padding-inline: 24px;
  margin-inline-start: 8px;
  border-inline-start: 1px solid currentColor;
  inset-inline-end: 0;
}
```

Avoid `left`, `right`, `margin-left`, `padding-right`, and similar physical
inline-axis properties. Physical block-axis properties are fine.

## Editable Values

Keep static styling in the CSS Module, not JSX `style` objects. Use literal CSS
values when no interpolation is needed; do not create a React prop or CSS custom
property for routine values that zero config already surfaces.

A part's font and paint are literal too, also when porting the user's code:
`font: 600 120px/.8 'Geist', sans-serif; color: rgb(21 21 20 / 5%)`, with one
literal rule per theme or mode. The Design panel shows a `var(--…)` or
`color-mix()` value as raw text and can't edit it. Keep one only for a value the
code reads (a canvas color); theme tokens (`var(wst-…)`) are fine. Each text
part sets its own `color` and font, even when they match the root, or its text
panel shows them empty.

Write each spacing value as one `px`, `%`, `vh` or `vw` number (`px` by
default), not `clamp()`, `calc()`, `min()` or `max()`.

```css
.root {
  gap: 16px;
  padding: 24px;
}

.grid {
  --columns: 3;
  grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
}
```

A dynamic runtime value may use a narrowly scoped custom property set from
JSX; keep the style rule in CSS and expose no visual prop for it.

```css
@value wst-button-primary-font, wst-heading-6-font from "@wix/react-component-schema/theme-variables.module.css";

/* Typography: keep the font token intact; font-size/family/weight/style
   and line-height overrides make the theme font custom. Tracking and
   decoration use their matching theme tokens, per BRANDED-COMPONENTS.md. */
.cta {
  font: var(wst-button-primary-font);
}

/* Choose a theme token whose size fits the card. */
.title {
  font: var(wst-heading-6-font);
}

/* Avoid: a module-only wrapper isn't editable; its font silently
   overrides the parent's typography control. */
.cta-label {
  font: 14px 'Inter', sans-serif;
}
```

The same applies to paint: a layout-only wrapper stays transparent or becomes
a named part, so it can't mask the parent's `background`/`border`/`box-shadow`.

An explicit size needs a complete font source on the part that owns the
typography: `font-family` plus `font-size`, or a full shorthand such as
`font: 600 32px/1.1 Georgia, serif`. For themed typography, use an unmodified
`font` token whose size fits; the Font panel shows the token's own size.
Same-class declarations may sit in separate rules. CSS-wide keywords
(`inherit`, `unset`, …) are not a family: the manifest extractor turns
`font-family: inherit` plus a size into an invalid shorthand.

### SVG Icons

The part owning an icon declares `--icon-size` and `--icon-color`, prefixed
per icon (`--start-icon-size`), applied via `inline-size`/`block-size` and
`fill` or `stroke`. A custom property on a part that repeats (list items,
previous/next) moves to the root, so a repeated inline icon keeps its controls
on the part: `currentColor` from text in the part (a visually hidden,
`aria-hidden` label in an icon-only button) and a size in `em`. Root `--icon-*`
is only for one that needs its own color; replaceable icons follow
`VECTOR-ART.md`.

- **Inline** (chevron, play/pause): the `svg` applies them through a module
  class, its paths carrying no color attributes; no rotation property, since
  state and direction own its transform.

```css
.toggleButton {
  --icon-size: 16px;
  --icon-color: currentColor;
}

.chevron {
  inline-size: var(--icon-size);
  block-size: var(--icon-size);
  fill: var(--icon-color);
}
```

- **Replaceable**: follow `VECTOR-ART.md`.

## Interaction and Motion

- Set `pointer-events: auto` on the root and each interactive element.
- Pair native design states (`hover`, `focus`, `disabled`, `invalid`) with
  the matching editor-injected global modifier. Custom modifiers need a class
  toggle from component logic/data or a root prop trigger (`DESIGN-STATES.md` §5).
- Animate only to show a change of state or a requested effect; list the
  exact transition properties, never `transition: all` or an implicit `all`
  shorthand.

```css
.panel {
  transition: height 0.2s ease;
}
```

## Checklist

- [ ] The scaffolded component and each extracted internal sub-component own
      their styles through colocated CSS Modules.
- [ ] Global classes exist only for the root and named inner parts.
- [ ] Selectors are flat except for a documented behavior-only exception.
- [ ] The root uses `--display`, fills the applicable configured axes, and uses
      border-box sizing.
- [ ] A sizing chain exists only on bounded growing axes.
- [ ] Layout is container-driven and uses logical inline properties.
- [ ] Static styling stays in CSS; custom properties exist only when needed.
- [ ] Typography is set with the `font` shorthand only, on the part that should
      own the typography control: no separate `font-family`, `font-size`,
      `font-weight`, `font-style`, `font-stretch`, `font-variant` or `line-height`.
- [ ] Interactive elements expose pointer events and accessible design states.
- [ ] New non-parts and pseudo-elements paint only `currentColor` from a text
      part or button, or a `--*-color` declared only on the root or its one
      using part in one color longhand (photo scrims and `forced-colors` rules
      aside); ported user code keeps its paint.

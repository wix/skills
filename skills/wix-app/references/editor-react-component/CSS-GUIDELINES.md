# CSS Guidelines

Use these rules for the scaffolded `<component-name>.module.css` file and any
colocated CSS Modules owned by internal sub-components. These rules keep the component
editable by zero config, responsive to its Wix-owned container, and safe in
both LTR and RTL layouts.

**Visual intent.** When the request specifies how the component should look —
mood, palette, layout style, or a reference — follow that direction. Default to a modern, refined look — intentional layout, pleasing proportions, polished and deliberate styling.

## Contents

- [Classes and Named Parts](#classes-and-named-parts)
- [Selector Rules](#selector-rules)
- [Root Layout](#root-layout)
- [Sizing Through the Tree](#sizing-through-the-tree)
- [Responsiveness and Direction](#responsiveness-and-direction)
- [Editable Values](#editable-values)
- [Interaction and Motion](#interaction-and-motion)
- [Default Visual Quality](#default-visual-quality)
- [Checklist](#checklist)

## Classes and Named Parts

Apply classes with `classnames`:

| Element | Classes |
| --- | --- |
| Elected root | `'<component-name>'`, `styles.root`, incoming `className`, fallback-direction class |
| Named inner part | `'<component-name>-<part-name>'`, its module class, injected `elementProps` class |
| Structural/decorative non-part | Module class only |

The global class lets zero config create an editor element. Prefix every inner
part with the component name to prevent collisions between components. The
module class carries the component's default CSS. Preserve the scaffolded root
pattern. For a new named part, add only the wiring the scaffold cannot infer:
spread its `elementProps` entry and merge the injected class.

```tsx
<h2
  {...elementProps?.heading}
  className={classNames(
    'profile-card-heading',
    styles.heading,
    elementProps?.heading?.className,
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

```css
.heading {
  color: #1e293b;
}

.cta:global(.profile-card-cta--hover),
.cta:hover {
  background: #4f46e5;
}
```

Do not use compound selectors, tag selectors, child/sibling combinators, or CSS
nesting for editable styling. They make an element's editor surface depend on
DOM context.

Narrow exception: a relationship selector may control behavior-only visibility
when the behavior requires ancestor state and the rule does not define editable
appearance. A hover-revealed play/pause control is the canonical case. Keep all
of the control's size, color, border, typography, and state styling on its own
single-class rules.

## Root Layout

The root must fill the available inline size and use border-box sizing:

```css
.root {
  --display: flex;
  width: 100%;
  box-sizing: border-box;
}
```

Add `height: 100%` only when the editor extension gives the component a pixel
height or the requested behavior requires a bounded height. Omit it when the
extension uses `LAYOUT.SIZING_TYPE.content`; the component's content must then
establish its block size.

Set `--display` on the root; do not set root `display` directly. The platform
resolves and overrides this custom property. Inner elements use `display`
normally.

Choose the simplest root shape that fits the component:

- column: `--display: flex; flex-direction: column`
- row: `--display: flex; flex-direction: row`
- split layout: `--display: grid; grid-template-columns: 1fr 1fr`
- responsive collection: `--display: grid; grid-template-columns: repeat(auto-fit, minmax(...))`

Do not hardcode the root's pixel dimensions. Installation defaults belong in
the extension file.

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
flex/grid sizing, `minmax()`, `auto-fit`, `1fr`, and `clamp()`. Do not add
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
inline-axis properties. Physical block-axis properties such as `top` and
`margin-bottom` are fine.

## Editable Values

Keep static styling in the CSS Module, not JSX `style` objects. Use literal CSS
values when no interpolation is needed; do not create a React prop or CSS custom
property for routine values that zero config already surfaces.

Use this pattern:

```css
.root {
  gap: 16px;
  padding: 24px;
  background: #ffffff;
}

.grid {
  --columns: 3;
  grid-template-columns: repeat(var(--columns), 1fr);
}
```

A dynamic runtime value that cannot be represented statically may use a narrowly
scoped CSS custom property set from JSX, but keep the actual style rule in CSS
and do not expose a visual prop solely for that purpose.

```css
/* Typography: zero config builds the `font` control from both longhands.
   A part with a size but no family gets a control with no default. */
.cta {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

/* Avoid: a module-only wrapper is not an editor element. A size here is
   uneditable and silently overrides the parent's typography control. */
.cta-label {
  font-size: 14px;
}
```

## Interaction and Motion

- Set `pointer-events: auto` on the root and each interactive element.
- Pair native interaction selectors with the matching editor-injected global
  state modifier. Toggle custom state modifiers from component data.
- Do not add decorative transitions or animations.
- When motion is functionally required, list the exact transition properties;
  never use `transition: all` or an implicit `all` shorthand.

```css
.panel {
  transition: height 0.2s ease;
}
```

## Default Visual Quality

Create a clear hierarchy with at least two techniques that fit the component:
a defined surface, border or soft shadow, type scale or weight, spacing, an
accent, or visible interaction states. Use these neutral defaults unless the
request or existing design provides better values:

- 16px or larger body text, 14px or larger labels, and 600–700 weight for titles
- 8–16px spacing inside controls and 16–32px spacing inside containers
- 8–12px corner radii for cards and controls; `50%` for circular media
- a subtle border or soft shadow when a card, panel, or control needs separation
- touch targets at least 44 by 44px and visible keyboard focus states

### Foreground and Background Ownership

If the component is a self-contained block (card, panel, banner, accordion item), give the root a background. If it is an inline control meant to blend in (link, ghost button, icon button), control may leave the root transparent instead.

- On a transparent root, don't hardcode text or icon colors; inherit them from the parent.
- Set the background and main text/icon color together on the same element. Any secondary text (captions, hints, icons) must still be readable against that same background.
- If an interactive state changes the background, set the foreground color in that state too. Don't assume a color inherited from a parent or from a previous state will still look right on the new background.
- In every default and interactive state, meet WCAG AA contrast: 4.5:1 for body text and 3:1 for large text and UI controls.

A neutral owned surface may use a light background with dark primary and
secondary foregrounds, plus one accessible accent. The exact colors are not a
contract; the contrast relationship is.


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
- [ ] Every part that sets `font-size` also sets `font-family`, on the part that
      should own the typography control.
- [ ] Interactive elements expose pointer events and accessible design states.
- [ ] Visual containers have deliberate hierarchy rather than bare scaffolding.
- [ ] Every explicit foreground has a known contrasting background; transparent
      components inherit foregrounds from their host.

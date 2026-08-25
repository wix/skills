# Directionality (RTL/LTR)

Use these rules for component direction, logical layout, nested content, and
direction-dependent JavaScript.

## Contents

- [Root Contract](#root-contract)
- [Logical CSS](#logical-css)
- [Direction-Dependent Transforms](#direction-dependent-transforms)
- [Direction-Dependent JavaScript](#direction-dependent-javascript)
- [Nested `ReactNode` Content](#nested-reactnode-content)
- [Checklist](#checklist)

## Root Contract

Every component accepts `direction?: Direction`. Put `dir={direction}` and the
fallback class on the elected root; do not add a wrapper for them. Apply the
fallback class unconditionally so it works whenever `dir` is absent. Preserve
the scaffolded `dir`, root class, and `.fallbackDirection:not([dir])` wiring;
the generated component already demonstrates this contract.

Do not set fallback direction with a React condition or a custom direction CSS
variable.

## Logical CSS

Use logical inline-axis properties instead of physical left/right properties:

```css
.element {
  inset-inline-start: 0;
  padding-inline-start: 8px;
  margin-inline-end: 4px;
  border-inline-end: 1px solid currentColor;
}
```

Block-axis properties such as `top`, `bottom`, and `padding-block` do not need
directional conversion.

## Direction-Dependent Transforms

For directional transforms, use the platform multiplier:

```css
.arrow {
  scale: var(--wix-opt-in-direction-multiplier, 1) 1;
}
```

## Direction-Dependent JavaScript

Use `useLanguageDirection()` only when direction changes JavaScript behavior,
such as arrow-key order, scroll math, animation direction, or conditional
rendering. Purely visual direction belongs in logical CSS.

```tsx
import { useLanguageDirection } from '@wix/react-component-utils';

const siteDirection = useLanguageDirection();
const resolvedDirection = direction ?? siteDirection;
const isRtl = resolvedDirection === 'rtl';
```

## Nested `ReactNode` Content

Put `dir="ltr"` on the element that renders a `ReactNode` content prop. This
isolates arbitrary nested content from the parent component's direction so each
nested component can resolve its own contract.

```tsx
<div dir="ltr">{item.content}</div>
```

## Checklist

- [ ] Root props include `direction?: Direction`.
- [ ] The elected root has `dir={direction}` and the unconditional fallback class.
- [ ] Direction-sensitive CSS uses logical properties.
- [ ] Runtime direction hooks are used only for JavaScript behavior.
- [ ] Every `ReactNode` content slot renders under `dir="ltr"`.

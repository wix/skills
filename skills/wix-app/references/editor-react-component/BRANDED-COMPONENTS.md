# Branded / Themed Components

Use this reference only when the prompt explicitly requests a **branded**,
**themed**, or **brand-aware** component. Do not infer this requirement from a
generic request for polished styling.

## Rules

Import theme tokens from `@wix/react-component-schema/theme-variables.module.css`
using CSS Modules `@value`, then consume with `var()`.

```css
@value wst-primary-background-color from "@wix/react-component-schema/theme-variables.module.css";
@value wst-heading-3-font, wst-heading-3-color from "@wix/react-component-schema/theme-variables.module.css";
@value wst-paragraph-1-font, wst-paragraph-1-color from "@wix/react-component-schema/theme-variables.module.css";

.root    { background: var(wst-primary-background-color); }
.heading { font: var(wst-heading-3-font); color: var(wst-heading-3-color); }
.body    { font: var(wst-paragraph-1-font); color: var(wst-paragraph-1-color); }
```

**Colors:** `wst-primary-background-color`, `wst-secondary-background-color`, `wst-base-1-color`, `wst-base-2-color`, `wst-shade-1/2/3-color`, `wst-accent-1/2/3/4-color`, `wst-links-and-actions-color`

**Headings:** `wst-heading-1..6-font` / `wst-heading-1..6-color`

**Body:** `wst-paragraph-1..3-font` / `wst-paragraph-1..3-color`

- Do not use `var(--wst-*)` directly; import the `@value` alias first.
- Do not use `@import`; CSS Modules resolves theme aliases through `@value`.
- Do not use `wst-base-1-color` for text. Prefer heading/paragraph color tokens,
  or `wst-base-2-color` when a base contrast color is required.

## Checklist

- [ ] Theme values are imported from `theme-variables.module.css` with `@value`.
- [ ] Imported aliases are consumed through `var()`.
- [ ] Typography uses heading/paragraph font and color token pairs.
- [ ] Text colors remain legible on the selected background token.

# Branded / Themed Components

Apply automatically — without being asked — whenever the user requests a
**branded**, **themed**, or **brand-aware** component.

---

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

❌ Don't use `var(--wst-*)` directly — import the `@value` alias first.  
❌ Don't use `@import` — CSS Modules doesn't process `@value` aliases from `@import`; `@value` is the only mechanism that resolves them at build time.  
❌ Don't use `wst-base-1-color` for text — it typically resolves to white and is invisible on the default white background. Use `wst-heading-*-color` / `wst-paragraph-*-color` for text, or `wst-base-2-color` if you need a base contrast color.  

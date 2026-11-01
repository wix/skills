# Branded / Themed Components

Theme new components only when the request or host rules ask. Edits preserve
existing styling, `theme/` imports, color settings and manifest metadata. Keep
layout, scale, shape and imagery. `VISUAL-QUALITY.md` applies.

## Styling Scope

- Requested colors/fonts win only on the named elements; theme the rest.
  "Red buttons" get a red fill and keep the theme button. Keep contrast.
- Unless theming is requested, supplied code keeps its palette, and so does
  a Character-led component (below).
- Edits keep existing styling unless asked to change it.
- Brik tool imports keep the stylesheet the `wix-brik` skill writes.

## How Much Theme

| Level | Fits | Theme supplies | Component owns |
| --- | --- | --- | --- |
| Brand-led | Forms, FAQ, pricing, contact | Type, colors, buttons, surfaces | Layout, spacing |
| Balanced (default) | Cards, sliders, testimonials, galleries, heroes | Type, buttons, surfaces, the action color | Composition, scale, imagery |
| Character-led | Requested own look the theme cannot give: neon, gradient, games | Font families, buttons, unless they clash | Palette, mood, layout, motion |

Keep two design decisions and a signature move.

## Tokens by Role

| Part | Use | Never |
| --- | --- | --- |
| Section title (full-width section) | `heading-1..3` | — |
| Item title | the `heading-4..6` level that renders 18–28px | `heading-1..3` |
| Body copy | `paragraph-1` | heading tokens |
| Meta, caption, eyebrow, hint | `paragraph-2` / `paragraph-3` | heading tokens |
| Primary action | complete `button-primary-*` set | heading or paragraph fonts |
| Secondary action, arrows, pagination, tabs | `button-secondary-*` / `button-tertiary-*` | heading tokens |
| Card or panel surface | `box-primary-*`, or `box-secondary-*` with its border | the page background on both page and card |
| Divider between sections | `system-line-1/2-*` | — |
| Error, success, alert, disabled | `system-*-color` | hand-picked colors |

**Typography follows content role, not element tag.** An item title keeps
18–28px title styling when it also toggles content: use neutral chrome and
no button `text-transform`. Action/navigation labels, field labels and
captions never use heading fonts. Preserve semantics, keyboard behavior,
focus and a 44px target.

Default Studio: `heading-5` is 32px, `heading-6` 24px. Step down a level;
keep the font token intact. Ordinary controls and labels render 14–18px:
labels take `paragraph-2/3`, controls their button variant's font (16px there).

Use one button variant's complete tokens. Keep padding px; map sides and
corners to logical CSS for RTL.

Use spacing and one separator per item. Keep strong `system-line-*` and
`box-secondary` borders for section breaks; inside, use
`color-mix(in srgb, var(wst-paragraph-1-color) 15%, transparent)`.

## Color Roles

- **Root:** pair `wst-primary-background-color` with `wst-paragraph-1-color`;
  inline controls may stay transparent.
- **Action:** `wst-button-primary-background-color` paints a part's fill,
  border, icon or progress at rest, even empty; hover/focus alone don't count.
  Keep it off text and reading surfaces; never the sole state cue.
  A small highlight can use `wst-accent-1-color`; verify contrast.
- **Fills:** buttons and selected/open fills keep their theme background/ink
  pair. Never put text over an arbitrary accent or its tint. Focus uses
  readable ink; selection also has a label, icon or shape cue. `box-*` paint
  as themed. Derived tints may decorate non-text areas; photos use a dark
  scrim under text. Check contrast on the rendered surface.
- `accent-2..4` are often pale or equal the card: keep them off text and
  marks; never fill with `accent-3/4`.

## Token Rules

Import theme tokens from `@wix/react-component-schema/theme-variables.module.css`
using CSS Modules `@value`, then consume with `var()`.

- Never `var(--wst-*)`, a `var()` fallback or `@import`: use the `@value` alias.
- Import every token you use, `color-mix()` included.
- Themed text uses one role for `font`, `letter-spacing` and
  `text-decoration-line` (token `-text-decoration`). On the page, inherit
  the root's theme ink; inside a filled box/button, use its contrasting theme ink.
- Put an unmodified `font` token on each named text part's own module class.
  Wrapper fonts can leave Studio controls empty; longhand overrides
  make the theme style custom.
- Never pair `wst-links-and-actions-color` with `wst-base-2-color` as button
  colors.

**Text:** `wst-heading-1..6-` and `wst-paragraph-1..3-` `font`, `-color`, `-letter-spacing`, `-text-decoration`

**Surfaces:** `wst-primary-background-color`, `wst-secondary-background-color`, `wst-base-1/2-color`, `wst-shade-1/2/3-color`

**Brand:** `wst-accent-1/2/3/4-color`, `wst-links-and-actions-color`, `wst-graphics-1/2-color`

**Buttons** (`primary`, `secondary`, `tertiary`): `wst-button-<variant>-font`, `-color`, `-background-color`, `-background-image`, `-border-<side>-color/width/style`, `-border-<corner>-radius`, `-box-shadow`, `-text-transform`, `-letter-spacing`

**Boxes** (`primary`, `secondary`): `wst-box-<variant>-background-color`, `-background-image`, `-border-<side>-color/width/style`, `-border-<corner>-radius`, `-box-shadow`

**Lines:** `wst-system-line-1/2-color`, `wst-system-line-1/2-width`

**Status:** `wst-system-success/error/alert/disabled-color`

## Example

Use theme tokens directly. Keep named-part editor styling controls; add no universal color-picker preset or extension overrides.

```css
@value wst-primary-background-color, wst-paragraph-1-color, wst-button-primary-background-color, wst-box-primary-background-color, wst-box-primary-background-image, wst-box-primary-box-shadow, wst-box-primary-border-top-left-radius, wst-box-primary-border-top-right-radius, wst-box-primary-border-bottom-right-radius, wst-box-primary-border-bottom-left-radius, wst-heading-6-font, wst-heading-6-color, wst-heading-6-letter-spacing, wst-heading-6-text-decoration, wst-paragraph-2-font, wst-paragraph-2-color, wst-paragraph-2-letter-spacing, wst-paragraph-2-text-decoration, wst-button-secondary-font, wst-button-secondary-color, wst-button-secondary-background-color, wst-button-secondary-background-image, wst-button-secondary-box-shadow, wst-button-secondary-text-transform, wst-button-secondary-letter-spacing, wst-button-secondary-border-top-width, wst-button-secondary-border-right-width, wst-button-secondary-border-bottom-width, wst-button-secondary-border-left-width, wst-button-secondary-border-top-style, wst-button-secondary-border-right-style, wst-button-secondary-border-bottom-style, wst-button-secondary-border-left-style, wst-button-secondary-border-top-color, wst-button-secondary-border-right-color, wst-button-secondary-border-bottom-color, wst-button-secondary-border-left-color, wst-button-secondary-border-top-left-radius, wst-button-secondary-border-top-right-radius, wst-button-secondary-border-bottom-right-radius, wst-button-secondary-border-bottom-left-radius from "@wix/react-component-schema/theme-variables.module.css";

.root { background-color: var(wst-primary-background-color); color: var(wst-paragraph-1-color); }
.card {
  background-color: var(wst-box-primary-background-color);
  background-image: var(wst-box-primary-background-image);
  border-start-start-radius: var(wst-box-primary-border-top-left-radius);
  border-start-end-radius: var(wst-box-primary-border-top-right-radius);
  border-end-end-radius: var(wst-box-primary-border-bottom-right-radius);
  border-end-start-radius: var(wst-box-primary-border-bottom-left-radius);
  box-shadow: var(wst-box-primary-box-shadow);
}
.progress { block-size: 4px; background: var(wst-button-primary-background-color); }
.title   { font: var(wst-heading-6-font); color: var(wst-heading-6-color); letter-spacing: var(wst-heading-6-letter-spacing); text-decoration-line: var(wst-heading-6-text-decoration); }
.index, .meta { font: var(wst-paragraph-2-font); color: var(wst-paragraph-2-color); letter-spacing: var(wst-paragraph-2-letter-spacing); text-decoration-line: var(wst-paragraph-2-text-decoration); }
.control {
  font: var(wst-button-secondary-font);
  color: var(wst-button-secondary-color);
  background-color: var(wst-button-secondary-background-color);
  background-image: var(wst-button-secondary-background-image);
  box-shadow: var(wst-button-secondary-box-shadow);
  text-transform: var(wst-button-secondary-text-transform);
  letter-spacing: var(wst-button-secondary-letter-spacing);
  border-block-start: var(wst-button-secondary-border-top-width) var(wst-button-secondary-border-top-style) var(wst-button-secondary-border-top-color);
  border-block-end: var(wst-button-secondary-border-bottom-width) var(wst-button-secondary-border-bottom-style) var(wst-button-secondary-border-bottom-color);
  border-inline-start: var(wst-button-secondary-border-left-width) var(wst-button-secondary-border-left-style) var(wst-button-secondary-border-left-color);
  border-inline-end: var(wst-button-secondary-border-right-width) var(wst-button-secondary-border-right-style) var(wst-button-secondary-border-right-color);
  border-start-start-radius: var(wst-button-secondary-border-top-left-radius);
  border-start-end-radius: var(wst-button-secondary-border-top-right-radius);
  border-end-end-radius: var(wst-button-secondary-border-bottom-right-radius);
  border-end-start-radius: var(wst-button-secondary-border-bottom-left-radius);
  min-inline-size: 44px;
  min-block-size: 44px;
  padding: 8px 16px;
}
```

## Checklist

- [ ] Item titles render 18–28px; ordinary controls/labels
      14–18px. No heading fonts on actions/navigation/labels/captions.
- [ ] Action buttons use a complete variant; interactive item titles keep title styling.
- [ ] One separator per item.
- [ ] The action color shows before interaction, empty states included; no
      accent on text the theme left neutral.
- [ ] Theme fill/ink pairs stay together; all states retain readable text and cues.

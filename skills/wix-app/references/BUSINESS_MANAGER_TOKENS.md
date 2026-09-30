# Business Manager tokens — what to use instead of a hardcoded value

Companion to [BUSINESS_MANAGER_THEME.md](BUSINESS_MANAGER_THEME.md), which sets the theme up. This file covers what you style yourself once it is wired.

A hardcoded colour or font size keeps its old value while the themed components around it change — the most visible way a surface looks half migrated. Everything below was resolved against the installed `@wix/design-system` 1.330.0 `themes/odeditor.global.css` and component typings, not from a design-side migration note.

## 1. Tokens, not hardcoded values

Use a `--wds-*` custom property, or the component's own `skin`/`size` prop.

The middle column is the value each token actually resolves to under the theme.

| Use case | Resolves to | Token |
| --- | --- | --- |
| Primary action fill | `#2F5DFF` | `--wds-color-fill-standard-primary` |
| Dark secondary fill | `#F0EFEF` | `--wds-color-fill-dark-secondary` |
| Dark secondary, hover | `#E8E7E7` | `--wds-color-fill-dark-secondary-hover` |
| Warning / success surface | yellow / green tones | `--wds-color-fill-warning-secondary`, `--wds-color-fill-success-secondary` |
| Primary text | `#151414` | `--wds-color-text-standard-primary` |
| Interactive / link | `#2F5DFF` | `--wds-color-text-primary` |
| Destructive text | `#DF3336` | `--wds-color-text-destructive` |
| Standard border | `#767574` | `--wds-color-border-dark-primary` |
| Subtle border | `#DEDEDE` | `--wds-color-border-dark-secondary` |
| Heading / body font | Madefor Display / Text | `--wds-font-family-display`, `--wds-font-family-default` |
| Heading 1 size / line height | `32px` / **`40px`** | `--wds-font-size-heading-1`, `--wds-font-line-height-heading-1` |
| Heading 1 weight | `500` | `--wds-font-weight-heading-1` |

Two traps in that table, both of which produce a declaration the browser silently drops:

- **`--wds-font-line-height-heading-1` resolves to 40px, not 32px.** If you are replacing a hardcoded `line-height: 32px`, the token changes your layout — that is the theme working, not a mistake, but know it before you swap.
- **`--wds-font-letter-spacing-heading-1` is unitless** (`-0.50`), so `letter-spacing: var(--wds-font-letter-spacing-heading-1)` is invalid CSS. WDS itself emits it with a fallback; if you need it, wrap it: `calc(var(--wds-font-letter-spacing-heading-1) * 1px)`.

**For a token not in the table, do not derive the name — look it up.** Grep the installed stylesheet, which is the only authority:

```bash
grep -oE '\-\-wds-color-fill-[a-z0-9-]+' node_modules/@wix/design-system/themes/odeditor.global.css | sort -u
```

Guessing from a Figma layer name invents tokens that do not exist (`-light` variants, for instance, are not a thing — the scale is `-primary`/`-secondary`/`-tertiary` with `-hover`/`-active`/`-disabled`), and `var()` on a missing name with no fallback makes the whole declaration invalid. You get no colour at all, and nothing in the build tells you.

**On a WDS component the prop is the target, not the token:**

```tsx
// ❌ unchanged by a theme switch
<Button style={{ background: '#2F5DFF' }}>Save</Button>
<Badge style={{ background: '#F4B8B9' }}>Error</Badge>
<Text style={{ color: '#DF3336' }}>Invalid email</Text>
<Box style={{ background: '#F7F8FA', borderColor: '#DEDEDE' }}>

// ✅
<Button skin="standard">Save</Button>
<Badge skin="danger">Error</Badge>
<Text skin="error">Invalid email</Text>
<Box backgroundColor="D75" border="1px solid" borderColor="D60">
```

A container that genuinely isn't a WDS component takes the tokens in its own CSS: `background: var(--wds-color-fill-standard-tertiary);`.

**Tokens are CSS custom properties**, so a colour copied into a JavaScript object — a chart palette, a canvas value — does not follow the theme.

**🛑 The theme rebases the spacing unit, from 6px to 4px.** `--wds-space-100` is `6px` under the default theme and `4px` under `odeditor`, and the `SP*` scale is defined against it (`SP2` is `calc(var(--wds-space-100) * 2)`). So the moment you import the theme stylesheet, `SP2` resolves to 8px rather than 12px, and numeric spacing (`<Box gap={2}>`) rebases with it. This is the one change that lands silently on every surface.

Keep expressing spacing in `SP*` or numeric units — **because** they follow the theme — and never convert them to the pixel values in [WDS_LAYOUT.md](dashboard-page/WDS_LAYOUT.md#base-unit)'s table, which are the 6px-base figures and are wrong on a themed surface. Use that table for the 12-column grid and layout rhythm, not as a px conversion chart.

No matching token? Ship it with a `// TODO: migrate when <token> exists` comment rather than bare. If you can't say in one sentence why it can't be a token, it should be one.

## 2. Adjustments the wrapper doesn't cover

| Component | Adjustment | Prop |
| --- | --- | --- |
| Tabs | Small, no divider | `size="small" showDivider={false}` — `showDivider` defaults on, so pass it |
| Panel / modal headers | Smallest close/help button | `closeButtonProps={{ size: 'small' }}`, `helpButtonProps={{ size: 'small' }}` — `CloseButton` sizes are `small \| medium \| large` |
| Modal headers / footers | Dividers off | `showHeaderDivider={false} showFooterDivider={false}` — **both default to `'auto'`**, which shows them once content scrolls, so doing nothing ships the dividers the redesign removes |
| Slider | Horizontal spacing 12px, not 8px | Per call site |

Two rows from the design-side migration note have **no API to land on at 1.330.0**, so don't go looking: a modal footer's secondary slot is `secondaryButtonProps?: Omit<ButtonProps, …>` and renders a `Button`, so "secondary becomes a text button at M size" needs a hand-built footer rather than a prop (and `CustomModalLayout` has no footer-skin prop at all — the only `light` skin is `footnoteSkin`, which styles the footnote); and `AngleInput` exposes no `size`, so "medium / 38px" is not reachable. Raise those with **#wix-design-system** rather than improvising.

**Several adjustments the providers already make for you** — don't redo them by hand: a nested icon button is Dark / Tertiary from the wrapper's `IconButton` default, and `WixDesignSystemIconThemeProvider` already supplies the Accordion caret. `Accordion`, `CloseButton`, `Tooltip`, `Popover`, `Thumbnail`, `SidePanel` and ~20 more are all legal keys of `WixDesignSystemDefaultProps`, so anything you find yourself repeating per call site probably belongs in `BUSINESS_MANAGER_DEFAULTS` instead.

Two genuine author decisions remain: a **standalone** text button uses the standard (blue) skin while one beside a primary or secondary button uses Dark; and empty states are **typography only**, no legacy illustrations (on a collection page the empty state comes from the patterns shell — the page template's, [DRAFT_TEMPLATE.md](dashboard-page/DRAFT_TEMPLATE.md)).


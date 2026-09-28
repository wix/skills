# Business Manager theme — one wrapper, every dashboard surface

Business Manager (the Wix site dashboard) was redesigned with the Harmony theme. **A dashboard extension runs in its own iframe and inherits none of it.** `WixDesignSystemProvider` alone gives the pre-redesign look — classic icons, pre-redesign button sizes and skins — rendered inside redesigned platform chrome.

**No automated check catches this.** `tsc`, `wix build` and `wix preview` all pass on an unthemed page — every import resolves and every component renders. The failure is purely visual, so wire it from the start.

Verified against `@wix/design-system` 1.330.0 and `@wix/wix-ui-icons-common` 3.189.28 — both providers are root exports, `IconTheme` is typed `'default' | 'odeditor'`, and `themes/odeditor.global.css`, `lazy`, `lazy/system` and `core` all ship.

## 1. Both packages, together

```bash
npm install @wix/design-system@latest @wix/wix-ui-icons-common@latest
```

The redesigned styles and matching icon set ship as a pair — update them together. An older `@wix/design-system` leaves a surface half-migrated however the providers are wired, since refinements ship continuously during the rollout.

## 2. The wrapper — write this file once per app

```tsx
// src/extensions/dashboard/BusinessManagerTheme.tsx
import type { FC, ReactNode } from 'react';
import {
  WixDesignSystemProvider,
  WixDesignSystemIconThemeProvider,
  WixDesignSystemDefaultPropsProvider,
  type WixDesignSystemDefaultProps,
} from '@wix/design-system';
import { IconThemeProvider } from '@wix/wix-ui-icons-common/core';
import '@wix/design-system/styles.global.css';
import '@wix/design-system/themes/odeditor.global.css';

const BUSINESS_MANAGER_DEFAULTS: WixDesignSystemDefaultProps = {
  Button: { size: 'small', skin: 'dark' },
  IconButton: { size: 'small', skin: 'dark', priority: 'tertiary' },
  TextButton: { size: 'small', skin: 'standard' },
  Input: { size: 'small' },
};

export const BusinessManagerTheme: FC<{ children: ReactNode; locale?: string }> = ({
  children,
  locale,
}) => (
  <WixDesignSystemProvider locale={locale}>
    <WixDesignSystemIconThemeProvider>
      <IconThemeProvider theme="odeditor">
        <WixDesignSystemDefaultPropsProvider defaults={BUSINESS_MANAGER_DEFAULTS}>
          {children}
        </WixDesignSystemDefaultPropsProvider>
      </IconThemeProvider>
    </WixDesignSystemIconThemeProvider>
  </WixDesignSystemProvider>
);
```

Duplicating these four providers per entry file is how one surface silently drifts out of the theme. Each piece earns its place:

| Piece | Without it |
| --- | --- |
| `themes/odeditor.global.css` | `--wds-*` tokens keep pre-redesign values, so every component renders the old palette |
| `WixDesignSystemIconThemeProvider` + `IconThemeProvider` | Icons stay classic — heavier strokes, wrong sizes beside redesigned components |
| `WixDesignSystemDefaultPropsProvider` | Buttons and inputs render pre-redesign unless every call site passes `size`/`skin` by hand |

**Order is outermost-first and fixed**, and `WixPatternsProvider` goes *inside* the wrapper: the defaults provider must sit above the components it supplies defaults to, and the WDS leaf UI inside a patterns shell is exactly that.

A prop on a component still wins over the provider, so a one-off `size="medium"` is fine. **A nested `WixDesignSystemDefaultPropsProvider` replaces these defaults rather than merging**, so don't add a second for one subtree. And don't pass `features={{ newColorsBranding: true }}` — it predates the theme and is not a substitute.

## 3. Where the wrapper goes

**Write the file once per app; use it once per extension.** Every dashboard extension — page, modal, plugin — is a separate iframe, so each needs its own wrapper at its own root, in the file that owns the providers, never in a child, tab or helper file:

| Surface | File | Section |
| --- | --- | --- |
| Page, Cases A/B/D (router-wired) | `{feature}.tsx` | [DRAFT_TEMPLATE_ROUTER.md § 1](dashboard-page/DRAFT_TEMPLATE_ROUTER.md#1-entry--location-is-manual-in-a-wix-cli-app-and-only-because-the-router-needs-it) |
| Page, Case C (settings only) | `{feature}.tsx` | [DRAFT_TEMPLATE.md § 1](dashboard-page/DRAFT_TEMPLATE.md#1-entry--case-c-only-router-free-no-location-plumbing) |
| Page with dynamic parameters | `withProviders.tsx` | [DYNAMIC_PARAMETERS.md](dashboard-page/DYNAMIC_PARAMETERS.md#provider-wrapper-implementation) |
| Modal | the generated `<modal>.tsx` | [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md#theme) |
| Plugin | the generated plugin component | [DASHBOARD_PLUGIN.md](DASHBOARD_PLUGIN.md#theme) |

Each surface's own doc shows the wrapper already in place. Copy that file as-is rather than re-adding providers by hand. A plugin is the least forgiving of the three: it renders inside a redesigned first-party page, so an unthemed one is surrounded by the very styling it is missing.

## 4. Import icons from the lazy entry point

Icons imported from the package root render classic **regardless of the providers above them**. Only the lazy entry point resolves through `IconThemeProvider`:

```diff
- import { Add } from '@wix/wix-ui-icons-common';
- import { Confirm } from '@wix/wix-ui-icons-common/system';
+ import { Add } from '@wix/wix-ui-icons-common/lazy';
+ import { Confirm } from '@wix/wix-ui-icons-common/lazy/system';
```

Use `lazy` for every icon on a dashboard surface. Outside Business Manager it keeps rendering the current set, so this is the default import, not a Business-Manager-only one. An `iconKey` in a builder file names an icon for the platform rather than importing one — leave those alone.

## 5. Tokens, not hardcoded values

A hardcoded colour or font size keeps its old value while the themed components around it change — the most visible way a page looks half migrated. Use a `--wds-*` custom property, or the component's own `skin`/`size` prop.

| Use case | Don't write | Token |
| --- | --- | --- |
| Primary action fill | `#2F5DFF` | `--wds-color-fill-standard-primary` |
| Dark secondary fill | `#DEDEDE` | `--wds-color-fill-dark-secondary` |
| Dark secondary, hover | `#E8E7E7` | `--wds-color-fill-dark-secondary-hover` |
| Warning / success surface | yellow / green tones | `--wds-color-fill-warning-light`, `--wds-color-fill-success-light` |
| Primary text | `#151414` | `--wds-color-text-standard-primary` |
| Interactive / link | `#2F5DFF` | `--wds-color-text-primary` |
| Destructive text | `#DF3336` | `--wds-color-text-destructive` |
| Standard border | `#767574` | `--wds-color-border-dark-primary` |
| Subtle border | `#DEDEDE` | `--wds-color-border-dark-secondary` |
| Heading / body font | `"Wix Madefor Display"`, `"Arial"` | `--wds-font-family-heading`, `--wds-font-family-body` |
| Heading 1 size / line height | `32px` / `32px` | `--wds-font-size-heading-1`, `--wds-font-line-height-heading-1` |
| Heading 1 spacing / weight | `-0.5px` / `500` | `--wds-font-letter-spacing-heading-1`, `--wds-font-weight-heading-1` |

For a token not in the table, derive it from the Figma name: prepend `--wds-`, lowercase, replace `/` and spaces with `-`. `Color/Fill/Standard/standard-primary` → `--wds-color-fill-standard-primary`.

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
<Box backgroundColor="A-10" border="1px solid" borderColor="D-10">
```

A container that genuinely isn't a WDS component takes the tokens in its own CSS: `background: var(--wds-color-fill-standard-tertiary);`.

**Two traps.** Tokens are CSS custom properties, so a colour copied into a JavaScript object — a chart palette, a canvas value — does not follow the theme. And spacing is untouched by the redesign: keep the 6px base unit and `SP*` tokens for `gap`/`padding`/`margin` per [WDS_LAYOUT.md](dashboard-page/WDS_LAYOUT.md#base-unit).

No matching token? Ship it with a `// TODO: migrate when <token> exists` comment rather than bare. If you can't say in one sentence why it can't be a token, it should be one.

## 6. Adjustments the wrapper doesn't cover

| Component | Adjustment |
| --- | --- |
| Accordion | Set the chevron manually |
| Panel / modal headers | Update the close button; `tiny` question-mark icon |
| Modal footers | Secondary → text button at M size; light footer skin; no divider |
| Slider | Horizontal spacing 12px, not 8px |
| Components with built-in buttons | Nested icon button → Dark / Tertiary |
| Tabs | `size="small"`, divider off |
| Angle input | Medium (38px height) |

Three layout defaults are the author's job: a **standalone** text button uses the standard (blue) skin while one beside a primary or secondary button uses Dark; panels, cards and modals carry **no dividers** in headers and footers; empty states are **typography only**, no legacy illustrations (on a collection page the empty state comes from the patterns shell — [DRAFT_TEMPLATE_COLLECTION.md](dashboard-page/DRAFT_TEMPLATE_COLLECTION.md)).

## 7. Verify

- The entry file wraps the page in `BusinessManagerTheme`, and that file imports both stylesheets and nests all four providers in order.
- Every icon comes from `@wix/wix-ui-icons-common/lazy` or `/lazy/system`.
- `grep -rn "style={{" src/` and `grep -rn "#[0-9A-Fa-f]\{3,6\}" src/` return nothing for the page's own files, or only lines carrying a justification comment.
- In devtools, a component's colours resolve from `--wds-*` properties. A literal means that element is still custom-styled.
- Hover, focus, disabled, selected, error, warning and success all render — a token gap usually surfaces in a state, not at rest.

# Business Manager theme — one wrapper, every dashboard surface

Business Manager (the Wix site dashboard) was redesigned with the Harmony theme. **A dashboard extension runs in its own iframe and inherits none of it.** `WixDesignSystemProvider` alone gives the pre-redesign look — classic icons, pre-redesign button sizes and skins — rendered inside redesigned platform chrome.

**No automated check catches this.** `tsc`, `wix build` and `wix preview` all pass on an unthemed surface — every import resolves and every component renders. The failure is purely visual, so wire it from the start.

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
import { i18n } from '@wix/essentials';
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
  locale = i18n.getLocale(),
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
| Page, from any `@wix/patterns` page template | `{feature}.tsx`, holding the template's `page.tsx` | [DRAFT_TEMPLATE.md § 3](dashboard-page/DRAFT_TEMPLATE.md#3-copy-it-into-the-extension) |
| Page with dynamic parameters | `withProviders.tsx` | [DYNAMIC_PARAMETERS.md](dashboard-page/DYNAMIC_PARAMETERS.md#provider-wrapper-implementation) |
| Modal | the generated `<modal>.tsx` | [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md#theme) |
| Plugin | the generated plugin component | [DASHBOARD_PLUGIN.md](DASHBOARD_PLUGIN.md#theme) |

Each surface's own doc shows the wrapper already in place. Copy that file as-is rather than re-adding providers by hand. A plugin is the least forgiving of the three: it renders inside a redesigned first-party page, so an unthemed one is surrounded by the very styling it is missing.

## 4. Import icons from the lazy entry point

Icons imported from the package root render classic **regardless of the providers above them**. Only the lazy entry point resolves through `IconThemeProvider`:

```diff
- import { Add, Confirm } from '@wix/wix-ui-icons-common';
+ import { Add, Confirm } from '@wix/wix-ui-icons-common/lazy';
```

Use `lazy` for every icon on a dashboard surface. Outside Business Manager it keeps rendering the current set, so this is the default import, not a Business-Manager-only one. An `iconKey` in a builder file names an icon for the platform rather than importing one — leave those alone.

Two things worth knowing before you convert everything:

- **`/lazy/system` is not where app icons live.** The `system` entry holds WDS's own internal component decorations (`CheckboxChecked`, `DropDownArrow`, …) — about 80 glyphs. Ordinary icons like `Add` and `Confirm` are in `/lazy` itself, so importing them from `/lazy/system` fails `tsc` with "no exported member".
- **A lazy icon is a network fetch.** `core/icon.js` fetches the glyph JSON from the CDN at render time and suspends, falling back to an empty state on failure. That is fine in the dashboard, but a unit test asserting icon markup synchronously will see the fallback. If you need the redesign glyphs statically inlined with no provider and no fetch, `@wix/wix-ui-icons-common/odeditor` is a real entry point — `lazy` is still the default here because one import keeps tracking the right set both inside and outside Business Manager.

## 5. Tokens and component adjustments

Everything you style yourself — which `--wds-*` token replaces a hardcoded value, which `skin`/`size` prop replaces an inline `style`, the spacing unit the theme rebases, and the per-component adjustments the wrapper can't make for you — is in [BUSINESS_MANAGER_TOKENS.md](BUSINESS_MANAGER_TOKENS.md). Read it before styling anything by hand.

## 6. Verify

- The entry file wraps the page in `BusinessManagerTheme`, and that file imports both stylesheets and nests all four providers in order.
- Every icon comes from `@wix/wix-ui-icons-common/lazy` (not the package root, and not `/lazy/system`).
- `grep -rn "style={{" src/` and `grep -rn "#[0-9A-Fa-f]\{3,6\}" src/` return nothing for the page's own files, or only lines carrying a justification comment.
- In devtools, a component's colours resolve from `--wds-*` properties. A literal means that element is still custom-styled.
- Hover, focus, disabled, selected, error, warning and success all render — a token gap usually surfaces in a state, not at rest.

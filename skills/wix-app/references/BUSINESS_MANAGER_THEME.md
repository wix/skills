# Business Manager theme — one wrapper, every dashboard surface

Business Manager (the Wix site dashboard) was redesigned with the Harmony theme. **A dashboard extension runs in its own iframe and inherits none of it.** `WixDesignSystemProvider` alone gives the pre-redesign look — classic icons, pre-redesign button sizes and skins — rendered inside redesigned platform chrome.

**No automated check catches this.** `tsc`, `wix build` and `wix preview` all pass on an unthemed surface — every import resolves and every component renders. The failure is purely visual, so wire it from the start.

Verified against `@wix/design-system` 1.330.0 and `@wix/wix-ui-icons-common` 3.189.28 — both providers are root exports, `IconTheme` is typed `'default' | 'odeditor'`, and `themes/odeditor.global.css`, `lazy`, `lazy/system` and `core` all ship.

## 1. Both packages, together

```bash
npm install @wix/design-system@latest @wix/wix-ui-icons-common@latest
```

The redesigned styles and matching icon set ship as a pair — update them together. An older `@wix/design-system` leaves a surface half-migrated however the providers are wired, since refinements ship continuously during the rollout.

## 2. Use the provider the package exports — never write the defaults yourself

**The values are Business Manager's, not yours.** A copy goes stale silently — three copies of this list existed across Wix in one month and had already drifted apart in both directions, and none matched the published guidance. So import the provider wherever one exists, and pass it the props you would have passed `WixDesignSystemProvider`.

**Check the installed package before writing anything:**

```bash
grep -r "BusinessManagerThemeProvider" node_modules/@wix/design-system/dist/types/index.d.ts
```

`@wix/design-system` is the only place it lives — `@wix/patterns` does not define or re-export it, because the theme is not patterns' to own.

```tsx
import { BusinessManagerThemeProvider } from '@wix/design-system';
import { i18n } from '@wix/essentials';
import '@wix/design-system/styles.global.css';
import '@wix/design-system/themes/odeditor.global.css';

<BusinessManagerThemeProvider locale={i18n.getLocale()}>
  {/* WixPatternsProvider and the page go inside */}
</BusinessManagerThemeProvider>;
```

The two stylesheet imports stay in the app's entry file: global CSS order belongs to the bundler, and a bare CSS import inside a library can be tree-shaken.

**If neither package exports it yet, write the wrapper from § 3 and treat it as temporary** — it is a copy, so it is the thing that goes stale. Say so in the handover: the app should delete it and import the provider once the package ships one. Do not invent the values from a design doc; use § 3 exactly, and if a value there looks wrong, check `@wix/design-system`'s own `businessManagerDefaultProps` rather than guessing.

What the provider applies, and why each piece is needed:

| Piece | Without it |
| --- | --- |
| `themes/odeditor.global.css` | `--wds-*` tokens keep pre-redesign values, so every component renders the old palette |
| `WixDesignSystemIconThemeProvider` + `IconThemeProvider` | Icons stay classic — heavier strokes, wrong sizes beside redesigned components |
| `WixDesignSystemDefaultPropsProvider` | Buttons and inputs render pre-redesign unless every call site passes `size`/`skin` by hand |

**Order is outermost-first and fixed**, and `WixPatternsProvider` goes *inside* the wrapper: the defaults provider must sit above the components it supplies defaults to, and the WDS leaf UI inside a patterns shell is exactly that.

A prop on a component still wins over the provider, so a one-off `size="medium"` is fine. **A nested `WixDesignSystemDefaultPropsProvider` replaces these defaults rather than merging**, so don't add a second for one subtree. And don't pass `features={{ newColorsBranding: true }}` — it predates the theme and is not a substitute.

**`Search` is in the list for a reason.** It defaults to `border: 'round'` — a full pill — while `Input` defaults to `'standard'`. Business Manager uses standard corners, so without that entry every search field comes out pill-shaped beside square inputs. The published default-props snippet omits `Search`; this one does not. It reaches a `@wix/patterns` search too: `resolveDefaultProps` fills a prop only when it is `undefined`, and patterns' `QuerySearch` passes `border: isBmHarmonyTheme ? 'standard' : undefined`, so that `undefined` falls through to here. An explicitly-valued prop would not.

## 3. The temporary wrapper, only when no package exports one

Write this **only** after checking both packages in § 2. It is a copy, so it is the thing that goes stale — delete it and import the provider as soon as one ships. The values below are `@wix/design-system`'s own `businessManagerDefaultProps`; do not add to them from a design doc.

```tsx
// src/extensions/dashboard/BusinessManagerTheme.tsx — temporary, see BUSINESS_MANAGER_THEME.md § 2
import type { FC, ReactNode } from 'react';
import { i18n } from '@wix/essentials';
import {
  WixDesignSystemProvider,
  WixDesignSystemIconThemeProvider,
  WixDesignSystemDefaultPropsProvider,
  type WixDesignSystemDefaultProps,
} from '@wix/design-system';
import { IconThemeProvider } from '@wix/wix-ui-icons-common/core';

const BUSINESS_MANAGER_DEFAULTS: WixDesignSystemDefaultProps = {
  Button: { size: 'small', skin: 'dark' },
  IconButton: { size: 'small', skin: 'dark', priority: 'tertiary' },
  TextButton: { size: 'small', skin: 'standard' },
  Input: { size: 'small' },
  Search: { size: 'small', border: 'standard' },
  TableActionCell: {
    moreActionsProps: { priority: 'tertiary' },
    secondaryActionsProps: { priority: 'tertiary' },
    primaryActionPlaceholderProps: { priority: 'tertiary' },
  },
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

Both stylesheets stay in the extension's entry file, not here. **Write this file once per app** and import it from every extension — a copy per surface is how one of them drifts.

## 4. Where the wrapper goes

**Write the file once per app; use it once per extension.** Every dashboard extension — page, modal, plugin — is a separate iframe, so each needs its own wrapper at its own root, in the file that owns the providers, never in a child, tab or helper file:

| Surface | File | Section |
| --- | --- | --- |
| Page, from any `@wix/patterns` page template | `{feature}.tsx`, holding the template's `page.tsx` | [DRAFT_TEMPLATE.md § 3](dashboard-page/DRAFT_TEMPLATE.md#3-copy-it-into-the-extension) |
| Page with dynamic parameters | `withProviders.tsx` | [DYNAMIC_PARAMETERS.md](dashboard-page/DYNAMIC_PARAMETERS.md#provider-wrapper-implementation) |
| Modal | the generated `<modal>.tsx` | [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md#theme) |
| Plugin | the generated plugin component | [DASHBOARD_PLUGIN.md](DASHBOARD_PLUGIN.md#theme) |

Each surface's own doc shows the wrapper already in place. Copy that file as-is rather than re-adding providers by hand. A plugin is the least forgiving of the three: it renders inside a redesigned first-party page, so an unthemed one is surrounded by the very styling it is missing.

## 5. Import icons from the lazy entry point

Icons imported from the package root render classic **regardless of the providers above them**. Only the lazy entry point resolves through `IconThemeProvider`:

```diff
- import { Add, Confirm } from '@wix/wix-ui-icons-common';
+ import { Add, Confirm } from '@wix/wix-ui-icons-common/lazy';
```

Use `lazy` for every icon on a dashboard surface. Outside Business Manager it keeps rendering the current set, so this is the default import, not a Business-Manager-only one. An `iconKey` in a builder file names an icon for the platform rather than importing one — leave those alone.

Two things worth knowing before you convert everything:

- **`/lazy/system` is not where app icons live.** The `system` entry holds WDS's own internal component decorations (`CheckboxChecked`, `DropDownArrow`, …) — about 80 glyphs. Ordinary icons like `Add` and `Confirm` are in `/lazy` itself, so importing them from `/lazy/system` fails `tsc` with "no exported member".
- **A lazy icon is a network fetch.** `core/icon.js` fetches the glyph JSON from the CDN at render time and suspends, falling back to an empty state on failure. That is fine in the dashboard, but a unit test asserting icon markup synchronously will see the fallback. If you need the redesign glyphs statically inlined with no provider and no fetch, `@wix/wix-ui-icons-common/odeditor` is a real entry point — `lazy` is still the default here because one import keeps tracking the right set both inside and outside Business Manager.

## 6. A `@wix/patterns` page has a second gate

Verified at `@wix/patterns` 1.486.0. Patterns does **not** read the WDS theme to decide its own look. It calls `useBmHarmonyTheme()`, which is `experiments.enabled('bmHarmonyTheme')` resolved from the patterns container (scope `cairo`) — a Petri experiment, not a provider you can set.

So a collection page can be wired perfectly per this file and still render patterns' own chrome in the pre-redesign style:

| Symptom | What patterns passes with the experiment off | Does the wrapper fix it? |
| --- | --- | --- |
| Filter button outlined, not tertiary | `ResponsiveButton` → `priority: 'secondary'` (explicit) | **No.** An explicit prop beats the defaults provider — it needs the experiment |
| Search renders as a pill | `QuerySearch` → `border: undefined` | **Yes** — `undefined` falls through to the `Search` default in § 2 |
| Toolbar icons look like the old set | `ContentFilter` from `/lazy`, resolved via `IconThemeContext` | **Yes** — that is what `IconThemeProvider theme="odeditor"` is for. A lazy icon with no provider renders the *default*, i.e. classic, set |

**So before hunting through your own code:** a filter button still rendering secondary is the experiment, not your wiring — raise it with the `@wix/patterns` team rather than overriding it per call site. An old-looking icon, by contrast, almost always means the icon providers are missing or that surface sits outside the wrapper.

## 7. Tokens and component adjustments

Everything you style yourself — which `--wds-*` token replaces a hardcoded value, which `skin`/`size` prop replaces an inline `style`, the spacing unit the theme rebases, and the per-component adjustments the wrapper can't make for you — is in [BUSINESS_MANAGER_TOKENS.md](BUSINESS_MANAGER_TOKENS.md). Read it before styling anything by hand.

## 8. Verify

- The entry file wraps the surface in `BusinessManagerThemeProvider` from the package, and imports both stylesheets itself. No hand-written provider stack, no local defaults object.
- Every icon comes from `@wix/wix-ui-icons-common/lazy` (not the package root, and not `/lazy/system`).
- `grep -rn "style={{" src/` and `grep -rn "#[0-9A-Fa-f]\{3,6\}" src/` return nothing for the page's own files, or only lines carrying a justification comment.
- In devtools, a component's colours resolve from `--wds-*` properties. A literal means that element is still custom-styled.
- Hover, focus, disabled, selected, error, warning and success all render — a token gap usually surfaces in a state, not at rest.

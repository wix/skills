# Business Manager theme for `@wix/patterns` — the second wrapper

Companion to [BUSINESS_MANAGER_THEME.md](BUSINESS_MANAGER_THEME.md). That wrapper themes the design system; this one turns on the patterns shell's own Harmony layout. A page built on `@wix/patterns` needs both.

Verified against `@wix/patterns` 1.501.0 and `@wix/dashboard` 1.3.48.

## 1. Why the WDS theme isn't enough

Patterns does not take its Harmony layout from the WDS theme. Its toolbar, search, filters, page headers and side panels switch on the `bmHarmonyTheme` experiment, and no experiment crosses into an extension iframe: `@wix/dashboard` implements no experiments host, so patterns falls back to reading **every** experiment as `false`.

The result is a hybrid page — Harmony tokens and icons around the pre-redesign patterns layout. The tell is the collection toolbar: an outlined **Filter** button and a pill-shaped search, where Harmony has a borderless Filter button and a standard search field. `tsc`, `wix build` and `wix preview` all pass on it.

An experiment override on the Business Manager URL stays in the parent frame, and neither `wix.config` nor the CLI has a setting for this. The lever is the patterns container itself: `WixPatternsContainerOverridesProvider` is the documented container override, and patterns applies its values last when it builds the container.

## 2. The wrapper — write this file once per app

```tsx
// src/extensions/dashboard/BusinessManagerPatternsTheme.tsx
import type { FC, ReactNode } from 'react';
import { WixPatternsContainerOverridesProvider } from '@wix/patterns';
import type { WixPatternsContainerParams } from '@wix/patterns/core';

const BM_HARMONY_THEME_EXPERIMENT = 'bmHarmonyTheme';

const HARMONY_CONTAINER_OVERRIDES: Partial<WixPatternsContainerParams> = {
  experiments: {
    enabled: (key) => key === BM_HARMONY_THEME_EXPERIMENT,
    get: (key) => (key === BM_HARMONY_THEME_EXPERIMENT ? 'true' : ''),
    ready: () => Promise.resolve(true),
  },
};

export const BusinessManagerPatternsTheme: FC<{ children: ReactNode }> = ({ children }) => (
  <WixPatternsContainerOverridesProvider value={HARMONY_CONTAINER_OVERRIDES}>
    {children}
  </WixPatternsContainerOverridesProvider>
);
```

- **A separate file, not part of `BusinessManagerTheme`.** Plugins and most modals don't install `@wix/patterns`, and the shared wrapper has to compile without it.
- **It replaces the host's experiments outright.** That costs nothing, because inside the iframe every other key already reads `false`. Don't add other keys to it: patterns' other experiments are its own rollouts, not app settings.

## 3. Where it goes

Every surface that renders `WixPatternsProvider` — in practice every page built from a patterns template — takes it **directly inside `BusinessManagerTheme`, above `WixPatternsProvider`**. Patterns reads the overrides once, when `WixPatternsProvider` first renders, so an override provider below it, or a value changed after mount, does nothing.

In a page template that is the entry file, around the template's app component:

```tsx
<BusinessManagerTheme>
  <BusinessManagerPatternsTheme>
    {location ? <ItemsApp location={location} /> : null}
  </BusinessManagerPatternsTheme>
</BusinessManagerTheme>
```

Pickers and the other containers patterns nests inherit it, so they need no second override provider.

## 4. Verify

- Every `WixPatternsProvider` sits below `BusinessManagerPatternsTheme`, which sits directly inside `BusinessManagerTheme`.
- On a collection page in the dashboard, the toolbar's Filter button has no border and the search field is not pill-shaped. An outlined Filter button or a pill search means patterns never got the experiment: the override provider is missing, or it sits below `WixPatternsProvider`.

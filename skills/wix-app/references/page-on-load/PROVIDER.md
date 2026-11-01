# Page onLoad Provider and Registration

## Provider Component Pattern

Goes in `page-on-load-<task-kebab-case-name>.tsx`. **`UtmCapture` below is the example task, not a fixed name** — replace that token everywhere it appears (component, context, hook, folder, both filenames) with the task-derived name for the actual request (see [Naming](../PAGE_ON_LOAD.md#naming)).

```typescript
import React, { createContext, useContext, useEffect } from 'react';

// No API is exposed — the context value is always `undefined`.
const PageOnLoadUtmCaptureContext = createContext<undefined>(undefined);
PageOnLoadUtmCaptureContext.displayName = 'PageOnLoadUtmCaptureContext';

// A hook is exported because the manifest's contextSpecifier.hook is required.
// It is intentionally not meant to be consumed by other components.
export function usePageOnLoadUtmCapture(): undefined {
  return useContext(PageOnLoadUtmCaptureContext);
}

export interface PageOnLoadUtmCaptureProps {
  children?: React.ReactNode;
}

export function PageOnLoadUtmCapture({
  children,
}: PageOnLoadUtmCaptureProps): React.ReactNode {
  useEffect(() => {
    // The requested side effect goes here. For async work, define and call an
    // inner async function — do not make the effect callback itself async.
    const run = async (): Promise<void> => {
      // e.g. send a BI / analytics event, read UTM params from the URL...
    };
    void run();
  }, []); // empty deps → runs once, on page render

  return (
    <PageOnLoadUtmCaptureContext.Provider value={undefined}>
      {children}
    </PageOnLoadUtmCaptureContext.Provider>
  );
}

PageOnLoadUtmCapture.displayName = 'PageOnLoadUtmCapture';
export default PageOnLoadUtmCapture;
```

> The hook (`usePageOnLoad<TaskName>`) and the `default` export are **required by the Wix extension manifest** (`contextSpecifier.hook`) and runtime loader, even though nothing consumes the hook. The context and the component can't share a name, so they are `PageOnLoad<TaskName>Context` and `PageOnLoad<TaskName>`.

### Key rules for the provider component

- **Always** set `displayName` on both the context and the provider component.
- **Always** accept `children` and render them inside the Provider — the page's content renders as children of the context.
- **Always** export the provider as both a named export and `default` — the Wix runtime loads the provider via its default export.
- The context value is always `undefined` — this provider exposes no API.

## Extension Registration

`wix generate` writes `page-on-load-<task-kebab-case-name>.extension.ts` and registers it in `src/extensions.ts`. Edit the generated file; the finished shape of the parts you change, for the example task `UtmCapture` (substitute your task per [Naming](../PAGE_ON_LOAD.md#naming)):

```typescript
// No exposed items and no inputs: both fields stay, empty (they are required).
context: { items: {} },
data: {},
resources: {
  client: {
    url: './extensions/site/contexts/page-on-load-utm-capture/page-on-load-utm-capture.tsx',
  },
  contextSpecifier: {
    // Required by the manifest even though nothing consumes it.
    hook: 'usePageOnLoadUtmCapture',
    moduleSpecifier: '<moduleSpecifierPrefix>page-on-load-utm-capture',
  },
},
```

- **`hook`** must be the exact hook name the provider file exports. The scaffold's `useCounterContext` stops existing when you rewrite the file.
- **`moduleSpecifier`** is `<moduleSpecifierPrefix>` plus the folder name. Module specifiers are unique across all of Wix, so an unprefixed one can belong to another app and fail the checkpoint with `Error during component specifier upsert`.
- **Dependencies.** Run `npm install @wix/site`: it provides `analytics`, and is often present only as a transitive dependency.
- **Unique `type`.** The `type` is built from the context's `name` and is globally unique. A second context with the same name fails with `componentType already exists` (code 2018), which the platform's background preview reports: rename it.
- **`data`** is only needed if the side effect must be configurable from the Editor (e.g. a configurable event name); otherwise keep `data: {}`.

## Binding to a page (manual)

After creating and registering the context, **tell the user** to attach it to each target page in the Wix Editor:

> Open **`<page name>`** → **Page Settings → Contexts** → add the context you registered, listed under its `name` (for example **Page On Load Utm Capture**).

Reusing one context across pages means repeating this step per page, not creating a new context per page. Binding is a manual Editor step today — do NOT attempt to bind the context to a page programmatically.

## Examples

See [EXAMPLES.md](EXAMPLES.md) for documented imports and page onLoad templates by use case. Examples share the provider shape shown above; substitute the task-derived name (see [Naming](../PAGE_ON_LOAD.md#naming)) — only imports and the body of the `useEffect` change per use case.

> ⚠️ **Runtime support — use `@wix/site` analytics + browser-native APIs; NEVER use `@wix/site-*`.** `@wix/site` (`analytics.trackEvent`) works, but the separate `@wix/site-*` packages (`@wix/site-window`, `@wix/site-location`, `@wix/site-seo`) throw `Wix Site SDK only works in a Wix site environment` in the Studio 2 runtime — even when the provider is correctly bound and the effect is firing. Read URL/UTM params from `window.location.search` and the visitor locale from `navigator.language` (both inside the `useEffect`); do **not** import `@wix/site-window` or `@wix/site-location`. **Setting SEO tags is out of scope** for page onLoad — there is no client-side path and a client effect can't reach crawlers; set SEO server-side (router `response.data` / the page's SEO settings) instead. See [EXAMPLES.md](EXAMPLES.md).

## Code Quality Requirements

- Strict TypeScript, no `any`.
- Explicit return types for all functions.
- SSR-safe: no browser APIs at module scope. Browser globals (`window`, `navigator`) are fine **inside `useEffect`** (client-only); guard defensively with `if (typeof window !== 'undefined')`.
- Functional components with hooks; `const`/`let` only.
- No `@ts-ignore`. The one exception in [CODE_QUALITY.md](../CODE_QUALITY.md) is for importing another context, which this context never does.
- Always set `displayName` on the context and the provider.

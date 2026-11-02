# Lightbox

> **Studio 2 editor only.** This extension type works only on sites built in the Studio 2 editor. It does not run on Harmony, the classic Wix Editor or Wix Studio (Editor X), so do not offer it for those sites.

A lightbox in Studio 2 is a **popup page**: a page that opens over the current page. Code opens it, closes it, and passes it data through the **lightbox service** (`@wix/site-service-lightbox`). The rules below apply to every extension that renders on the site. Build the extension itself from its own reference (for a context provider, [CONTEXT_PROVIDER.md](CONTEXT_PROVIDER.md)); this file adds only the popup rules.

## Three Rules for Every Extension

1. **Use the lightbox service, never `@wix/site-window`.**
2. **Declare the services in the extension's manifest.**
3. **Find the popup by its popup ID.**

### 1. Use the Lightbox Service, Never `@wix/site-window`

`window.openLightbox()`, `lightbox.getContext()` and `lightbox.close()` from `@wix/site-window` are Velo frontend APIs. They do not run in the extension: Studio 2 pages have no `window.clientSdk`, the bridge these calls need, so every call rejects with `Wix Site SDK only works in a Wix site environment` and the popup never opens. Nothing on the page shows the unhandled rejection.

Read the services with `useService`:

```ts
import { useService } from '@wix/services-manager-react';
import { LightboxDefinition, type ILightboxService } from '@wix/site-service-lightbox/definition';
import { PagesDefinition, type IPagesService } from '@wix/site-service-pages/definition';
```

Install these as direct `dependencies`: `@wix/site-service-lightbox` and `@wix/site-service-pages` at their latest versions, and `@wix/services-manager-react`. The project often has an older `@wix/site-service-pages` only as a transitive dependency, whose types have no `slug` field; installing it directly fixes that. `@wix/services-manager-react` is usually only a transitive dependency too, so add it directly. This skill is the reason to add them, so a "do not invent imports" rule in another skill does not block them.

> **Version 2 renamed `context` and `getContext()` to `payload` and `getPayload()`, but the Studio 2 host provides only the old ones** (`open`, `close`, `getContext`). `getPayload()` throws `TypeError: lightbox?.getPayload is not a function`, and `open({ slug, payload })` alone opens the popup with no data and no error. Only a run shows it: `tsc` and `wix build` pass. Keep version 2 and send the data under both keys, then read it with the helper in [Reading the Payload](#reading-the-payload-in-the-popup).

### 2. Declare the Services in the Extension's Manifest

A live site loads a service only when an extension on the page declares it. The editor preview loads every service, so code that skips the declaration works in preview and fails on the published site: `useService` throws `Service @wix/site-service-lightbox is not provided`.

Add both services to the extension's `serviceDependencies`, next to any `contextDependencies` it already has, in every resource that renders:

```ts
dependencies: {
  serviceDependencies: ['@wix/site-service-lightbox', '@wix/site-service-pages'],
},
```

For a context provider, this is `resources.dependencies`. For an Editor React Component, it is `resources.client.dependencies` and `resources.editor.dependencies`.

### 3. Find the Popup by Its Popup ID

The lightbox service opens a popup by its **slug**, but the editor generates the slug (`popup-xxnez-evf5t-1-1-1-1-2-2-1-5`) and a site owner can change it. The popup's title ("New Popup") can also change, and two popups can share it. Only the **popup ID** (`skx1r`) stays the same. It is the `popupId` that the editor reports when the popup is created or listed, and the key of the pages service's `pages` map.

1. Take the popup ID from the extension's configuration: a `popupId` text field in the manifest `data` section, with no `defaultValue`. The editor sets it; a manifest `defaultValue` does not reach an extension that is already on the page, which receives `''`. Never hard-code a popup ID, slug, or title in code.
2. Look up the slug at the moment the code opens the popup: `pages.pages[popupId]`, and check that its `popup` is `true`.
3. Open it: `lightbox.open({ slug: page.slug, payload: data, context: data })` (the same object under both keys).

## Opening the Popup

- **Catch the rejection of `open()`.** It rejects when no popup has the slug or the popup page fails to load. Never leave it as `void lightbox.open(...)`.
- **Expose or show the failure.** When the popup ID is empty, matches no popup, or `open()` rejects, report it: a derived boolean such as `isPopupErrorHidden` for a context provider, or rendered error text for a component.
- **Pass everything the popup shows in the payload.** The popup page is a separate page and does not see the opener's state. Keep the context to plain JSON values. A popup that shows the same content for every opener needs none. Popups cannot stack: opening a popup closes any popup that is open, and opening the one that is already open keeps it open and replaces its payload with the one you pass (or `undefined`).
- **One open action per opener.** Every element that opens the popup gets its own action, which already knows what to send. In a context provider, prefer a no-parameter function on each item, so the binding needs no arguments. A single function that takes an item ID also works, if the binding passes the clicked item's ID. When the opener is repeated (a repeater, a list), put the action on each item.
- **A condition opens the popup from an effect**, not from a click: open it in a `useEffect` when the derived condition becomes true, once.

## Reading the Payload in the Popup

- Read the payload once, when the popup page mounts: `useState(() => readPayload<MyPopupPayload>(lightbox))`. It is synchronous and returns `undefined` when no popup is open, and in the editor. The type is not checked against what `open()` sent.

```ts
function readPayload<T>(lightbox: ILightboxService | undefined): T | undefined {
  // Some Studio 2 hosts only provide getContext, the deprecated name of getPayload.
  return typeof lightbox?.getPayload === 'function'
    ? lightbox.getPayload<T | undefined>()
    : lightbox?.getContext<T | undefined>();
}
```

- Show each value with a plain fallback (`''`) when the context is missing, and show an empty state for that case.
- Close from code with `lightbox.close()` only when the request asks for it — a "Done" button, after "Copy code", after a timer. The popup's own close button and the Escape key need no code.

## The Services May Be Missing

`useService` throws when the page has no services manager or does not provide the service — for example in the editor canvas, or on a live site without the manifest declaration. Wrap each service in a hook that returns `undefined` instead, and make every action a safe no-op when its service is missing:

```ts
function useLightbox(): ILightboxService | undefined {
  try {
    return useService(LightboxDefinition);
  } catch {
    return undefined;
  }
}
```

Call these hooks in a component that does not suspend, and pass the services down, so a loading fallback and the loaded content share them.

## When the Code Is a Context Provider

- **Attach the same provider to the opening page and to the popup page.** On the opening page it exposes the open functions; on the popup page it reads the payload and exposes what the popup shows. These are two instances: React state set on the opening page is not visible in the popup, so never expose "the selected item" from opener state for the popup to bind.
- Expose each shown value as its own context item, and the missing-context state as derived booleans (`isSelectionHidden`, `isEmptyStateHidden`), per [Derived Values](context-provider/DERIVED_VALUES.md#derived-values-mandatory).
- Expose `closePopup` (a no-parameter function) when the request closes the popup from code.

## What Code Cannot Do

- **Return data from the popup to the opener.** `close()` returns nothing, and `open()` resolves when the popup opens, not when it closes. If the opener must react to something done in the popup, the popup saves it (a CMS write, a backend call) and the opener reads it from there.
- **Add or attach the popup.** Creating the popup page, adding its elements, placing or attaching the extension, and setting `popupId` are editor work. Name each one in your final message.
- **Replace the auto-open setting.** A popup that opens automatically on page load, on chosen pages and after a fixed delay, is the popup's auto-open setting in the editor. Write no code for it; write code only when the request adds a condition the setting cannot express (once per visitor, only for members, only when the cart has items).

## Quick Start Checklist

1. [ ] Build the extension from its own reference (a context provider: [CONTEXT_PROVIDER.md](CONTEXT_PROVIDER.md))
2. [ ] Install `@wix/site-service-lightbox`, `@wix/site-service-pages` (both latest) and `@wix/services-manager-react` as direct `dependencies`
3. [ ] Add `serviceDependencies` for both services to every rendering resource of the manifest
4. [ ] Add the `popupId` text field to the manifest `data` section
5. [ ] Opening side: one open action per opener, `payload` and `context` with everything the popup shows, caught rejection, exposed failure
6. [ ] Popup side: `readPayload()` once on mount, fallbacks and empty state, `close()` when asked
7. [ ] Final message: the editor steps — attach or place the extension (a context provider on both pages), set its **Popup ID** to the popup's `popupId`, and bind or connect the elements

## Reference

- [EXAMPLES.md](lightbox/EXAMPLES.md) — a repeater whose buttons open a popup with the clicked item's data.
- [EXAMPLES_CONDITION.md](lightbox/EXAMPLES_CONDITION.md) — a countdown that opens a popup at zero and closes it from a button.

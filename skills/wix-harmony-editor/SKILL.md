---
name: wix-harmony-editor
description: Edit Wix Harmony sites through an authenticated Harmony editor using Playwright over a local Chrome CDP session. Use for inspecting, changing, saving, and verifying Harmony editor components and layouts; do not use for Wix Studio, the classic Editor, Dashboard data, or publishing without explicit approval.
---

# Wix Harmony editor

Work through the Wix Harmony editor, not the published site. Use the local Chrome launcher and Playwright; the standard in-app browser may not expose the isolated Chrome CDP session.

## Safety and scope

- Treat the editor as a persistent external system. Inspect before writing.
- Obtain clear user authorization immediately before a persistent change unless the request already explicitly authorizes that exact change. State the component and intended effect.
- Never publish unless the user explicitly asks. Saving a draft is not publishing.
- Work only on visible front-end editor content. Dashboard data (Stores, Bookings, contacts, orders, coupons, members, blog posts, or settings) is out of scope.
- The launcher uses a separate Chrome profile. Never use, copy, or inspect the user's normal Chrome profile.
- Do not expose cookies, local storage, headers, session data, or CDP WebSocket URLs. Use only the local `http://127.0.0.1:9333` endpoint launched for this task.
- If the sandbox blocks `connectOverCDP` with `EPERM`, request elevation specifically for the local loopback connection. Do not use a remote host, a different port, or a workaround that exposes the debugger.

## Launch and authenticate

Run the bundled launcher with the Wix editor URL:

```bash
skills/wix-harmony-editor/scripts/launch.sh 'https://example.editor.wix.com/edit/...'
```

It starts a headed Chrome instance with an isolated, private profile and a loopback-only CDP port. If Wix shows a sign-in page, let the user authenticate in that browser. Never ask for or enter credentials yourself.

The launcher is intentionally quiet about CDP internals. It reports only whether local Chrome is reachable.

## Attach with Playwright

Confirm the expected editor is open before doing anything else:

```bash
node --input-type=module -e "
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const pages = browser.contexts().flatMap(context => context.pages());
console.log(await Promise.all(pages.map(async page => ({ url: page.url(), title: await page.title() }))));
await browser.close();
"
```

In a Playwright script, resolve the editor page mechanically:

```js
const page = browser.contexts()
  .flatMap(context => context.pages())
  .find(page => page.url().includes('editor.wix.com/edit/'));

if (!page) throw new Error('No authenticated Wix Harmony editor page is open.');
```

`browser.close()` detaches Playwright; it does not close the launched Chrome instance.

## Initialize and use the Harmony API

All API code runs in `page.evaluate`:

```js
const api = await repluggableAppDebug.host.getAPI({
  name: 'RunEditorLLMCodeToolAPI',
  public: true,
  layer: 'DATA_SERVICE',
});
```

Execute editor code with the required editor context:

```js
await api.execute(
  { code: 'return await editorLLMApis.catalog.list();' },
  { biParams: {} },
);
```

The `{ biParams: {} }` second argument is required in this workflow. Omitting it produces `Cannot read properties of undefined (reading 'biParams')`; that error changed nothing in the observed case, but do not use failed calls to discover write signatures.

### Discover before acting

1. Start with `editorLLMApis.catalog.list()` for namespace orientation.
2. Read documentation only for namespaces needed by the task, in one documentation-only call:

   ```js
   return await editorLLMApis.catalog.describe({
     namespaces: ['pages', 'components', 'layout', 'breakpoints', 'appearance', 'site'],
   });
   ```

3. Never introspect undocumented API objects or guess a write method's arguments.
4. Open/focus the correct page before reads, because component reads resolve against the focused page.
5. Use IDs, element paths, units, tokens, and schemas returned by live reads—never assumed values.
6. After every write, do a fresh read of the normalized, user-visible result. A write echo alone is not verification.

Common namespaces: `pages` (focus the page), `components` (find and inspect), `layout` (measure and resize), `breakpoints` (desktop/mobile view), `appearance` (borders/backgrounds), and `site` (save/publish status).

## Execution pattern

```js
const result = await page.evaluate(async () => {
  const api = await repluggableAppDebug.host.getAPI({
    name: 'RunEditorLLMCodeToolAPI',
    public: true,
    layer: 'DATA_SERVICE',
  });

  return api.execute({
    code: `
      const focused = await editorLLMApis.pages.getFocused();
      return { focused };
    `,
  }, { biParams: {} });
});
```

Check the returned action result for errors before taking the next step.

## Example: make a hero frame responsive

When a hero frame scales in width but its text overflows at wide desktop sizes, find visible title text, inspect its ancestors, and identify the bordered frame container:

```js
const title = await editorLLMApis.components.find({
  textContains: 'Hero title',
  limit: 20,
});

const inspection = await editorLLMApis.components.inspect({
  componentId: title.components[0].id,
  aspects: ['layout', 'styles'],
  neighbourhood: true,
});
```

Read the frame's declared layout and composition. A typical problem is a percentage width paired with fixed pixel height while the text uses `spx` sizing:

```js
const frameId = 'REPLACE_WITH_FRAME_COMPONENT_ID';
const layout = await editorLLMApis.layout.get({ componentId: frameId });
const composition = await editorLLMApis.layout.getComposition({ componentId: frameId });
const measured = await editorLLMApis.layout.measure({ componentId: frameId });
return { layout, composition, measured };
```

For a frame declared as `height: { value: 536, unit: 'px' }`, the responsive repair is normally to preserve the value and use Wix scaled pixels. After authorization:

```js
const updated = await editorLLMApis.layout.setSize({
  componentId: frameId,
  height: { value: 536, unit: 'spx' },
});

const verifiedLayout = await editorLLMApis.layout.get({ componentId: frameId });
const status = await editorLLMApis.site.getStatus();
return { updated, verifiedLayout, status };
```

Verify that the stored height is `{ type: 'spx', value: 536 }`, that the editor reports a successful save state, and that the site remains unpublished unless publication was explicitly requested.

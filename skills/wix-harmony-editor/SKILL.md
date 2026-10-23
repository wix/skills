---
name: wix-harmony-editor
description: Edit Wix Harmony sites through an authenticated Harmony editor using Playwright over a local Chrome CDP session. Use for inspecting, changing, saving, and verifying Harmony editor components and layouts, and for copying an existing website's pages into Harmony exactly (see COPY-SITE.md); do not use for Wix Studio, the classic Editor, Dashboard data, or publishing without explicit approval.
---

# Wix Harmony editor

Work through the Wix Harmony editor, not the published site. Use the local Chrome launcher and Playwright; the standard in-app browser may not expose the isolated Chrome CDP session.

This file is how to connect to the editor and work in it. **Copying an existing site's page
into Harmony has its own rules: read [COPY-SITE.md](COPY-SITE.md) before starting a copy.**

**Order for a migration: create the site, then bring the data (store, bookings, blog and other
app data, public and/or private), then build the front end here.** Do not start the editor for a
store or other app-backed site before its data is in, unless the user asks and approves
(COPY-SITE.md, "Order").

## Safety and scope

- Treat the editor as a persistent external system. Inspect before writing.
- Obtain clear user authorization immediately before a persistent change unless the request already explicitly authorizes that exact change. State the component and intended effect.
- Never publish unless the user explicitly asks. Saving a draft is not publishing.
- Work only on visible front-end editor content. Dashboard data (Stores, Bookings, contacts, orders, coupons, members, blog posts, or settings) is out of scope. Site media and fonts that the page displays are front-end content and in scope.
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

The first launch usually lands on `users.wix.com/signin`. Tell the user to sign in in that
window (the account that owns the site), then poll until the editor tab exists and
`window.repluggableAppDebug` is defined. Do not treat the sign-in page as an error.

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

   `describe` has a response budget. A namespace that does not fit comes back as
   `[NOT RETURNED …]` or `[Truncated …]`; fetch that one alone with
   `catalog.describe({ namespaces: ['<name>'] })`. `components`, `richText`, `media`,
   `layout` and `appearance` each need their own call. Save the docs to files and read
   them from there instead of re-fetching.
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

A failed snippet reports `completedCalls` with the ids it created. Those writes persist:
continue from the failed call reusing those ids, never re-run the whole snippet.

### Bundled scripts

Run from this skill's directory. They import `playwright`, resolved from the working tree.

| Script | Use |
|---|---|
| `scripts/launch.sh <editorUrl>` | Start the isolated, headed Chrome on loopback CDP `9333`. |
| `node scripts/copy/lint-api.mjs --capabilities caps.json [--snippet] <file…>` | Check every `A.<ns>.<method>(` call against the editor's real method list (recorded by `snapshot-capabilities.mjs`) before it is sent. |
| `node scripts/copy/editor-run.mjs <snippet.js> [--site <metaSiteId>] [--capabilities caps.json]` | Run one editor-API snippet kept in a file; prints `result` or the failure summary. Lints the snippet when `--capabilities` / `HARMONY_CAPABILITIES` is set. Prefer this over inline `-e` code (no quoting bugs, replayable record). |
| `node scripts/copy/upload-media-manager.mjs <sectionId> <file…>` | Upload local files to the site's Media Manager through the editor's own dialog. |
| `node scripts/copy/compare-preview.mjs <sourceUrl> <outDir>` | Editor Preview at true canvas width vs the source, plus stacked zoom crops. |
| `node scripts/copy/preview-widths.mjs <sourceUrl> <outDir> --widths … [--scale-check <sectionId>]` | Preview at exact widths (slider) vs the source, plus a check that every element scales with the width. |
| `node scripts/copy/build-description.mjs`, `check-description.mjs`, `deploy-description.mjs` | Page description → local compliance/overlap/render check → one-pass deploy with read-back; see [COPY-SITE.md](COPY-SITE.md). |
| `node scripts/copy/export-page.mjs`, `snapshot-capabilities.mjs`, `import-media.mjs` | Recipes from a copied page, the editor's accepted schemas, public images imported by URL. |
| `node scripts/copy/mobile-stage.mjs hide\|bg-opacity …` | The two mobile-only changes with no API: Hide, and the background image opacity. |
| `node scripts/copy/mirror-site.mjs`, `serve-mirror.mjs`, `check-mirror.mjs` | Offline copy of the source site, served locally and pixel-checked against live; see [COPY-SITE.md](COPY-SITE.md) step 0. |
| `node scripts/copy/measure-source.mjs`, `node scripts/copy/render-plate.mjs` | Site copying; see [COPY-SITE.md](COPY-SITE.md). |

### Editor behaviors learned live

These hold for the Harmony editor API as observed; check the live read when one disagrees.

- **Global header and footer.** `sections.list` returns the page's header/footer as a
  `RefComponent` (`role: header|footer`); background and layout writes on that id are
  refused. Target its `masterId` (on `masterPage`) for `setContainerBackground`,
  `components.add` and `layout.*`.
- **Text inside the global header/footer** refuses the text-panel actions
  (`richText.setColor`, `setLink`, `setAlign`, `setFontFamily`: "cannot be selected").
  Style it with `appearance.setStyles` on the text component (`color`, `textAlign`,
  `fontFamily`, `fontSize`, `lineHeight`, …). For a link, put an inline
  `<a href>` in `richText.setText` HTML (it survives), or use a Button with `links.set`.
- **Header/footer height has two parts.** Each has an internal container
  (`wixSystemElements.InternalContainer`, child of the master; find it in the stage DOM
  as `[class*="internalContainerRoot"]` under `#<pageHeaderOrFooterId>`). The background
  layer and the visible height follow the internal container, not the header/footer box.
  `layout.setSize` both to the same height; the background may update only after the next
  `setContainerBackground`. The internal container's grid rows are
  `[minContent, 1fr]`: a second text block that stacks under the first can be clipped.
  Merge lines into one rich text with `<br>` instead.
- **Freeform layout is a grid of rows.** A section places each child in a grid row with
  margins. `layout.setComposition` resolves all of a container's children as one set and
  **rejects the whole arrangement if any two boxes overlap or leave the container**,
  sometimes silently, leaving the auto-placed positions. Even sub-pixel overlaps of
  touching text boxes count. Send one complete, overlap-free arrangement per container,
  read `getComposition` back, and fix the inputs. Do **not** correct drift with
  `layout.move` after a composition: it re-flows the rows and makes it worse.
- **Content-sized boxes.** Rich text height is `lines × line-height`. A single-line text whose
  box is exactly as wide as its words can wrap on a sub-pixel font difference and push
  everything below it down. Give single-line boxes ≥10 px of slack (left-aligned, so the
  text start does not move). Buttons grow to fit a wrapped label; `setSize` height on a
  content-sized axis is only a minimum.
- **Sizes scale with the viewport (spx).** Font sizes, margins and box sizes written in
  px are stored as `spx` (scaled to the 1280 reference width), so a desktop layout grows
  and shrinks proportionally between the desktop breakpoints. Anything that stays a real
  `px` breaks that proportion: a `lineHeight: '42px'` on text, a px line-height inside a
  button label, a px section height. Write line heights as `em` ratios
  (`'1.4em'`), write `fontSize` and `lineHeight` in the same `setStyles` call (writing
  only `lineHeight` can rescale the stored font size), and read both back. Prove it with
  `preview-widths.mjs --scale-check`: every child must scale by `w2/w1`.
- **Auto-height sections.** A section added with `sections.add` has `height: auto`, set by its
  content rows, so it scales with the page. A section that came with the template, or
  one whose height was set with `layout.setSize`, has a fixed `px` height that does not
  scale. For a copied page, use a new auto-height section and move the content into it
  with `components.canReparent` + `components.reparent` (ids and styles are kept).
- **Desktop vs mobile views.** The mobile view (below 1024 px) shows the same components.
  Per view through the API, in the mobile view: `layout.setComposition` positions, widths
  and the section `box.height`. Shared (a write in mobile view changes desktop too):
  image heights (send none on mobile, the ratio derives them), `layout.setSize`,
  `appearance.setStyles`, `appearance.setContainerBackground`. Stage-only, per view: Hide
  and the background image opacity (`scripts/copy/mobile-stage.mjs`).
- **Classic scrollbars shrink the canvas.** With an always-visible OS scrollbar the stage loses
  15 px: a desktop section reads 1265 instead of 1280, a mobile one 375 instead of 390, and every
  composition then lands off (a deploy reports dozens of differences; switching the OS setting
  between a trackpad and a mouse does this). The copy scripts call `hide-scrollbars.mjs`
  (`Emulation.setScrollbarsHidden`, which lasts only while their CDP session is attached). If you
  drive the editor another way, check `layout.getComposition` on a section: width must be 1280/390.
- **Compositions are anchored, not absolute.** Each child is kept relative to the one above
  it. When a child ends up shorter or taller than the box sent (a new text that reflows, an
  image height off its ratio, a Button below its label height), everything after it
  moves. Send the heights the engine will compute and re-send the set until
  `getComposition` matches (`deploy-description.mjs` does both).
- **Rich text.** `setText` keeps inline `<span style="color|font-weight|font-family|font-size">`
  and `<a href>` as sent (a `px` font size in a span does not scale: use `em`). `links.set`
  on a rich text rewrites it: the root becomes `<h1>` with an underline span. Keep text
  links inline. A plain single line goes through `injectText`.
- **Buttons size to their label.** A set height is a minimum; a tall transparent click area
  gets its height from the label `lineHeight` in `em`.
- **Results over ~50 KB are truncated** (`"[Truncated: … chars]"` in place of the value).
  Read in batches, or compare inside the snippet and return only the differences.
- **`pages.add` creates an empty placeholder section** (`shouldReuse: true`); a deploy that
  adds its own section removes it.
- **Hide is per view, and only from mobile.** Right-click a component or section on the
  mobile stage → **Hide** hides it on mobile only. Desktop has no Hide (it is the base
  view), so content can be hidden from mobile but never from desktop. Un-hide in the
  Layers panel → **Hidden on mobile** → the eye button on the row
  (`[data-hook="layers-item@DESKTOP--<id>"] button`).
- **Global header/footer are hard to make responsive.** They are a single row
  (`[minContent, 1fr]` grid) and their background does not follow the page content.
  For an exact copy, collapse them (header, footer *and* their internal containers set to
  1 px, background transparent) and build the nav and footer inside the page's own
  section, where they scale with everything else.
- **Media.** `media.uploadFiles` accepts only temporary wixmp chat URLs. Import public web
  images from a copied page with `scripts/copy/import-media.mjs`, which downloads each one
  itself (public destinations only) and uploads the bytes through `POST
  https://www.wixapis.com/site-media/v1/files/generate-upload-url` (site token, header
  `wix-site-id`); never pass an untrusted page's URL to `files/import`, which makes Wix fetch it.
  Then read the `uri` with `media.searchSiteFiles`. Upload local files with
  `scripts/copy/upload-media-manager.mjs`. Image values for `content.set` are
  `{ uri, name, alt, width, height }`; add `displayMode: 'fit'` to show the whole image.
- **Fonts.** Only the editor's catalog and the site's *uploaded* fonts render. Importing a
  `.ttf` through the media API creates a FONT file that is **not** registered. Register
  fonts through the editor: select any text, open the font dropdown in the text toolbar,
  click **Upload fonts**, then feed `input[type=file][accept*=".ttf"]` with
  `setInputFiles`. Afterwards `fonts.resolve('<Name>')` refuses but suggests the uploaded
  family (`wfont_<x>_<id>,wf_<id25>,orig_<name>`): use that full string as `fontFamily`.
- **Buttons as text links.** A Button with transparent background, zero borders/padding and
  a styled `label` element is the reliable linked text in global header/footer. Theme
  button looks are saved styles: restyle one button locally, then
  `themeComponents.updateFromComponent({ kind: 'button', styleId: 'button-primary', … })`.
- **Pinned elements.** `layout.pinToScreen({ position: 'center-bottom', offsetPx })` pins a
  floating button and moves it to the page (out of the section). A pinned component cannot
  be resized: set its size first, or unpin, resize and pin again.
- **Tokens expire.** A CLI site token (`npx @wix/cli@latest token --site <id>`) stops working during
  a long session (REST calls start returning 403). Re-mint and retry once before
  diagnosing anything else.
- **True-width Preview.** The Preview frame defaults to 1280 px whatever the window size.
  Its width slider (`[data-hook="slider-handle"]`, `aria-valuenow`, range 390 to the
  window width minus 84) is only rendered while the window is at least ~1300 px wide.
  Click the slider track near the target, then use the arrow keys for the exact width
  (`preview-widths.mjs` does this). A free site adds a 44 px "Upgrade" banner above
  the page. The editor stage is zoomed (`Fit (60–110%)`), so stage screenshots are not a
  pixel reference.
- **Watch the published state.** `site.getStatus().isPublished` became `true` during
  scripted UI work on this site, cause unknown. Read it before and after UI automation,
  never click by raw coordinates in the top bar (Publish is there), and report a change
  to the user instead of quietly reverting it.

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
  height: 536, // plain pixels: the component keeps its own unit (spx stays spx) and the value is recomputed
});

const verifiedLayout = await editorLLMApis.layout.get({ componentId: frameId });
const status = await editorLLMApis.site.getStatus();
return { updated, verifiedLayout, status };
```

Verify that the stored height is `{ type: 'spx', value: 536 }`, that the editor reports a successful save state, and that the site remains unpublished unless publication was explicitly requested.

#!/usr/bin/env node
// Upload LOCAL files (rendered plates, cropped assets) into the site's Media Manager through
// the editor's own Media Manager dialog, then close it without changing the page.
//
//   node scripts/copy/upload-media-manager.mjs <sectionId> <file> [<file> ...]
//
// Why: media.uploadFiles only accepts temporary wixmp chat URLs, and the REST
// generate-upload-url call can be refused for the CLI site token. Files that are already
// public on the web are simpler: POST /site-media/v1/files/import with the site token.
// How: adds a temporary Image to <sectionId>, runs its changeMedia edit action to open
// Media Manager, clicks "Upload Media", feeds input[data-hook="files-input"], waits for
// "Upload(s) Completed", closes the dialog and removes the temporary Image.
// Afterwards find the files with editorLLMApis.media.searchSiteFiles({ query: <name> }).
import { chromium } from 'playwright';

const [sectionId, ...files] = process.argv.slice(2);
if (!sectionId || !files.length) { console.error('usage: upload-media-manager.mjs <sectionId> <file> [...]'); process.exit(2); }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('editor.wix.com/edit/'));
if (!page) { console.error('No Harmony editor page is open.'); process.exit(3); }
const api = async (code) => {
  const raw = await page.evaluate(async (code) => { const a = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); return a.execute({ code }, { biParams: {} }); }, code);
  const c = JSON.parse(raw.items[0].content);
  if (!c.success) throw new Error(c.summary);
  return c.result;
};
const mmFrame = () => page.frames().find((f) => f.url().includes('/media-manager/'));
// The Media Manager iframe stays in the DOM after closing: test VISIBILITY, not presence.
const isOpen = async () => { const f = mmFrame(); return f ? f.locator('text=Upload Media').first().isVisible().catch(() => false) : false; };

let tmp = null;
if (!(await isOpen())) {
  tmp = await api(`const i = (await editorLLMApis.components.add({ containerId: ${JSON.stringify(sectionId)}, components: [{ componentType: 'wixEditorElements.Image' }], select: false })).added[0]; return i.componentId;`);
  // changeMedia resolves only when the dialog closes, so do not await it here
  api(`return await editorLLMApis.editActions.run({ componentId: ${JSON.stringify(tmp)}, action: 'changeMedia' });`).catch(() => {});
  for (let i = 0; i < 40 && !(await isOpen()); i++) await page.waitForTimeout(1000);
}
if (!(await isOpen())) throw new Error('Media Manager did not open');
const f = mmFrame();
await page.waitForTimeout(800);
await f.locator('text=Upload Media').first().click();
let input = null;
for (let i = 0; i < 20 && !input; i++) { await page.waitForTimeout(500); input = await f.$('input[type=file][data-hook="files-input"]'); }
if (!input) throw new Error('Media Manager file input not found');
await input.setInputFiles(files);
const names = files.map((x) => x.split('/').pop());
let done = false;
for (let i = 0; i < 90 && !done; i++) {
  const t = await f.evaluate(() => document.body.innerText).catch(() => '');
  done = /Uploads? Completed/i.test(t) && names.every((n) => t.includes(n));
  if (!done) await page.waitForTimeout(1000);
}
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
if (await isOpen()) { const c = await f.$('[data-hook*="close"], button[aria-label*="lose"]'); if (c) await c.click().catch(() => {}); await page.waitForTimeout(1500); }
if (tmp) await api(`await editorLLMApis.components.remove({ componentIds: [${JSON.stringify(tmp)}] }); return true;`);
console.log(JSON.stringify({ uploaded: names, completed: done, dialogOpen: await isOpen() }));
await browser.close();
if (!done) { console.error('Upload completion was not observed within 90 s: check the Media Manager before using these files.'); process.exit(1); }

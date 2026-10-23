#!/usr/bin/env node
// Snapshot what the live editor accepts, for check-description.mjs (compliance guard 1): the addable component types and, for each type a copy uses, every writable
// style key per element, the whole API surface (`api`: namespace -> methods, for lint-api.mjs), the content fields (with enum options) and the accepted link types.
//
//   node scripts/copy/snapshot-capabilities.mjs <scratchSectionId> <out.json> [--types a,b,c]
//
// It adds one temporary component of each type to <scratchSectionId> (a section on an
// unpublished draft page), reads the schemas, and removes them again. If the snapshot differs
// from a previous one (types, addable components or API methods), the editor changed: re-check descriptions before deploying.
import { chromium } from 'playwright';
import { hideScrollbars } from './hide-scrollbars.mjs';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [sectionId, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!sectionId || !out) { console.error('usage: snapshot-capabilities.mjs <scratchSectionId> <out.json> [--types …]'); process.exit(2); }
const types = opt('types', 'wixEditorElements.WRichText,wixEditorElements.Image,wixEditorElements.Button').split(',');
const b = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('editor.wix.com/edit/'));
if (!p) { console.error('No Harmony editor page is open.'); process.exit(3); }
await hideScrollbars(p); // canvas widths must not depend on the OS scrollbar setting
const raw = await p.evaluate(async (code) => { const a = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); return a.execute({ code }, { biParams: {} }); }, `
const A = editorLLMApis; const out = {}; const temp = [];
await A.pages.navigate({ pageId: (await A.sections.get({ sectionId: ${JSON.stringify(sectionId)} })).pageId }); await A.breakpoints.toggle({ device: 'desktop' });
for (const type of ${JSON.stringify(types)}) {
  const c = { id: (await A.components.add({ containerId: ${JSON.stringify(sectionId)}, components: [{ componentType: type }], select: false })).added[0].componentId }; temp.push(c.id);
  const ss = await A.appearance.getStyleSchema({ componentId: c.id }); const cs = await A.content.getSchema({ componentId: c.id });
  let links = null; try { links = (await A.links.getAllowedTypes({ componentId: c.id })).allowedTypes; } catch (e) {}
  out[type] = { styles: Object.fromEntries(ss.elements.filter((e) => e.writableProperties).map((e) => [e.elementPath.join('/') || 'root', Object.keys(e.writableProperties)])), content: cs.fields.map((f) => ({ key: f.key, dataType: f.dataType, options: f.options ? f.options.map((o) => o.value) : undefined })), links };
}
await A.components.remove({ componentIds: temp });
return { readAt: new Date().toISOString(), api: Object.fromEntries(Object.keys(A).map((ns) => [ns, Object.keys(A[ns])])), addable: (await A.components.listAddable()).components.map((c) => c.componentType), types: out, breakpoints: await A.breakpoints.list() };`);
const c = JSON.parse(raw.items[0].content);
if (!c.success) { console.error(c.summary); process.exit(1); }
let changed = null;
if (fs.existsSync(out)) { const prev = JSON.parse(fs.readFileSync(out, 'utf8')); changed = JSON.stringify(prev.types) !== JSON.stringify(c.result.types) || JSON.stringify(prev.addable) !== JSON.stringify(c.result.addable) || JSON.stringify(prev.api) !== JSON.stringify(c.result.api); }
fs.writeFileSync(out, JSON.stringify({ ...c.result, addableCount: c.result.addable.length }, null, 1));
console.log(JSON.stringify({ out, types: Object.keys(c.result.types), addable: c.result.addable.length, changedSinceLastSnapshot: changed }));
await b.close();

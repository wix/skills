#!/usr/bin/env node
// Export a copied Harmony page as RECIPES for build-description.mjs: every child of one
// section (type, label, styles, content, rich-text HTML, desktop and mobile boxes) plus the
// page's pinned components. A later page reuses these looks for the same texts and images
// (nav, tabs, side notes, footer), so a recipe verified once is never re-styled by hand.
//
//   node scripts/copy/export-page.mjs <pageId> <sectionId> <out.json> [--batch 10]
//
// Read only. Results are fetched in batches: an editor result over ~50 KB comes back truncated.
import { chromium } from 'playwright';
import { hideScrollbars } from './hide-scrollbars.mjs';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [pageId, sectionId, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!pageId || !sectionId || !out) { console.error('usage: export-page.mjs <pageId> <sectionId> <out.json> [--batch 10]'); process.exit(2); }
const batch = Number(opt('batch', 10));
const b = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('editor.wix.com/edit/'));
if (!p) { console.error('No Harmony editor page is open.'); process.exit(3); }
await hideScrollbars(p); // canvas widths must not depend on the OS scrollbar setting
const run = async (code) => { const r = await p.evaluate(async (code) => { const a = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); return a.execute({ code }, { biParams: {} }); }, code); const c = JSON.parse(r.items[0].content); if (!c.success) throw new Error(c.summary); return c.result; };
const J = JSON.stringify;
const prelude = `const A = editorLLMApis;
const slim = (els) => els.map((e) => ({ path: e.elementPath, el: e.element, props: Object.fromEntries(Object.entries(e.properties).filter(([k, v]) => v && v.raw != null && v.raw !== '').map(([k, v]) => [k, v.raw])) })).filter((e) => Object.keys(e.props).length);
const one = async (id, type, label, box, sizing) => { const it = { id, label, type, desktop: box, sizing };
  try { it.styles = slim((await A.appearance.getStyles({ componentId: id })).elements); } catch (e) {}
  try { const v = await A.content.get({ componentId: id }); it.content = v.values ?? v.value; } catch (e) {}
  if (/RichText/.test(type)) { try { it.html = (await A.richText.getText({ componentId: id })).text; } catch (e) {} }
  try { const pin = await A.layout.getPinToScreen({ componentId: id }); if (pin && pin.pinned) it.pin = pin; } catch (e) {}
  return it; };
await A.pages.navigate({ pageId: ${J(pageId)} }); await A.breakpoints.toggle({ device: 'desktop' });`;

const head = await run(`${prelude}
const d = await A.layout.getComposition({ componentId: ${J(sectionId)} });
const bg = await A.appearance.getContainerBackground({ componentId: ${J(sectionId)} });
await A.breakpoints.toggle({ device: 'mobile' }); const m = await A.layout.getComposition({ componentId: ${J(sectionId)} }); await A.breakpoints.toggle({ device: 'desktop' });
const pinned = []; for (const t of ['wixEditorElements.Button']) { const f = await A.components.find({ type: t, pageId: ${J(pageId)}, limit: 200 }); for (const c of f.components) { const g = await A.components.get({ componentId: c.id }); if (g.parentId === ${J(pageId)}) pinned.push(c.id); } }
return { ids: d.children.map((k) => k.componentId), section: { id: ${J(sectionId)}, box: d.box, mobileBox: m.box, mobileHidden: m.notVisible || [], background: bg.background && bg.background.fields.map((f) => ({ key: f.key, value: f.value })) }, mobile: Object.fromEntries(m.children.map((k) => [k.componentId, k.box])), pinned };`);
const components = [];
for (let i = 0; i < head.ids.length; i += batch) {
  const part = await run(`${prelude}
const d = await A.layout.getComposition({ componentId: ${J(sectionId)} }); const want = new Set(${J(head.ids.slice(i, i + batch))}); const out = [];
for (const c of d.children) if (want.has(c.componentId)) out.push(await one(c.componentId, c.type, c.label, c.box, c.sizing));
return out;`);
  components.push(...part);
}
for (const id of head.pinned) components.push(await run(`${prelude} const m = await A.layout.measure({ componentId: ${J(id)} }); const g = await A.components.get({ componentId: ${J(id)} }); const it = await one(${J(id)}, g.type, g.label, m.onPage, null); it.parent = 'page'; return it;`));
for (const c of components) c.mobile = head.mobile[c.id] || null;
fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), pageId, total: components.length, section: head.section, components }, null, 1));
console.log(JSON.stringify({ out, components: components.length, pinned: head.pinned.length }));
await b.close();

#!/usr/bin/env node
// The two mobile-only changes the editor API cannot make, done on the editor stage.
//
//   node scripts/copy/mobile-stage.mjs hide <componentId> [<componentId> ...]
//   node scripts/copy/mobile-stage.mjs bg-opacity <sectionId> <0-100>
//
// hide        mobile view, select, right-click the component on the stage, "Hide". Desktop keeps it.
// bg-opacity  mobile view, select the section, "Replace Background", set the image opacity field.
//             (setContainerBackground in mobile view writes the SHARED value and changes desktop.)
// Both read the result back for BOTH views and print it; nothing else on the page is touched.
// Widths, heights and positions on mobile need no stage work: layout.setComposition in the
// mobile view is per view (deploy-description.mjs does it).
import { chromium } from 'playwright';

const [mode, ...rest] = process.argv.slice(2);
if (!['hide', 'bg-opacity'].includes(mode)) { console.error('usage: mobile-stage.mjs hide <id...> | bg-opacity <sectionId> <0-100>'); process.exit(2); }
const b = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('editor.wix.com/edit/'));
if (!p) { console.error('No Harmony editor page is open.'); process.exit(3); }
const api = async (code) => { const r = await p.evaluate(async (code) => { const a = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); return a.execute({ code }, { biParams: {} }); }, code); const c = JSON.parse(r.items[0].content); if (!c.success) throw new Error(c.summary); return c.result; };
await p.setViewportSize({ width: 1600, height: 1000 });
await p.keyboard.press('Escape').catch(() => {});
const iframeEl = async () => p.$('iframe[class^="preview-"]');
const stageRect = async (id) => { const ie = await iframeEl(); const ib = await ie.boundingBox(); const f = await ie.contentFrame(); const r = await f.evaluate((id) => { const e = document.getElementById(id) || document.querySelector(`[id$="${id}"]`); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, vw: innerWidth }; }, id); if (!r) return null; const k = ib.width / r.vw; return { x: ib.x + r.x * k, y: ib.y + r.y * k, w: r.w * k, h: r.h * k }; };
const hiddenIn = (id) => api(`const out = {}; for (const dev of ['mobile', 'desktop']) { await editorLLMApis.breakpoints.toggle({ device: dev }); const i = await editorLLMApis.components.inspect({ componentId: '${id}', aspects: ['layout'], neighbourhood: false }); out[dev] = !!(i.members && i.members[0] && i.members[0].layout && i.members[0].layout.componentLayout && i.members[0].layout.componentLayout.hidden); } await editorLLMApis.breakpoints.toggle({ device: 'desktop' }); return out;`);
const out = [];

if (mode === 'hide') {
  for (const id of rest) {
    await api(`await editorLLMApis.breakpoints.toggle({ device: 'mobile' }); await editorLLMApis.components.select({ componentIds: ['${id}'] }); return 1;`);
    await p.waitForTimeout(800);
    let r = await stageRect(id);
    for (let i = 0; i < 12 && r && (r.y < 200 || r.y + r.h > 950); i++) { await p.mouse.move(1500, 600); await p.mouse.wheel(0, Math.max(-900, Math.min(900, r.y - 450))); await p.waitForTimeout(500); r = await stageRect(id); }
    if (!r) { out.push({ id, error: 'not on the mobile stage' }); continue; }
    await p.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await p.waitForTimeout(600);
    await p.mouse.click(r.x + r.w / 2, r.y + r.h / 2, { button: 'right' }); await p.waitForTimeout(1000);
    const hide = p.locator('text=Hide').first();
    if (await hide.isVisible().catch(() => false)) { await hide.click(); await p.waitForTimeout(1500); } else { out.push({ id, error: 'no Hide in the context menu' }); await p.keyboard.press('Escape'); continue; }
    out.push({ id, hidden: await hiddenIn(id) });
  }
} else {
  const [id, value] = rest;
  const read = () => api(`const out = {}; for (const dev of ['mobile', 'desktop']) { await editorLLMApis.breakpoints.toggle({ device: dev }); const f = (await editorLLMApis.appearance.getContainerBackground({ componentId: '${id}' })).background.fields; const o = f.find((x) => x.key === 'backgroundMediaOpacity'); out[dev] = o && o.value ? o.value.raw : null; } await editorLLMApis.breakpoints.toggle({ device: 'desktop' }); return out;`);
  const before = await read();
  await api(`await editorLLMApis.breakpoints.toggle({ device: 'mobile' }); await editorLLMApis.components.select({ componentIds: ['${id}'] }); return 1;`);
  await p.waitForTimeout(1500);
  await p.getByText('Replace Background', { exact: true }).first().click(); await p.waitForTimeout(2500);
  const inp = p.locator('input[value="100"], input[value="' + Math.round(Number(before.mobile ?? 1) * 100) + '"]').first();
  await inp.click({ clickCount: 3 }); await p.keyboard.type(String(value)); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
  await p.keyboard.press('Escape').catch(() => {});
  out.push({ id, before, after: await read() });
}
await api(`await editorLLMApis.breakpoints.toggle({ device: 'desktop' }); await editorLLMApis.site.save(); return 1;`);
out.push({ isPublished: await api(`return (await editorLLMApis.site.getStatus()).isPublished;`) });
console.log(JSON.stringify(out));
await b.close();

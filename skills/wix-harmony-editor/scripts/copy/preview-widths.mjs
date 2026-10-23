#!/usr/bin/env node
// Screenshot the editor Preview at exact viewport widths (desktop slider), plus the source
// at the same widths, and optionally check that every element scales with the width.
//
//   node scripts/copy/preview-widths.mjs <sourceUrl> <outDir> --widths 1920,1440,1280,1024,768
//        [--scale-check <sectionId>]
//
// Writes <outDir>/h-<w>.png (Harmony, full page) and <outDir>/s-<w>.png (source, full page).
// The Preview width slider ([data-hook="slider-handle"], aria-valuenow) only renders while
// the window is >= ~1300px wide; the script widens the window as needed, clicks the track
// near the target and steps with the arrow keys to the exact width.
// --scale-check compares every direct child of <sectionId> between the first two widths:
// in a spx-scaled copy each box must equal box * (w2/w1). Any element listed has a px value
// (line-height, height, margin) that does not scale and will break other screen sizes.
import { chromium } from 'playwright';
import { hideScrollbars } from './hide-scrollbars.mjs';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [sourceUrl, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const widths = String(opt('widths', '1920,1440,1280,1024')).split(',').map(Number);
const checkId = opt('scale-check', null);
if (!sourceUrl || !out) { console.error('usage: preview-widths.mjs <sourceUrl> <outDir> --widths a,b,c [--scale-check <sectionId>]'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const b = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const ctx = b.contexts()[0];
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes('editor.wix.com/edit/'));
if (!p) { console.error('No Harmony editor page is open.'); process.exit(3); }
await hideScrollbars(p); // the Preview frame must not lose 15 px to a classic scrollbar
const pubBefore = await p.evaluate(async () => { const a = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); const r = await a.execute({ code: 'return (await editorLLMApis.site.getStatus()).isPublished;' }, { biParams: {} }); return JSON.parse(r.items[0].content).result; });
if (!(await p.getByText('Edit Site', { exact: true }).first().isVisible().catch(() => false))) { await p.getByText('Preview', { exact: true }).first().click(); await p.waitForTimeout(7000); }
const siteFrame = async () => { for (const f of p.frames()) { const ok = await f.evaluate(() => !!document.getElementById('SITE_CONTAINER')).catch(() => false); if (ok) { const fe = await f.frameElement().catch(() => null); if (fe) return { f, box: await fe.boundingBox() }; } } return null; };
const res = [], rects = {};
for (const w of widths) {
  await p.setViewportSize({ width: Math.max(w + 84, 1300), height: 1100 });
  await p.waitForTimeout(1500);
  await p.mouse.move(200, 20); await p.waitForTimeout(800);
  let tr = null;
  for (let i = 0; i < 20 && !tr; i++) { tr = await p.evaluate(() => { const h = document.querySelector('[data-hook="slider-handle"]'); if (!h) return null; const r = h.parentElement.getBoundingClientRect(); return r.width ? { x: r.x, w: r.width, y: r.y + r.height / 2 } : null; }); if (!tr) await p.waitForTimeout(500); }
  if (!tr) throw new Error('Preview width slider not found');
  const val = () => p.evaluate(() => Number(document.querySelector('[data-hook="slider-handle"]').getAttribute('aria-valuenow')));
  const max = await p.evaluate(() => Number(document.querySelector('[data-hook="slider-handle"]').getAttribute('aria-valuemax')));
  await p.mouse.click(tr.x + Math.max(1, Math.min(tr.w - 1, ((w - 390) / (max - 390)) * tr.w)), tr.y);
  await p.waitForTimeout(800);
  for (let i = 0; i < 400; i++) { const v = await val(); if (v === w) break; await p.keyboard.press(v < w ? 'ArrowRight' : 'ArrowLeft'); }
  await p.waitForTimeout(3000);
  let fr = await siteFrame();
  const docH = await fr.f.evaluate(() => document.documentElement.scrollHeight);
  if (checkId) rects[w] = await fr.f.evaluate((id) => { const s = document.getElementById(id); if (!s) return null; const sr = s.getBoundingClientRect(); const o = { _section: [0, 0, sr.width, sr.height] }; for (const e of s.querySelectorAll('[id^="comp-"]')) { const q = e.getBoundingClientRect(); if (q.width && e.parentElement.closest('[id^="comp-"]') === s) o[e.id] = [q.x - sr.x, q.y - sr.y, q.width, q.height]; } return o; }, checkId);
  await p.setViewportSize({ width: Math.max(w + 84, 1300), height: Math.min(Math.round(fr.box.y + docH + 20), 8000) });
  await p.waitForTimeout(2500);
  fr = await siteFrame();
  await p.screenshot({ path: `${out}/h-${w}.png`, clip: { x: fr.box.x, y: fr.box.y, width: fr.box.width, height: Math.min(docH, 8000 - fr.box.y) } });
  res.push({ w, slider: await val(), frameW: Math.round(fr.box.width), docH });
}
await p.getByText('Edit Site', { exact: true }).first().click().catch(() => {});
await p.waitForTimeout(2500);
await p.setViewportSize({ width: 1600, height: 1000 });
const s = await ctx.newPage();
// a local copy is compared OFFLINE: live third-party widgets (order popups, chat) would paint over it
if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(sourceUrl)) { const origin = new URL(sourceUrl).origin; await s.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort())); }
for (const w of widths) { await s.setViewportSize({ width: w, height: 1000 }); await s.goto(sourceUrl, { waitUntil: 'networkidle', timeout: 90000 }); await s.waitForTimeout(1200); await s.screenshot({ path: `${out}/s-${w}.png`, fullPage: true }); }
await s.close();
let scaleDeviations = null;
if (checkId && widths.length > 1 && rects[widths[0]] && rects[widths[1]]) {
  const [a, c] = widths, k = c / a; scaleDeviations = [];
  for (const id of Object.keys(rects[a])) { const A = rects[a][id], C = rects[c][id]; if (!C) continue; const d = [C[0] - A[0] * k, C[1] - A[1] * k, C[2] - A[2] * k, C[3] - A[3] * k].map(Math.round); if (d.some((v) => Math.abs(v) > 3)) scaleDeviations.push({ id, at: [a, A.map(Math.round)], [c]: C.map(Math.round), delta: d }); }
}
const pubAfter = await p.evaluate(async () => { const a = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); const r = await a.execute({ code: 'return (await editorLLMApis.site.getStatus()).isPublished;' }, { biParams: {} }); return JSON.parse(r.items[0].content).result; });
console.log(JSON.stringify({ res, scaleDeviations, published: { before: pubBefore, after: pubAfter } }));
await b.close();

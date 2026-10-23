#!/usr/bin/env node
// Capture the Harmony copy (editor Preview, at true canvas width) and the source at the
// same size, plus stacked zoom crops (source above, copy below) for side-by-side review.
//
//   node scripts/copy/compare-preview.mjs <sourceUrl> <outDir> [--width 1280] [--height 1254]
//        [--crops "x,y,w,h,scale;x,y,w,h,scale"]
//
// Writes <outDir>/source.png, <outDir>/harmony.png and <outDir>/crop-<n>.png.
// --height should be the source page height, so a screen-pinned element (floating
//          button) lands at the same viewport position in both captures.
// The Preview frame's top is located from the page's first header element, so the
// "Upgrade your website" ads banner of a free site is excluded automatically.
// Restores the editor tab to edit mode and its previous viewport when done.
import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const [sourceUrl, outDir] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!sourceUrl || !outDir) { console.error('usage: compare-preview.mjs <sourceUrl> <outDir> [--width 1280] [--height 1254] [--crops "x,y,w,h,s;..."]'); process.exit(2); }
const width = Number(opt('width', 1280));
const height = Number(opt('height', 1254));
const crops = (opt('crops', '') || '').split(';').filter(Boolean).map((c) => c.split(',').map(Number));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const ctx = browser.contexts()[0];
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('editor.wix.com/edit/'));
if (!page) { console.error('No Harmony editor page is open.'); process.exit(3); }
const before = page.viewportSize();

// 1) Harmony Preview: preview chrome (~90px) + optional ads banner sit above the page.
await page.setViewportSize({ width, height: height + 200 });
await page.waitForTimeout(800);
await page.getByText('Preview', { exact: true }).first().click();
await page.waitForTimeout(7000);
let top = null;
for (const f of page.frames()) {
  const t = await f.evaluate(() => { const e = document.querySelector('header, [id^="SITE_HEADER"], #masterPage > *'); return e ? e.getBoundingClientRect().top : null; }).catch(() => null);
  if (t == null) continue;
  const fe = await f.frameElement().catch(() => null);
  const fb = fe ? await fe.boundingBox() : null;
  if (fb) { top = fb.y + t; break; }
}
if (top == null) top = 90;
await page.setViewportSize({ width, height: Math.round(top + height) });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/harmony.png`, clip: { x: 0, y: top, width, height } });
await page.getByText('Edit Site', { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(2500);
if (before) await page.setViewportSize(before);

// 2) Source at the same size, in the same browser (same fonts and colour handling).
const s = await ctx.newPage();
await s.setViewportSize({ width, height });
await s.goto(sourceUrl, { waitUntil: 'networkidle', timeout: 90000 });
await s.waitForTimeout(2500);
await s.screenshot({ path: `${outDir}/source.png` });

// 3) Stacked crops for close review (source on top, copy below, magenta divider).
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
for (const [i, [x, y, w, h, sc = 1]] of crops.entries()) {
  await s.setViewportSize({ width: Math.round(w * sc), height: Math.round(h * sc * 2 + 10) });
  await s.setContent(`<body style="margin:0;background:#f0f"><canvas id=c width=${w * sc} height=${h * sc * 2 + 10}></canvas></body>`);
  await s.evaluate(async ([A, B, x, y, w, h, sc]) => {
    const c = document.getElementById('c').getContext('2d'); c.imageSmoothingEnabled = false;
    const load = (src) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = src; });
    const [a, b] = await Promise.all([load(A), load(B)]);
    c.drawImage(a, x, y, w, h, 0, 0, w * sc, h * sc);
    c.drawImage(b, x, y, w, h, 0, h * sc + 10, w * sc, h * sc);
  }, [b64(`${outDir}/source.png`), b64(`${outDir}/harmony.png`), x, y, w, h, sc]);
  await s.screenshot({ path: `${outDir}/crop-${i + 1}.png` });
}
await s.close();
console.log(JSON.stringify({ previewTop: top, written: ['source.png', 'harmony.png', ...crops.map((_, i) => `crop-${i + 1}.png`)].map((f) => `${outDir}/${f}`) }));
await browser.close();

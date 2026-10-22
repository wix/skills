#!/usr/bin/env node
// Render the source page's decorative layer ("plate") with all text and chosen images
// hidden, then cut it into one PNG per Harmony band (header / sections / footer).
//
//   node scripts/copy/render-plate.mjs <url> <outDir> --cuts header:0:65,main:65:1195,footer:1195:1254
//        [--width 1920] [--keep <img-src-substring>,…] [--prefix plate] [--scale 2]
//
// --cuts   name:yStart:yEnd in source page pixels (from measure-source.mjs). One PNG per cut:
//          <outDir>/<prefix>-<name>.png, exactly (width x (yEnd-yStart)).
// --width  render width. Use the canvas width + 640 (1920 for a 1280 canvas) when the
//          source is a centred fixed-width layout, so full-bleed strips still cover a
//          wide viewport. Prefer ONE full-page cut set as a 'fill' background of a single
//          auto-height section (it then scales with the page); see COPY-SITE.md.
// --keep   comma-separated substrings of <img src> that stay visible because they are
//          decorative and get no component of their own (paper clips, ornaments, an
//          image that would overlap a text box). Every other <img> is hidden, because it
//          is rebuilt as a real Image component with its link and alt text.
// --scale  device pixel ratio of the PNG (2 = sharp when the band scales up on wide screens;
//          the file is then 2x the CSS size, which a 'fill' background handles).
// The page is scrolled once first, so scroll-revealed backgrounds paint.
// Text is made transparent (layout unchanged) and position:fixed elements (floating
// buttons, chat widgets, cookie bars), including those in shadow DOM, are removed.
import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const [url, outDir] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const cuts = (opt('cuts', '') || '').split(',').filter(Boolean).map((c) => { const [name, a, b] = c.split(':'); return { name, y0: Number(a), y1: Number(b) }; });
if (!url || !outDir || !cuts.length) { console.error('usage: render-plate.mjs <url> <outDir> --cuts name:y0:y1,... [--width 1920] [--keep a,b] [--prefix plate] [--scale 2]'); process.exit(2); }
const width = Number(opt('width', 1920));
const keep = (opt('keep', '') || '').split(',').filter(Boolean);
const prefix = opt('prefix', 'plate');
const scale = Number(opt('scale', 1));
const maxY = Math.max(...cuts.map((c) => c.y1));

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
// A normal viewport height, then a scroll pass: a viewport as tall as the page changes vh-sized
// blocks, and backgrounds that are revealed on scroll (footers, bands) would never paint.
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: scale });
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y <= fullH; y += 500) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(120); }
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(1500);
const keepCss = keep.map((k) => `img[src*="${k}"]`).join(', ');
await page.addStyleTag({ content: `
  body * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
  img { visibility: hidden !important; }
  ${keepCss ? `${keepCss} { visibility: visible !important; }` : ''}
` });
const removed = await page.evaluate(() => {
  let n = 0;
  const walk = (root) => { for (const e of root.querySelectorAll('*')) { if (getComputedStyle(e).position === 'fixed') { e.style.setProperty('display', 'none', 'important'); n++; } if (e.shadowRoot) walk(e.shadowRoot); } };
  walk(document);
  return n;
});
await page.waitForTimeout(600);
const written = [];
for (const c of cuts) {
  const file = `${outDir}/${prefix}-${c.name}.png`;
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: c.y0, width, height: c.y1 - c.y0 } });
  written.push({ file, width: width * scale, height: (c.y1 - c.y0) * scale });
}
await browser.close();
console.log(JSON.stringify({ removedFixed: removed, kept: keep, written }));

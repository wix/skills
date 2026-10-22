#!/usr/bin/env node
// Prove a mirror works: screenshot every page live and from the local server at each width,
// with the local browser cut off from the internet, and compare the pixels.
//
//   node scripts/copy/check-mirror.mjs <outDir> <shotsDir> [--port 8732] [--widths 390,1024,1280,1920] [--pages 0,1]
//
// Per page and width it reports the live and local page heights, the share of differing
// pixels (a channel off by more than 40), every request the local page tried to send off the
// server ("leaks", blocked) and every local 404. Writes live-*, local-* and diff-* PNGs
// (diff: red = differs). Animations and transitions are frozen on both sides.
// Refuses to run when the port serves another site. Video and player regions (video, iframe,
// canvas, vidyard) cannot be compared: headless Chromium has no h264, so live paints blank
// where the mirror paints the recorded thumbnail. `diffPct` counts everything;
// `diffOutsideMediaPct` ignores those regions and is the figure the 0.1% gate applies to.
import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [outDir, shots] = args;
const port = Number(opt('port', 8732));
const widths = opt('widths', '390,1024,1280,1920').split(',').map(Number);
const index = JSON.parse(fs.readFileSync(`${outDir}/index.json`, 'utf8'));
const pick = opt('pages', null);
const pages = pick ? pick.split(',').map((i) => index.pages[Number(i)]) : index.pages;
fs.mkdirSync(shots, { recursive: true });
const local = (u) => { const x = new URL(u); return `http://127.0.0.1:${port}${x.pathname}${x.search}`; };
const freeze = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const slug = (u) => { const x = new URL(u); return `${x.pathname}${x.search}`.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'home'; }; // path AND query, so path-only pages do not share a name

const served = await fetch(`http://127.0.0.1:${port}/__mirror-site`).then((r) => r.ok ? r.text() : '', () => '');
if (served !== index.site) { console.error(`port ${port} serves ${served ? `"${served}"` : 'nothing'}, not "${index.site}". Start serve-mirror.mjs for this mirror on a free --port and pass the same --port here.`); process.exit(2); }
const browser = await chromium.launch();
async function shot(url, width, file, offline) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const leaks = [], misses = [];
  if (offline) await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(`http://127.0.0.1:${port}/`)) return r.continue(); leaks.push(u); return r.abort(); });
  const page = await ctx.newPage();
  page.on('response', (r) => { if (offline && r.status() === 404) misses.push(r.url()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.addStyleTag({ content: freeze });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= h; y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(80); }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: file, fullPage: true });
  const media = await page.evaluate(() => [...document.querySelectorAll('video, iframe, canvas, [class*="vidyard" i]')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; }).filter((r) => r[2] > 40 && r[3] > 40));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await ctx.close();
  return { height, media, leaks: [...new Set(leaks.map((u) => new URL(u).host))], misses };
}
// pixel comparison in a blank page: draw both PNGs, count channel differences, paint the diff
const cmpPage = await browser.newPage();
async function compare(a, b, out, media = []) {
  const r = await cmpPage.evaluate(async ([a, b, media]) => {
    const load = (d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = d; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const px = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
    const da = px(ia), db = px(ib); const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); const out = x.createImageData(w, h);
    let diff = 0, outside = 0;
    const masked = new Uint8Array(w * h);
    for (const [mx, my, mw, mh] of media) for (let yy = Math.max(0, my); yy < Math.min(h, my + mh); yy++) masked.fill(1, yy * w + Math.max(0, mx), yy * w + Math.min(w, mx + mw));
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2])) > 40;
      if (d) { diff++; if (!masked[i / 4]) outside++; }
      const g = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3;
      out.data[i] = d ? 255 : g * 0.3 + 178; out.data[i + 1] = d ? 0 : g * 0.3 + 178; out.data[i + 2] = d ? 0 : g * 0.3 + 178; out.data[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    const blob = await c.convertToBlob(); const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { pct: Math.round((diff / (w * h)) * 10000) / 100, outside: Math.round((outside / (w * h)) * 10000) / 100, png: btoa(s) };
  }, [...[a, b].map((f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`), media]);
  fs.writeFileSync(out, Buffer.from(r.png, 'base64'));
  return { pct: r.pct, outside: r.outside };
}
const rows = [];
for (const url of pages) for (const w of widths) {
  const s = slug(url);
  const live = await shot(url, w, `${shots}/live-${s}-${w}.png`, false);
  const loc = await shot(local(url), w, `${shots}/local-${s}-${w}.png`, true);
  const cmp = await compare(`${shots}/live-${s}-${w}.png`, `${shots}/local-${s}-${w}.png`, `${shots}/diff-${s}-${w}.png`, live.media);
  rows.push({ page: s, width: w, liveH: live.height, localH: loc.height, diffPct: cmp.pct, diffOutsideMediaPct: cmp.outside, mediaRegions: live.media.length, leaks: loc.leaks, misses: loc.misses.length });
  console.log(JSON.stringify(rows.at(-1)));
}
await browser.close();
fs.writeFileSync(`${shots}/report.json`, JSON.stringify(rows, null, 1));

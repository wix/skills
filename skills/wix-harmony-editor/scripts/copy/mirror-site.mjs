#!/usr/bin/env node
// Save a public site for offline viewing: every response the browser receives while each page
// loads (HTML, CSS, JS, fonts, images, JSON), at several widths so responsive images are caught.
//
//   node scripts/copy/mirror-site.mjs <outDir> <url> [<url> ...] [--widths 390,1024,1280,1920] [--resume]
//
// Writes <outDir>/index.json (original URL -> status, content type, body file) and
// <outDir>/bodies/<sha1>. Bodies are stored unchanged; serve-mirror.mjs rewrites URLs when
// serving. Third-party embeds (iframes from another host, e.g. Google Maps) cannot be replayed
// offline (their auth is bound to the live origin), so each one is saved as a snapshot image
// at 1280 px (index.embeds[src]) and served in place of the iframe.
// Read only: plain anonymous page loads, nothing is posted to the source.
import { chromium } from 'playwright';
import fs from 'fs';
import crypto from 'crypto';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [outDir, ...urls] = pos;
if (!outDir || !urls.length) { console.error('usage: mirror-site.mjs <outDir> <url...> [--widths 390,1024,1280,1920] [--resume]'); process.exit(2); }
const widths = opt('widths', '390,1024,1280,1920').split(',').map(Number);
fs.mkdirSync(`${outDir}/bodies`, { recursive: true });
const idxFile = `${outDir}/index.json`;
const index = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : { site: new URL(urls[0]).host, pages: [], resources: {} };
index.embeds ??= {};
const key = (u) => u.split('#')[0];
const failures = [];

const browser = await chromium.launch();
async function capture(url, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const pending = [];
  page.on('response', (res) => pending.push((async () => {
    const u = key(res.url());
    if (!/^https?:/.test(u)) return;
    const status = res.status();
    const headers = res.headers();
    if (status >= 300 && status < 400) { index.resources[u] ??= { status, location: headers.location || '' }; return; }
    let body; try { body = await res.body(); } catch { return; } // e.g. aborted beacons
    const sha = crypto.createHash('sha1').update(body).digest('hex');
    if (!fs.existsSync(`${outDir}/bodies/${sha}`)) fs.writeFileSync(`${outDir}/bodies/${sha}`, body);
    const prev = index.resources[u];
    if (!prev || prev.status !== 200 || status === 200) index.resources[u] = { status, type: headers['content-type'] || '', body: sha, bytes: body.length };
  })()));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
    // scroll through the page so lazy-loaded images and scripts load, then back to the top
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= h; y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(120); }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    if (width === 1280) {
      for (const el of await page.$$('iframe[src]')) {
        const src = await el.getAttribute('src');
        if (!/^https?:/.test(src) || new URL(src).host === index.site) continue;
        const box = await el.evaluate((e) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX + e.clientLeft, y: r.y + scrollY + e.clientTop, width: e.clientWidth, height: e.clientHeight }; }); // content box: the border stays CSS
        if (box.width < 2 || box.height < 2) continue;
        await page.waitForTimeout(3000); // map tiles
        const png = await page.screenshot({ fullPage: true, clip: box });
        const sha = crypto.createHash('sha1').update(png).digest('hex');
        fs.writeFileSync(`${outDir}/bodies/${sha}`, png);
        index.embeds[src] = { page: key(url), body: sha };
      }
      await page.evaluate(() => scrollTo(0, 0));
    }
  } catch (e) { failures.push({ url, width, error: String(e).slice(0, 200) }); }
  await Promise.all(pending);
  await ctx.close();
}
// a long list is saved as it goes (every 10 pages) and --resume skips pages already in the index, so a crash or a
// stopped run costs minutes, not the whole capture
const resume = args.includes('--resume');
let done = 0;
for (const url of urls) {
  if (resume && index.captured?.includes(key(url))) continue;
  if (!index.pages.includes(key(url))) index.pages.push(key(url));
  await Promise.all(widths.map((w) => capture(url, w)));
  (index.captured ??= []).push(key(url));
  if (++done % 10 === 0) fs.writeFileSync(idxFile, JSON.stringify(index));
}
await browser.close();
fs.writeFileSync(idxFile, JSON.stringify(index, null, 1));
const res = Object.values(index.resources);
const hosts = [...new Set(Object.keys(index.resources).map((u) => new URL(u).host))];
console.log(JSON.stringify({ pages: index.pages.length, embeds: Object.keys(index.embeds).length, resources: res.length, bytes: res.reduce((s, r) => s + (r.bytes || 0), 0), hosts, failures }));

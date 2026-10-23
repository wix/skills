#!/usr/bin/env node
// Find what a visitor can DO on the source page, and capture every state it can show.
//
//   node scripts/copy/find-interactions.mjs <url> <out.json> [--width 1280] [--shots <dir>]
//
// A static screenshot only shows the default state. Tabs, accordions, "read more" toggles,
// carousels and menus hide content that never reaches the measurement, the plate or the copy
// (a whole second tab of price tiles was missing from a copy until a person clicked it).
// This script lists the controls and, for each, clicks it and records what appears.
//
// A <details><summary> disclosure needs no id: the summary's own <details> is its pane (hidden while !details.open).
// Controls found: role=tab and [data-toggle=tab|pill] / [data-bs-toggle=tab], [aria-controls] with
// [aria-expanded], [data-toggle=collapse], <details>/<summary>, carousel arrows (.slick-next,
// .swiper-button-next, [class*=next]), and links to in-page ids (#id) whose target is hidden.
// Per control the output has: kind, label, target pane id, whether the pane is hidden by default,
// and for each state the pane's images, links and text, plus a screenshot of the region.
// Map each kind to a Wix component (COPY-SITE item 17): tabs -> Tabs, accordion -> Accordion,
// carousel -> Slideshow or the Stores slider gallery, hover/dropdown -> Menu, dialog -> Popup.
//
// Clicks are dispatched in the page (el.click()), so a consent dialog or a sticky bar covering the
// control does not block them. The page is never submitted anywhere: forms are not touched.
import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [url, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!url || !out) { console.error('usage: find-interactions.mjs <url> <out.json> [--width 1280] [--shots dir]'); process.exit(2); }
const width = Number(opt('width', 1280)); const shots = opt('shots', null);
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);

const SEL = '[role=tab], [data-toggle=tab], [data-toggle=pill], [data-bs-toggle=tab], [data-toggle=collapse], [data-bs-toggle=collapse], summary, [aria-expanded][aria-controls], .slick-next, .swiper-button-next, button[class*=next], a[href^="#"]:not([href="#"])';
const controls = await page.evaluate((SEL) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const paneOf = (e) => { if (e.tagName === 'SUMMARY' && e.parentElement && e.parentElement.tagName === 'DETAILS') return e.parentElement; const t = idOf(e); return t ? document.getElementById(t) : null; };
  const idOf = (e) => { const h = e.getAttribute('href') || e.getAttribute('data-target') || e.getAttribute('data-bs-target') || ''; const m = h.match(/^#(.+)$/); return e.getAttribute('aria-controls') || (m ? m[1] : null); };
  let n = 0; const seen = new Set(); const out = [];
  for (const e of document.querySelectorAll(SEL)) {
    if (!vis(e)) continue; const target = idOf(e); const pane = paneOf(e);
    if (/^#/.test(e.getAttribute('href') || '') && !pane) continue; // an anchor to nowhere
    const key = (target || (pane && pane.tagName === 'DETAILS' ? 'details' : '')) + '|' + (e.innerText || '').trim().slice(0, 40) + '|' + e.tagName; if (seen.has(key)) continue; seen.add(key);
    e.setAttribute('data-hz-ctl', String(n)); const r = e.getBoundingClientRect();
    const pane2 = paneOf(e); if (pane2) pane2.setAttribute('data-hz-pane', String(n));
    const isDetails = !!pane2 && pane2.tagName === 'DETAILS';
    const kind = e.matches('[role=tab],[data-toggle=tab],[data-toggle=pill],[data-bs-toggle=tab]') ? 'tab' : e.matches('[data-toggle=collapse],[data-bs-toggle=collapse],summary,[aria-expanded]') ? 'accordion' : e.matches('.slick-next,.swiper-button-next,button[class*=next]') ? 'carousel' : 'anchor-target';
    out.push({ n: n++, kind, label: (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60), target, hiddenByDefault: pane ? (pane.tagName === 'DETAILS' ? !pane.open : (pane.getBoundingClientRect().height === 0 || getComputedStyle(pane).display === 'none')) : null, hasPane: !!pane, native: isDetails ? 'details' : null, box: [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)] });
  }
  return out;
}, SEL);

const snap = (n) => page.evaluate((n) => {
  const el = document.querySelector(`[data-hz-pane="${n}"]`); if (!el) return null;
  return { open: el.tagName === 'DETAILS' ? el.open : undefined, images: [...el.querySelectorAll('img')].map((i) => (i.currentSrc || i.src || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 200)), links: [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).slice(0, 40), text: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 400), shown: el.tagName === 'DETAILS' ? el.open : (el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none'), h: Math.round(el.getBoundingClientRect().height) };
}, n);

const result = [];
for (const c of controls) {
  const entry = { ...c, states: [] };
  if (c.kind === 'carousel') { result.push(entry); continue; } // arrows: the copy uses a slider component; the items are in the page already
  entry.states.push({ state: 'before', ...(await snap(c.n)) });
  await page.evaluate((n) => document.querySelector(`[data-hz-ctl="${n}"]`).click(), c.n).catch(() => {});
  await page.waitForTimeout(900);
  const after = await snap(c.n); entry.states.push({ state: 'after click', ...after });
  if (shots && c.hasPane) { const f = `${shots}/ctl-${c.n}-${c.kind}.png`; const l = page.locator(`[data-hz-pane="${c.n}"]`); await l.screenshot({ path: f }).catch(() => {}); entry.shot = f; }
  result.push(entry);
}
// a toggled control may be a pair (open and close): leave nothing assumed, record what was clicked
fs.writeFileSync(out, JSON.stringify({ url, width, controls: result }, null, 1));
const byKind = result.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});
console.log(JSON.stringify({ controls: result.length, byKind, hiddenPanes: result.filter((c) => c.hiddenByDefault).map((c) => `${c.kind}: ${c.label} -> ${c.native === 'details' ? '<details>' : '#' + c.target}`) }, null, 1));
await browser.close();

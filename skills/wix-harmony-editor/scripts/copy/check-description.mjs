#!/usr/bin/env node
// Check a page description BEFORE anything is written to Harmony, and settle its layout.
//
//   node scripts/copy/check-description.mjs <page.desc.json> <outDir>
//        --capabilities capabilities.json   what the live editor accepts (caps.js snapshot)
//        --fonts font-ledger.json           Harmony family -> source family, for the local render
//        [--source <url>]                   the (local) source page, for fonts and the pixel diff
//        [--plate plate.png]                the decorative plate, drawn behind the components
//        [--heights editor-heights.json]    text heights measured by the editor (key -> px), overriding the local render's
//        [--write]                          store the settled heights and mobile layout back
//
// 1. Compliance: every component type, style key, link type and value shape is one the
//    snapshot lists (compliance guard 1); line heights and inline sizes are not px; rich
//    text has exactly one p/h1-h6 root.
// 2. Local render: draws the description as a plain HTML page with the source's own fonts,
//    measures every text's real height, then checks the desktop composition for overlaps
//    and bounds (Harmony rejects a whole composition for one overlap) and diffs the render
//    against the source at 1280.
// 3. Mobile: stacks the column with the measured heights at 390 px, so the deploy sends
//    final boxes in one call, and derives the mobile background bands from the groups.
// Exit code 1 when a compliance error or a desktop overlap remains.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { descHash, openItems, pendingItems } from './desc-hash.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [descFile, outDir] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!descFile || !outDir || !opt('capabilities')) { console.error('usage: check-description.mjs <page.desc.json> <outDir> --capabilities caps.json --fonts font-ledger.json [--source url] [--plate png] [--write] [--allow-old-links "reason"]'); process.exit(2); }
const desc = JSON.parse(fs.readFileSync(descFile, 'utf8'));
const caps = JSON.parse(fs.readFileSync(opt('capabilities'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(opt('fonts'), 'utf8')).families || {};
const sourceUrl = opt('source', desc.source.measured || desc.source.url);
const plate = opt('plate', null);
fs.mkdirSync(outDir, { recursive: true });
const errors = [], warnings = [];
// the cutover hand-off must match the links as they are now (build-description writes it)
if (JSON.stringify(desc.openItems || []) !== JSON.stringify(openItems(desc))) errors.push({ key: 'openItems', error: 'desc.openItems is missing or stale against the component links: re-run build-description' });
// pages the copy lacks must stay in the hand-off with their source URL, whatever stand-in page the link points at
if (JSON.stringify(desc.pendingItems || []) !== JSON.stringify(pendingItems(desc))) errors.push({ key: 'pendingItems', error: 'desc.pendingItems is missing or stale against the component links: re-run build-description' });
for (const p of pendingItems(desc)) warnings.push({ key: 'page-not-built', warning: `${p.url} is not built (links go to ${p.standInFor}): ${p.reason}` });
// A copy must never send a visitor back to the source site. A link to a store category, a product or any page the
// copy replaces has to be mapped (build-description --linkmap) to the new site's own page. Only links to pages that
// are deliberately not built yet may stay, and then the run says so with --allow-old-links "<reason>".
{
  const old = openItems(desc);
  if (old.length && !opt('allow-old-links')) errors.push({ key: 'old-site-links', error: `${old.length} link(s) still point at the source site (${old.slice(0, 3).map((o) => o.url).join(', ')}${old.length > 3 ? ', ...' : ''}): map them to the new site's store category/product/pages with build-description --linkmap, or, for pages that are not built yet, pass --allow-old-links "<reason>" (it is recorded in the report)` });
  else if (old.length) warnings.push({ key: 'old-site-links', warning: `${old.length} link(s) left pointing at the source site on purpose: ${opt('allow-old-links')}` });
}
// ---- 0. the editor code this pipeline sends uses only methods the editor has (lint-api.mjs) ----
{
  const { lintApi } = await import('./lint-api.mjs');
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const f of ['deploy-description.mjs', 'export-page.mjs', 'snapshot-capabilities.mjs', 'mobile-stage.mjs']) {
    for (const p of lintApi(fs.readFileSync(path.join(here, f), 'utf8'), caps, f).problems) (p.error ? errors : warnings).push({ key: 'editor-code', [p.error ? 'error' : 'warning']: `${p.at}: ${p.error || p.warning}` });
  }
}

// ---- 1. compliance against the editor's own snapshot -------------------------------------
for (const c of desc.components) {
  const t = caps.types[c.type];
  if (!caps.addable.includes(c.type) || !t) { errors.push({ key: c.key, error: `type ${c.type} is not addable in this editor` }); continue; }
  for (const [el, props] of Object.entries(c.styles || {})) {
    const allowed = t.styles[el];
    if (!allowed) { errors.push({ key: c.key, error: `element '${el}' takes no styles on ${c.type}` }); continue; }
    for (const [k, v] of Object.entries(props)) {
      if (!allowed.includes(k)) errors.push({ key: c.key, error: `style '${k}' is not writable on ${c.type} ${el}` });
      if (k === 'lineHeight' && /px$/.test(v)) errors.push({ key: c.key, error: `lineHeight ${v} is px: it would not scale (use em)` });
    }
  }
  if (c.link && t.links && !t.links.includes(c.link.type)) errors.push({ key: c.key, error: `link type ${c.link.type} not accepted by ${c.type}` });
  if (c.html !== undefined) {
    if (!/^<(p|h[1-6])>[\s\S]*<\/\1>$/.test(c.html) || /<\/(p|h[1-6])>[\s\S]*<(p|h[1-6])>/.test(c.html)) errors.push({ key: c.key, error: 'rich text needs exactly one <p> or <h1-6> root' });
    if (/font-size:\s*[\d.]+px/.test(c.html)) errors.push({ key: c.key, error: 'inline font-size in px does not scale (use em)' });
  }
  if (c.kind === 'image') {
    if (!t.content.some((f) => f.key === 'displayMode' && (!f.options || f.options.includes(c.displayMode)))) errors.push({ key: c.key, error: `displayMode ${c.displayMode} not offered` });
    if (!c.image.uri && !c.image.source) errors.push({ key: c.key, error: 'image has neither a Harmony uri nor a source URL to import' });
    if (!c.image.uri) warnings.push({ key: c.key, warning: `media not imported yet: ${c.image.source}` });
  }
  const fam = c.styles?.root?.fontFamily || c.styles?.label?.fontFamily;
  if (fam && !Object.values(ledger).includes(fam) && !/^(courier new|helvetica-w01-(roman|bold)|arial|georgia|times new roman)$/.test(fam)) warnings.push({ key: c.key, warning: `font '${fam}' is neither uploaded (ledger) nor a known catalog font` });
}

// ---- 2. local render with the source's fonts --------------------------------------------
const back = Object.fromEntries(Object.entries(ledger).map(([src, fam]) => [fam, src]));
const famCss = (f) => (back[f] ? `'${back[f]}'` : f === 'helvetica-w01-bold' ? 'Helvetica, Arial, sans-serif' : `'${f}'`);
const browser = await chromium.launch();
const srcPage = await browser.newPage({ viewport: { width: desc.section.desktop.width, height: 900 } });
await srcPage.goto(sourceUrl, { waitUntil: 'networkidle', timeout: 90000 });
const fontLinks = await srcPage.$$eval('link[rel=stylesheet]', (ls) => ls.map((l) => l.href).filter((h) => /font/i.test(h)));
const fontFaces = await srcPage.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].filter((r) => r instanceof CSSFontFaceRule).map((r) => r.cssText); } catch { return []; } }).join('\n'));
await srcPage.screenshot({ path: `${outDir}/source-1280.png`, fullPage: true });
await srcPage.close();
const css = (st) => Object.entries(st || {}).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${k === 'fontFamily' ? famCss(v) : String(v).replace(/spx$/, 'px')}`).join(';');
const html = (mobile) => `<!doctype html><html><head><meta charset="utf-8">${fontLinks.map((h) => `<link rel="stylesheet" href="${h}">`).join('')}<style>${fontFaces}
 body{margin:0} #s{position:relative;width:${mobile ? 390 : desc.section.desktop.width}px;height:${mobile ? 6000 : desc.section.desktop.height}px;background:${desc.section.background.backgroundColor} ${!mobile && plate ? `url('data:image/png;base64,${fs.readFileSync(plate).toString('base64')}') center top/auto 100% no-repeat` : ''};overflow:hidden}
 .c{position:absolute;box-sizing:border-box} .c p,.c h1,.c h2,.c h3,.c h4,.c h5,.c h6{margin:0;font:inherit} .c a{color:inherit;text-decoration:none} .c img{width:100%;display:block}
 .btn{display:flex;align-items:center;justify-content:center;white-space:nowrap}</style></head><body><div id="s">${desc.components.filter((c) => c.kind !== 'pinned' && !(mobile && c.mobile?.hidden)).map((c) => {
    const b = mobile ? { x: c.mobile.box?.x ?? c.mobile.x, y: 0, width: c.mobile.box?.width ?? c.mobile.width } : c.desktop;
    if (c.kind === 'text') return `<div class="c" data-key="${c.key}" style="left:${b.x}px;top:${b.y}px;width:${b.width}px;${css(c.styles.root)}">${c.html}</div>`;
    if (c.kind === 'image') return `<div class="c" data-key="${c.key}" style="left:${b.x}px;top:${b.y}px;width:${b.width}px"><img src="${c.image.uri ? `https://static.wixstatic.com/media/${c.image.uri}` : c.image.sourceRendered || c.image.source}"></div>`;
    return `<div class="c btn" data-key="${c.key}" style="left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${mobile ? b.height ?? c.desktop.height : b.height}px;${css(c.styles.root)}"><span style="${css(c.styles.label)}">${c.kind === 'hotspot' ? '' : c.label || ''}</span></div>`;
  }).join('\n')}</div></body></html>`;

const page = await browser.newPage({ viewport: { width: desc.section.desktop.width, height: 900 } });
// load every family the description uses BEFORE measuring (fonts.ready alone can resolve before a lazily-used face loads)
const families = [...new Set(desc.components.flatMap((c) => [c.styles?.root?.fontFamily, c.styles?.label?.fontFamily]).filter(Boolean).map(famCss))];
const loadFonts = (p) => p.evaluate(async (fams) => { await Promise.all(fams.map((f) => document.fonts.load(`20px ${f}`).catch(() => null))); await document.fonts.ready; }, families);
await page.setContent(html(false), { waitUntil: 'networkidle' }); await loadFonts(page); await page.waitForTimeout(500);
fs.writeFileSync(`${outDir}/render-desktop.html`, html(false));
const measured = await page.$$eval('[data-key]', (es) => Object.fromEntries(es.map((e) => [e.dataset.key, { h: Math.ceil(e.getBoundingClientRect().height), w: Math.ceil(e.scrollWidth) }])));
// --heights: text heights the EDITOR measured on an earlier deploy ({ key: px }). Harmony's text height
// differs from the local render by a pixel or so per line; sent as-is, the difference drifts every
// box below it, so a second pass uses the editor's own numbers.
const editorHeights = opt('heights', null) ? JSON.parse(fs.readFileSync(opt('heights'), 'utf8')) : {};
for (const [k, h] of Object.entries(editorHeights)) if (measured[k]) measured[k].h = Math.ceil(h);
await page.screenshot({ path: `${outDir}/render-1280.png`, fullPage: true, clip: { x: 0, y: 0, width: desc.section.desktop.width, height: desc.section.desktop.height } });
// overlaps and bounds on the settled desktop boxes
const boxes = desc.components.filter((c) => c.kind !== 'pinned').map((c) => ({ c, key: c.key, x: c.desktop.x, y: c.desktop.y, w: c.desktop.width, h: c.kind === 'text' ? measured[c.key].h : c.desktop.height }));
// settle what is safe to settle (COPY-SITE rule 5): a touch of <= 3 px is nudged (the lower box
// down, or the left box narrower), and an invisible click area (hotspot) shrinks off its neighbours
const settled = [];
for (let pass = 0; pass < 3; pass++) for (let i = 0; i < boxes.length; i++) for (let j = 0; j < boxes.length; j++) {
  if (i === j) continue; const a = boxes[i], b = boxes[j];
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= -1 || oy <= -1) continue; // boxes need 1 px clearance: Harmony's heights carry decimals
  if (a.c.kind === 'hotspot' && b.c.kind !== 'hotspot') { if (b.y > a.y && b.y - a.y > 20) a.h = b.y - a.y - 1; else if (b.x > a.x) a.w = b.x - a.x - 1; else if (b.x + b.w < a.x + a.w) { const r = a.x + a.w; a.x = b.x + b.w + 1; a.w = r - a.x; } settled.push([a.key, 'shrunk off', b.key]); continue; }
  if (oy <= 3 && b.y > a.y) { b.y += oy + 1; settled.push([b.key, `down ${oy + 1}px off`, a.key]); continue; }
  if (ox <= 3 && b.x > a.x) { a.w -= ox + 1; settled.push([a.key, `narrower ${ox + 1}px off`, b.key]); }
}
for (const b of boxes) Object.assign(b.c.desktop, { x: b.x, y: b.y, width: b.w });
for (const b of boxes) if (b.c.kind !== 'text') b.c.desktop.height = b.h;
// a Button's height follows its label (a set height is only a minimum), so a click area gets
// its height from the label's line height, as an em ratio so it scales
for (const b of boxes) if (b.c.kind === 'hotspot') { const lab = b.c.styles.label || (b.c.styles.label = {}); const fs = parseFloat(lab.fontSize) || 12; lab.fontSize = lab.fontSize || '12px'; lab.lineHeight = `${Math.round((b.h / fs) * 10000) / 10000}em`; }
const overlaps = [];
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([a.key, b.key, { a, b }]); }
const outOfBounds = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > desc.section.desktop.width || b.y + b.h > desc.section.desktop.height).map((b) => b.key);
const wraps = desc.components.filter((c) => c.kind === 'text' && c.lines && Math.round(measured[c.key].h / (parseFloat(c.styles.root.lineHeight) * parseFloat(c.styles.root.fontSize))) > c.lines).map((c) => ({ key: c.key, expectedLines: c.lines, renderedHeight: measured[c.key].h }));

// pixel diff of the local render against the source at 1280 (texts and images; the plate is the same pixels)
const diffPct = await page.evaluate(async ([a, b]) => {
  const load = (d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = d; });
  const [ia, ib] = await Promise.all([load(a), load(b)]); const w = ia.width, h = Math.min(ia.height, ib.height);
  const px = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const da = px(ia), db = px(ib); let d = 0; for (let i = 0; i < da.length; i += 4) if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > 40) d++;
  return Math.round((d / (w * h)) * 10000) / 100;
}, [`${outDir}/render-1280.png`, `${outDir}/source-1280.png`].map((f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`));

// ---- 3. mobile column with real heights -------------------------------------------------
const mp = await browser.newPage({ viewport: { width: 390, height: 900 } });
await mp.setContent(html(true), { waitUntil: 'networkidle' }); await loadFonts(mp); await mp.waitForTimeout(300);
const mh = await mp.$$eval('[data-key]', (es) => Object.fromEntries(es.map((e) => [e.dataset.key, Math.ceil(e.getBoundingClientRect().height)])));
const M = desc.section.mobile; const seq = desc.components.filter((c) => c.kind !== 'pinned' && !c.mobile.hidden).sort((a, b) => a.mobile.order - b.mobile.order);
// the colour behind each component on desktop (the plate pixel at its left edge): the mobile
// background repeats those colours in bands, so text keeps the paper/note/sky it sat on
const plateColor = {};
if (plate) {
  const pc = await browser.newPage();
  const cx = desc.source.centered ? 320 : 0, k = 2; // plate rendered at canvas+640 and 2x
  // 7 x 3 samples across the box; the most common colour wins (ignores ornaments and edges)
  const pts = Object.fromEntries(desc.components.map((c) => [c.key, [0, 1, 2].flatMap((r) => [0, 1, 2, 3, 4, 5, 6].map((i) => [(c.desktop.x + cx + c.desktop.width * (i + 0.5) / 7) * k, (c.desktop.y + Math.min(c.desktop.height, 60) * (r + 0.5) / 3) * k]))]));
  Object.assign(plateColor, await pc.evaluate(async ([d, pts]) => { const i = new Image(); await new Promise((ok) => { i.onload = ok; i.src = d; }); const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const q = (v) => Math.round(v / 24) * 24; // bucket similar shades
    return Object.fromEntries(Object.entries(pts).map(([k, list]) => { const votes = new Map(); for (const [px, py] of list) { const p = x.getImageData(Math.round(px), Math.round(py), 1, 1).data; const key = [q(p[0]), q(p[1]), q(p[2])].join(','); const e = votes.get(key) || { n: 0, p }; e.n++; votes.set(key, e); }
      const p = [...votes.values()].sort((a, b) => b.n - a.n)[0].p; return [k, '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()]; })); }, [`data:image/png;base64,${fs.readFileSync(plate).toString('base64')}`, pts]));
  // the fixed chrome bands (nav, header) take the page colour at the left margin of their rows
  const margin = (g) => { const c = desc.components.find((x) => x.mobile?.group === g); return c ? [(6 + cx) * k, (c.desktop.y + Math.min(c.desktop.height, 40) / 2) * k] : null; };
  const m = await pc.evaluate(async ([d, pts]) => { const i = new Image(); await new Promise((ok) => { i.onload = ok; i.src = d; }); const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    return Object.fromEntries(Object.entries(pts).filter(([, v]) => v).map(([g, [px, py]]) => { const p = x.getImageData(Math.round(px), Math.round(py), 1, 1).data; return [g, '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()]; })); }, [`data:image/png;base64,${fs.readFileSync(plate).toString('base64')}`, { nav: margin('nav'), head: margin('head') }]);
  desc.section.mobile.bands = { ...desc.section.mobile.bands, ...m };
  await pc.close();
}
const near = (a, b) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const [x, y] = [p(a), p(b)]; return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) < 40; };
let y = 0, lastGroup = null, rowY = null, rowKey = null; const bands = [];
const fixedEnd = Math.max(0, ...seq.filter((c) => c.mobile.box).map((c) => c.mobile.box.y + (c.kind === 'image' ? Math.round(c.mobile.box.width * c.desktop.height / c.desktop.width) : c.mobile.box.height)));
for (const c of seq) {
  if (c.mobile.box) { // exported chrome keeps its boxes; an image's height follows its width (Harmony keeps the ratio,
    // and boxes below are anchored to its real bottom, so a wrong height shifts everything after it)
    c.mobile.final = { ...c.mobile.box }; if (c.kind === 'image') c.mobile.final.height = Math.round(c.mobile.box.width * c.desktop.height / c.desktop.width); continue; }
  if (y < fixedEnd) y = fixedEnd + M.groupGap;
  const color = plateColor[c.key] || '#FFFFFF';
  if (lastGroup && c.mobile.group !== lastGroup) y += M.groupGap;
  if (!bands.length || !near(bands[bands.length - 1].color, color)) { if (bands.length) bands[bands.length - 1].end = y - M.gap / 2; bands.push({ color, start: y - M.gap / 2 }); }
  const h = c.kind === 'image' ? Math.round(c.desktop.height * (c.mobile.width / c.desktop.width)) : mh[c.key];
  let top = y;
  if (c.mobile.row && c.mobile.row === rowKey) top = rowY; else { rowKey = c.mobile.row || null; rowY = y; }
  if (c.continues && !c.mobile.row) top = Math.max(top - M.gap, 0); // the next run of the same paragraph follows with no gap
  c.mobile.final = { x: c.mobile.x, y: top, width: c.mobile.width, height: h };
  y = Math.max(y, top + h + M.gap); lastGroup = c.mobile.group;
}
const mobileHeight = y + M.groupGap;
if (bands.length) bands[bands.length - 1].end = mobileHeight;
// a band thinner than 40 px is a sliver: it joins its neighbour above
for (let i = bands.length - 1; i > 0; i--) if (bands[i].end - bands[i].start < 40) { bands[i - 1].end = bands[i].end; bands.splice(i, 1); }
for (let i = bands.length - 1; i > 0; i--) if (near(bands[i].color, bands[i - 1].color)) { bands[i - 1].end = bands[i].end; bands.splice(i, 1); }
const headEnd = fixedEnd + M.groupGap / 2;
const stops = [[M.bands.nav || '#FFFFFF', 100], [M.bands.head || M.bands.nav || '#FFFFFF', headEnd], ...bands.map((b) => [b.color, b.end])];
let prev = 0; const grad = stops.map(([c, end]) => { const s = `${c} ${(prev / mobileHeight * 100).toFixed(2)}%, ${c} ${(end / mobileHeight * 100).toFixed(2)}%`; prev = end; return s; });
const mobileGradient = `linear-gradient(180deg, ${grad.join(', ')})`;
const mobileOverlaps = [];
const fin = seq.map((c) => ({ key: c.key, ...c.mobile.final }));
for (let i = 0; i < fin.length; i++) for (let j = i + 1; j < fin.length; j++) { const a = fin[i], b = fin[j]; if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) mobileOverlaps.push([a.key, b.key]); }
// mobile preview image
await mp.setContent(html(true).replace(/(data-key="([^"]+)" style="left:[\d.]+px;top:)0px/g, (m, pre, k) => `${pre}${desc.components.find((c) => c.key === k).mobile.final?.y ?? 0}px`).replace(/height:6000px;background:[^;]*;/, `height:${mobileHeight}px;background:${mobileGradient};`), { waitUntil: 'networkidle' });
await mp.evaluate(() => document.fonts.ready); await mp.waitForTimeout(300);
await mp.screenshot({ path: `${outDir}/render-390.png`, fullPage: true });
await browser.close();

for (const c of desc.components) if (c.kind === 'text') c.desktop.height = measured[c.key].h;
const report = { errors, warnings, desktop: { settled, overlaps: overlaps.map(([a, b]) => [a, b]), outOfBounds, wraps, diffPctVsSource1280: diffPct }, mobile: { height: mobileHeight, overlaps: mobileOverlaps, bands: bands.map((b) => [b.color, Math.round(b.start), Math.round(b.end)]), gradient: mobileGradient }, images: [`${outDir}/render-1280.png`, `${outDir}/source-1280.png`, `${outDir}/render-390.png`] };
for (const c of desc.components) if (plateColor[c.key]) c.mobile.color = plateColor[c.key];
const blocking = errors.length + overlaps.length + outOfBounds.length + mobileOverlaps.length;
if (args.includes('--write')) {
  desc.section.mobile.height = mobileHeight; desc.section.mobile.gradient = mobileGradient;
  delete desc.checkedAt; delete desc.checkedHash; // a failed check never authorises a deploy
  if (!blocking) { desc.checkedAt = new Date().toISOString(); desc.checkedHash = descHash(desc); }
  fs.writeFileSync(descFile, JSON.stringify(desc, null, 1));
}
fs.writeFileSync(`${outDir}/check.json`, JSON.stringify({ ...report, overlapDetail: overlaps.map(([a, b, d]) => d), mobileItems: seq.map((c) => [c.key, c.mobile.group, plateColor[c.key], c.mobile.final]) }, null, 1));
console.log(JSON.stringify(report));
if (blocking) console.error(`check FAILED: ${errors.length} errors, ${overlaps.length} desktop overlaps, ${outOfBounds.length} boxes outside the section (${outOfBounds.join(', ')}), ${mobileOverlaps.length} mobile overlaps. No deploy stamp written.`);
process.exit(blocking ? 1 : 0);

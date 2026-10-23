#!/usr/bin/env node
// Turn a source measurement (measure-source.mjs) into a PAGE DESCRIPTION: one JSON file that
// lists every Harmony component the copied page needs — type, content, styles, link, desktop
// box and mobile placement — so the page can be checked locally and deployed in one pass.
//
//   node scripts/copy/build-description.mjs <source.json> <out.desc.json>
//        --fonts font-ledger.json            source family -> Harmony family (wfont_… or catalog)
//        [--recipes export.json ...]         exported Harmony components (export-page.js) whose
//                                            styles/links are reused for the same text or image
//        [--source-origin https://site] [--local-origin http://127.0.0.1:8732]
//        [--pages '{"https://site/":"<homePageId>"}'] source URL -> Harmony pageId (PageLink); "self" = this page (needs --page-id <id>)
//        [--layout '{"navMaxY":60,…}']        thresholds for the mobile grouping (defaults below)
//        [--name "<Page name>"] [--decorative <img-src-substring>,…]  (kept in the plate, no component)
//
// Deterministic: the same inputs give the same file. Anything it cannot decide is listed in
// `review` for the agent (or a person) instead of guessed.
import fs from 'fs';
import { openItems, pendingItems } from './desc-hash.mjs';
import { normU, stripTracking } from './link-url.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const optAll = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const [srcFile, outFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!srcFile || !outFile || !opt('fonts')) { console.error('usage: build-description.mjs <source.json> <out.desc.json> --fonts font-ledger.json [--recipes export.json ...]'); process.exit(2); }
const src = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
const fontLedger = JSON.parse(fs.readFileSync(opt('fonts'), 'utf8')).families || {};
const recipes = optAll('recipes').flatMap((f) => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d.components || [d]; });
const sourceOrigin = opt('source-origin', null), localOrigin = opt('local-origin', null);
const pageMap = JSON.parse(opt('pages', '{}'));
// --linkmap links.json: { "<source URL>": { link: <Harmony link>, inline?: "<absolute URL for links inside text>" } }.
// Every link the source has is looked up here first. Rich text cannot hold a PageLink, so a link inside text uses
// `inline` (an absolute URL on the new site). `unbuilt: "<why>"` marks a page the new site does not have yet: its link points at an
// existing page for now, and the page stays in desc.pendingItems (the cutover hand-off) until the entry drops `unbuilt`.
// Lookup keys are normalised by link-url.mjs (case of the path and query values is kept, tracking parameters are removed).
// Build it from the migrated data: a store category or product link
// MUST land on the new store's category / product page, never on the source site (see COPY-SITE.md "Links").
const rawLinkmap = opt('linkmap') ? JSON.parse(fs.readFileSync(opt('linkmap'), 'utf8')) : {};
const linkmap = Object.fromEntries(Object.entries(rawLinkmap).map(([u, v]) => [normU(u), v]));
const mapped = (u) => linkmap[normU(u)] || null;

// "self" in --pages means this very page: it needs --page-id, never becomes the literal id "self"
for (const [u, v] of Object.entries(pageMap)) if (v === 'self') {
  if (!opt('page-id')) { console.error(`--pages maps ${u} to "self": pass --page-id <this page's Harmony pageId>`); process.exit(2); }
  pageMap[u] = opt('page-id');
}
const decorative = (opt('decorative', '') || '').split(',').filter(Boolean);
const review = [];
// Mobile grouping thresholds (desktop px at the measured width). The defaults come from a fixed-width,
// centred 1280 layout with a top nav, a header band, a main column and a right-hand sidebar; another
// theme needs its own numbers: pass --layout and read the `review` item that says defaults were used.
const L = { navMaxY: 60, mainLeftMin: 200, mainLeftMax: 400, mainTopMin: 300, sideMinX: 860, footHeight: 160, ...JSON.parse(opt('layout', '{}')) };

// ---- helpers ------------------------------------------------------------------------------
const toSource = (u) => (u && localOrigin && sourceOrigin ? u.split(localOrigin).join(sourceOrigin) : u);
const plain = (h) => (h || '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|’/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const hex = (c) => { if (/^#[0-9a-f]{6}$/i.test(String(c).trim())) return String(c).trim().toUpperCase(); const m = String(c).match(/\d+(\.\d+)?/g); if (!m) return c; const [r, g, b, a] = m.map(Number); const h = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); return a !== undefined && a < 1 ? `rgba(${r},${g},${b},${a})` : h; };
const px = (v) => parseFloat(v);
const fontFor = (family) => {
  const first = String(family).split(',')[0].replace(/["']/g, '').trim();
  const hit = Object.entries(fontLedger).find(([k]) => k.toLowerCase() === first.toLowerCase());
  if (hit) return hit[1];
  const generic = { courier: 'courier new', 'courier new': 'courier new', arial: 'arial', helvetica: 'helvetica-w01-roman', georgia: 'georgia', 'times new roman': 'times new roman' };
  if (generic[first.toLowerCase()]) return generic[first.toLowerCase()];
  review.push({ font: first, why: 'no Harmony family for this source font: upload it (Upload fonts dialog) and add it to the font ledger' });
  return first.toLowerCase();
};
const linkFor = (href) => {
  if (!href) return null;
  let u = toSource(href);
  const lm = mapped(u); if (lm?.link) return { ...lm.link, ...(lm.unbuilt ? { unbuilt: { url: stripTracking(u), reason: lm.unbuilt } } : {}) };
  u = stripTracking(u); // tracking parameters change per visit
  const pid = pageMap[u] ?? pageMap[u.replace(/\/$/, '')] ?? pageMap[u + '/'];
  if (pid) return { type: 'PageLink', pageId: pid, target: '_self' };
  if (u.startsWith('mailto:')) return { type: 'EmailLink', recipient: u.slice(7).split('?')[0] };
  if (u.startsWith('tel:')) return { type: 'PhoneLink', phoneNumber: u.slice(4) };
  const sameSite = sourceOrigin && u.startsWith(sourceOrigin);
  return { type: 'ExternalLink', url: u, target: sameSite ? '_self' : '_blank', ...(sameSite ? { sourcePage: true } : {}) };
};
const align = (a) => ({ left: 'start', start: 'start', right: 'end', end: 'end', center: 'center', justify: 'justify' }[a] || 'start');
// a recipe is reused when the same words (text) or the same file (image) exist on an exported page
const recipeText = (txt, size, color) => {
  // same words AND the same look: the recipe's font size within 1px and the same colour
  const look = (r) => { const st = Object.assign({}, ...(r.styles || []).map((e) => e.props)); return { size: px(st.fontSize), color: hex(st.color) }; };
  const cands = recipes.filter((r) => (r.html ? plain(r.html) : r.content?.label ? plain(r.content.label) : null) === txt)
    .filter((r) => { const l = look(r); return Math.abs(l.size - size) <= 1 && l.color === hex(color); });
  return cands[0] || null;
};
const recipeImage = (srcUrl) => { const f = srcUrl.split('/').pop().split('?')[0]; return recipes.find((r) => r.type === 'wixEditorElements.Image' && (r.content?.image?.name || '').endsWith(f)) || null; };
const KEEP = { // the style keys a copy writes; everything else stays the component's default
  'wixEditorElements.WRichText': { root: ['color', 'textAlign', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing'] },
  'wixEditorElements.Button': { root: ['background', 'backgroundColor', 'backgroundImage', 'boxShadow', 'paddingTop', 'paddingBottom', 'paddingInlineStart', 'paddingInlineEnd', 'borderTopWidth', 'borderBottomWidth', 'borderInlineStartWidth', 'borderInlineEndWidth', 'borderStartStartRadius', 'borderStartEndRadius', 'borderEndStartRadius', 'borderEndEndRadius'], label: ['color', 'textAlign', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textDecorationLine'] },
  'wixEditorElements.Image': { root: ['opacity'] },
};
const recipeStyles = (r) => {
  const keep = KEEP[r.type] || {}; const out = {};
  for (const e of r.styles || []) { const k = e.path.join('/') || 'root'; if (!keep[k]) continue; const props = Object.fromEntries(Object.entries(e.props).filter(([p, v]) => keep[k].includes(p) && !String(v).startsWith('var('))); if (Object.keys(props).length) out[k] = props; }
  return out;
};
const textStyles = (t) => {
  const size = px(t.size); const pitch = t.linePitch || px(t.lineHeight) || size * 1.2;
  const ls = t.letterSpacing === 'normal' ? 'normal' : `${Math.round((px(t.letterSpacing) / size) * 1000) / 1000}em`;
  return { root: { fontFamily: fontFor(t.font), fontSize: `${size}px`, lineHeight: `${Math.round((pitch / size) * 10000) / 10000}em`, fontWeight: String(t.weight), fontStyle: t.style, color: hex(t.color), textAlign: align(t.align), letterSpacing: ls } };
};
// single-line left-aligned text gets its painted width plus slack, so it never wraps early;
// multi-line text keeps the source block (or float run) width so it wraps where the source wraps
const textBox = (t, seg) => {
  const pitch = t.linePitch || px(t.lineHeight) || px(t.size) * 1.2;
  const b = seg ? seg.box : t.block; const lines = seg ? seg.lines : t.lines || 1;
  const y = Math.round(seg ? seg.lineTop : t.lineTop);
  if (lines <= 1 && !seg) { // one line: its painted width plus slack, anchored the way it is aligned
    const g = t.glyphBox || t.textBox; // the words, not an inline icon beside them
    const w = Math.min(b.w, g.w + 12), a = align(t.align);
    const x = a === 'center' ? Math.round(g.x + g.w / 2 - w / 2) : a === 'end' ? g.x + g.w + 6 - w : g.x;
    return { x: Math.max(b.x, Math.min(x, b.x + b.w - w)), y, width: w, height: Math.round(pitch) };
  }
  return { x: b.x, y, width: b.w, height: Math.round(lines * pitch) };
};

// a click area that paints nothing
const TRANSPARENT = { root: { backgroundColor: 'rgba(0,0,0,0)', background: 'rgba(0,0,0,0)', boxShadow: 'none', borderTopWidth: '0px', borderBottomWidth: '0px', borderInlineStartWidth: '0px', borderInlineEndWidth: '0px', paddingTop: '0px', paddingBottom: '0px', paddingInlineStart: '0px', paddingInlineEnd: '0px' }, label: { color: 'rgba(0,0,0,0)' } };

// ---- components ---------------------------------------------------------------------------
const comps = []; let n = 0;
const key = (kind, label) => `${kind}-${String(++n).padStart(2, '0')}-${plain(label).replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/-$/, '')}`;

for (const f of src.fixed) {
  const r = recipes.find((x) => x.pin && plain(x.content?.label) === plain(f.text));
  if (!r) { review.push({ fixed: f.text, why: 'floating element without a recipe: build a pinned Button from fixed[] by hand once, export it, and pass it as --recipes' }); continue; }
  comps.push({ key: key('pinned', f.text), kind: 'pinned', type: r.type, label: r.content.label, link: linkFor(f.href), styles: recipeStyles(r), pin: { position: r.pin.position, offsetPx: { horizontal: r.pin.offsetPx.horizontal, vertical: f.bottomOffset } }, desktop: { x: f.box.x, y: f.box.y, width: f.box.w, height: f.box.h }, from: `recipe:${r.label}`, recipeId: r.id });
}

for (const t of src.texts) {
  if (src.fixed.some((f) => plain(f.text) === plain(t.text))) continue; // the floating element's own words
  if (t.hiddenText) {
    if (!t.links.length) continue;
    const r = recipes.find((x) => x.type === 'wixEditorElements.Button' && /hotspot/.test(x.label));
    comps.push({ key: key('hotspot', t.text), kind: 'hotspot', type: 'wixEditorElements.Button', label: t.text.trim(), link: linkFor(t.links[0]), styles: r ? recipeStyles(r) : TRANSPARENT, desktop: { x: t.block.x, y: t.block.y, width: t.block.w, height: t.block.h }, from: r ? `recipe:${r.label}` : 'measured', recipeId: r ? r.id : null, note: 'click area over artwork in the plate (image-replacement link on the source)' });
    continue;
  }
  if (t.occluded) { review.push({ text: t.text.slice(0, 40), why: 'covered by another element on the source: not copied' }); continue; }
  const parts = t.segments || [null];
  for (const seg of parts) {
    let rich = toSource(seg ? seg.rich : t.rich);
    if (!plain(rich)) continue;
    const r = !seg && recipeText(plain(rich), px(t.size), t.color);
    if (r && r.type === 'wixEditorElements.Button') { // the exported page used a Button for this text (nav links)
      comps.push({ key: key('button', t.text), kind: 'button', type: r.type, label: r.content.label, link: linkFor((t.links[0] || null)), styles: recipeStyles(r), desktop: { x: t.block.x, y: t.block.y, width: t.block.w, height: t.block.h }, from: `recipe:${r.label}`, recipeId: r.id });
      continue;
    }
    // links in text stay INLINE <a href>: links.set on a rich text rewrites it (root becomes <h1>,
    // an underline span is added). A text that must reach a Harmony page is listed for review.
    const link = null;
    // a text that is itself inside a link (nav item, "show all") has no <a> in its own markup: wrap it, or the link is lost
    if (t.links?.length && !/<a href=/.test(rich) && !seg) rich = `<a href="${toSource(t.links[0])}">${rich}</a>`;
    const unbuiltInline = [];
    rich = rich.replace(/<a href="([^"]+)"/g, (all, h) => { const lm = mapped(h); const to = lm?.inline || (lm?.link?.type === 'ExternalLink' ? lm.link.url : null); if (lm?.unbuilt) unbuiltInline.push({ url: stripTracking(toSource(h)), reason: lm.unbuilt, standIn: to || 'unchanged (still the source URL)' }); return to ? `<a href="${to.replace(/&/g, '&amp;')}"` : all; });
    for (const m of rich.matchAll(/<a href="([^"]+)"/g)) { const l = linkFor(m[1]); if (l?.type === 'PageLink') review.push({ text: plain(rich).slice(0, 40), why: `inline link to a Harmony page (${l.pageId}): rich text keeps the source URL; use a Button if it must be a page link` }); }
    const tag = /^h[1-6]$/i.test(t.tag || '') ? t.tag.toLowerCase() : 'p';
    const tk = key('text', seg ? seg.rich : t.text);
    comps.push({ key: tk, kind: 'text', type: 'wixEditorElements.WRichText', html: `<${tag}>${rich}</${tag}>`, link, ...(unbuiltInline.length ? { unbuiltInline } : {}), styles: r ? recipeStyles(r) : textStyles(t), desktop: textBox(t, seg), lines: seg ? seg.lines : t.lines, from: r ? `recipe:${r.label}` : 'measured', recipeId: r ? r.id : null, ...(seg ? { note: `run ${parts.indexOf(seg) + 1}/${parts.length} of a paragraph that wraps around a float`, ...(parts.indexOf(seg) > 0 ? { continues: true } : {}) } : {}) });
  }
}

for (const im of src.images) {
  if (decorative.some((d) => im.src.includes(d))) continue;
  const r = recipeImage(im.src);
  comps.push({ key: key('image', im.src.split('/').pop()), kind: 'image', type: 'wixEditorElements.Image', image: r ? { uri: r.content.image.uri, name: r.content.image.name, width: r.content.image.width, height: r.content.image.height, alt: im.alt || r.content.image.alt || '' } : { source: toSource(im.src).replace(/-\d+x\d+(\.\w+)$/, '$1'), sourceRendered: toSource(im.src), name: im.src.split('/').pop(), alt: im.alt || '', width: im.box.w, height: im.box.h }, displayMode: 'fitWidth', link: linkFor(im.href), desktop: { x: im.box.x, y: im.box.y, width: im.box.w, height: im.box.h }, from: r ? `recipe:${r.label}` : 'measured', recipeId: r ? r.id : null });
}

// ---- elements Harmony supplies itself (--native native.json) -------------------------------------
// [{ "key": "cart", "type": "checkout_Orders.CartIcon_legacy", "desktop": { x, y, width, height }, "styles": {...} }]
// A cart icon or login a store needs: added with the page in the same deploy, never by hand afterwards (every
// add or remove after the deploy lets the editor squeeze the page's blank bands and shifts the whole layout).
for (const nv of opt('native') ? JSON.parse(fs.readFileSync(opt('native'), 'utf8')) : []) comps.push({ key: `native-${nv.key}`, kind: 'native', type: nv.type, label: nv.key, link: null, styles: nv.styles || {}, desktop: nv.desktop, from: 'native', recipeId: null });

// ---- every source link is a link in the copy ------------------------------------------------
// Text and image links are set above. Any other visible link (icons painted in the plate, the logo, a tile, a
// social icon) becomes a transparent click area over its box, so no link is dropped.
const overlap = (a, b) => { const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / (b.width * b.height) : 0; }; // share of b (the source link's box) that a covers
const sameLink = (a, b) => a && b && a.type === b.type && (a.url || a.pageId || a.phoneNumber || a.recipient) === (b.url || b.pageId || b.phoneNumber || b.recipient) && (a.innerRoute || '') === (b.innerRoute || '');
const seen = new Set();
for (const a of src.anchors || []) {
  const href = toSource(a.href); const bx = { x: a.box.x, y: a.box.y, width: a.box.w, height: a.box.h };
  if (bx.x < 0 || bx.x + bx.width > src.width + 1 || /^javascript:/i.test(href) || /demandware\.store|\/on\/demandware/.test(href)) continue; // off the page (carousel clones) or an app action, not a page link
  if ((src.fixed || []).some((f) => overlap({ x: f.box.x, y: f.box.y, width: f.box.w, height: f.box.h }, bx) >= 0.5)) continue; // a floating element (chat pill...): pinned by hand/recipe, listed in review, never a click area over the page
  const dupe = `${normU(href)}@${bx.x},${bx.y}`; if (seen.has(dupe)) continue; seen.add(dupe);
  const want = linkFor(href); if (!want) continue;
  const inl = mapped(href); const inlineUrl = inl?.inline || inl?.link?.url || href;
  const covered = comps.some((c) => overlap(c.desktop, bx) >= 0.5 && (c.kind === 'native' || sameLink(c.link, want) || (c.kind === 'text' && (c.html.includes(`href="${inlineUrl.replace(/&/g, '&amp;')}"`) || c.html.includes(`href="${href}"`)))));
  if (covered) continue;
  comps.push({ key: key('hotspot', a.text || href), kind: 'hotspot', type: 'wixEditorElements.Button', label: (a.text || 'link').slice(0, 40), link: want, styles: TRANSPARENT, desktop: bx, from: 'measured', recipeId: null, note: 'click area over a source link that is not text or an image' });
}

for (const u of src.unsupported || []) review.push({ unsupported: `${u.tag}${u.src ? ' ' + u.src : ''} at x${u.box.x} y${u.box.y} ${u.box.w}x${u.box.h}`, why: 'not rebuilt by this method (only text, images, buttons and the plate): decide by hand, e.g. a Harmony app/element, a link, or leave it out and tell the customer' });
if (!opt('layout')) review.push({ layout: 'default mobile grouping thresholds', why: 'tuned for a fixed-width 1280 layout with nav, header band, main column and right sidebar: check the mobile render, or pass --layout' });
// ---- mobile: one readable column in reading order, reusing an exported page's mobile boxes --
const W = 390, M = 24, CW = W - 2 * M;
const recipeOf = (c) => (c.recipeId ? recipes.find((r) => r.id === c.recipeId) : null);
const top = Math.min(...src.texts.filter((t) => /^(start|left)$/.test(t.align) && t.block.x > L.mainLeftMin && t.block.x < L.mainLeftMax && t.block.y > L.mainTopMin).map((t) => t.block.y), 1e9); // first main-column line
const group = (c) => {
  const d = c.desktop;
  if (c.kind === 'pinned') return 'pinned';
  if (d.y < L.navMaxY) return 'nav';
  if (d.y + d.height <= top) return 'head';
  if (d.x >= L.sideMinX) return 'side';
  if (d.y > src.page.height - L.footHeight) return 'foot';
  return 'main';
};
for (const c of comps) {
  c.mobile = { group: group(c) };
  const r = recipeOf(c);
  if (c.mobile.group === 'pinned') continue;
  if (c.kind === 'hotspot') { c.mobile.hidden = true; continue; }
  if (c.kind === 'native') { c.mobile.width = c.desktop.width; c.mobile.x = W - M - c.desktop.width; continue; } // keeps its own size: it is not a full-width block
  if (r && r.mobile && ['nav', 'head'].includes(c.mobile.group)) { c.mobile.box = r.mobile; continue; } // the same chrome as the exported page
  if (r?.mobile && c.mobile.group === 'side') { c.mobile.x = r.mobile.x; c.mobile.width = r.mobile.width; continue; } // same arrangement as the exported page
  const w = c.kind === 'image' ? Math.min(c.desktop.width, CW) : CW;
  c.mobile.width = w;
  c.mobile.x = c.kind === 'image' ? Math.round((W - w) / 2) : M;
}
const ordered = ['nav', 'head', 'main', 'side', 'foot'];
comps.forEach((c) => { c.mobile.order = ordered.indexOf(c.mobile.group) * 100000 + Math.round(c.desktop.y / 10) * 10 + c.desktop.x / 10000; }); // rows within 10 px read left to right
// icons that sit side by side on desktop stay in one row on mobile
for (const c of comps) { const row = comps.filter((o) => o !== c && o.mobile.group === c.mobile.group && o.kind === 'image' && c.kind === 'image' && Math.abs(o.desktop.y - c.desktop.y) < 8); if (row.length && [c, ...row].reduce((n, o) => n + o.mobile.width, 0) + 12 * row.length <= CW) c.mobile.row = Math.min(...[c, ...row].map((o) => Math.round(o.desktop.y))); } // only when the row really fits the mobile width: large cards stack

// a row that stays a row on mobile: spread its images evenly across the content width, in desktop order
const rows = new Map(); for (const c of comps) if (c.mobile.row != null) rows.set(`${c.mobile.group}:${c.mobile.row}`, [...(rows.get(`${c.mobile.group}:${c.mobile.row}`) || []), c]);
for (const items of rows.values()) { items.sort((a, b) => a.desktop.x - b.desktop.x); const sum = items.reduce((n, o) => n + o.mobile.width, 0); const gap = items.length > 1 ? (CW - sum) / (items.length - 1) : 0; let x = M; for (const o of items) { o.mobile.x = Math.round(x); x += o.mobile.width + gap; } }

// the page colour: an exported page's section colour when given, else the body's
const exportedSection = optAll('recipes').map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).section).find(Boolean);
const sectionColor = exportedSection?.background?.find((f) => f.key === 'backgroundColor')?.value?.raw || hex((src.backgrounds.find((b) => b.tag === 'BODY') || {}).color || '#FFFFFF');
// mobile band colours are sampled from the plate by check-description
const out = {
  schema: 'harmony-page-description/1',
  generatedAt: new Date().toISOString(),
  source: { url: toSource(src.url), measured: src.url, width: src.width, height: src.page.height, centered: src.page.centered },
  page: { name: opt('name', null) },
  layout: L,
  section: { desktop: { width: src.width, height: src.page.height }, background: { plate: null, fittingType: 'fill', backgroundColor: sectionColor }, mobile: { width: W, margin: M, gap: 12, groupGap: 28, bands: {} } },
  components: comps,
  openItems: openItems({ components: comps, source: { url: toSource(src.url) } }), // links still pointing at the source site: the cutover hand-off
  pendingItems: pendingItems({ components: comps }), // pages the copy still lacks (their links point at a stand-in page): the cutover hand-off
  review,
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const count = (k) => comps.filter((c) => c.kind === k).length;
console.log(JSON.stringify({ out: outFile, components: comps.length, text: count('text'), image: count('image'), button: count('button'), hotspot: count('hotspot'), pinned: count('pinned'), fromRecipes: comps.filter((c) => c.from.startsWith('recipe')).length, newMedia: comps.filter((c) => c.image && !c.image.uri).map((c) => c.image.name), review }));

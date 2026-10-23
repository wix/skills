#!/usr/bin/env node
// Measure a live source page so it can be copied exactly into Harmony.
//
//   node scripts/copy/measure-source.mjs <url> <out.json> [--width 1280] [--height 900]
//
// Writes one JSON file with everything the copy needs, in page coordinates at --width:
//   page        height, and a centering check (the same layout rendered 640px wider:
//               a constant dx of 320 means a centered fixed-width layout, so a wider
//               background plate lines up with the narrower canvas)
//   backgrounds every element with a background image or a non-transparent colour
//   images      every visible <img>: src, natural size, rendered box, alt, link
//   texts       one entry per text BLOCK: the block box, the first line's top
//               (lineTop), font family/size/weight/colour/line-height/letter-spacing,
//               alignment, inner HTML, explicit <br> breaks and links, plus:
//                 rich      Harmony-ready rich-text HTML: links kept, <br> kept, images and
//                           nested blocks dropped, and every run whose colour, weight,
//                           style, decoration, family or size differs from the text's own
//                           base style (font/size/color below) as an
//                           inline <span style> (sizes as em, so they scale)
//                 segments  only when the text wraps around a float (its lines start at
//                           different x): one {rich, box, lineTop, lines} per run of lines
//                           sharing a left edge, box width = the space the lines wrap in
//                 lines, linePitch  painted line count and the real distance between lines
//                           (can differ from lineHeight when inline content is bigger)
//                 occluded  true when something else is painted over all of the first line:
//                           usually not copied
//                 hiddenText  the words are not painted (image replacement, text-indent
//                           -9999px): with a link the box is a click area over artwork
//                           (copy as a transparent link button), without one skip it
//   fixed       position:fixed elements (floating buttons, chat widgets) incl. shadow DOM
//   unsupported iframes, video/audio, canvas, forms and form controls, inline svg: not rebuilt by
//               this method; build-description turns each into a `review` item
//
// Read only. It never logs in and never sends anything to the source.
import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const [url, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!url || !out) { console.error('usage: measure-source.mjs <url> <out.json> [--width 1280] [--height 900]'); process.exit(2); }
const width = Number(opt('width', 1280));
const height = Number(opt('height', 900));

const browser = await chromium.launch();

async function measure(w) {
  const page = await browser.newPage({ viewport: { width: w, height } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const R = (r) => ({ x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
    const visible = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0; };
    const backgrounds = [], images = [], texts = [], fixed = [], unsupported = [];
    for (const e of document.querySelectorAll('body *')) {
      if (!visible(e)) continue;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const hasImg = s.backgroundImage && s.backgroundImage !== 'none';
      const hasColor = !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor);
      if (hasImg || hasColor) backgrounds.push({ tag: e.tagName, id: e.id || null, cls: String(e.className || '').slice(0, 80), box: R(r), image: hasImg ? s.backgroundImage : null, repeat: s.backgroundRepeat, position: s.backgroundPosition, size: s.backgroundSize, color: s.backgroundColor, radius: s.borderRadius });
      // things this copy method does not rebuild (it only knows text, images, buttons and the plate): listed so
      // nothing is dropped silently. Hidden/aria-hidden tracking pixels are skipped by visible() above.
      if (/^(IFRAME|VIDEO|AUDIO|CANVAS|OBJECT|EMBED|FORM|INPUT|SELECT|TEXTAREA|SVG)$/i.test(e.tagName) && !(e.tagName.toUpperCase() === 'INPUT' && e.type === 'hidden') && !e.closest('svg:not(:scope)') && !(e.tagName.toUpperCase() === 'SVG' && r.width < 24 && r.height < 24)) unsupported.push({ tag: e.tagName.toLowerCase(), src: e.currentSrc || e.src || e.action || null, box: R(r) });
      if (e.tagName === 'IMG' && e.dataset.embedSrc) { unsupported.push({ tag: 'iframe', src: e.dataset.embedSrc, box: R(r) }); continue; } // the offline copy swapped an iframe for a snapshot image: still an embed, not a picture
      if (e.tagName === 'IMG') images.push({ src: e.currentSrc || e.src, natural: [e.naturalWidth, e.naturalHeight], box: R(r), alt: e.alt || '', href: e.closest('a') ? e.closest('a').href : null });
    }
    // floats only push lines of text in the same block formatting context (BFC)
    const makesBfc = (e) => { const s = getComputedStyle(e); return e === document.documentElement || s.float !== 'none' || /absolute|fixed/.test(s.position) || !/visible|clip/.test(s.overflowX + s.overflowY) && s.overflow !== 'visible' || /inline-block|flow-root|table-cell|table-caption|flex|grid/.test(s.display) || (e.parentElement && /flex|grid/.test(getComputedStyle(e.parentElement).display)); };
    const bfcOf = (e) => { for (let p = e; p; p = p.parentElement) if (makesBfc(p)) return p; return document.documentElement; };
    const floats = [...document.querySelectorAll('body *')].filter((e) => { const s = getComputedStyle(e); return (s.float === 'left' || s.float === 'right') && visible(e); })
      .map((e) => ({ el: e, bfc: bfcOf(e.parentElement), side: getComputedStyle(e).float, box: () => { const q = e.getBoundingClientRect(), s = getComputedStyle(e); return { left: q.left - parseFloat(s.marginLeft), right: q.right + parseFloat(s.marginRight), top: q.top - parseFloat(s.marginTop), bottom: q.bottom + parseFloat(s.marginBottom) }; } }));
    const seen = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !visible(el)) continue;
      let block = el; while (block && getComputedStyle(block).display === 'inline') block = block.parentElement;
      if (!block || seen.has(block)) continue; seen.add(block);
      const bs = getComputedStyle(block), br = block.getBoundingClientRect();
      if (br.width < 1 || br.right < 0 || br.left > innerWidth) continue; // off-screen (e.g. hidden menu items)
      const rg = document.createRange(); rg.selectNodeContents(block); const tr = rg.getBoundingClientRect();
      const ts = getComputedStyle(el);
      const lh = parseFloat(ts.lineHeight) || parseFloat(ts.fontSize) * 1.2;
      const rects = [...rg.getClientRects()].filter((q) => q.width > 0);
      const firstLine = rects.length ? rects[0] : tr;
      // a glyph rect is the font's content area, centred on its line box
      const lineTop = Math.round((firstLine.top + scrollY + (firstLine.height - lh) / 2) * 10) / 10;
      // ---- rich HTML, line runs (floats) and occlusion -------------------------------
      const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return c; const [r, g, b, a] = m.map(Number); const h = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); return a !== undefined && a < 1 ? `rgba(${r},${g},${b},${a})` : h; };
      const escT = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
      const inBlock = (n) => { for (let p = n.parentElement; p && p !== block; p = p.parentElement) if (!/^inline/.test(getComputedStyle(p).display)) return false; return true; };
      // the BASE style is the one most characters are painted in; every other run becomes a flat
      // <span style> relative to it (sizes in em), links stay <a>, nested blocks are their own entry
      const runKey = (c) => [c.color, c.fontWeight, c.fontStyle, c.textDecorationLine, c.fontFamily, c.fontSize].join('|');
      const counts = new Map(); const twc = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (twc.nextNode()) { const tn = twc.currentNode; if (!tn.textContent.trim() || !inBlock(tn)) continue; const c = getComputedStyle(tn.parentElement); const k = runKey(c); const e = counts.get(k) || { n: 0, el: tn.parentElement }; e.n += tn.textContent.trim().length; counts.set(k, e); }
      const baseEl = counts.size ? [...counts.values()].sort((x, y) => y.n - x.n)[0].el : el;
      const base = getComputedStyle(baseEl);
      const diff = (cs) => { const st = [];
        if (cs.color !== base.color) st.push(`color:${hex(cs.color)}`);
        if (cs.fontWeight !== base.fontWeight) st.push(`font-weight:${cs.fontWeight}`);
        if (cs.fontStyle !== base.fontStyle) st.push(`font-style:${cs.fontStyle}`);
        if (cs.textDecorationLine !== base.textDecorationLine) st.push(`text-decoration:${cs.textDecorationLine}`);
        if (cs.fontFamily !== base.fontFamily) st.push(`font-family:${cs.fontFamily.replace(/"/g, "'")}`);
        if (cs.fontSize !== base.fontSize) st.push(`font-size:${(parseFloat(cs.fontSize) / parseFloat(base.fontSize)).toFixed(3)}em`);
        return st.join(';'); };
      const rich = (node, R) => {
        let o = '';
        for (const n of node.childNodes) {
          if (R && !R.intersectsNode(n)) continue;
          if (n.nodeType === 3) { const t = n.textContent; const s0 = R && n === R.startContainer ? R.startOffset : 0; const e0 = R && n === R.endContainer ? R.endOffset : t.length;
            const w = escT(t.slice(s0, e0).replace(/[\n\t ]+/g, ' ')); const d = w.trim() ? diff(getComputedStyle(n.parentElement)) : ''; o += d ? `<span style="${d}">${w}</span>` : w; continue; }
          if (n.nodeType !== 1) continue;
          const tag = n.tagName; if (['IMG', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME'].includes(tag)) continue;
          if (tag === 'BR') { o += '<br>'; continue; }
          const cs = getComputedStyle(n); if (cs.display === 'none' || !/^inline/.test(cs.display)) continue;
          const inner = rich(n, R);
          o += tag === 'A' && n.getAttribute('href') ? `<a href="${n.href}">${inner}</a>` : inner;
        }
        return o;
      };
      const tidy = (h) => h.replace(/^(\s|&nbsp;|<br>)+|(\s|&nbsp;|<br>)+$/g, '');
      const bcs = getComputedStyle(block);
      // one entry per visual line: where it starts (text node + offset), its left and top
      const lineStarts = []; const tw2 = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const lhB = parseFloat(bcs.lineHeight) || parseFloat(bcs.fontSize) * 1.2;
      while (tw2.nextNode()) { const tn = tw2.currentNode; if (!inBlock(tn)) continue; const rr = document.createRange();
        for (let i = 0; i < tn.textContent.length; i++) { if (/\s/.test(tn.textContent[i])) continue; rr.setStart(tn, i); rr.setEnd(tn, i + 1); const q = rr.getBoundingClientRect(); if (!q.width) continue;
          const last = lineStarts[lineStarts.length - 1]; if (!last || q.top > last.top + lhB / 2) lineStarts.push({ node: tn, offset: i, left: q.left, top: q.top, h: q.height }); } }
      let segments = null;
      // image replacement (text-indent:-9999px etc.): the words are not painted, the box is a click area
      const hiddenText = lineStarts.length > 0 && (lineStarts[0].left > br.right + 50 || lineStarts[0].left < br.left - 50);
      const leftAligned = /^(start|left|justify)$/.test(bcs.textAlign) && bcs.direction !== 'rtl';
      if (!hiddenText && leftAligned && lineStarts.length) {
        // the space each line wraps in: the block's content box minus every float beside the line
        const contentLeft = br.left + parseFloat(bcs.paddingLeft) + parseFloat(bcs.borderLeftWidth);
        const contentRight = br.right - parseFloat(bcs.paddingRight) - parseFloat(bcs.borderRightWidth);
        for (const l of lineStarts) {
          l.availL = contentLeft; l.availR = contentRight;
          const myBfc = makesBfc(block) ? block : bfcOf(block);
          // a float pushes only the lines that come after it in the document
          for (const fl of floats) { if (fl.el.contains(block) || fl.bfc !== myBfc || !(fl.el.compareDocumentPosition(l.node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue; const q = fl.box(); if (q.bottom <= l.top + 1 || q.top >= l.top + lhB - 1) continue;
            if (fl.side === 'left' && q.right > l.availL && q.left < contentRight) l.availL = Math.max(l.availL, q.right);
            if (fl.side === 'right' && q.left < l.availR && q.right > contentLeft) l.availR = Math.min(l.availR, q.left); }
        }
        const groups = []; for (const l of lineStarts) { const g = groups[groups.length - 1]; if (g && Math.abs(g.availL - l.availL) < 4 && Math.abs(g.availR - l.availR) < 4) g.lines.push(l); else groups.push({ availL: l.availL, availR: l.availR, left: l.left, lines: [l] }); }
        // runs of lines that wrap in different spaces (floats beside some lines), or a single run narrowed by a float
        if (groups.length > 1 || groups[0].availL > contentLeft + 4 || groups[0].availR < contentRight - 4) {
          segments = groups.map((g, gi) => { const R = document.createRange(); if (gi === 0) R.setStart(block, 0); else R.setStart(g.lines[0].node, g.lines[0].offset);
            if (gi < groups.length - 1) R.setEnd(groups[gi + 1].lines[0].node, groups[gi + 1].lines[0].offset); else R.setEnd(block, block.childNodes.length);
            const f = g.lines[0]; const x = Math.round(g.availL);
            return { rich: tidy(rich(block, R)), lineTop: Math.round((f.top + scrollY + (f.h - lhB) / 2) * 10) / 10, box: { x, y: Math.round(f.top + scrollY + (f.h - lhB) / 2), w: Math.round(g.availR) - x, h: Math.round(g.lines.length * lhB) }, lines: g.lines.length };
          });
        }
      }
      let occluded = false;
      if (lineStarts.length) { // scroll the line into view, ignore floating (fixed) layers, test what is on top
        const f = lineStarts[0]; const sy = scrollY; const absTop = f.top + sy; scrollTo(0, Math.max(0, absTop - 300));
        const fixedUp = (e) => { for (let p = e; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true; return false; };
        const right = Math.min(br.right, f.left + tr.width) - 4; // sample the first line at three points: hidden only if all are covered
        occluded = [f.left + 4, (f.left + right) / 2, right].every((x) => { const hit = document.elementsFromPoint(x, absTop - scrollY + f.h / 2).find((e) => !fixedUp(e)); return !!hit && hit !== block && !block.contains(hit); });
        scrollTo(0, sy); }
      texts.push({
        rich: tidy(rich(block, null)), segments, occluded, hiddenText,
        lines: lineStarts.length, linePitch: lineStarts.length > 1 ? Math.round(((lineStarts[lineStarts.length - 1].top - lineStarts[0].top) / (lineStarts.length - 1)) * 10) / 10 : null,
        text: block.innerText.replace(/\s+\n/g, '\n').trim().slice(0, 400),
        html: block.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 600),
        explicitBreaks: block.querySelectorAll('br').length,
        // the painted WORDS only (inline images excluded): single-line boxes are sized and centred on it
        glyphBox: (() => { let l = 1e9, t = 1e9, r = -1e9, b = -1e9; const tw3 = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); while (tw3.nextNode()) { const tn = tw3.currentNode; if (!tn.textContent.trim() || !inBlock(tn)) continue; const rr = document.createRange(); rr.selectNodeContents(tn); for (const q of rr.getClientRects()) { if (!q.width) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); } } return l < 1e9 ? { x: Math.round(l), y: Math.round(t + scrollY), w: Math.round(r - l), h: Math.round(b - t) } : null; })(),
        // the first painted glyph line sets lineTop (an inline image on the first line must not)
        block: R(br), textBox: R(tr), lineTop: lineStarts.length && !hiddenText ? Math.round((lineStarts[0].top + scrollY + (lineStarts[0].h - lhB) / 2) * 10) / 10 : lineTop,
        padding: [bs.paddingTop, bs.paddingRight, bs.paddingBottom, bs.paddingLeft].join(' '),
        font: base.fontFamily, size: base.fontSize, weight: base.fontWeight, style: base.fontStyle, color: base.color,
        lineHeight: base.lineHeight, letterSpacing: base.letterSpacing, transform: base.textTransform, align: bs.textAlign,
        decoration: base.textDecorationLine, shadow: base.textShadow,
        links: [...new Set([...block.querySelectorAll('a')].map((a) => a.href).concat(block.closest('a') ? [block.closest('a').href] : []))],
      });
    }
    const walk = (root) => { for (const e of root.querySelectorAll('*')) { const s = getComputedStyle(e); if (s.position === 'fixed' && visible(e)) {
          // report the clickable child (the visible pill), not a full-width wrapper
          const t = e.matches('a,button') ? e : (e.querySelector('a,button') || e);
          const ts = getComputedStyle(t), r = t.getBoundingClientRect();
          fixed.push({ tag: t.tagName, cls: String(t.className || '').slice(0, 80), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, bottomOffset: Math.round(innerHeight - r.bottom), text: (t.innerText || '').trim().slice(0, 120), href: t.href || null, background: ts.backgroundColor, radius: ts.borderRadius, padding: ts.padding, font: ts.fontFamily, size: ts.fontSize, weight: ts.fontWeight, color: ts.color });
        } if (e.shadowRoot) walk(e.shadowRoot); } };
    walk(document);
    // every visible link, with its box: build-description turns each one the text and image links do not
    // already cover into a transparent click area, so no source link is lost (icons, logo, nav, tiles)
    const anchors = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href') || ''; if (!h || h.startsWith('#') || /^javascript:/i.test(h) || !visible(a)) continue;
      const r = a.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      anchors.push({ href: a.href, text: ((a.innerText || '').trim().replace(/\s+/g, ' ') || a.getAttribute('aria-label') || (a.querySelector('img') && a.querySelector('img').alt) || '').slice(0, 60), box: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    return { anchors, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, Math.round(document.body.getBoundingClientRect().bottom + scrollY)) /* the full scrollable page, body margins included */, backgrounds, images, texts, fixed, unsupported };
  });
  await page.close();
  return data;
}

const main = await measure(width);
const wide = await measure(width + 640);
const dx = wide.images.map((im, i) => (main.images[i] ? im.box.x - main.images[i].box.x : null)).filter((v) => v != null);
const centered = dx.length > 0 && dx.every((v) => v === dx[0]);
const result = { url, width, measuredAt: new Date().toISOString(), page: { height: main.height, centeringDx: [...new Set(dx)], centered, offsetAtPlusWidth: centered ? dx[0] : null }, ...main };
fs.writeFileSync(out, JSON.stringify(result, null, 1));
await browser.close();
console.log(JSON.stringify({ out, height: main.height, centered: result.page.centered, centeringDx: result.page.centeringDx, backgrounds: main.backgrounds.length, images: main.images.length, texts: main.texts.length, fixed: main.fixed.length }));

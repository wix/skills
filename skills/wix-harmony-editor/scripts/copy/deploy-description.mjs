#!/usr/bin/env node
// Deploy a checked page description into a Harmony page in a few editor calls, read
// everything back, and save. No model in the loop.
//
//   node scripts/copy/deploy-description.mjs <page.desc.json> --page <pageId> [--clean] [--reapply] [--chunk 10]
//
// --reapply  re-send content, styles and links to components that already exist (after the
//            description changed); without it an existing component is only re-placed
//
// Calls (each one RunEditorLLMCodeToolAPI execute):
//   1  setup     navigate, add the page's one auto-height section (or reuse the one recorded in
//                the state file), set its background; --clean removes the page's other sections
//                and this description's components left elsewhere on the page (pinned ones)
//   2… create    add components in chunks, each renamed to its description key and given its
//                content, styles and link (idempotent: a key already in the section is skipped)
//   n  desktop   one setComposition with every box and the section height; pin floating items
//   n+1 mobile   one setComposition in the mobile view (positions, widths, height: per view)
//   n+2 verify   read back text, links, styles and both compositions, diff against the
//                description, save, report publish state before/after
// State (key -> componentId) is kept in <desc>.deploy.json, so a failed call is resumed, never
// re-run blindly. Requires the editor open on CDP 127.0.0.1:$PW_PORT, default 9333 (SKILL.md → Connect).
// Mobile-only Hide and the mobile background-image opacity have no API: run mobile-stage.mjs after.
import { chromium } from 'playwright';
import { hideScrollbars } from './hide-scrollbars.mjs';
import fs from 'fs';
import { descHash, openItems, pendingItems } from './desc-hash.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const descFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const pageId = opt('page');
if (!descFile || !pageId) { console.error('usage: deploy-description.mjs <page.desc.json> --page <pageId> [--clean] [--chunk 10]'); process.exit(2); }
const desc = JSON.parse(fs.readFileSync(descFile, 'utf8'));
if (!desc.checkedAt || desc.checkedHash !== descHash(desc)) { console.error('Refused: the description has no passing check for its current content. Run check-description.mjs --write until it passes (it stamps only a clean check).'); process.exit(2); }
const stateFile = descFile.replace(/\.json$/, '') + '.deploy.json';
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { pageId, ids: {} };
const chunk = Number(opt('chunk', 10));
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('editor.wix.com/edit/'));
if (!page) { console.error('No Harmony editor page is open.'); process.exit(3); }
await hideScrollbars(page); // canvas widths must not depend on the OS scrollbar setting
const timings = [];
async function run(name, code) {
  const t0 = Date.now();
  const raw = await page.evaluate(async (code) => { const api = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); try { return await api.execute({ code }, { biParams: {} }); } catch (e) { return { thrown: String(e?.message || e) }; } }, code);
  timings.push([name, Date.now() - t0]);
  if (raw.thrown) throw new Error(`${name}: ${raw.thrown}`);
  const c = JSON.parse(raw.items[0].content);
  if (!c.success) { const e = new Error(`${name}: ${c.summary}`); e.detail = c; throw e; }
  return c.result;
}
const J = (v) => JSON.stringify(v);
const plainLine = (h) => { const m = h.match(/^<p>([^<]*)<\/p>$/); return m ? m[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null; };
const cleanLink = (l) => { if (!l) return null; const { sourcePage, unbuilt, ...rest } = l; return rest; };
const flow = desc.components.filter((c) => c.kind !== 'pinned');

// 1 setup -----------------------------------------------------------------------------
const bg = desc.section.background;
const setup = await run('setup', `
const A = editorLLMApis;
const before = (await A.site.getStatus()).isPublished;
await A.pages.navigate({ pageId: ${J(pageId)} });
await A.breakpoints.toggle({ device: 'desktop' });
let secs = await A.sections.list({});
let sec = secs.find((s) => s.sectionId === ${J(state.sectionId || null)});
if (!sec) sec = await A.sections.add({ name: ${J(desc.section.name || desc.page.name || 'Copy')} });
const removed = [];
if (${args.includes('--clean')}) {
  for (const s of secs) if (s.role === 'section' && s.sectionId !== sec.sectionId) { await A.sections.remove({ sectionId: s.sectionId }); removed.push(s.sectionId); }
  // components this description placed outside the section earlier (pinned ones live on the page)
  for (const k of ${J(desc.components.filter((c) => c.kind === 'pinned').map((c) => c.key))}) { const f = await A.components.find({ labelContains: k, pageId: ${J(pageId)} }); for (const c of f.components) if (c.label === k) { await A.components.remove({ componentIds: [c.id] }); removed.push(c.id); } }
}
await A.appearance.setContainerBackground({ componentId: sec.sectionId, properties: { ${bg.plate ? `image: ${J({ uri: bg.plate.uri, name: bg.plate.name, alt: '', width: bg.plate.width, height: bg.plate.height })}, fittingType: ${J(bg.fittingType)},` : ''} backgroundColor: ${J(bg.backgroundColor)}${desc.section.mobile.gradient ? `, backgroundImage: ${J(desc.section.mobile.gradient)}` : ''} } });
const kids = (await A.components.getTree({ rootId: sec.sectionId, depth: 1 })).children || [];
const pins = [];
for (const k of ${J(desc.components.filter((c) => c.kind === 'pinned').map((c) => c.key))}) { const f = await A.components.find({ labelContains: k, pageId: ${J(pageId)} }); for (const c of f.components) if (c.label === k) pins.push([k, c.id]); }
return { before, sectionId: sec.sectionId, removed, existing: kids.map((k) => [k.label, k.id]), pins };`);
state.sectionId = setup.sectionId; state.publishedBefore = setup.before;
// the live page is the truth: drop every remembered id that is no longer there (--clean, a replaced section)
{ const live = new Map(setup.existing), livePins = new Map(setup.pins); state.ids = {};
  for (const c of desc.components) { const id = (c.kind === 'pinned' ? livePins : live).get(c.key); if (id) state.ids[c.key] = id; } }
saveState();

// 2 create ----------------------------------------------------------------------------
// --reapply also re-sends content, styles and links to components that already exist (no add)
const reapply = args.includes('--reapply');
const todo = desc.components.filter((c) => !state.ids[c.key] || reapply);
for (let i = 0; i < todo.length; i += chunk) {
  const part = todo.slice(i, i + chunk);
  const body = part.map((c) => {
    const lines = state.ids[c.key] ? [`{ const id = ${J(state.ids[c.key])}; out[${J(c.key)}] = id;`] : [`{ const a = (await A.components.add({ containerId: S, components: [{ componentType: ${J(c.type)} }], select: false })).added[0]; const id = a.componentId; out[${J(c.key)}] = id;`, `await A.components.rename({ componentId: id, label: ${J(c.key)} });`];
    if (c.kind === 'text') { const pl = plainLine(c.html); lines.push(pl !== null ? `await A.richText.injectText({ componentId: id, text: ${J(pl)} });` : `await A.richText.setText({ componentId: id, text: ${J(c.html)} });`); }
    if (c.kind === 'image') lines.push(`await A.content.set({ componentId: id, values: { image: ${J({ uri: c.image.uri, name: c.image.name, alt: c.image.alt || '', width: c.image.width, height: c.image.height })}, displayMode: ${J(c.displayMode)} } });`);
    if (c.kind === 'image' && c.displayMode === 'fill') lines.push(`await A.layout.setSize({ componentId: id, width: ${c.desktop.width}, height: ${c.desktop.height} });`); // a cropped image (fill) keeps the box the source drew; composition derives height from the ratio
    if (['button', 'hotspot', 'pinned'].includes(c.kind)) lines.push(`await A.content.writeText({ componentId: id, text: ${J(c.label || ' ')} });`);
    for (const [el, props] of Object.entries(c.styles || {})) lines.push(`await A.appearance.setStyles({ componentId: id, ${el === 'root' ? '' : `elementPath: ${J(el.split('/'))}, `}properties: ${J(props)} });`);
    if (c.link) lines.push(`await A.links.set({ componentId: id, link: ${J(cleanLink(c.link))} });`);
    else if (reapply && state.ids[c.key] && c.kind !== 'text') lines.push(`await A.links.remove({ componentId: id });`); // the description has none: an old live link must go (removing a missing one succeeds; any error is real)
    return lines.join('\n') + ' }';
  }).join('\n');
  const made = await run(`create ${i / chunk + 1}`, `const A = editorLLMApis; const S = ${J(state.sectionId)}; const out = {};\n${body}\nreturn out;`);
  Object.assign(state.ids, made); saveState();
}

// 3 desktop composition + pins ----------------------------------------------------------
// text and native (cart icon...) heights follow content; on mobile an image's height is SHARED with desktop (its width is
// per view), so mobile sends no image height and lets the ratio derive it
const box = (c, b, dev = 'desktop') => (c.kind === 'text' || c.kind === 'native' || (dev === 'mobile' && c.kind === 'image') ? { x: b.x, y: b.y, width: b.width } : { x: b.x, y: b.y, width: b.width, height: b.height });
const pinned = desc.components.filter((c) => c.kind === 'pinned');
// A new text starts narrow and therefore tall; once the first pass gives it its width it
// reflows shorter and the boxes below it drift up. So the same set is sent until it lands.
const compose = (dev, list, height, keyOf) => `
const A = editorLLMApis; await A.breakpoints.toggle({ device: '${dev}' });
const want = ${J(list.map((c) => ({ componentId: state.ids[c.key], box: box(c, keyOf(c), dev) })))};
let r, pass = 0, off = [];
for (; pass < 4; pass++) {
  // the editor rejects a composition that changes nothing ("resolved back onto the boxes it already had"):
  // that is fine when the read-back below shows every box already where it was asked to be
  let noop = false;
  try { r = await A.layout.setComposition({ componentId: ${J(state.sectionId)}, box: { height: ${height} }, children: want }); }
  catch (e) { if (!/back onto the boxes it already had/.test(String((e && e.message) || e))) throw e; noop = true; }
  const got = await A.layout.getComposition({ componentId: ${J(state.sectionId)} });
  const at = Object.fromEntries(got.children.map((k) => [k.componentId, k.box]));
  off = want.filter((w) => !at[w.componentId] || ['x', 'y', 'width', 'height'].some((k) => w.box[k] !== undefined && Math.abs(at[w.componentId][k] - w.box[k]) > 1)).map((w) => [w.componentId, w.box, at[w.componentId] || null]);
  if (noop) r = got;
  if (!off.length) break;
}`;
const desk = await run('desktop', compose('desktop', flow, desc.section.desktop.height, (c) => c.desktop) + `
const pins = [];
${pinned.map((c) => `{ const id = ${J(state.ids[c.key])}; // a pinned component cannot be resized: size it in the flow, then pin
  if ((await A.layout.getPinToScreen({ componentId: id })).pinned) await A.layout.unpinFromScreen({ componentId: id });
  await A.layout.setSize({ componentId: id, width: ${c.desktop.width} });
  pins.push(await A.layout.pinToScreen({ componentId: id, position: ${J(c.pin.position)}, offsetPx: ${J(c.pin.offsetPx)} })); }`).join('\n')}
return { passes: pass + 1, box: r.box, diagnostics: r.diagnostics, off, pins: pins.map((p) => [p.componentId, p.position, p.offsetPx]) };`);

// 4 mobile composition ------------------------------------------------------------------
const mob = flow.filter((c) => !c.mobile.hidden && c.mobile.final);
// Mobile: a first pass sets widths (with the locally predicted y's), then the column is
// re-stacked IN THE EDITOR from the heights Harmony actually gave each text (fonts wrap a
// little differently there), the same rules as check-description, and sent again. The band
// gradient is recomputed from the final y's.
const M = desc.section.mobile;
const stack = [...mob].sort((a, b) => a.mobile.order - b.mobile.order).map((c) => ({ // reading order, as check-description stacks it
  id: state.ids[c.key], fixed: !!c.mobile.box, x: c.mobile.final.x, width: c.mobile.final.width, y: c.mobile.final.y, group: c.mobile.group, row: c.mobile.row || null, continues: !!c.continues, color: c.mobile.color || null, image: c.kind === 'image' }));
const mobile = await run('mobile', compose('mobile', mob, M.height, (c) => c.mobile.final) + `
const H = Object.fromEntries((await A.layout.getComposition({ componentId: ${J(state.sectionId)} })).children.map((k) => [k.componentId, k.box]));
const L = ${J(stack)}, G = ${M.gap}, GG = ${M.groupGap};
const near = (a, b) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) < 40; };
const fixedEnd = Math.max(0, ...L.filter((c) => c.fixed).map((c) => H[c.id].y + H[c.id].height));
let y = 0, last = null, rowKey = null, rowY = 0; const bands = []; const kids = [];
for (const c of L) {
  if (c.fixed) continue;
  if (y < fixedEnd) y = fixedEnd + GG;
  if (last && c.group !== last) y += GG;
  if (c.color && (!bands.length || !near(bands[bands.length - 1].color, c.color))) { if (bands.length) bands[bands.length - 1].end = y - G / 2; bands.push({ color: c.color, start: y - G / 2 }); }
  let top = y; if (c.row && c.row === rowKey) top = rowY; else { rowKey = c.row; rowY = y; }
  if (c.continues && !c.row) top = Math.max(top - G, 0);
  kids.push({ componentId: c.id, box: { x: c.x, y: top, width: c.width } });
  y = Math.max(y, top + H[c.id].height + G); last = c.group;
}
const height = Math.round(y + GG);
if (bands.length) bands[bands.length - 1].end = height;
for (let i = bands.length - 1; i > 0; i--) if (bands[i].end - bands[i].start < 40 || near(bands[i].color, bands[i - 1].color)) { bands[i - 1].end = bands[i].end; bands.splice(i, 1); }
let restack = null, restackOff = [];
for (let k = 0; k < 3; k++) { try { restack = await A.layout.setComposition({ componentId: ${J(state.sectionId)}, box: { height }, children: kids }); } catch (e) { if (!/back onto the boxes it already had/.test(String((e && e.message) || e))) throw e; restack = await A.layout.getComposition({ componentId: ${J(state.sectionId)} }); } const got = Object.fromEntries((await A.layout.getComposition({ componentId: ${J(state.sectionId)} })).children.map((q) => [q.componentId, q.box])); restackOff = kids.filter((w) => Math.abs(got[w.componentId].y - w.box.y) > 1); if (!restackOff.length) break; }
const stops = [[${J(M.bands.nav || '#FFFFFF')}, 100], [${J(M.bands.head || M.bands.nav || '#FFFFFF')}, fixedEnd + GG / 2], ...bands.map((b) => [b.color, b.end])];
let prev = 0; const gradient = 'linear-gradient(180deg, ' + stops.map(([c, e]) => { const s = c + ' ' + (prev / height * 100).toFixed(2) + '%, ' + c + ' ' + (e / height * 100).toFixed(2) + '%'; prev = e; return s; }).join(', ') + ')';
await A.breakpoints.toggle({ device: 'desktop' });
await A.appearance.setContainerBackground({ componentId: ${J(state.sectionId)}, properties: { backgroundImage: gradient } }); // shared: desktop's plate covers it
return { passes: pass + 1, box: restack.box, diagnostics: restack.diagnostics, off: restackOff, restacked: Object.fromEntries(kids.map((k) => [k.componentId, k.box.y])), height, bands: bands.length };`);
// the verify step compares mobile y against the restacked positions
for (const c of mob) if (mobile.restacked[state.ids[c.key]] !== undefined) c.mobile.final = { ...c.mobile.final, y: mobile.restacked[state.ids[c.key]] };

// 5 read back, diff INSIDE the editor (a result over ~50 KB comes back truncated), save ----
const expect = desc.components.map((c) => ({ key: c.key, id: state.ids[c.key], kind: c.kind, text: c.html, link: cleanLink(c.link), styles: c.styles || {}, desktop: c.kind === 'pinned' ? null : c.desktop, mobile: c.mobile?.final || null }));
const back = await run('verify', `
const A = editorLLMApis; const S = ${J(state.sectionId)}; const E = ${J(expect)};
const num = (v) => parseFloat(String(v));
const textOf = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const comp = async (dev) => { await A.breakpoints.toggle({ device: dev }); const c = await A.layout.getComposition({ componentId: S }); return { box: c.box, kids: Object.fromEntries(c.children.map((k) => [k.componentId, k.box])), overlaps: c.diagnostics.overlaps.length }; };
const d = await comp('desktop'); const m = await comp('mobile'); await A.breakpoints.toggle({ device: 'desktop' });
const problems = [];
for (const e of E) {
  if (!e.id) { problems.push([e.key, 'not created']); continue; }
  let vals = {}; try { const v = await A.content.get({ componentId: e.id }); vals = v.values || {}; } catch (err) { problems.push([e.key, 'content unreadable']); }
  if (e.kind === 'text') { const h = vals.richText ? vals.richText.text : ''; if (textOf(h) !== textOf(e.text)) problems.push([e.key, 'text differs', textOf(h).slice(0, 50)]); if ((h.match(/<span/g) || []).length !== (e.text.match(/<span/g) || []).length) problems.push([e.key, 'inline styling differs']); }
  if (e.link) { const l = vals.link || {}; if (l.type !== e.link.type || (e.link.pageId && l.pageId !== e.link.pageId) || (e.link.url && l.url !== e.link.url) || (e.link.recipient && l.recipient !== e.link.recipient)) problems.push([e.key, 'link differs', l.type || null]); }
  if (!e.link && e.kind !== 'text' && vals.link && vals.link.type) problems.push([e.key, 'link should be absent', vals.link.type]);
  const st = await A.appearance.getStyles({ componentId: e.id });
  const byEl = Object.fromEntries(st.elements.map((x) => [x.elementPath.join('/') || 'root', x.properties]));
  for (const [el, props] of Object.entries(e.styles)) for (const [k, v] of Object.entries(props)) {
    const got = byEl[el] && byEl[el][k] ? byEl[el][k].raw : null;
    const same = got === v || String(got).toLowerCase() === String(v).toLowerCase() || (/(px|spx|em)$/.test(v) && Math.abs(num(got) - num(v)) <= 0.02 * Math.max(1, num(v))) || (/^(rgb|#)/.test(v) && String(got).replace(/\s/g, '').toLowerCase() === String(v).replace(/\s/g, '').toLowerCase());
    if (!same) problems.push([e.key, el + '.' + k, v, got]);
  }
  if (e.desktop) { const b = d.kids[e.id]; if (!b) problems.push([e.key, 'not in desktop layout']); else for (const k of e.kind === 'text' ? ['x', 'y', 'width'] : ['x', 'y', 'width', 'height']) if (Math.abs(b[k] - e.desktop[k]) > 2) problems.push([e.key, 'desktop ' + k, e.desktop[k], b[k]]); }
  if (e.mobile) { const b = m.kids[e.id]; if (!b) problems.push([e.key, 'not in mobile layout']); else for (const k of ['x', 'y', 'width']) if (Math.abs(b[k] - e.mobile[k]) > 2) problems.push([e.key, 'mobile ' + k, e.mobile[k], b[k]]); }
}
await A.site.save();
return { desktop: { box: d.box, overlaps: d.overlaps }, mobile: { box: m.box, overlaps: m.overlaps }, problems: problems.slice(0, 120), problemCount: problems.length, publishedAfter: (await A.site.getStatus()).isPublished };`);
const problems = back.problems;
const ok = back.problemCount === 0 && back.desktop.overlaps === 0 && back.mobile.overlaps === 0 && desk.off.length === 0 && mobile.off.length === 0;
state.publishedAfter = back.publishedAfter;
if (ok) { state.deployedAt = new Date().toISOString(); delete state.lastFailedAt; } else state.lastFailedAt = new Date().toISOString();
saveState();
const report = { ok, openItems: openItems(desc), pendingItems: pendingItems(desc), sectionId: state.sectionId, components: Object.keys(state.ids).length, editorCalls: timings.length, ms: timings, desktop: { passes: desk.passes, box: back.desktop.box, overlaps: back.desktop.overlaps, stillOff: desk.off.length, pins: desk.pins }, mobile: { passes: mobile.passes, box: back.mobile.box, overlaps: back.mobile.overlaps, stillOff: mobile.off.length }, problemCount: back.problemCount, problems, publishedBefore: state.publishedBefore, publishedAfter: back.publishedAfter };
fs.writeFileSync(descFile.replace(/\.json$/, '') + '.deploy-report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
if (!ok) { console.error(`deploy NOT clean: ${back.problemCount} read-back differences, overlaps desktop ${back.desktop.overlaps} / mobile ${back.mobile.overlaps}, still off ${desk.off.length}/${mobile.off.length}. See ${descFile.replace(/\.json$/, '')}.deploy-report.json; fix and re-run (no --clean), or --reapply.`); process.exit(1); }

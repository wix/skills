#!/usr/bin/env node
// Split a deployed one-section page into one Harmony section per source section, keeping every
// component (ids, styles, links) and giving each section its own background (colour, plate or
// video) and its own desktop and mobile layout. Videos become Video Player components or a
// section background video.
//
//   node scripts/copy/split-sections.mjs <spec.json> --page <pageId> --section <oldSectionId> [--keep-old]
//
// spec.json:
//   { "sections": [ { "name": "Hero", "y0": 165, "y1": 832, "delta": 1,
//        "background": { "color": "#ffffff", "plate": { "uri", "name", "width", "height" }, "video": <video> },
//        "videos": [ { "video": <video>, "box": { "x", "y", "width", "height" } } ],      // Video Player at that box (section coordinates)
//        "cards": true,                                                                   // mobile: stack tile by tile (an image with the captions under it), not all images then all captions
//        "include": ["<label>"],                                                      // components that belong here whatever their position (a gallery taller than its source band)
//        "place": { "<label>": { "x", "y" } },                                         // move a component (section coordinates)
//        "height": 600 } ],                                                              // override y1 - y0
//     "drop": [ "<label prefix>" ] }                                                     // components removed (static copies of a gallery, spacers)
//   y0/y1: source page pixels. delta: how far this band's components sit below the source
//   (Harmony y = source y + delta); components belong to the section holding their centre.
//   <video>: { "fileId": "5f062c_…" (Media Manager uri of the uploaded mp4), "name", "width", "height" }.
//
// Calls (one editor run each): inventory (desktop and mobile boxes), then per section: add the
// section, background, videos, reparent, desktop composition, mobile composition; then remove
// the old section and save. Mobile: components keep their old order and spacing within the
// section, restarted at the section top (a video goes first, full width, 16:9).
// A video value must carry adaptiveSources (even []): without it the saved document cannot be loaded again
// (document services fail on `.map` of undefined and the editor never opens).
// Hide-on-mobile and mobile background opacity have no API: run mobile-stage.mjs after.
import { chromium } from 'playwright';
import { hideScrollbars } from './hide-scrollbars.mjs';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const specFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const pageId = opt('page'), oldId = opt('section');
if (!specFile || !pageId || !oldId) { console.error('usage: split-sections.mjs <spec.json> --page <pageId> --section <oldSectionId> [--keep-old]'); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const stateFile = specFile.replace(/\.json$/, '') + '.split-state.json';
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { sections: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
const J = JSON.stringify;

// HZ_EDITOR_RUNNER=<module>: a module whose default export is async (code) => result, used instead of the live
// editor. The tests drive the real script against a fake editor this way; nothing else uses it.
let browser = null;
let run;
if (process.env.HZ_EDITOR_RUNNER) {
  const runner = (await import(process.env.HZ_EDITOR_RUNNER)).default;
  run = (name, code) => runner(code, name);
} else {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT || 9333}`);
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('editor.wix.com/edit/'));
  if (!page) { console.error('No Harmony editor page is open.'); process.exit(3); }
  await hideScrollbars(page);
  run = async (name, code) => {
    const raw = await page.evaluate(async (code) => { const api = await repluggableAppDebug.host.getAPI({ name: 'RunEditorLLMCodeToolAPI', public: true, layer: 'DATA_SERVICE' }); try { return await api.execute({ code }, { biParams: {} }); } catch (e) { return { thrown: String(e?.message || e) }; } }, code);
    if (raw.thrown) throw new Error(`${name}: ${raw.thrown}`);
    const c = JSON.parse(raw.items[0].content);
    if (!c.success) { const e = new Error(`${name}: ${c.summary}`); e.detail = c; throw e; }
    return c.result;
  };
}
const videoValue = (v) => ({ uri: `video/${v.fileId}/720p/mp4/file.mp4`, name: v.name, hasAudio: false, duration: v.duration || 10, adaptiveSources: [], sources: [{ quality: '720p', width: 1280, height: 720, types: [{ format: 'mp4', uri: `video/${v.fileId}/720p/mp4/file.mp4` }] }, { quality: '480p', width: 854, height: 480, types: [{ format: 'mp4', uri: `video/${v.fileId}/480p/mp4/file.mp4` }] }], poster: { uri: `${v.fileId}f002.jpg`, name: `${v.name}.jpg`, width: 1280, height: 720 } });

// 1 inventory ---------------------------------------------------------------------------
if (!state.inventory) {
  state.inventory = await run('inventory', `const A = editorLLMApis;
await A.pages.navigate({ pageId: ${J(pageId)} }); await A.breakpoints.toggle({ device: 'desktop' });
const d = await A.layout.getComposition({ componentId: ${J(oldId)} });
await A.breakpoints.toggle({ device: 'mobile' }); const m = await A.layout.getComposition({ componentId: ${J(oldId)} }); await A.breakpoints.toggle({ device: 'desktop' });
const mb = Object.fromEntries(m.children.map((k) => [k.componentId, k.box]));
return { desktopBox: d.box, mobileBox: m.box, children: d.children.map((k) => ({ id: k.componentId, label: k.label, type: k.type, box: k.box, mobile: mb[k.componentId] || null })) };`);
  save();
}
const isDropped = (label) => (spec.drop || []).some((p) => label.startsWith(p));
const all = state.inventory.children;
const dropIds = all.filter((c) => isDropped(c.label)).map((c) => c.id);
const live = all.filter((c) => !isDropped(c.label));
const band = (s) => [s.y0 + s.delta, s.y1 + s.delta];
const sectionOf = (c) => { const forced = spec.sections.findIndex((s) => (s.include || []).includes(c.label)); if (forced >= 0) return forced; const mid = c.box.y + c.box.height / 2; return spec.sections.findIndex((s) => { const [a, b] = band(s); return mid >= a && mid < b; }); };
const assigned = spec.sections.map(() => []);
const lost = [];
for (const c of live) { const i = sectionOf(c); if (i < 0) lost.push(c.label); else assigned[i].push(c); }
if (lost.length) { console.error('components outside every section:', lost.join(', ')); process.exit(4); }

// 2 per section ---------------------------------------------------------------------------
const kindOf = (t) => (/RichText/.test(t) ? 'text' : /Image$|\.Image/.test(t) ? 'image' : /Slider|Gallery|Cart/.test(t) ? 'native' : /Video/.test(t) ? 'video' : 'other');
const sized = (c, b, dev) => { const k = kindOf(c.type); return k === 'text' || k === 'native' || (dev === 'mobile' && k === 'image') ? { x: b.x, y: b.y, width: b.width } : { x: b.x, y: b.y, width: b.width, height: b.height }; };
let prev = oldId;
let mutated = false, saved = false;
for (let i = 0; i < spec.sections.length; i++) {
  const s = spec.sections[i];
  const done = state.sections[s.name];
  if (done && done.finished && opt('redo-mobile', null) !== s.name) { prev = done.id; continue; } // --redo-mobile "<section name>" re-sends one section's layout
  const [a] = band(s);
  const height = s.height || (s.y1 - s.y0);
  const place = s.place || {};
  const items = assigned[i].map((c) => ({ c, box: { ...c.box, y: place[c.label]?.y ?? Math.round(c.box.y - a), x: place[c.label]?.x ?? c.box.x } }));
  // mobile layout: old order and spacing, restarted at the section top; a video goes first
  const vids = s.videos || [];
  const vidH = Math.round(390 * 9 / 16), top = vids.length ? vids.length * (vidH + 12) : 0;
  const mob = items.filter((it) => it.c.mobile).sort((x, y) => x.c.mobile.y - y.c.mobile.y);
  let mobBoxes, mobHeight;
  if (s.cards) {
    // cards: an image with the texts under it in its column stay together (a grid of tiles stacks tile by tile,
    // right to left for RTL), instead of all images first and all captions after
    const imgs = mob.filter((it) => kindOf(it.c.type) === 'image' && it.box.width >= 100);
    const cardOf = new Map(); const rest = [];
    for (const it of mob) { if (imgs.includes(it)) { cardOf.set(it, { img: it, below: [] }); continue; }
      const host = imgs.filter((im) => it.box.y >= im.box.y + im.box.height - 5 && Math.min(it.box.x + it.box.width, im.box.x + im.box.width) - Math.max(it.box.x, im.box.x) >= 0.5 * Math.min(it.box.width, im.box.width)).sort((m, n) => n.box.y - m.box.y)[0];
      if (host) cardOf.get(host).below.push(it); else rest.push(it); }
    const units = [...cardOf.values()].map((cd) => ({ key: [Math.round(cd.img.box.y / 20), -cd.img.box.x], list: [cd.img, ...cd.below.sort((m, n) => m.box.y - n.box.y)] }))
      .concat(rest.map((it) => ({ key: [Math.round(it.box.y / 20), -it.box.x], list: [it] })));
    units.sort((m, n) => m.key[0] - n.key[0] || m.key[1] - n.key[1]);
    let y = 16 + top; mobBoxes = [];
    for (const u of units) { for (const it of u.list) { mobBoxes.push({ id: it.c.id, label: it.c.label, type: it.c.type, box: { x: it.c.mobile.x, y: Math.round(y), width: it.c.mobile.width, height: it.c.mobile.height } }); y += it.c.mobile.height + 6; } y += 14; }
    mobHeight = Math.round(y + 10);
  } else {
    const minY = mob.length ? Math.min(...mob.map((it) => it.c.mobile.y)) : 0;
    mobBoxes = mob.map((it) => ({ id: it.c.id, label: it.c.label, type: it.c.type, box: { x: it.c.mobile.x, y: Math.round(it.c.mobile.y - minY + 16 + top), width: it.c.mobile.width, height: it.c.mobile.height } }));
    mobHeight = Math.max(top, ...mobBoxes.map((m) => m.box.y + m.box.height + 16), 120);
  }
  const code = `const A = editorLLMApis;
await A.pages.navigate({ pageId: ${J(pageId)} }); await A.breakpoints.toggle({ device: 'desktop' });
const existing = ${J(done ? done.id : null)};
let sec; if (existing) sec = { sectionId: existing }; else sec = await A.sections.add({ name: ${J(s.name)}, afterSectionId: ${J(prev)} });
const SID = sec.sectionId;
try { await A.view.scrollTo({ componentId: SID }); } catch (e) {} // an off-screen section is not rendered, so it has no size to compose
await new Promise((r) => setTimeout(r, 800));
const bg = { backgroundColor: ${J(s.background.color || '#FFFFFF')}${s.background.plate ? `, image: ${J({ uri: s.background.plate.uri, name: s.background.plate.name, alt: '', width: s.background.plate.width, height: s.background.plate.height })}, fittingType: 'fill'` : ''}${s.background.video ? `, videoMedia: ${J(videoValue(s.background.video))}, loop: true, autoplay: true, showControls: false, muted: true` : ''} };
await A.appearance.setContainerBackground({ componentId: SID, properties: bg });
const newVids = [];
${vids.map((v, k) => `{ const have = existing ? ((await A.components.getTree({ rootId: SID, depth: 1 })).children || []).find((q) => q.label === ${J(`video-${s.name}-${k}`)}) : null; // a re-run reuses the video it already made
  if (have) newVids.push(have.id); else { const r = await A.components.add({ containerId: SID, components: [{ componentType: 'wixEditorElements.VideoUpload' }], select: false }); const id = r.added[0].componentId; await A.components.rename({ componentId: id, label: ${J(`video-${s.name}-${k}`)} });
  await A.content.set({ componentId: id, values: { video: ${J(videoValue(v.video))}, autoplay: true, loop: true, mute: true, enableControls: false } }); newVids.push(id); } }`).join('\n')}
const ids = ${J(items.map((it) => it.c.id))};
if (ids.length) await A.components.reparent({ componentIds: ids, targetContainerId: SID });
const kids = [${items.map((it) => `{ componentId: ${J(it.c.id)}, box: ${J(sized(it.c, it.box, 'desktop'))} }`).join(', ')}${vids.length && items.length ? ', ' : ''}${vids.map((v, k) => `{ componentId: newVids[${k}], box: ${J(v.box)} }`).join(', ')}];
const comp = async (dev, h, list) => { await A.breakpoints.toggle({ device: dev }); let r, off = [];
  for (let pass = 0; pass < 4; pass++) { let noop = false; try { r = await A.layout.setComposition({ componentId: SID, box: { height: h }, children: list }); } catch (e) { if (!/back onto the boxes it already had/.test(String((e && e.message) || e))) throw e; noop = true; }
    const got = Object.fromEntries((await A.layout.getComposition({ componentId: SID })).children.map((q) => [q.componentId, q.box]));
    off = list.filter((w) => !got[w.componentId] || ['x', 'y', 'width', 'height'].some((k) => w.box[k] !== undefined && Math.abs(got[w.componentId][k] - w.box[k]) > 1)).map((w) => [w.componentId, w.box, got[w.componentId] || null]); if (!off.length) break; }
  return { off, box: r && r.box }; };
const out = { id: SID };
out.desktop = kids.length ? await comp('desktop', ${height}, kids) : (await A.layout.setComposition({ componentId: SID, box: { height: ${height} }, children: [] }).catch((e) => String(e.message).slice(0, 200)));
const mkids = [${mobBoxes.map((m) => `{ componentId: ${J(m.id)}, box: ${J(sized({ type: m.type }, m.box, 'mobile'))} }`).join(', ')}${vids.length && mobBoxes.length ? ', ' : ''}${vids.map((v, k) => `{ componentId: newVids[${k}], box: { x: 0, y: ${16 + k * (vidH + 12)}, width: 390, height: ${vidH} } }`).join(', ')}];
out.mobile = mkids.length ? await comp('mobile', ${mobHeight}, mkids) : null;
// a mobile write can move desktop boxes: read the desktop view back and count what is off now
await A.breakpoints.toggle({ device: 'desktop' });
if (kids.length) { const gd = Object.fromEntries((await A.layout.getComposition({ componentId: SID })).children.map((q) => [q.componentId, q.box])); const offD = kids.filter((w) => !gd[w.componentId] || ['x', 'y', 'width', 'height'].some((k) => w.box[k] !== undefined && Math.abs(gd[w.componentId][k] - w.box[k]) > 1)); out.desktop.off = offD.map((w) => [w.componentId, w.box, gd[w.componentId] || null]); }
out.newVids = newVids;
return out;`;
  const res = await run(`section ${s.name}`, code);
  mutated = true; // layout was written: it must be saved even when the one-time cleanup is already done or skipped (--keep-old)
  const dOff = res.desktop && res.desktop.off ? res.desktop.off.length : 0, mOff = res.mobile && res.mobile.off ? res.mobile.off.length : 0;
  // a section with boxes that never landed is NOT finished: keep it resumable and keep the original section
  state.sections[s.name] = { id: res.id, newVids: res.newVids, finished: dOff === 0 && mOff === 0, desktopOff: dOff, mobileOff: mOff };
  save(); prev = res.id;
  console.log(s.name, JSON.stringify({ id: res.id, items: items.length, desktopOff: dOff, mobileOff: mOff }));
  if (dOff || mOff) { console.error(`section "${s.name}" has boxes that did not land (desktop ${dOff}, mobile ${mOff}): the original section is kept; fix the spec and re-run (finished sections are skipped)`); if (browser) await browser.close(); process.exit(1); }
}

// 3 drop, remove the old section, save -------------------------------------------------------
// Idempotent: the old section is looked up first, and what was done is persisted, so a repeat (--redo-mobile after a
// finished split, a re-run after a failed save) never queries or removes a section that is already gone.
if (!args.includes('--keep-old') && spec.sections.every((s) => state.sections[s.name] && state.sections[s.name].finished)) {
  if (state.cleanup && state.cleanup.done) console.log(JSON.stringify({ cleanup: 'already done' }));
  else {
    const fin = await run('finish', `const A = editorLLMApis;
const OLD = ${J(oldId)};
const exists = (await A.sections.list({})).some((s) => s.sectionId === OLD);
let dropped = 0, left = [], removed = !exists;
if (exists) {
  const DROP = ${J(dropIds)};
  const kids = (await A.components.getTree({ rootId: OLD, depth: 1 })).children || [];
  const present = kids.filter((k) => DROP.includes(k.id)).map((k) => k.id); // only the ones still there: a repeat removes nothing twice
  if (present.length) { await A.components.remove({ componentIds: present }); dropped = present.length; }
  left = kids.filter((k) => !present.includes(k.id));
  if (!left.length) { await A.sections.remove({ sectionId: OLD }); removed = true; }
}
await A.site.save();
return { dropped, left: left.map((k) => k.label), removed };`);
    saved = true; // the cleanup call ends with site.save()
    state.cleanup = { done: fin.removed, ...fin }; save();
    console.log(JSON.stringify(fin));
  }
}
// separate from the one-time cleanup: a mobile redo, a repeat after a failed save, or --keep-old still has unsaved layout writes
if (mutated && !saved) { await run('save', 'return await editorLLMApis.site.save();'); console.log(JSON.stringify({ saved: true })); }
if (browser) await browser.close();

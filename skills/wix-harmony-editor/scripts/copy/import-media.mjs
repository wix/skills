#!/usr/bin/env node
// Import the public source images a page description needs into the site's media, and write
// the Harmony uris back into the description. REST only (no editor), so it runs in parallel
// with the plate upload and font uploads.
//
//   node scripts/copy/import-media.mjs <migrationProjectDir> <page.desc.json> [--ledger media-ledger.json]
//
// Reads WIX_SITE_ID and WIX_AUTH_TOKEN from <project>/config/wix.env (mint it first with
// scripts/mint-token.sh; it expires) and never prints them. Idempotent: a source URL already in
// the ledger is not imported again. If the full-size original has a different aspect ratio
// than the size the source page rendered (WordPress crops thumbnails), the rendered file is
// imported instead, so `fitWidth` keeps the source's height.
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [projectDir, descFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!projectDir || !descFile) { console.error('usage: import-media.mjs <projectDir> <page.desc.json> [--ledger file]'); process.exit(2); }
const env = Object.fromEntries(fs.readFileSync(path.join(projectDir, 'config/wix.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const auth = /^IST\./.test(env.WIX_AUTH_TOKEN) ? env.WIX_AUTH_TOKEN : `Bearer ${env.WIX_AUTH_TOKEN}`;
const headers = { Authorization: auth, 'Content-Type': 'application/json', 'wix-site-id': env.WIX_SITE_ID };
const ledgerFile = opt('ledger', path.join(path.dirname(descFile), 'media-ledger.json'));
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {};
const desc = JSON.parse(fs.readFileSync(descFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function importOne(url) {
  if (ledger[url]?.uri) return ledger[url];
  const name = url.split('/').pop().split('?')[0];
  const mimeType = /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.gif$/i.test(name) ? 'image/gif' : /\.webp$/i.test(name) ? 'image/webp' : 'image/png';
  const r = await fetch('https://www.wixapis.com/site-media/v1/files/import', { method: 'POST', headers, body: JSON.stringify({ url, displayName: name, mimeType, mediaType: 'IMAGE', externalInfo: { origin: 'site-copy', externalId: url } }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) return { error: r.status, body: JSON.stringify(b).slice(0, 200) };
  const e = { id: b.file.id, uri: b.file.id, name };
  let ready = false;
  for (let i = 0; i < 20; i++) {
    const g = await fetch(`https://www.wixapis.com/site-media/v1/files/${encodeURIComponent(e.id)}`, { headers }).then((x) => x.json()).catch(() => ({}));
    if (g.file?.operationStatus === 'READY') { ready = true; e.width = g.file.media?.image?.image?.width; e.height = g.file.media?.image?.image?.height; break; }
    await sleep(1500);
  }
  if (!ready) return { error: 'import not READY after 30 s', id: e.id };
  ledger[url] = e; fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
  return e;
}

const jobs = desc.components.filter((c) => c.kind === 'image' && !c.image.uri && c.image.source);
const results = await Promise.all(jobs.map(async (c) => {
  let e = await importOne(c.image.source);
  const want = c.desktop.width / c.desktop.height;
  if (!e.uri || !e.width || Math.abs(e.width / e.height - want) / want > 0.01) { // cropped thumbnail on the source: use what it rendered
    if (c.image.sourceRendered && c.image.sourceRendered !== c.image.source) e = await importOne(c.image.sourceRendered);
  }
  if (e.uri) Object.assign(c.image, { uri: e.uri, width: e.width, height: e.height, name: e.name });
  return { key: c.key, uri: e.uri || null, size: e.width ? `${e.width}x${e.height}` : null, error: e.error || null };
}));
fs.writeFileSync(descFile, JSON.stringify(desc, null, 1));
console.log(JSON.stringify(results));
const failed = results.filter((r) => !r.uri || r.error);
if (failed.length) { console.error(`import failed or not ready for: ${failed.map((r) => `${r.key} (${r.error || 'no uri'})`).join(', ')}`); process.exit(1); }

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
//
// Source URLs come from the page being copied, so Wix is never asked to fetch them: this script
// downloads each image itself (https only, no credentials or custom port; the host must resolve to
// public addresses, the connection is pinned to the address it validated, every redirect hop is
// re-checked, the size is capped) and uploads the bytes through Media's Generate File Upload URL.
// A URL that fails a check is reported as an import error, not fetched. There is no fallback to
// Media's server-side `files/import`: that would hand an untrusted URL to Wix to fetch.
import dns from 'node:dns/promises';
import https from 'node:https';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [projectDir, descFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--ledger'));
if (!projectDir || !descFile) { console.error('usage: import-media.mjs <projectDir> <page.desc.json> [--ledger file]'); process.exit(2); }
const env = Object.fromEntries(fs.readFileSync(path.join(projectDir, 'config/wix.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const auth = /^IST\./.test(env.WIX_AUTH_TOKEN) ? env.WIX_AUTH_TOKEN : `Bearer ${env.WIX_AUTH_TOKEN}`;
const headers = { Authorization: auth, 'Content-Type': 'application/json', 'wix-site-id': env.WIX_SITE_ID };
const ledgerFile = opt('ledger', path.join(path.dirname(descFile), 'media-ledger.json'));
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {};
const desc = JSON.parse(fs.readFileSync(descFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
function isPrivateAddress(address) {
  let a = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  const dotted = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) a = dotted[1];
  const hex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); a = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'); }
  if (a === 'localhost' || a.endsWith('.localhost') || a.endsWith('.local')) return true;
  if (a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true;
  return PRIVATE_V4.some((re) => re.test(a));
}
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// One GET pinned to an address we already validated; TLS still verifies the certificate against the hostname.
function pinnedGet(url, { address, family }) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = https.request({
      protocol: 'https:', hostname: u.hostname, port: 443, path: `${u.pathname}${u.search}`, method: 'GET', servername: u.hostname, timeout: 20000,
      headers: { Accept: 'image/*,*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'wix-harmony-copy-import-media' },
      lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) { res.resume(); return done(resolve, { status, location: res.headers.location || '', body: Buffer.alloc(0) }); }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) { res.destroy(); return done(reject, new Error('response-too-large')); }
      const chunks = []; let total = 0;
      res.on('data', (c) => { total += c.length; if (total > MAX_IMAGE_BYTES) { res.destroy(); return done(reject, new Error('response-too-large')); } chunks.push(c); });
      res.on('end', () => done(resolve, { status, type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) }));
      res.on('error', (e) => done(reject, e));
    });
    req.on('timeout', () => { req.destroy(); done(reject, new Error('timeout')); });
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}
// { ok: true, bytes, contentType } | { ok: false, unsafe, reason }
async function fetchPublicImage(raw) {
  let current = String(raw || '').trim();
  for (let hop = 0; hop <= 3; hop++) {
    let u; try { u = new URL(current); } catch { return { ok: false, unsafe: true, reason: 'unparseable-url' }; }
    if (u.protocol !== 'https:') return { ok: false, unsafe: true, reason: 'not-https' };
    if (u.username || u.password) return { ok: false, unsafe: true, reason: 'embedded-credentials' };
    if (u.port && u.port !== '443') return { ok: false, unsafe: true, reason: 'non-standard-port' };
    if (isPrivateAddress(u.hostname)) return { ok: false, unsafe: true, reason: 'private-or-loopback-host' };
    let addrs; try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { return { ok: false, unsafe: false, reason: 'host-not-resolvable' }; }
    if (!addrs.length || addrs.some((x) => isPrivateAddress(x.address))) return { ok: false, unsafe: true, reason: 'resolves-to-private-address' };
    let res; try { res = await pinnedGet(current, { address: addrs[0].address, family: addrs[0].family || (addrs[0].address.includes(':') ? 6 : 4) }); } catch (e) { return { ok: false, unsafe: false, reason: e.message === 'response-too-large' ? 'response-too-large' : 'unreachable' }; }
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return { ok: false, unsafe: true, reason: 'redirect-without-location' };
      try { current = new URL(res.location, current).toString(); } catch { return { ok: false, unsafe: true, reason: 'redirect-unparseable-url' }; }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, unsafe: false, reason: `http-${res.status}` };
    if (!res.body.length) return { ok: false, unsafe: false, reason: 'empty-image' };
    return { ok: true, bytes: res.body, contentType: res.type };
  }
  return { ok: false, unsafe: true, reason: 'too-many-redirects' };
}

async function importOne(url) {
  if (ledger[url]?.uri) return ledger[url];
  const fetched = await fetchPublicImage(url);
  if (!fetched.ok) return { error: `${fetched.unsafe ? 'unsafe-source-url' : 'source-fetch-failed'}: ${fetched.reason}` };
  if (!/^image\//.test(fetched.contentType || '')) return { error: `source-fetch-failed: not-an-image (${fetched.contentType || 'no content-type'})` };
  // Generate File Upload URL rejects a MIME type that does not match the file name's extension
  // (MISMATCH_MIME_TYPE). The URL's own extension can lie (a .jpg served as WebP) or be missing, so
  // the name's extension is derived from the type the server actually sent.
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg' };
  const extension = extensions[fetched.contentType];
  if (!extension) return { error: `source-fetch-failed: unsupported-image-type (${fetched.contentType})` };
  const stem = url.split('/').pop().split('?')[0].replace(/\.[A-Za-z0-9]+$/, '').replace(/[^\w.~-]+/g, '-').slice(0, 80) || 'image';
  const name = `${stem}${extension}`;
  const mimeType = fetched.contentType;
  // Upload the bytes we fetched; Wix is never given the source URL.
  const gen = await fetch('https://www.wixapis.com/site-media/v1/files/generate-upload-url', { method: 'POST', headers, body: JSON.stringify({ mimeType: fetched.contentType, fileName: name, sizeInBytes: String(fetched.bytes.length), externalInfo: { origin: 'site-copy' } }) });
  const g0 = await gen.json().catch(() => ({}));
  let file;
  if (gen.ok && g0.uploadUrl) {
    const target = new URL(g0.uploadUrl); target.searchParams.set('filename', name);
    const put = await fetch(target, { method: 'PUT', headers: { 'Content-Type': fetched.contentType }, body: fetched.bytes });
    const pj = await put.json().catch(() => ({}));
    if (!put.ok || !pj.file) return { error: `upload-failed: ${put.status}`, body: JSON.stringify(pj).slice(0, 200) };
    file = pj.file;
  } else {
    return { error: `upload-url-refused: ${gen.status}`, body: JSON.stringify(g0).slice(0, 200) };
  }
  const e = { id: file.id, uri: file.id, name };
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

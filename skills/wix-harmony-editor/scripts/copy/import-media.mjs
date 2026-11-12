#!/usr/bin/env node
// Import the public source images a page description needs into the site's media, and write
// the Harmony uris back into the description. REST only (no editor), so it runs in parallel
// with the plate upload and font uploads.
//
//   node scripts/copy/import-media.mjs <migrationProjectDir> <page.desc.json> [--ledger media-ledger.json]
//
// Reads WIX_SITE_ID and WIX_AUTH_TOKEN from <project>/config/wix.env (mint it first with
// scripts/mint-token.sh; it expires) and never prints them. Idempotent: a source URL already in
// the ledger is not imported again, and a URL shared by several components is imported once. If the full-size original has a different aspect ratio
// than the size the source page rendered (WordPress crops thumbnails), the rendered file is
// imported instead, so `fitWidth` keeps the source's height.
//
// Source URLs come from the page being copied, so Wix is never asked to fetch them: this script
// downloads each image itself (https only, no credentials or custom port; the host must resolve to
// public addresses, the connection is pinned to the address it validated, every redirect hop is
// re-checked, the size is capped at 10 MB, the non-resumable upload limit) and uploads the bytes through Media's Generate File Upload URL.
// A URL that fails a check is reported as an import error, not fetched. There is no fallback to
// Media's server-side `files/import`: that would hand an untrusted URL to Wix to fetch.
import dns from 'node:dns/promises';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { isGlobalUnicastAddress, isPrivateHostname, MAX_UPLOAD_BYTES } from './public-address.mjs';
import { importPageImages } from './media-import.mjs';

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
      if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) { res.destroy(); return done(reject, new Error('response-too-large')); }
      const chunks = []; let total = 0;
      res.on('data', (c) => { total += c.length; if (total > MAX_UPLOAD_BYTES) { res.destroy(); return done(reject, new Error('response-too-large')); } chunks.push(c); });
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
    if (isPrivateHostname(u.hostname)) return { ok: false, unsafe: true, reason: 'private-or-loopback-host' };
    let addrs; try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { return { ok: false, unsafe: false, reason: 'host-not-resolvable' }; }
    if (!addrs.length || addrs.some((x) => !isGlobalUnicastAddress(x.address))) return { ok: false, unsafe: true, reason: 'resolves-to-private-address' };
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

const results = await importPageImages({
  desc, ledger, headers, sleep, fetchImage: fetchPublicImage, wixFetch: fetch,
  saveLedger: (value) => fs.writeFileSync(ledgerFile, JSON.stringify(value, null, 1)),
});
fs.writeFileSync(descFile, JSON.stringify(desc, null, 1));
console.log(JSON.stringify(results));
const failed = results.filter((r) => !r.uri || r.error);
if (failed.length) { console.error(`import failed or not ready for: ${failed.map((r) => `${r.key} (${r.error || 'no uri'})`).join(', ')}`); process.exit(1); }

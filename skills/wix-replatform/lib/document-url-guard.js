'use strict';

// One home for "is this URL safe to hand to something that will fetch it".
//
// A discovered invoice document URL is untrusted input from source-site metadata, and TWO modules
// act on it: discovery classifies and probes it, and the target writer hands it to Wix Media to
// fetch server-side. Both must apply the same rules, so the rules live here rather than in either
// one. While they lived only in discovery, the writer accepted a bare URL and imported
// `https://169.254.169.254/latest/meta-data` without complaint.
//
// The URL is also a bearer link whose filename can carry a customer name and an invoice number,
// so nothing here logs it or returns it in full.
//
// WHAT THIS CANNOT DO, stated because a guard that looks stronger than it is invites misuse.
// `classifyDocumentUrl` is a LEXICAL check on the URL as written: it does not resolve DNS and it
// does not follow redirects, so a public hostname that resolves to a private address, or one that
// redirects to it, passes it. It must therefore never be the only thing between an untrusted URL
// and a server-side fetch. `fetchPublicDocument` is the fetch that is safe to run on our side:
// it resolves the host, refuses any private answer, connects to the ADDRESS IT VALIDATED (so the
// name cannot resolve differently between check and connect -- no DNS rebinding), walks redirects
// hop by hop applying the same checks, and caps the response size. The bytes are then uploaded to
// Wix Media, so Wix never fetches an untrusted URL at all.

const dns = require('node:dns');

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
];

function isPrivateHostname(hostname) {
  let host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');

  // An IPv4-mapped IPv6 address is the same destination wearing a different notation, and Node
  // canonicalizes `::ffff:127.0.0.1` to `::ffff:7f00:1` -- so a loopback check that only knows
  // dotted-quad form waves it straight through. Unwrap the mapping, in both spellings, before
  // any other test runs.
  const mappedDotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) host = mappedDotted[1];
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    host = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  if (PRIVATE_IPV4.some((pattern) => pattern.test(host))) return true;
  return false;
}

// Signal D. Every discovered document is classified, not only the sampled ones -- the strategy
// depends on where the bytes are, and one WordPress-hosted document in an otherwise PSP-hosted
// store still dies with the source site.
function classifyDocumentUrl(rawUrl, { sourceSiteHost = null } = {}) {
  const text = String(rawUrl || '').trim();
  if (text.length === 0) return { safe: false, location: null, reason: 'empty-url' };

  let url;
  try {
    url = new URL(text);
  } catch (error) {
    return { safe: false, location: null, reason: 'unparseable-url' };
  }

  if (url.protocol !== 'https:') return { safe: false, location: null, reason: 'not-https' };
  if (url.username || url.password) return { safe: false, location: null, reason: 'embedded-credentials' };
  if (url.port && url.port !== '443') return { safe: false, location: null, reason: 'non-standard-port' };
  if (isPrivateHostname(url.hostname)) return { safe: false, location: null, reason: 'private-or-loopback-host' };

  const host = url.hostname.toLowerCase();
  const sameSite = sourceSiteHost
    && (host === String(sourceSiteHost).toLowerCase() || host.endsWith(`.${String(sourceSiteHost).toLowerCase()}`));

  // A same-origin uploads path is the WordPress filesystem: those bytes are gone when the site
  // goes. Anything else is somebody else's archive, which survives the migration but not the
  // merchant leaving that provider.
  const location = sameSite ? 'wordpress' : 'third-party';
  return { safe: true, location, reason: null, host };
}

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

// Default transport: one GET over HTTPS, pinned to an address the caller already validated. TLS
// still verifies the certificate against the hostname (`servername`), so pinning the address does
// not weaken it. The body is read up to `maxBytes` and the connection is dropped past that.
function pinnedHttpsGet(url, { address, family, timeoutMs, maxBytes }) {
  const https = require('node:https');
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const request = https.request({
      protocol: 'https:',
      hostname: target.hostname,
      port: 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      servername: target.hostname,
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'wix-replatform-document-fetch' },
      lookup: (hostname, options, callback) => (options && options.all
        ? callback(null, [{ address, family }])
        : callback(null, address, family)),
      timeout: timeoutMs,
    }, (response) => {
      const status = response.statusCode || 0;
      const headers = { get: (name) => { const value = response.headers[String(name).toLowerCase()]; return Array.isArray(value) ? value[0] : (value === undefined ? null : value); } };
      if (status >= 300 && status < 400) { response.resume(); done(resolve, { status, headers, body: Buffer.alloc(0) }); return; }
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(); done(reject, Object.assign(new Error('response-too-large'), { code: 'TOO_LARGE' })); return; }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) { response.destroy(); done(reject, Object.assign(new Error('response-too-large'), { code: 'TOO_LARGE' })); return; }
        chunks.push(chunk);
      });
      response.on('end', () => done(resolve, { status, headers, body: Buffer.concat(chunks) }));
      response.on('error', (error) => done(reject, error));
    });
    request.on('timeout', () => { request.destroy(); done(reject, Object.assign(new Error('timeout'), { code: 'TIMEOUT' })); });
    request.on('error', (error) => done(reject, error));
    request.end();
  });
}

// Fetches the document's bytes on our side, never handing the URL to anything else. Returns
// { ok: true, bytes, contentType } or { ok: false, unsafe, reason }. `unsafe` separates a URL we
// refuse on principle (internal address, redirect to one, bad scheme) from a document that is
// merely unavailable (404, timeout, too large). `lookup` and `transport` are injectable.
async function fetchPublicDocument(rawUrl, {
  lookup = dns.promises.lookup,
  transport = pinnedHttpsGet,
  maxRedirects = MAX_REDIRECTS,
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  let current = String(rawUrl || '').trim();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const classification = classifyDocumentUrl(current);
    if (!classification.safe) return { ok: false, unsafe: true, reason: hop === 0 ? classification.reason : `redirect-${classification.reason}` };
    let addresses;
    try {
      addresses = await lookup(new URL(current).hostname, { all: true });
    } catch (error) {
      return { ok: false, unsafe: false, reason: 'host-not-resolvable' };
    }
    const list = (Array.isArray(addresses) ? addresses : [addresses]).filter(Boolean);
    if (!list.length || list.some((entry) => isPrivateHostname(entry.address))) {
      return { ok: false, unsafe: true, reason: 'resolves-to-private-address' };
    }
    const pinned = list[0];
    let response;
    try {
      response = await transport(current, { address: pinned.address, family: pinned.family || (String(pinned.address).includes(':') ? 6 : 4), timeoutMs, maxBytes });
    } catch (error) {
      return { ok: false, unsafe: false, reason: error && error.code === 'TOO_LARGE' ? 'response-too-large' : 'unreachable' };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers && response.headers.get && response.headers.get('location');
      if (!location) return { ok: false, unsafe: true, reason: 'redirect-without-location' };
      try {
        current = new URL(location, current).toString();
      } catch (error) {
        return { ok: false, unsafe: true, reason: 'redirect-unparseable-url' };
      }
      continue;
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, unsafe: false, reason: `http-${response.status}` };
    const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body || '');
    if (body.length > maxBytes) return { ok: false, unsafe: false, reason: 'response-too-large' };
    if (body.length === 0) return { ok: false, unsafe: false, reason: 'empty-document' };
    const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : null;
    return { ok: true, bytes: body, contentType: contentType ? String(contentType).split(';')[0].trim().toLowerCase() : null };
  }
  return { ok: false, unsafe: true, reason: 'too-many-redirects' };
}

// Never log or persist a raw document URL: the query string can carry a bearer token and the
// filename can carry the customer's name and the invoice number.
function redactUrlForLog(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    const segments = url.pathname.split('/').filter(Boolean).length;
    return `${url.protocol}//${url.hostname}/<${segments} path segment(s) redacted>`;
  } catch (error) {
    return '<unparseable url redacted>';
  }
}

module.exports = {
  isPrivateHostname,
  classifyDocumentUrl,
  fetchPublicDocument,
  redactUrlForLog,
};

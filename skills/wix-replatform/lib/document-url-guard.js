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
const net = require('node:net');

// Only a GLOBAL UNICAST address may be fetched. This is an allowlist, not a list of known-private
// ranges: a deny list misses whatever it forgot (multicast, broadcast, benchmarking, documentation,
// newer IPv6 scopes). The ranges below are the IANA IPv4/IPv6 Special-Purpose Address Registries'
// entries that are not globally reachable, plus multicast and reserved space. IPv6 must also lie in
// 2000::/3, the only block IANA allocates for global unicast. The same rules live in
// wix-harmony-editor's copy/public-address.mjs (a separate published skill that cannot import this
// file); tests/target-wix/public-address-parity-test.js keeps the two identical.
const NON_GLOBAL = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) NON_GLOBAL.addSubnet(address, prefix, 'ipv4');
// Inside 2000::/3: IETF protocol assignments (incl. Teredo), documentation, 6to4 (it can wrap any
// IPv4 address, private ones included), and the second documentation block.
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) NON_GLOBAL.addSubnet(address, prefix, 'ipv6');

function ipv6Hextets(address) {
  let text = address;
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : new Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((part) => parseInt(part, 16));
}

// True only for a literal IP address that is globally routable unicast. Anything else -- a
// hostname, an unparseable string, a private/special-purpose address -- is false.
function isGlobalUnicastAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(address);
  if (family === 4) return !NON_GLOBAL.check(address, 'ipv4');
  if (family !== 6) return false;
  const hextets = ipv6Hextets(address);
  // An IPv4-mapped address (::ffff:a.b.c.d, which Node prints as ::ffff:hhhh:hhhh) is the IPv4
  // destination in another notation: judge the IPv4 address it carries.
  if (hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff) {
    return isGlobalUnicastAddress([hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join('.'));
  }
  if ((hextets[0] & 0xe000) !== 0x2000) return false;
  return !NON_GLOBAL.check(address, 'ipv6');
}

// Lexical check on a URL hostname: an IP literal must be global unicast; a name is refused only
// when it is local by definition, and is otherwise judged later by the addresses it resolves to.
function isPrivateHostname(hostname) {
  // A trailing dot is the same name (`localhost.` resolves like `localhost`) and WHATWG URL keeps it on a name host.
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return true;
  if (net.isIP(host)) return !isGlobalUnicastAddress(host);
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
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
// The bytes go to Media's Generate File Upload URL, which is non-resumable; Wix sends files over
// 10 MB to the resumable endpoint, so a document is capped below that.
const DEFAULT_MAX_BYTES = 10 * 1000 * 1000;

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
    if (!list.length || list.some((entry) => !isGlobalUnicastAddress(entry && entry.address))) {
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
  isGlobalUnicastAddress,
  isPrivateHostname,
  classifyDocumentUrl,
  fetchPublicDocument,
  redactUrlForLog,
};

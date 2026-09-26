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
// WHAT THIS CANNOT DO, stated because a guard that looks stronger than it is invites misuse. This
// is a LEXICAL check on the URL as written. It does not resolve DNS, and it does not follow
// redirects -- so a public hostname that resolves to a private address, or one that redirects to
// it, passes. Wix Media fetches the document server-side, so the request that would need bounding
// is not ours to bound; a request-plan object that nothing executed used to live here and only
// created the impression otherwise. Treat this as "reject what is obviously internal", not as
// SSRF protection.

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
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
  redactUrlForLog,
};

// Which addresses the copy scripts' browsers may open. The source URL comes from the command line (and
// from a hand-off file), so a mistyped, injected or redirected URL must not make a browser on this machine
// request cloud metadata, a router, an internal service or a loopback port. Two rules:
//
//   1. assertSourceUrl: the page to open is http(s) on a public host (a name must resolve only to global
//      unicast addresses), or it is a local mirror served by serve-mirror.mjs on loopback.
//   2. guardPage: while that page loads, every request it makes (the page, redirect hops, subresources,
//      frames) is checked the same way. Loopback is reachable only when the page itself is a local mirror,
//      so a public page cannot probe the loopback ports.
//
// The resolve-then-connect gap (DNS rebinding) remains; a network-isolated machine is the backstop. The
// address rules are public-address.mjs's, shared with import-media.mjs.
import dns from 'node:dns/promises';
import net from 'node:net';
import { isGlobalUnicastAddress, isPrivateHostname } from './public-address.mjs';

function bareHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

export function isLoopbackHost(hostname) {
  const host = bareHost(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (net.isIPv4(host)) return host.split('.')[0] === '127';
  if (net.isIPv6(host)) return host === '::1' || /^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(host);
  return false;
}

function parse(value) {
  try {
    return value instanceof URL ? value : new URL(String(value));
  } catch {
    throw new Error(`Refusing to open an invalid URL: ${String(value).slice(0, 200)}`);
  }
}

/**
 * Returns `{ url, loopback }` for an http(s) URL that is a public host or a loopback mirror; throws for
 * anything else. `loopback` tells the caller to pass `allowLoopback` to guardPage.
 */
export async function assertSourceUrl(value, { lookup = dns.lookup } = {}) {
  const url = parse(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Refusing to open a non-http(s) URL (${url.protocol})`);
  if (isLoopbackHost(url.hostname)) return { url, loopback: true };
  const host = bareHost(url.hostname);
  if (isPrivateHostname(host)) throw new Error(`Refusing to open an internal host: ${host}`);
  if (net.isIP(host)) return { url, loopback: false };
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch (error) {
    throw new Error(`Could not resolve ${host}: ${error.message}`);
  }
  if (!addresses.length) throw new Error(`Could not resolve ${host}`);
  const blocked = addresses.find((entry) => !isGlobalUnicastAddress(entry.address));
  if (blocked) throw new Error(`Refusing to open ${host}: it resolves to a non-public address (${blocked.address})`);
  return { url, loopback: false };
}

/**
 * Aborts every request the page makes to a destination assertSourceUrl would refuse, and every redirect to
 * one. Playwright does not route the hops that follow a `route.continue()`, so each request is fetched
 * here without following redirects: a 3xx is checked against its `Location` before it is handed back to the
 * browser, which then requests the next hop through this same handler. Verdicts are cached per origin.
 */
export async function guardPage(page, { allowLoopback = false, lookup } = {}) {
  const verdicts = new Map();
  const isAllowed = (url) => {
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return Promise.resolve(false);
    }
    if (!verdicts.has(origin)) {
      verdicts.set(origin, assertSourceUrl(url, { lookup }).then((result) => allowLoopback || !result.loopback, () => false));
    }
    return verdicts.get(origin);
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const scheme = url.slice(0, url.indexOf(':') + 1);
    if (scheme === 'data:' || scheme === 'blob:' || scheme === 'about:') return route.continue();
    if (!(await isAllowed(url))) return route.abort('blockedbyclient');
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      return route.abort('failed');
    }
    const location = response.headers().location;
    if (response.status() >= 300 && response.status() < 400 && location) {
      let target;
      try {
        target = new URL(location, url).toString();
      } catch {
        return route.abort('blockedbyclient');
      }
      if (!(await isAllowed(target))) return route.abort('blockedbyclient');
    }
    return route.fulfill({ response });
  });
}

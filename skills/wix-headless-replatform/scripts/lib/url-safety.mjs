import dns from "node:dns/promises";
import net from "node:net";

// Source URLs come from the caller (CLI, handoff, an import request), so before a browser navigates to one
// it must name a public http(s) host: not loopback, private, link-local (cloud metadata) or an internal
// name. Redirect hops and subresources are checked the same way through `guardPageRequests`.

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

function ipv4Parts(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

export function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPrivateAddress(mapped[1]);
  // WHATWG URL normalizes an IPv4-mapped address to hex groups (`::ffff:7f00:1`).
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (net.isIPv4(value)) {
    const [a, b] = ipv4Parts(value);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(value)) {
    return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || /^ff/.test(value);
  }
  return false;
}

// The clone under test (post-build-gap) is served from a local dev server or a Wix preview, which the
// guards above would refuse. It registers its own origin once; nothing else is ever trusted.
const TRUSTED_ORIGINS_ENV = "RP_TRUSTED_ORIGINS";
const trustedOrigins = new Set();
// A child process (the design extractor) cannot share this set, so the parent passes it down.
for (const value of String(process.env[TRUSTED_ORIGINS_ENV] || "").split(",").filter(Boolean)) {
  try { trustedOrigins.add(new URL(value).origin); } catch { /* ignore a malformed entry */ }
}

export function trustedOriginsEnv() {
  return { [TRUSTED_ORIGINS_ENV]: [...trustedOrigins].join(",") };
}

export function trustOrigin(value) {
  trustedOrigins.add(new URL(String(value)).origin);
}

export function isTrustedOrigin(value) {
  try {
    return trustedOrigins.has(new URL(String(value)).origin);
  } catch {
    return false;
  }
}

/** Throws unless `value` is an http(s) URL whose host resolves only to public addresses. */
export async function assertPublicHttpUrl(value, { lookup = dns.lookup } = {}) {
  if (isTrustedOrigin(value)) return value instanceof URL ? value : new URL(String(value));
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value));
  } catch {
    throw new Error(`Refusing to browse an invalid URL: ${String(value).slice(0, 200)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to browse a non-http(s) URL (${url.protocol})`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error(`Refusing to browse an internal host: ${host}`);
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Refusing to browse a private address: ${host}`);
    return url;
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch (error) {
    throw new Error(`Could not resolve ${host}: ${error.message}`);
  }
  const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
  if (blocked) throw new Error(`Refusing to browse ${host}: it resolves to a private address (${blocked.address})`);
  return url;
}

/**
 * fetch() that checks every hop: the first URL and each redirect target must be a public http(s) host
 * (the platform follows redirects silently, so a public page could otherwise bounce to cloud metadata).
 * The resolve-then-connect gap (DNS rebinding) remains; the browser-side guard and a network-isolated
 * sandbox are the backstop.
 */
export async function fetchPublic(value, init = {}, { lookup, maxRedirects = 5, fetchImpl = fetch } = {}) {
  let current = String(value);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicHttpUrl(current, { lookup });
    const response = await fetchImpl(current, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = new URL(response.headers.get("location"), current).toString();
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects fetching ${String(value).slice(0, 200)}`);
}

/**
 * Aborts every request the page makes (navigations, subresources) to a non-public destination, and every
 * redirect to one. Playwright does not route the hops that follow a `route.continue()`, so each request is
 * fetched here without following redirects: a 3xx is checked against its `Location` before it is handed
 * back to the browser, which then requests the next hop through this same handler. The registered clone
 * origin is exempt as a destination, but its redirects are still checked. Verdicts are cached per origin so
 * a page with many assets resolves each host once.
 */
export async function guardPageRequests(page, { lookup } = {}) {
  const verdicts = new Map();
  const isAllowed = (url) => {
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return Promise.resolve(false);
    }
    if (!verdicts.has(origin)) {
      verdicts.set(origin, assertPublicHttpUrl(url, { lookup }).then(() => true, () => false));
    }
    return verdicts.get(origin);
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const scheme = url.slice(0, url.indexOf(":") + 1);
    if (scheme === "data:" || scheme === "blob:" || scheme === "about:") return route.continue();
    if (!(await isAllowed(url))) return route.abort("blockedbyclient");
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      return route.abort("failed");
    }
    const location = response.headers().location;
    if (response.status() >= 300 && response.status() < 400 && location) {
      let target;
      try {
        target = new URL(location, url).toString();
      } catch {
        return route.abort("blockedbyclient");
      }
      if (!(await isAllowed(target))) return route.abort("blockedbyclient");
    }
    return route.fulfill({ response });
  });
}

// One fetch wrapper for every Wix call. The Wix CLI sends its token raw in `authorization`, no
// Bearer prefix, with two XSRF headers and its own user agent; so does this.
export class HttpError extends Error {
  constructor(status, body, url) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    super(`HTTP ${status} from ${url}: ${(text || "").slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export const MANAGE = "https://manage.wix.com";
export const API = "https://www.wixapis.com";
export const CLI_HEADERS = { "X-XSRF-TOKEN": "nocheck", Cookie: "XSRF-TOKEN=nocheck", "User-Agent": "wix-cli" };

let command = "light";
export const setCommandName = (name) => { command = name; };

export async function request(url, { method = "GET", headers = {}, body, token, raw = false } = {}) {
  const h = { Accept: "application/json", ...CLI_HEADERS, "x-wix-bi-gateway": `environment=CLI-Headless,package-version=light,package-name=${command}`, ...headers };
  if (body !== undefined && !raw) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (token) h.authorization = token;
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new HttpError(res.status, data, url);
  return data;
}

/** Up to `tries` attempts on a network error or a 5xx; a 4xx is final. */
export async function retrying(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status < 500) throw e;
      await new Promise((r) => setTimeout(r, Math.min(3000, 500 * 2 ** i)));
    }
  }
  throw last;
}

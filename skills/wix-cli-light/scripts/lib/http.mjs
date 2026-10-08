// One fetch wrapper for every Wix call: JSON in, JSON out, a typed error with the HTTP status.
export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} from ${url}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export async function request(url, { method = "GET", headers = {}, body, token } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== "string") {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (token) h.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new HttpError(res.status, data, url);
  return data;
}

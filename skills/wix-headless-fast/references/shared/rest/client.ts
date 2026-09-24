// The one auth seam for every Wix REST call — the twin of app/wix/sdk.ts, over fetch. No
// dependencies. deploy.mjs --stack static copies it flat into js/wix/ next to the core files and
// strips it to JS (comments kept); a port to another language reads it as the specification.
// Imports carry the .js suffix so the stripped output runs as browser ESM unchanged.
//
// WIX_CLIENT_ID is the public OAuth client id (`appId` in wix.config.json). It is NOT a secret — it
// only mints anonymous VISITOR tokens — so it is fine in page source. deploy.mjs writes ./config.
//
// THE TOKEN IS THE CART. A visitor token is the shopper's identity: their cart lives on it. Mint
// once per shopper, persist it, refresh it — never mint per request (a fresh token is a new visitor
// with an empty cart). Where it persists depends on where this code runs:
//   browser — localStorage, keyed by client id so two sites on one origin don't share a token
//             (what this file does).
//   server (a Python/PHP/Go port) — the SHOPPER'S SESSION, one token set per shopper. Never one
//             process-wide token for everyone: that is one shared cart for all visitors.
//             This is the only part of a port that isn't line-for-line.
// docs: https://dev.wix.com/docs/go-headless/coding/authentication/visitors.md
import { WIX_CLIENT_ID } from "./config.js";

export const WIX_API_BASE = "https://www.wixapis.com";
const TOKEN_URL = `${WIX_API_BASE}/oauth2/token`;
const STORAGE_KEY = `wix-visitor-${WIX_CLIENT_ID}`;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Swap this for a server-session-backed store in a port; the browser default is localStorage. */
export interface TokenStore {
  load(): Tokens | null;
  save(tokens: Tokens): void;
}

let memory: Tokens | null = null;
export const browserTokenStore: TokenStore = {
  load() {
    if (memory) return memory;
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) memory = JSON.parse(raw) as Tokens;
    } catch {
      /* disabled or corrupt storage — mint a fresh visitor */
    }
    return memory;
  },
  save(tokens) {
    memory = tokens;
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {
      /* storage full or disabled — the session just won't survive a reload */
    }
  },
};
let store: TokenStore = browserTokenStore;
/** A port calls this once with its session-backed store. */
export function useTokenStore(s: TokenStore): void {
  store = s;
}

// POST /oauth2/token — grantType "anonymous" mints a visitor; "refresh_token" renews and KEEPS the
// identity (a member refresh token yields member tokens).
async function mint(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: WIX_CLIENT_ID, ...body }),
  });
  if (!res.ok) throw new Error(`Wix auth failed (${res.status}).`);
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

/** A valid access token: cached, refreshed when expired, minted on first use. */
export async function accessToken(): Promise<string> {
  const t = store.load();
  if (t && t.expiresAt - 60_000 > Date.now()) return t.accessToken;
  let fresh: Tokens | undefined;
  if (t?.refreshToken) {
    try {
      fresh = await mint({ grantType: "refresh_token", refreshToken: t.refreshToken });
    } catch {
      /* fall through to a new visitor */
    }
  }
  fresh ??= await mint({ grantType: "anonymous" });
  store.save(fresh);
  return fresh.accessToken;
}

export class WixApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/**
 * Every Wix call goes through here. `path` is relative to WIX_API_BASE; `query` becomes the query
 * string (an array repeats the key: fields=A&fields=B). Throws WixApiError on a non-2xx, including
 * 404 — callers that treat 404 as "not found" catch it. The header carries the RAW access token,
 * no "Bearer " prefix.
 */
export async function wixRequest<T = any>(
  path: string,
  { method = "POST", body, query }: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, string | readonly string[]> } = {},
): Promise<T> {
  const url = new URL(path, WIX_API_BASE);
  for (const [k, v] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(v) ? v : [v as string]) url.searchParams.append(k, String(item));
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: await accessToken(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = "", code: string | undefined;
    try {
      const j = await res.json();
      message = j?.message ?? "";
      code = j?.details?.applicationError?.code;
    } catch {
      /* no JSON body */
    }
    throw new WixApiError(message || `${method} ${url.pathname} failed (${res.status}).`, res.status, code);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

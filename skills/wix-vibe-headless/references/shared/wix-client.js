/**
 * REST version of the Wix headless integration — the direct analog of
 * `storefrontApiRequest` in src/lib/shopify.ts. Plain fetch, JSON in / JSON out.
 * No SDK, no query builder, no Velo.
 *
 * WIX_CLIENT_ID is the one thing to set. The client exchanges it for a visitor
 * access token via the OAuth2 token endpoint, then sends that token on every API call.
 */

/**
 * The public headless OAuth client id. It is a buyer-facing credential (it only mints
 * anonymous visitor tokens), NOT a secret — so it is safe to hardcode here. Paste the
 * value from the Wix Business Manager prompt in place of the placeholder.
 */
export const WIX_CLIENT_ID = "<YOUR-CLIENT-ID>";

export const WIX_API_BASE = "https://www.wixapis.com";
const OAUTH_TOKEN_URL = `${WIX_API_BASE}/oauth2/token`;

// Scope the storage key by client id so two headless sites served from the same
// origin (e.g. localhost:4321 across projects) don't share one visitor token —
// which would load site A's token for site B and mix up carts/identity.
const TOKEN_STORAGE_KEY = `wix-visitor-token-${WIX_CLIENT_ID}`;
let tokenCache = null;

function loadToken() {
  if (tokenCache) return tokenCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (raw) tokenCache = JSON.parse(raw);
  } catch {
    /* ignore disabled/full storage */
  }
  return tokenCache;
}

function saveToken(t) {
  tokenCache = t;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

async function mintToken(body) {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Wix OAuth failed: ${res.status}`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Log a member in on THIS client by swapping the persisted token set for the
 * member's tokens (see references/members/). Member tokens are the SAME shape as
 * visitor tokens and refresh via the same `refresh_token` grant — logging in just
 * replaces the set the client already carries, so EVERY subsequent `wixApiRequest`
 * (cart, orders, bookings, "my …" reads) now runs as the member. Called by the
 * members helper after a successful credential / social / SSO login.
 *
 * @param {{ accessToken: string, refreshToken: string, expiresIn: number }} tokens
 */
export function setSessionTokens({ accessToken, refreshToken, expiresIn }) {
  saveToken({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    role: "member",
  });
}

/**
 * Drop the persisted session so the next call mints a FRESH anonymous visitor.
 * Call on logout — otherwise the dead member token lingers and reads fail.
 */
export function clearSession() {
  tokenCache = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True once a member is logged in on this client (vs. an anonymous visitor).
 * Gate account UI on this, or on the members helper's `isLoggedIn()`.
 * @returns {boolean}
 */
export function isMember() {
  return loadToken()?.role === "member";
}

/**
 * Get a visitor access token from the client id.
 *
 * The visitor token IS the identity of the Wix "current cart", so we persist the
 * refresh token to localStorage and REFRESH it on expiry — re-minting a fresh
 * `anonymous` token would create a NEW visitor and silently empty the cart on
 * every reload / after the 4h token lifetime. Anonymous mint happens only once
 * (or when no refresh token is stored).
 */
async function getAccessToken() {
  const cached = loadToken();
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  if (cached?.refreshToken) {
    try {
      const refreshed = await mintToken({ clientId: WIX_CLIENT_ID, grantType: "refresh_token", refreshToken: cached.refreshToken });
      // Refreshing preserves identity: a member refresh token yields member tokens.
      refreshed.role = cached.role || "visitor";
      saveToken(refreshed);
      return refreshed.accessToken;
    } catch {
      /* refresh failed — fall through to a fresh anonymous visitor */
    }
  }
  const fresh = await mintToken({ clientId: WIX_CLIENT_ID, grantType: "anonymous" });
  fresh.role = "visitor";
  saveToken(fresh);
  return fresh.accessToken;
}

/**
 * Core transport — mirrors storefrontApiRequest. Adds the Authorization header,
 * resolves the path against the Wix API base, parses JSON, surfaces errors.
 *
 * @param {string} path
 * @param {{ method?: "GET"|"POST"|"PUT"|"DELETE", body?: unknown, query?: Record<string, string | undefined> }} [options]
 */
export async function wixApiRequest(path, options = {}) {
  const { method = "POST", body, query } = options;
  const token = await getAccessToken();

  const url = new URL(path.startsWith("http") ? path : `${WIX_API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.set(k, v);
      }
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: token, // Wix expects the raw access token (no "Bearer " prefix)
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 402) {
    // This API requires an active plan / premium feature on the site.
    console.warn("Wix: Payment required (402) — this API needs an active plan/premium feature.");
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    // Attach status + parsed body so callers (e.g. the members helper) can map a
    // meaningful auth outcome (404 = bad credentials, 409 = email exists) to a
    // friendly message instead of parsing the message string.
    const err = new Error(`Wix API error ${res.status}: ${text}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  if (res.status === 204) return undefined;
  return await res.json();
}

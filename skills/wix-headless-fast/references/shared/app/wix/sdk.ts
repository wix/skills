// The one auth seam for every Wix SDK call in this app. Copy as-is; do not rewrite.
//
// Two modes, switched by WIX_CLIENT_ID in ./config:
//   null (ambient)  — a Wix-managed Astro project: `@wix/astro` authenticates raw SDK module
//                     calls automatically, server-side AND in client islands. `wixModule()`
//                     returns the module untouched.
//   string (manual) — any other React setup (Vite SPA, non-Astro): one shared client is built
//                     with OAuthStrategy, and `wixModule()` returns the module bound to it.
//                     The strategy self-manages visitor tokens on every call (mints on first
//                     use, renews on expiry) and persists them through the storage below.
//
// The visitor token IS the identity of the current cart / member session, so in manual mode
// tokens persist to localStorage — never re-minted per load (a fresh anonymous mint is a NEW
// visitor and silently empties the cart).
// docs: https://dev.wix.com/docs/sdk/core-modules/sdk/oauth-strategy.md
// docs: https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/about-the-astro-integration.md
import { createClient, OAuthStrategy, EMPTY_TOKENS } from "@wix/sdk";
import type { IOAuthStrategy, TokenStorage, Tokens } from "@wix/sdk";
import { WIX_CLIENT_ID } from "./config";

const STORAGE_KEY = `wix-session-${WIX_CLIENT_ID ?? "ambient"}`;

function browserTokenStorage(): TokenStorage {
  return {
    getTokens(): Tokens {
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) return JSON.parse(raw) as Tokens;
        } catch {
          /* disabled/corrupt storage — fall through to empty */
        }
      }
      return EMPTY_TOKENS;
    },
    setTokens(tokens: Tokens): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      } catch {
        /* storage full/disabled — the session just won't survive a reload */
      }
    },
  };
}

const client = WIX_CLIENT_ID
  ? createClient({
      auth: OAuthStrategy({
        clientId: WIX_CLIENT_ID,
        tokenStorage: browserTokenStorage(),
      }),
    })
  : null;

/**
 * Bind an SDK module to this app's auth. Usage (identical in both modes):
 *   import { productsV3 } from "@wix/stores";
 *   const products = wixModule(productsV3);
 *   await products.queryProducts(...)
 */
export function wixModule<T>(module: T): T {
  // The cast bridges the SDK's internal Descriptors constraint; the in/out type is identical.
  return client
    ? (client.use(module as unknown as Record<string, unknown>) as unknown as T)
    : module;
}

/**
 * The shared data client's manual-mode auth strategy, or null under ambient auth. The
 * Members vertical deliberately owns a separate explicit client for its custom in-app login;
 * app code reads that session through the members hooks instead.
 */
export function wixAuth(): IOAuthStrategy | null {
  return client ? client.auth : null;
}

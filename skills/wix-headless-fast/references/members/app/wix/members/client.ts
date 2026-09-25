// Explicit custom-login client for the Members vertical. Unlike the shared SDK seam,
// this client is used in a browser island even on managed Astro: direct credential login
// cannot use the Wix-hosted /api/auth redirect flow.
import { createClient, EMPTY_TOKENS, OAuthStrategy } from "@wix/sdk";
import type { TokenStorage, Tokens } from "@wix/sdk";
import { members } from "@wix/members";
import { WIX_MEMBERS_CLIENT_ID } from "../config";

// `@wix/astro` uses this cookie as the session source for both browser islands
// and the next server render. Direct login must write the exact same contract,
// so the member identity becomes the managed Astro identity too.
const SESSION_COOKIE_NAME = "wixSession";

const tokenStorage: TokenStorage = {
  getTokens(): Tokens {
    try {
      const raw = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
      if (!raw) return EMPTY_TOKENS;
      const session = JSON.parse(
        decodeURIComponent(raw.slice(SESSION_COOKIE_NAME.length + 1)),
      ) as { clientId?: string; tokens?: Tokens };
      return session.clientId === WIX_MEMBERS_CLIENT_ID && session.tokens
        ? session.tokens
        : EMPTY_TOKENS;
    } catch {
      return EMPTY_TOKENS;
    }
  },
  setTokens(tokens: Tokens): void {
    try {
      const value = encodeURIComponent(
        JSON.stringify({ clientId: WIX_MEMBERS_CLIENT_ID, tokens }),
      );
      document.cookie = `${SESSION_COOKIE_NAME}=${value}; path=/; secure; samesite=none`;
    } catch {
      // A blocked cookie only prevents the member session from surviving navigation.
    }
  },
};

if (!WIX_MEMBERS_CLIENT_ID) {
  throw new Error("Custom member login needs WIX_MEMBERS_CLIENT_ID.");
}

const client = createClient({
  modules: { members },
  auth: OAuthStrategy({ clientId: WIX_MEMBERS_CLIENT_ID, tokenStorage }),
});

export const membersAuth = client.auth;
export const membersApi = client.members;

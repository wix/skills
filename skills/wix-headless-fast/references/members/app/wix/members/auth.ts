// Member login/logout — the ONE stack-branched file. Sign-up, log-in, and log-out are the
// same Wix-hosted flow: the login page registers a new member or logs in an existing one;
// never build a separate sign-up call.
//
// Ambient (Wix-managed Astro): `@wix/astro` ships the whole mechanism as built-in routes —
// GET /api/auth/login and POST /api/auth/logout — and keeps the session in a cookie shared
// by SSR and every client island. startLogin/logoutMember just navigate into those routes.
// ⚠️ The routes' return param is `returnToUrl` — NOT `returnUrl`: unknown params are
// silently dropped and the member lands on "/".
//
// Manual (any other React setup): the same hosted login page, driven by hand on the shared
// OAuthStrategy client — generateOAuthData → getAuthUrl → redirect → (on /callback)
// parseFromUrl → getMemberTokens → setTokens. Member tokens are the same shape as visitor
// tokens and persist through sdk.ts's token storage, so the session survives reloads.
// ⚠️ Manual preconditions: the connected site must be PUBLISHED, and `<origin>/callback`
// must be in the OAuth app's allowedRedirectUris — a manual post-release step; `wix release`
// registers only the origin. See INSTRUCTIONS → "Wiring — React SPA".
import type { OauthData } from "@wix/sdk";
import { WIX_CLIENT_ID } from "../config";
import { wixAuth } from "../sdk";

const OAUTH_STASH_KEY = `wix-oauth-data-${WIX_CLIENT_ID ?? "ambient"}`;

/** Where the manual handshake returns to — mount LoginCallback on exactly this route (react stack). */
export const CALLBACK_PATH = "/callback";

/**
 * Synchronous session check: manual mode → exact; ambient → null (unknown — the member
 * store resolves it by fetching the current member).
 */
export function loggedInHint(): boolean | null {
  const auth = wixAuth();
  return auth ? auth.loggedIn() : null;
}

/** Send the visitor to the Wix login page (logs in OR signs up). `returnTo` is a relative path. */
export async function startLogin(returnTo?: string): Promise<void> {
  const dest = returnTo ?? window.location.pathname + window.location.search;
  const auth = wixAuth();
  if (!auth) {
    window.location.href = `/api/auth/login?returnToUrl=${encodeURIComponent(dest)}`;
    return;
  }
  const oauthData = auth.generateOAuthData(window.location.origin + CALLBACK_PATH, dest);
  window.localStorage.setItem(OAUTH_STASH_KEY, JSON.stringify(oauthData)); // survives the redirect
  const { authUrl } = await auth.getAuthUrl(oauthData);
  window.location.href = authUrl;
}

/**
 * Finish a manual-mode login on the CALLBACK_PATH route. Resolves to the path the member
 * started from. Throws with the provider's message on a failed login — surface it; do NOT
 * loop back into startLogin automatically.
 */
export async function completeLogin(): Promise<string> {
  const auth = wixAuth();
  if (!auth) throw new Error("completeLogin is manual-mode only — ambient auth handles its own /api/auth/callback.");
  const stashed = window.localStorage.getItem(OAUTH_STASH_KEY);
  if (!stashed) throw new Error("No login in progress — the stored OAuth state is gone. Start the login again.");
  const oauthData = JSON.parse(stashed) as OauthData;
  const returned = auth.parseFromUrl(); // default responseMode: the code rides in the URL fragment
  if (returned.error) throw new Error(returned.errorDescription || returned.error);
  const tokens = await auth.getMemberTokens(returned.code, returned.state, oauthData);
  auth.setTokens(tokens); // persists via sdk.ts token storage — later SDK calls run as the member
  window.localStorage.removeItem(OAUTH_STASH_KEY);
  return oauthData.originalUri || "/";
}

/** Log out and navigate through the Wix logout flow back to `returnTo` (relative path). */
export async function logoutMember(returnTo = "/"): Promise<void> {
  const auth = wixAuth();
  if (!auth) {
    // The built-in logout is a POST route answering with a redirect chain — submit a real
    // form so the browser follows it as navigation (fetch can't).
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/auth/logout?returnToUrl=${encodeURIComponent(returnTo)}`;
    document.body.appendChild(form);
    form.submit();
    return;
  }
  // logout() clears the strategy's tokens itself — the next load is a clean anonymous visitor.
  const { logoutUrl } = await auth.logout(new URL(returnTo, window.location.origin).href);
  window.location.href = logoutUrl;
}

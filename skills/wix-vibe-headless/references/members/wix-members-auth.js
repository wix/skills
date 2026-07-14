import {
  wixApiRequest,
  WIX_API_BASE,
  WIX_CLIENT_ID,
  setSessionTokens,
  clearSession,
  isMember,
} from "./wix-client.js";

/**
 * Custom member login for a client-only headless front end — the REST analog of
 * the SDK `OAuthStrategy` (`register`/`login`/`getMemberTokensForDirectLogin`/
 * `getAuthUrl`/`getMemberTokens`/`logout`). **The front owns its login UI**; the
 * member never bounces to a Wix-hosted login page.
 *
 * Two mechanisms — pick by the brief (a page can use both):
 *   (A) DIRECT-CREDENTIAL — your own email+password form. `register()` / `login()`
 *       → on SUCCESS an INVISIBLE iframe (`web_message`) mints member tokens. No
 *       navigation. Supports custom sign-up fields via `profile`.
 *   (B) SOCIAL / SSO — your own "Continue with Google/Facebook" (or custom SSO)
 *       button. Full-page redirect to the provider → back to YOUR `/callback` →
 *       token exchange. `idp` is always a connection id (see `IDP`).
 *
 * All paths converge on ONE end state: member tokens written onto the shared
 * client via `setSessionTokens` (wix-client.js). Member tokens are the SAME shape
 * as visitor tokens, so EVERY later `wixApiRequest` (cart, orders, "my …" reads)
 * now runs as the member — login just swaps the token set on the client you have.
 *
 * State machine — `register()`/`login()`/`verifyEmail()` return `{ state, ... }`:
 *   - "SUCCESS"                    → logged in; `{ state, member }`.
 *   - "REQUIRE_EMAIL_VERIFICATION" → a 6-digit code was emailed; `{ state, stateToken }`.
 *                                    Collect the code, call `verifyEmail(code, stateToken)`.
 *   - "REQUIRE_OWNER_APPROVAL"     → membership pending owner approval; `{ state }`.
 * Hard failures throw a `MemberAuthError` with a `.code` (invalidCredentials,
 * emailAlreadyExists, …) — surface `.message` in your form.
 *
 * `profile` (register, all optional): firstName, lastName, nickname, picture,
 * language, privacyStatus ("PUBLIC"|"PRIVATE"), labels[], phonesV2[], addresses[],
 * company, position, birthdate, and `customFields` (name→value map). Standard
 * fields work as-is; arbitrary `customFields` keys must first be DEFINED in the
 * Members Area app or they're silently dropped. Social (B) can't collect any of
 * these — that's the reason to pick direct-credential.
 *
 * Docs (curl the .md): custom login <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/custom-login-page/custom-login/custom-login-using-the-js-sdk.md>
 * · external/social login <https://dev.wix.com/docs/rest/business-management/headless-authentication/redirects/create-redirect-session>
 * · Retrieve Tokens <https://dev.wix.com/docs/rest/business-management/headless-authentication/authentication/retrieve-tokens>
 */

const AUTH_BASE = "/_api/iam/authentication/v2";
const VERIFY_URL = "/_api/iam/verification/v1/auth/verify";
const RECOVERY_URL = "/_api/iam/recovery/v1/send-email";
const REDIRECT_SESSION_URL = "/_api/redirects-api/v1/redirect-session";
const CURRENT_MEMBER_URL = "/members/v1/members/my";
const OAUTH_STASH_KEY = `wix-oauth-data-${WIX_CLIENT_ID}`;

/**
 * `idp` connection ids for social login. Google & Facebook are enabled by default
 * on every headless client. For custom SSO / OIDC (Okta, Auth0, …) pass the
 * connection id of a connection you created in the Business Manager instead.
 */
export const IDP = {
  GOOGLE: "0e6a50f5-b523-4e29-990d-f37fa2ffdd69",
  FACEBOOK: "3ecad13f-52c3-483d-911f-31dbcf2a6d23",
};

/** Auth outcome you can show the user. `.code` is stable; `.message` is human text. */
export class MemberAuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "MemberAuthError";
    this.code = code;
  }
}

// ─────────────────────────── (A) direct-credential ───────────────────────────

/**
 * Sign up a new member with email + password (+ optional custom `profile`).
 * On SUCCESS the member is logged in (member tokens written to the shared client).
 *
 * @param {string} email
 * @param {string} password
 * @param {object} [profile] see the `profile` note in the file header
 * @returns {Promise<{ state: string, member?: object|null, stateToken?: string }>}
 */
export async function register(email, password, profile) {
  return runCredentialFlow(`${AUTH_BASE}/register`, {
    loginId: { email },
    password,
    ...(profile ? { profile } : {}),
  });
}

/**
 * Log an existing member in with email + password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ state: string, member?: object|null, stateToken?: string }>}
 */
export async function login(email, password) {
  return runCredentialFlow(`${AUTH_BASE}/login`, { loginId: { email }, password });
}

/**
 * Continue a "REQUIRE_EMAIL_VERIFICATION" flow with the 6-digit code from the email.
 * @param {string} code verification code the member received by email
 * @param {string} stateToken the `stateToken` returned alongside REQUIRE_EMAIL_VERIFICATION
 * @returns {Promise<{ state: string, member?: object|null, stateToken?: string }>}
 */
export async function verifyEmail(code, stateToken) {
  let res;
  try {
    res = await wixApiRequest(VERIFY_URL, { body: { code, stateToken } });
  } catch (e) {
    throw mapAuthError(e);
  }
  return resolveState(res);
}

/**
 * Email the member a password-reset link. Wix hosts the reset page and returns
 * them to `redirectUri`, which MUST be an allow-listed authorization redirect URI
 * on the OAuth app (see INSTRUCTIONS.md → dashboard links).
 * @param {string} email
 * @param {string} redirectUri full URL to return to after reset
 */
export async function sendPasswordResetEmail(email, redirectUri) {
  await wixApiRequest(RECOVERY_URL, {
    body: { email, redirect: { url: redirectUri, clientId: WIX_CLIENT_ID } },
  });
}

async function runCredentialFlow(path, body) {
  let res;
  try {
    res = await wixApiRequest(path, { body });
  } catch (e) {
    throw mapAuthError(e);
  }
  return resolveState(res);
}

// On SUCCESS, finish login and return the member; otherwise hand the state (and
// stateToken, if any) back to the UI so it can prompt for verification etc.
async function resolveState(res) {
  if (res.state === "SUCCESS") {
    const member = await completeDirectLogin(res.sessionToken);
    return { state: res.state, member };
  }
  return { state: res.state, stateToken: res.stateToken };
}

// The `getMemberTokensForDirectLogin` analog: turn a session token into member
// tokens via an INVISIBLE iframe (responseMode: web_message, prompt: none). The
// member never sees a page — this is the silent plumbing behind your own form.
async function completeDirectLogin(sessionToken) {
  const pkce = await generatePkce();
  const { fullUrl } = await createRedirectSession({
    authRequest: { responseMode: "web_message", sessionToken, pkce },
  });
  const { code } = await authorizeViaHiddenIframe(fullUrl, pkce.state);
  const tokens = await exchangeCode(code, pkce.codeVerifier);
  setSessionTokens(tokens);
  return getCurrentMember();
}

// ─────────────────────────── (B) social / SSO ───────────────────────────

/**
 * Start a social / SSO login. Redirects the whole page to the provider; returns
 * through YOUR `callbackUri`, where you must call `completeSocialLogin()`.
 *
 * @param {string} idp `IDP.GOOGLE` / `IDP.FACEBOOK`, or a custom SSO connection id
 * @param {string} callbackUri your `/callback` URL — MUST be an allow-listed
 *   authorization redirect URI on the OAuth app (see INSTRUCTIONS.md)
 * @param {string} [returnTo="/"] where to send the member after login completes
 */
export async function startSocialLogin(idp, callbackUri, returnTo = "/") {
  const pkce = await generatePkce();
  const { fullUrl } = await createRedirectSession({
    authRequest: { responseMode: "fragment", idp, redirectUri: callbackUri, pkce },
  });
  // The callback runs on a separate page load — carry what the exchange needs.
  window.localStorage.setItem(
    OAUTH_STASH_KEY,
    JSON.stringify({ codeVerifier: pkce.codeVerifier, state: pkce.state, redirectUri: callbackUri, returnTo }),
  );
  window.location.href = fullUrl;
}

/**
 * Finish a social / SSO login on the `/callback` page: reads `#code`/`#state`
 * from the URL, verifies state, exchanges the code, logs the member in.
 * @returns {Promise<{ member: object|null, returnTo: string }>}
 */
export async function completeSocialLogin() {
  const raw = window.localStorage.getItem(OAUTH_STASH_KEY);
  if (!raw) throw new MemberAuthError("missingOAuthData", "No pending login found — start the login again.");
  window.localStorage.removeItem(OAUTH_STASH_KEY);
  const stash = JSON.parse(raw);

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const error = params.get("error");
  if (error) throw new MemberAuthError(error, params.get("error_description") || error);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) throw new MemberAuthError("missingCode", "No authorization code returned.");
  if (state !== stash.state) throw new MemberAuthError("stateMismatch", "OAuth state mismatch — possible CSRF; login aborted.");

  const tokens = await exchangeCode(code, stash.codeVerifier, stash.redirectUri);
  setSessionTokens(tokens);
  return { member: await getCurrentMember(), returnTo: stash.returnTo || "/" };
}

// ─────────────────────────── session ───────────────────────────

/** True once a member is logged in on this client. Gate account UI on it. */
export function isLoggedIn() {
  return isMember();
}

/**
 * Read the logged-in member (name / photo / roles / custom fields). Needs the
 * **Members Area app** installed; returns `null` for an anonymous visitor or when
 * the app isn't installed (that's setup, not a code bug — see INSTRUCTIONS.md).
 * @returns {Promise<object|null>}
 */
export async function getCurrentMember() {
  try {
    const res = await wixApiRequest(CURRENT_MEMBER_URL, { method: "GET", query: { fieldSet: "FULL" } });
    return res?.member || null;
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) return null;
    throw e;
  }
}

/**
 * Log the member out: clears the local session immediately, then redirects
 * through the Wix logout URL so the server session is dropped too. After this the
 * client is a clean anonymous visitor again.
 * @param {string} [returnTo] where to land after logout (defaults to the origin)
 */
export async function logout(returnTo) {
  const postFlowUrl = returnTo || (typeof window !== "undefined" ? window.location.origin : "/");
  let logoutUrl;
  try {
    const { redirectSession } = await wixApiRequest(REDIRECT_SESSION_URL, {
      body: { logout: { clientId: WIX_CLIENT_ID }, callbacks: { postFlowUrl } },
    });
    logoutUrl = redirectSession?.fullUrl;
  } finally {
    clearSession(); // drop local tokens even if building the logout URL failed
  }
  if (logoutUrl && typeof window !== "undefined") window.location.href = logoutUrl;
}

// ─────────────────────────── internals ───────────────────────────

async function createRedirectSession({ authRequest }) {
  const { responseMode, sessionToken, idp, redirectUri, pkce } = authRequest;
  const { redirectSession } = await wixApiRequest(REDIRECT_SESSION_URL, {
    body: {
      auth: {
        authRequest: {
          clientId: WIX_CLIENT_ID,
          codeChallenge: pkce.codeChallenge,
          codeChallengeMethod: "S256",
          responseMode,
          responseType: "code",
          scope: "offline_access",
          state: pkce.state,
          ...(redirectUri ? { redirectUri } : {}),
          ...(sessionToken ? { sessionToken } : {}),
          ...(idp ? { idp } : {}),
        },
      },
    },
  });
  if (!redirectSession?.fullUrl) throw new MemberAuthError("noRedirectSession", "Wix did not return an authorization URL.");
  return { fullUrl: redirectSession.fullUrl };
}

// Open the authorize URL in a hidden iframe and wait for the web_message postMessage
// carrying { code, state }. Matches @wix/sdk iframeUtils.addPostMessageListener.
function authorizeViaHiddenIframe(authUrl, expectedState) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    const onMessage = (e) => {
      if (!e.data || e.data.state !== expectedState) return; // not our message
      settled = true;
      cleanup();
      if (e.data.error) reject(new MemberAuthError(e.data.error, e.data.error_description || e.data.error));
      else resolve({ code: e.data.code, state: e.data.state });
    };
    window.addEventListener("message", onMessage);
    const timer = setTimeout(() => {
      if (!settled) {
        cleanup();
        // The overwhelmingly common cause: this app's ORIGIN is not an allowed
        // authorization redirect URI on the OAuth app, so the browser silently
        // blocks the iframe's postMessage (check the console for a "target origin
        // … does not match" error). Register the origin — see INSTRUCTIONS.md.
        reject(new MemberAuthError(
          "timeout",
          `Login timed out. Most likely this app's origin (${typeof window !== "undefined" ? window.location.origin : "?"}) ` +
            `is not an allowed authorization redirect URI on the Wix OAuth app — register it in the site's Headless Settings.`,
        ));
      }
    }, 120000);
    iframe.src = authUrl;
    document.body.appendChild(iframe);
  });
}

// Exchange an authorization code for member tokens. No Authorization header — this
// is the token-minting endpoint (mirrors the SDK's fetchTokens). `redirectUri` is
// sent only for social (it must match the redirect-session's redirectUri).
async function exchangeCode(code, codeVerifier, redirectUri) {
  if (!code) throw new MemberAuthError("missingCode", "No authorization code to exchange.");
  const res = await fetch(`${WIX_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: WIX_CLIENT_ID,
      grantType: "authorization_code",
      code,
      codeVerifier,
      ...(redirectUri ? { redirectUri } : {}),
    }),
  });
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new MemberAuthError(body?.error || "tokenExchangeFailed", `Token exchange failed: ${res.status}${body ? ` ${JSON.stringify(body)}` : ""}`);
  }
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

function mapAuthError(e) {
  const code = e?.body?.details?.applicationError?.code;
  // Email already exists (register) — route them to log in.
  if (code === "-19995" || e?.status === 409) {
    return new MemberAuthError("emailAlreadyExists", "An account with this email already exists — try logging in instead.");
  }
  // Bad credentials: -19999 identity-not-found (404), -19976 wrong-password (401).
  if (code === "-19999" || code === "-19976" || e?.status === 404 || e?.status === 401) {
    return new MemberAuthError("invalidCredentials", "Incorrect email or password.");
  }
  if (e instanceof MemberAuthError) return e;
  return e; // unknown — bubble the raw transport error (fail loudly)
}

// ── PKCE (RFC 7636, S256) — browser Web Crypto, dependency-free ──
async function generatePkce() {
  const codeVerifier = randomUnreserved(43);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)), state: randomUnreserved(24) };
}

function randomUnreserved(length) {
  const mask = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += mask[bytes[i] % mask.length];
  return out;
}

function base64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

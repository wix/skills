// Member authentication over REST — the twin of app/wix/members/auth.ts. Same exports, same
// LoginResult; the state and error-code rules come from auth-core (the SAME file the SDK transport
// uses). The custom credential flow, as the docs order it: login/register with the VISITOR token →
// a one-shot sessionToken (5-minute life) → a redirect session that authorizes it (PKCE,
// web_message) → an authorization code → POST /oauth2/token grantType authorization_code → MEMBER
// tokens, adopted by ./client.js so every later call (the current-member read, a member's own
// records) runs as the member and the refresh keeps the member. All from a page with the public
// client id; nothing elevated. Porting: keep the paths and bodies; the exchange is three calls.
// docs: https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/build-a-custom-login-page-rest.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { WIX_CLIENT_ID } from "./config.js";
import { WixApiError, clearTokens, loadTokens, mintTokens, setTokens, wixRequest, type Tokens } from "./client.js";
import {
  NO_SESSION_ERROR,
  authOutcome,
  failure,
  loginErrorCode,
  registerErrorCode,
  toLoginResult,
  type LoginResult,
  type LoginState,
  type RawAuth,
} from "./auth-core.js";

export type { LoginResult, LoginState };

const REDIRECT_SESSION = "/headless/v1/redirect-session";
/** The stateToken of a login/registration that stopped at email verification — verifyMemberEmail continues it. */
let pendingStateToken: string | null = null;

/** True when the persisted token set is a member's (no network) — the store skips the profile read when false. */
export function loggedInHint(): boolean {
  return loadTokens()?.role === "member";
}

// A SUCCESS carries the one-shot session token: exchange it for member tokens and adopt them. Other
// states pass through; a verification state keeps its stateToken for verifyMemberEmail.
async function finish(raw: RawAuth): Promise<LoginResult> {
  const outcome = authOutcome(raw);
  if (outcome.state === "SUCCESS") {
    pendingStateToken = null;
    if (!outcome.sessionToken) return failure(NO_SESSION_ERROR);
    setTokens(await memberTokensForSession(outcome.sessionToken));
    return { state: "SUCCESS" };
  }
  if (outcome.stateToken) pendingStateToken = outcome.stateToken;
  return toLoginResult(outcome);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Sign in with email + password. A wrong password or unknown email is a FAILURE result (errorCode
 * invalidPassword / invalidEmail, Wix's message in `error`), never a throw.
 * POST /_api/iam/authentication/v2/login  { loginId: { email }, password }  → { state, sessionToken?, stateToken? }
 */
export async function loginMember(email: string, password: string): Promise<LoginResult> {
  let raw: RawAuth;
  try {
    raw = await wixRequest<RawAuth>("/_api/iam/authentication/v2/login", { body: { loginId: { email }, password } });
  } catch (e) {
    return failure(message(e), e instanceof WixApiError ? loginErrorCode(e.code) : undefined);
  }
  return finish(raw);
}

/**
 * Sign up with email + password (+ first/last name). An email already registered is a FAILURE with
 * errorCode emailAlreadyExists. Whether the result is SUCCESS, EMAIL_VERIFICATION_REQUIRED, or
 * OWNER_APPROVAL_REQUIRED is the site's signup policy (dashboard), not the caller's.
 * POST /_api/iam/authentication/v2/register  { loginId: { email }, password, profile?: { firstName, lastName } }
 */
export async function registerMember(
  email: string,
  password: string,
  profile?: { firstName?: string; lastName?: string },
): Promise<LoginResult> {
  let raw: RawAuth;
  try {
    raw = await wixRequest<RawAuth>("/_api/iam/authentication/v2/register", {
      body: { loginId: { email }, password, ...(profile ? { profile } : {}) },
    });
  } catch (e) {
    return failure(message(e), e instanceof WixApiError ? registerErrorCode(e.code, e.details) : undefined);
  }
  return finish(raw);
}

/**
 * Continue an EMAIL_VERIFICATION_REQUIRED flow with the code from the email; the state token of the
 * last login/registration is kept here. A FAILURE when nothing is waiting or the code is wrong.
 * POST /_api/iam/verification/v1/auth/verify  { code, stateToken }  → { state, sessionToken?, stateToken? }
 */
export async function verifyMemberEmail(verificationCode: string): Promise<LoginResult> {
  if (!pendingStateToken) return failure("No sign-in is waiting for a verification code.");
  let raw: RawAuth;
  try {
    raw = await wixRequest<RawAuth>("/_api/iam/verification/v1/auth/verify", { body: { code: verificationCode, stateToken: pendingStateToken } });
  } catch (e) {
    return failure(message(e));
  }
  return finish(raw);
}

/**
 * The Wix logout URL for the current member — navigating the document there ends the Wix session
 * and lands on `returnTo` (an absolute URL). Called with the MEMBER token.
 * POST /headless/v1/redirect-session  { logout: { clientId }, callbacks: { postFlowUrl } }  → { redirectSession: { fullUrl } }
 */
export async function logoutUrl(returnTo: string): Promise<string> {
  const res = await wixRequest<RawAuth>(REDIRECT_SESSION, { body: { logout: { clientId: WIX_CLIENT_ID }, callbacks: { postFlowUrl: returnTo } } });
  const url = res?.redirectSession?.fullUrl;
  if (!url) throw new Error("Logout couldn't start: no redirect URL returned.");
  return url;
}

/** Log out: drop the member tokens (the next call is a fresh visitor) and navigate to Wix's logout, which returns to `returnTo`. */
export async function logoutMember(returnTo = "/"): Promise<void> {
  const target = typeof window !== "undefined" ? new URL(returnTo, window.location.origin).href : returnTo;
  const url = await logoutUrl(target);
  clearTokens();
  if (typeof window !== "undefined") window.location.assign(url);
}

/**
 * sessionToken → member tokens. Three calls, as the docs order them:
 *  1. POST /headless/v1/redirect-session
 *       { auth: { authRequest: { clientId, codeChallenge, codeChallengeMethod: "S256", responseMode: "web_message",
 *                                responseType: "code", scope: "offline_access", state, sessionToken }, prompt: "none" } }
 *       → { redirectSession: { fullUrl } }   (with the visitor token)
 *  2. fullUrl is a page whose script posts { code, state, error } to its parent — a hidden iframe in a
 *     browser (its origin must be one of the OAuth app's allowed domains, or the message is dropped
 *     and this times out); without a DOM (a server-side port, a Node check) the same page is fetched
 *     and read.
 *  3. POST /oauth2/token { clientId, grantType: "authorization_code", code, codeVerifier }
 *       → member access + refresh tokens (role "member"); the code is single-use.
 */
export async function memberTokensForSession(sessionToken: string): Promise<Tokens> {
  const { verifier, challenge } = await pkce();
  const state = randomString();
  const res = await wixRequest<RawAuth>(REDIRECT_SESSION, {
    body: {
      auth: {
        authRequest: {
          clientId: WIX_CLIENT_ID,
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          responseMode: "web_message",
          responseType: "code",
          scope: "offline_access",
          state,
          sessionToken,
        },
        prompt: "none",
      },
    },
  });
  const url: string | undefined = res?.redirectSession?.fullUrl;
  if (!url) throw new Error("Login couldn't finish: no authorization URL returned.");
  const code = await authorizationCode(url, state);
  return mintTokens({ grantType: "authorization_code", code, codeVerifier: verifier }, "member");
}

// The authorize page posts { code, state, error }. Browser: a hidden iframe and a message listener
// keyed on our state (the SDK's own mechanism). No DOM: fetch the page and read the same three values.
async function authorizationCode(url: string, state: string): Promise<string> {
  if (typeof document === "undefined") {
    const html = await (await fetch(url)).text();
    const field = (name: string) => html.match(new RegExp(`'${name}':\\s*'([^']*)'`))?.[1];
    const error = field("error");
    if (error) throw new Error(`Login was refused: ${error}`);
    const code = field("code");
    if (!code || field("state") !== state) throw new Error("Login couldn't finish: no authorization code.");
    return code;
  }
  return new Promise<string>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    const done = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      frame.remove();
    };
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { code?: string; state?: string; error?: string } | null;
      if (!data || data.state !== state) return; // a message not meant for us
      done();
      if (data.error) reject(new Error(`Login was refused: ${data.error}`));
      else if (data.code) resolve(data.code);
      else reject(new Error("Login couldn't finish: no authorization code."));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("Login timed out. Is this page's origin on the OAuth app's allowed domains?"));
    }, 120_000);
    window.addEventListener("message", onMessage);
    frame.src = url;
    document.body.appendChild(frame);
  });
}

// PKCE: a 43-char base64url verifier, its SHA-256 as the S256 challenge. Web Crypto (browser + Node).
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

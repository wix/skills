// Member authentication — the transport only; what a response MEANS lives in ./auth-core (shared
// with the REST twin in templates/members/rest/auth.ts). Two transports behind one export list,
// switched by AMBIENT_AUTH from ./client:
//
//   ambient (Wix-managed Astro): the integration's built-in auth routes. Credentials go to
//     POST /api/auth/login or /api/auth/signup as JSON; a SUCCESS answers with `redirectUrl`, the
//     Wix authorization step that the browser MUST navigate to — it bounces straight back through
//     /api/auth/callback, which writes the member session cookie server-side (HttpOnly) and lands
//     on `returnTo`. Email verification continues through POST /api/auth/verify-email (the pending
//     state is a server cookie, nothing to keep here). Logout is a POST to /api/auth/logout.
//     docs: @wix/astro docs/custom-login.md, docs/custom-signup.md, docs/email-verification.md
//
//   manual (any other React setup): the SDK's OAuthStrategy in the browser — login/register/verify,
//     then the one-shot session token is exchanged for member tokens that the client persists.
//     docs: https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/build-a-custom-login-page-js-sdk.md
//
// Copy as-is; extend by adding functions, never by editing the exchange.
import { AMBIENT_AUTH, membersAuth } from "./client";
import {
  NO_SESSION_ERROR,
  authOutcome,
  failure,
  fromAuthRoute,
  toLoginResult,
  type LoginResult,
  type LoginState,
  type RawAuth,
} from "./auth-core";

export type { LoginResult, LoginState };

export interface LoginOptions {
  /** Same-site path to land on after a SUCCESS (ambient: the callback's destination). Default "/". */
  returnTo?: string;
}

/** Whether register() can carry first/last name. The built-in signup route takes credentials only. */
export const PROFILE_ON_SIGNUP = !AMBIENT_AUTH;

/**
 * Session hint without a network call: manual mode knows from its tokens; ambient mode returns
 * null — the current-member read IS the session check there (the store handles both).
 */
export function loggedInHint(): boolean | null {
  return membersAuth ? membersAuth.loggedIn() : null;
}

// ---- ambient: the built-in routes ----------------------------------------------------------------

function safeReturnTo(returnTo: string | undefined): string {
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}

async function postAuthRoute(path: string, body: Record<string, string>): Promise<LoginResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => null)) as RawAuth | null;
  return fromAuthRoute(res.status, json);
}

// ---- manual: the SDK strategy ----------------------------------------------------------------------

// A SUCCESS carries a one-shot session token; the strategy exchanges it for member tokens
// (getMemberTokensForDirectLogin) and setTokens persists them, so every later call runs as the member.
async function finish(raw: RawAuth): Promise<LoginResult> {
  const outcome = authOutcome(raw);
  if (outcome.state === "SUCCESS") {
    if (!outcome.sessionToken || !membersAuth) return failure(NO_SESSION_ERROR);
    const tokens = await membersAuth.getMemberTokensForDirectLogin(outcome.sessionToken);
    membersAuth.setTokens(tokens);
    return { state: "SUCCESS" };
  }
  return toLoginResult(outcome);
}

// ---- the exports (same on both transports) ---------------------------------------------------------

export async function loginMember(email: string, password: string, options: LoginOptions = {}): Promise<LoginResult> {
  if (!membersAuth) return postAuthRoute("/api/auth/login", { email, password, returnToUrl: safeReturnTo(options.returnTo) });
  return finish((await membersAuth.login({ email, password })) as RawAuth);
}

export async function registerMember(
  email: string,
  password: string,
  profile?: { firstName?: string; lastName?: string },
  options: LoginOptions = {},
): Promise<LoginResult> {
  if (!membersAuth) return postAuthRoute("/api/auth/signup", { email, password, returnToUrl: safeReturnTo(options.returnTo) });
  return finish((await membersAuth.register({ email, password, ...(profile ? { profile } : {}) })) as RawAuth);
}

/** Continue an EMAIL_VERIFICATION_REQUIRED flow with the code from the email; the transport holds the state. */
export async function verifyMemberEmail(verificationCode: string): Promise<LoginResult> {
  if (!membersAuth) return postAuthRoute("/api/auth/verify-email", { verificationCode });
  return finish((await membersAuth.processVerification({ verificationCode })) as RawAuth);
}

/** Log out through Wix (clears the session) and land on `returnTo` — navigates away. */
export async function logoutMember(returnTo = "/"): Promise<void> {
  const target = safeReturnTo(returnTo);
  if (!membersAuth) {
    // The built-in logout is a POST that answers with a redirect; a real form submit navigates.
    const form = document.createElement("form");
    form.method = "post";
    form.action = `/api/auth/logout?returnToUrl=${encodeURIComponent(target)}`;
    document.body.appendChild(form);
    form.submit();
    return;
  }
  const { logoutUrl } = await membersAuth.logout(new URL(target, window.location.origin).href);
  window.location.assign(logoutUrl);
}

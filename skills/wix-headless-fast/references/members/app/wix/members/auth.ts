// Custom, in-app member authentication over the SDK — the transport only. Credentials are
// submitted from the branded LoginForm; there is no Wix-hosted login-page redirect or callback
// route. What a response means lives in ./auth-core (shared with the REST twin in
// references/members/rest/auth.ts); this file makes the OAuthStrategy calls and delegates.
// docs: https://dev.wix.com/docs/go-headless/authentication/members/custom-login-page/build-a-custom-login-page-js-sdk.md
import { membersAuth } from "./client";
import {
  NO_SESSION_ERROR,
  authOutcome,
  failure,
  toLoginResult,
  type LoginResult,
  type LoginState,
  type RawAuth,
} from "./auth-core";

export type { LoginResult, LoginState };

/** True when the explicit members client holds member tokens (no network). */
export function loggedInHint(): boolean {
  return membersAuth.loggedIn();
}

// A SUCCESS carries a one-shot session token; the strategy exchanges it for member tokens
// (getMemberTokensForDirectLogin) and setTokens writes them into Astro's wixSession cookie, so the
// next server render and every island run as the member. Other states pass through.
async function finish(raw: RawAuth): Promise<LoginResult> {
  const outcome = authOutcome(raw);
  if (outcome.state === "SUCCESS") {
    if (!outcome.sessionToken) return failure(NO_SESSION_ERROR);
    const tokens = await membersAuth.getMemberTokensForDirectLogin(outcome.sessionToken);
    membersAuth.setTokens(tokens);
    return { state: "SUCCESS" };
  }
  return toLoginResult(outcome);
}

export async function loginMember(email: string, password: string): Promise<LoginResult> {
  return finish((await membersAuth.login({ email, password })) as RawAuth);
}

export async function registerMember(
  email: string,
  password: string,
  profile?: { firstName?: string; lastName?: string },
): Promise<LoginResult> {
  return finish((await membersAuth.register({ email, password, ...(profile ? { profile } : {}) })) as RawAuth);
}

/** Continue an EMAIL_VERIFICATION_REQUIRED flow with the code from the email; the strategy holds the state token. */
export async function verifyMemberEmail(verificationCode: string): Promise<LoginResult> {
  return finish((await membersAuth.processVerification({ verificationCode })) as RawAuth);
}

/** Log out through Wix (clears the session cookie) and land on `returnTo` — navigates away. */
export async function logoutMember(returnTo = "/"): Promise<void> {
  const { logoutUrl } = await membersAuth.logout(new URL(returnTo, window.location.origin).href);
  window.location.assign(logoutUrl);
}

// Custom, in-app member authentication. Credentials are submitted from the branded
// LoginForm; there is no Wix-hosted login-page redirect or callback route.
import { membersAuth } from "./client";

export type LoginState =
  | "SUCCESS"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "OWNER_APPROVAL_REQUIRED"
  | "FAILURE";

export interface LoginResult {
  state: LoginState;
  stateToken?: string;
  errorCode?: string;
  error?: string;
}

type AuthResponse = {
  loginState?: LoginState;
  data?: { sessionToken?: string };
  stateToken?: string;
  errorCode?: string;
  error?: string;
};

export function loggedInHint(): boolean {
  return membersAuth.loggedIn();
}

async function finish(response: AuthResponse): Promise<LoginResult> {
  const state = response.loginState ?? "FAILURE";
  if (state === "SUCCESS") {
    const sessionToken = response.data?.sessionToken;
    if (!sessionToken)
      return {
        state: "FAILURE",
        error: "Wix did not return a member session.",
      };
    const tokens =
      await membersAuth.getMemberTokensForDirectLogin(sessionToken);
    membersAuth.setTokens(tokens);
    return { state };
  }
  return {
    state,
    ...(response.stateToken ? { stateToken: response.stateToken } : {}),
    ...(response.errorCode ? { errorCode: response.errorCode } : {}),
    ...(response.error ? { error: response.error } : {}),
  };
}

export async function loginMember(
  email: string,
  password: string,
): Promise<LoginResult> {
  return finish((await membersAuth.login({ email, password })) as AuthResponse);
}

export async function registerMember(
  email: string,
  password: string,
  profile?: { firstName?: string; lastName?: string },
): Promise<LoginResult> {
  return finish(
    (await membersAuth.register({
      email,
      password,
      ...(profile ? { profile } : {}),
    })) as AuthResponse,
  );
}

export async function verifyMemberEmail(
  verificationCode: string,
): Promise<LoginResult> {
  return finish(
    (await membersAuth.processVerification({
      verificationCode,
    })) as AuthResponse,
  );
}

export async function logoutMember(returnTo = "/"): Promise<void> {
  const { logoutUrl } = await membersAuth.logout(
    new URL(returnTo, window.location.origin).href,
  );
  window.location.assign(logoutUrl);
}

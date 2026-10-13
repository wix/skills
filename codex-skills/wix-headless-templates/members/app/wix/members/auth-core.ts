// Authentication rules — transport-agnostic, imported by EVERY transport: ./auth.ts (the SDK's
// OAuthStrategy, or the managed-Astro built-in auth routes) and the REST twin in
// templates/members/rest/auth.ts (the IAM authentication API over fetch). What a login/registration
// response MEANS — the four states, when a session token is expected, which Wix error code is which
// failure — lives HERE, once. No imports: a strip to JS emits a plain module.

/** The four outcomes every credential operation resolves to; the shipped LoginForm renders each. */
export type LoginState = "SUCCESS" | "EMAIL_VERIFICATION_REQUIRED" | "OWNER_APPROVAL_REQUIRED" | "FAILURE";

export interface LoginResult {
  state: LoginState;
  /** Continues an EMAIL_VERIFICATION_REQUIRED flow (the transport keeps it too — verifyMemberEmail needs no argument). */
  stateToken?: string;
  /** A stable name for a FAILURE: invalidPassword, invalidEmail, emailAlreadyExists, resetPassword, missingCaptchaToken, invalidCaptchaToken. */
  errorCode?: string;
  /** Wix's message for a FAILURE — render it. */
  error?: string;
  /**
   * Managed Astro only: a SUCCESS is not a session yet — the browser must navigate here (the Wix
   * authorization step), which returns through /api/auth/callback and lands on the requested page.
   */
  redirectUrl?: string;
}

/** A raw login/register/verify response as either transport returns it. */
export type RawAuth = Record<string, any>;

/** A LoginResult plus the one-shot session token a SUCCESS carries (5-minute life; exchanged, never shown). */
export interface AuthOutcome extends LoginResult {
  sessionToken: string | null;
}

// REST spells the states differently from the SDK; both map onto LoginState.
const REST_STATES: Record<string, LoginState> = {
  SUCCESS: "SUCCESS",
  REQUIRE_EMAIL_VERIFICATION: "EMAIL_VERIFICATION_REQUIRED",
  REQUIRE_OWNER_APPROVAL: "OWNER_APPROVAL_REQUIRED",
};

/**
 * Normalize either transport's response — SDK `{ loginState, data: { sessionToken | stateToken },
 * error?, errorCode? }` or REST `{ state, sessionToken?, stateToken? }`. Anything else is a FAILURE.
 */
export function authOutcome(raw: RawAuth | null | undefined): AuthOutcome {
  const state: LoginState = raw?.loginState ?? REST_STATES[raw?.state ?? ""] ?? "FAILURE";
  const stateToken: string | undefined = raw?.stateToken ?? raw?.data?.stateToken;
  return {
    state,
    sessionToken: raw?.data?.sessionToken ?? raw?.sessionToken ?? null,
    ...(stateToken ? { stateToken } : {}),
    ...(raw?.errorCode ? { errorCode: raw.errorCode } : {}),
    ...(raw?.error ? { error: raw.error } : {}),
  };
}

/** The outcome as callers see it — without the session token, which the transport has consumed. */
export function toLoginResult({ sessionToken: _consumed, ...result }: AuthOutcome): LoginResult {
  return result;
}

export function failure(error: string, errorCode?: string): LoginResult {
  return { state: "FAILURE", error, ...(errorCode ? { errorCode } : {}) };
}

/** A SUCCESS without a session token — the exchange can't run; surfaced as a FAILURE with this text. */
export const NO_SESSION_ERROR = "Wix did not return a member session.";

// The built-in auth routes' request-level error codes (body `{ error }`), in the words a form can show.
const AUTH_ROUTE_ERRORS: Record<string, string> = {
  ALREADY_LOGGED_IN: "You are already signed in.",
  AUTH_SERVICE_ERROR: "Wix could not process the sign-in right now. Try again.",
  VERIFICATION_FAILED: "That code did not match. Check the email and try again.",
  VERIFICATION_STATE_EXPIRED: "The verification code expired. Sign in again to get a new one.",
  INVALID_REQUEST: "The form sent something Wix did not accept.",
  FORBIDDEN: "This request was refused.",
};

/**
 * A managed-Astro auth route answer → LoginResult. Success: `{ loginState: "SUCCESS", redirectUrl }`
 * (200). Challenges: `{ loginState }` with 403 — verification and owner approval pass through; a
 * CAPTCHA challenge (the site owner turned reCAPTCHA on) is a FAILURE the form cannot clear without
 * a widget. Failure: `{ loginState: "FAILURE", errorCode }` (422, or 403 for resetPassword). Request
 * errors: `{ error: CODE }` without a loginState.
 */
export function fromAuthRoute(status: number, body: RawAuth | null): LoginResult {
  const loginState: string | undefined = body?.loginState;
  switch (loginState) {
    case "SUCCESS":
      return body?.redirectUrl ? { state: "SUCCESS", redirectUrl: body.redirectUrl } : failure(NO_SESSION_ERROR);
    case "EMAIL_VERIFICATION_REQUIRED":
    case "OWNER_APPROVAL_REQUIRED":
      return { state: loginState };
    case "SILENT_CAPTCHA_REQUIRED":
    case "USER_CAPTCHA_REQUIRED":
      return failure("This site requires a CAPTCHA to sign up; the form has no CAPTCHA widget yet.", "captchaRequired");
    case "FAILURE":
      return failure(body?.error ?? FAILURE_TEXT[body?.errorCode ?? ""] ?? "Could not sign in.", body?.errorCode ?? "unknown");
    default: {
      // No route at all: the project's @wix/astro predates the built-in credential routes (2.75).
      if (status === 404 || status === 405) return failure("This site's @wix/astro has no /api/auth credential routes; update it to 2.75 or later.", "authRoutesMissing");
      const code: string | undefined = body?.error;
      return failure(AUTH_ROUTE_ERRORS[code ?? ""] ?? `Sign-in request failed (${status}).`, code);
    }
  }
}

/** Default wording per errorCode when the route sends none (the SDK sends none either). */
const FAILURE_TEXT: Record<string, string> = {
  invalidCredentials: "Wrong email or password.",
  invalidEmail: "That email is not valid here.",
  invalidPassword: "Wrong password.",
  emailAlreadyExists: "An account with this email already exists. Sign in instead.",
  resetPassword: "You need to reset your password before signing in.",
  missingCaptchaToken: "This site requires a CAPTCHA to sign up.",
  invalidCaptchaToken: "The CAPTCHA check failed. Try again.",
};

// Wix IAM application-error codes, named as the SDK names them.
export const AUTH_ERROR_CODES = {
  MISSING_CAPTCHA: "-19971",
  INVALID_CAPTCHA: "-19970",
  EMAIL_EXISTS: "-19995",
  INVALID_PASSWORD: "-19976",
  RESET_PASSWORD: "-19973",
} as const;

/** A failed login's applicationError code → the SDK's errorCode name (anything unrecognized is `invalidEmail`, as the SDK does). */
export function loginErrorCode(code: string | undefined): string {
  switch (code) {
    case AUTH_ERROR_CODES.MISSING_CAPTCHA:
      return "missingCaptchaToken";
    case AUTH_ERROR_CODES.INVALID_CAPTCHA:
      return "invalidCaptchaToken";
    case AUTH_ERROR_CODES.INVALID_PASSWORD:
      return "invalidPassword";
    case AUTH_ERROR_CODES.RESET_PASSWORD:
      return "resetPassword";
    default:
      return "invalidEmail";
  }
}

/**
 * A failed registration's applicationError code (+ the response `details`) → the SDK's errorCode
 * name; undefined when the SDK would name none. A validation error on the EMAIL field is `invalidEmail`.
 */
export function registerErrorCode(code: string | undefined, details?: RawAuth): string | undefined {
  const violations: RawAuth[] = details?.validationError?.fieldViolations ?? [];
  if (violations.some((v) => v?.data?.type === "EMAIL")) return "invalidEmail";
  switch (code) {
    case AUTH_ERROR_CODES.MISSING_CAPTCHA:
      return "missingCaptchaToken";
    case AUTH_ERROR_CODES.EMAIL_EXISTS:
      return "emailAlreadyExists";
    case AUTH_ERROR_CODES.INVALID_CAPTCHA:
      return "invalidCaptchaToken";
    default:
      return undefined;
  }
}

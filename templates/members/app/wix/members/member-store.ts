// Member session state — a module-scope store, deliberately NOT a React context.
// A context can't span Astro islands (each island is its own React root); a module
// singleton is shared by every island in the page bundle, and works identically in a
// single-root SPA. Consume it through useMember() (hooks/), or subscribe directly.
import { fetchCurrentMember } from "./members";
import {
  loggedInHint,
  loginMember,
  logoutMember,
  registerMember,
  verifyMemberEmail,
  type LoginResult,
} from "./auth";
import type { CurrentMember } from "./types";

export interface MemberState {
  member: CurrentMember | null;
  /** True for a logged-in member — can be true with `member` null when the Members Area app is absent. */
  loggedIn: boolean;
  /** True until the first session read settles — render skeletons, not the logged-out state. */
  loading: boolean;
  /** Last failed operation's message — render it; a new operation clears it. */
  error: string | null;
}

const EMPTY: MemberState = {
  member: null,
  loggedIn: false,
  loading: true,
  error: null,
};

let state: MemberState = EMPTY;
const listeners = new Set<() => void>();
let started = false;

function setState(patch: Partial<MemberState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getMemberState(): MemberState {
  return state;
}

/** Adopt an SSR-resolved member (Astro island props) so no client re-fetch happens. */
export function hydrateMember(member: CurrentMember | null): void {
  if (started) return;
  started = true;
  state = { member, loggedIn: member !== null, loading: false, error: null };
}

export function subscribeMember(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber triggers the initial session read (browser only — SSR renders `loading`).
  if (!started && typeof window !== "undefined") {
    started = true;
    void refreshMember();
  }
  return () => listeners.delete(listener);
}

/** Re-read the session — call after anything that may have changed it. */
export async function refreshMember(): Promise<void> {
  setState({ loading: true, error: null });
  const hint = loggedInHint();
  if (hint === false) {
    setState({ member: null, loggedIn: false, loading: false });
    return;
  }
  // hint true → read the profile (null = profile data missing, still logged in).
  // hint null (ambient) → the member read IS the session check: null = anonymous.
  const member = await fetchCurrentMember();
  setState({ member, loggedIn: hint ?? member !== null, loading: false });
}

async function runLogin(
  action: () => Promise<LoginResult>,
): Promise<LoginResult> {
  try {
    const result = await action();
    if (result.state === "SUCCESS") await refreshMember();
    if (result.state === "FAILURE")
      setState({
        error: result.error ?? result.errorCode ?? "Could not log in.",
      });
    return result;
  } catch (e) {
    setState({ error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Submit the branded in-app sign-in form. No Wix-hosted login redirect is used. */
export function login(email: string, password: string): Promise<LoginResult> {
  return runLogin(() => loginMember(email, password));
}

/** Submit the branded in-app sign-up form. */
export function register(
  email: string,
  password: string,
  profile?: { firstName?: string; lastName?: string },
): Promise<LoginResult> {
  return runLogin(() => registerMember(email, password, profile));
}

/** Finish an email-verification branch from the same in-app form. */
export function verifyEmail(code: string): Promise<LoginResult> {
  return runLogin(() => verifyMemberEmail(code));
}

/** Log out (navigates away); local state resets for the instant before the redirect lands. */
export async function logout(returnTo?: string): Promise<void> {
  setState({ member: null, loggedIn: false });
  try {
    await logoutMember(returnTo);
  } catch (e) {
    setState({ error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

// React binding for the member store. Works in any React root — Astro islands (several on
// one page share the same session) and SPAs alike. SSR-friendly: pass a server-resolved
// member as `initialMember` (Astro island props) and no client re-fetch happens.
import { useRef, useSyncExternalStore } from "react";
import {
  getMemberState,
  hydrateMember,
  login,
  register,
  logout,
  refreshMember,
  subscribeMember,
  verifyEmail,
  type MemberState,
} from "../../wix/members/member-store";
import type { LoginResult } from "../../wix/members/auth";
import type { CurrentMember } from "../../wix/members/types";

export interface UseMemberOptions {
  /** Server-resolved member (null = a known-anonymous visitor); omit to resolve client-side. */
  initialMember?: CurrentMember | null;
}

export interface UseMember extends MemberState {
  /** Submit the shipped in-app credential form. */
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (
    email: string,
    password: string,
    profile?: { firstName?: string; lastName?: string },
  ) => Promise<LoginResult>;
  verifyEmail: (code: string) => Promise<LoginResult>;
  /** Log out through the Wix logout flow; navigates away. */
  logout: (returnTo?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMember({ initialMember }: UseMemberOptions = {}): UseMember {
  // Adopt SSR props into the shared store before the first subscription (a no-op once any
  // island has settled the session).
  if (typeof window !== "undefined" && initialMember !== undefined)
    hydrateMember(initialMember);
  const server = useRef<MemberState | null>(null);
  server.current ??=
    initialMember !== undefined
      ? {
          member: initialMember,
          loggedIn: initialMember !== null,
          loading: false,
          error: null,
        }
      : getMemberState();
  const state = useSyncExternalStore(
    subscribeMember,
    getMemberState,
    () => server.current as MemberState,
  );
  return {
    ...state,
    login,
    register,
    verifyEmail,
    logout,
    refresh: refreshMember,
  };
}

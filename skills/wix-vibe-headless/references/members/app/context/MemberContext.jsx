// Member auth state — mirrors the Wix SESSION on the shared client (never a local guess). Wrap the
// app in <MemberProvider>; every component reads useMember(). Login mechanisms (credential/social)
// write member tokens onto @/rest/wix-client via the auth helper; this provider reads that session
// and exposes the current member + logout. Data wiring is correct as-is — do not re-derive it.
//
// NAMED useMember (not useAuth) ON PURPOSE: the Base44 App.jsx already ships a platform
// AuthProvider/useAuth for the builder account — a second `useAuth` would shadow it. This is the
// WIX member session, kept under its own name so the two never collide.
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { isLoggedIn, getCurrentMember, logout as apiLogout } from "@/rest/wix-members-auth";

const MemberContext = createContext(null);

export function MemberProvider({ children }) {
  const [member, setMember] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  // Re-read the session from the shared client. Call after a successful login so the header/account
  // update without a reload. `member` stays null (with loggedIn true) when the Members Area app
  // isn't installed — that's setup, not a bug (see INSTRUCTIONS → identity vs. profile).
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const active = isLoggedIn();
      setLoggedIn(active);
      setMember(active ? await getCurrentMember() : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // logout() clears local tokens then redirects through the Wix logout URL, so it navigates away;
  // we still reset local state first for the instant before the redirect lands.
  const logout = useCallback(async (returnTo) => {
    setMember(null);
    setLoggedIn(false);
    await apiLogout(returnTo);
  }, []);

  return (
    <MemberContext.Provider value={{ member, loggedIn, loading, refresh, logout }}>
      {children}
    </MemberContext.Provider>
  );
}

export function useMember() {
  const ctx = useContext(MemberContext);
  if (!ctx) throw new Error("useMember must be used within <MemberProvider>");
  return ctx;
}

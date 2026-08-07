// Header account control — the members analog of a cart button. Reads useMember() and renders the
// session state: a "Log in" link for a visitor, or the member's name + a log-out button once signed
// in. Drop it into the Header you build (STEP 4), same as the storefront's CartButton. Pure UI reading
// useMember + theme.css tokens — render it as-is; don't wrap it in your own auth logic.
import { Link } from "react-router-dom";
import { useMember } from "@/context/MemberContext";

export default function MemberMenu() {
  const { loggedIn, member, loading, logout } = useMember();

  if (loading) return <span style={{ color: "var(--color-muted)", fontSize: 14 }}>…</span>;

  if (!loggedIn) {
    return (
      <Link to="/login" style={{
        color: "var(--color-primary)", textDecoration: "none", fontSize: 14, fontWeight: 600,
      }}>Log in</Link>
    );
  }

  // member may be null when logged in but the Members Area app isn't installed — fall back to a
  // generic label rather than assuming a profile (see INSTRUCTIONS → identity vs. profile).
  const name = member?.profile?.nickname || member?.contact?.firstName || member?.loginEmail || "Account";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Link to="/account" style={{ color: "var(--color-text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
        {name}
      </Link>
      <button type="button" onClick={() => logout()} style={{
        background: "none", border: "1px solid var(--color-border)", borderRadius: 999,
        padding: "4px 12px", fontSize: 13, cursor: "pointer", color: "var(--color-muted)",
      }}>Log out</button>
    </div>
  );
}

// Header account control — the members analog of a cart button. Reads useMember() and renders the
// session state: a "Log in" link for a visitor, or the member's name + a log-out button once signed
// in. Drop it into the Header you build (STEP 4), same as the storefront's CartButton. Pure UI reading
// useMember + base44 design tokens (shadcn Tailwind classes) — render it as-is; don't wrap it in your own auth logic.
import { Link } from "react-router-dom";
import { useMember } from "@/context/MemberContext";

export default function MemberMenu() {
  const { loggedIn, member, loading, logout } = useMember();

  if (loading) return <span className="text-muted-foreground text-sm">…</span>;

  if (!loggedIn) {
    return (
      <Link to="/login" className="text-primary no-underline text-sm font-semibold">Log in</Link>
    );
  }

  // member may be null when logged in but the Members Area app isn't installed — fall back to a
  // generic label rather than assuming a profile (see INSTRUCTIONS → identity vs. profile).
  const name = member?.profile?.nickname || member?.contact?.firstName || member?.loginEmail || "Account";

  return (
    <div className="flex items-center gap-3">
      <Link to="/account" className="text-foreground no-underline text-sm font-semibold">
        {name}
      </Link>
      <button type="button" onClick={() => logout()}
        className="bg-transparent border border-border rounded-full py-1 px-3 text-[13px] cursor-pointer text-muted-foreground"
      >Log out</button>
    </div>
  );
}

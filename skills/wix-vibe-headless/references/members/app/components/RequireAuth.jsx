// Route gate for member-only surfaces. Wrap any protected element in <RequireAuth> — it renders the
// children only for a logged-in member, otherwise redirects to /login (carrying the attempted path so
// login can return there). This is the gate the shipped Account page uses; reuse it for your own
// member-only routes ("my orders", "my plans", …). Reads useMember; no styling of its own.
import { Navigate, useLocation } from "react-router-dom";
import { useMember } from "@/context/MemberContext";

export default function RequireAuth({ children, fallback = "/login" }) {
  const { loggedIn, loading } = useMember();
  const location = useLocation();

  // Wait for the initial session read before deciding — otherwise a logged-in member gets bounced to
  // /login on first paint while the token check is still resolving.
  if (loading) {
    return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  }
  if (!loggedIn) {
    return <Navigate to={fallback} replace state={{ from: location.pathname }} />;
  }
  return children;
}

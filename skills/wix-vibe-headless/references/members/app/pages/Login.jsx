// Login page (`/login`) — composes the shipped LoginForm (credential state machine) with
// SocialButtons (Google/Facebook redirect). On credential SUCCESS it returns the member to where
// they came from (RequireAuth stashes it in location.state.from) or home. Social login returns via
// /callback instead. Token-styled; re-skin via theme.css — don't rewrite this page to add chrome
// (the Header/Footer live in the Layout).
import { useNavigate, useLocation } from "react-router-dom";
import LoginForm from "@/components/LoginForm";
import SocialButtons from "@/components/SocialButtons";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/";

  return (
    <main style={{
      maxWidth: "var(--form-maxw)", margin: "0 auto", padding: "calc(var(--space) * 2) var(--space)",
      display: "flex", flexDirection: "column", gap: "calc(var(--space) * 1.25)",
    }}>
      <h1 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Welcome</h1>

      <LoginForm onSuccess={() => navigate(from, { replace: true })} />

      <Divider>or</Divider>
      <SocialButtons />
    </main>
  );
}

function Divider({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--color-muted)", fontSize: 13 }}>
      <span style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
      {children}
      <span style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
    </div>
  );
}

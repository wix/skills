// Login page (`/login`) — composes the shipped LoginForm (credential state machine) with
// SocialButtons (Google/Facebook redirect). On credential SUCCESS it returns the member to where
// they came from (RequireAuth stashes it in location.state.from) or home. Social login returns via
// /callback instead. Styled with base44 design tokens (shadcn Tailwind classes) — don't rewrite this page to add chrome
// (the Header/Footer live in the Layout).
import { useNavigate, useLocation } from "react-router-dom";
import LoginForm from "@/components/LoginForm";
import SocialButtons from "@/components/SocialButtons";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/";

  return (
    <main className="max-w-[420px] mx-auto py-8 px-4 flex flex-col gap-5">
      <h1 className="font-display text-center m-0">Welcome</h1>

      <LoginForm onSuccess={() => navigate(from, { replace: true })} />

      <Divider>or</Divider>
      <SocialButtons />
    </main>
  );
}

function Divider({ children }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground text-[13px]">
      <span className="flex-1 h-px bg-border" />
      {children}
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

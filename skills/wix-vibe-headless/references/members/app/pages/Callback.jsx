// Social/SSO callback page — mount at EXACTLY `/callback` (the URL you allow-list on the OAuth app;
// it must match SocialButtons' callbackUri character-for-character). The provider redirects the whole
// page back here with `#code`/`#state` in the hash; completeSocialLogin() verifies state, exchanges
// the code for member tokens, and logs the member in on the shared client. Then refresh the session
// and send them to `returnTo`. Styled with base44 design tokens (shadcn Tailwind classes).
import { useEffect, useState } from "react";
import { completeSocialLogin } from "@/rest/wix-members-auth";
import { useMember } from "@/context/MemberContext";

export default function Callback() {
  const { refresh } = useMember();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    completeSocialLogin()
      .then(async ({ returnTo }) => {
        await refresh();
        if (!cancelled) window.location.replace(returnTo || "/");
      })
      .catch((e) => { if (!cancelled) setError(e.message || "Login failed."); });
    return () => { cancelled = true; };
  }, [refresh]);

  return (
    <main className="p-12 text-center text-muted-foreground">
      {error
        ? <p className="text-destructive" role="alert">{error} <a href="/login" className="text-primary">Try again</a></p>
        : <p>Signing you in…</p>}
    </main>
  );
}

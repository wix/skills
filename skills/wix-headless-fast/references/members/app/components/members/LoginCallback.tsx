// REFERENCE /callback handler — REACT stack only. Mount at exactly CALLBACK_PATH ("/callback");
// ambient Astro never uses it (@wix/astro owns /api/auth/callback itself). Finishes the login
// handshake and sends the member back to where they started.
import { useEffect, useRef, useState } from "react";
import { completeLogin } from "../../wix/members/auth";

export default function LoginCallback() {
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // completeLogin consumes the one-shot OAuth state — never run it twice
    ran.current = true;
    completeLogin()
      .then((returnTo) => window.location.replace(returnTo))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border p-8 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <a href="/" className="mt-4 inline-block text-sm text-muted-foreground underline">
          Back to the site
        </a>
      </div>
    );
  }

  return (
    <p className="py-16 text-center text-muted-foreground" aria-busy="true">
      Signing you in…
    </p>
  );
}

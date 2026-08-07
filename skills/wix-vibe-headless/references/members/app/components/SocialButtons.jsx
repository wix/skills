// "Continue with Google / Facebook" buttons. Social/SSO is a FULL-PAGE redirect: this kicks it off
// with startSocialLogin, which sends the browser to the provider and returns to your /callback route
// (mount Callback there). callbackUri MUST be allow-listed on the OAuth app or Wix rejects it before
// returning — see INSTRUCTIONS (allowedRedirectUris). Token-styled; re-skin via theme.css.
import { startSocialLogin, IDP } from "@/rest/wix-members-auth";

// The exact /callback URL that must be registered as an allowed redirect URI. `returnTo` is where
// the member lands after login — carry the current path so they resume where they started.
function go(idp) {
  const callbackUri = new URL("/callback", window.location.origin).href;
  startSocialLogin(idp, callbackUri, window.location.pathname);
}

export default function SocialButtons() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ProviderButton onClick={() => go(IDP.GOOGLE)}>Continue with Google</ProviderButton>
      <ProviderButton onClick={() => go(IDP.FACEBOOK)}>Continue with Facebook</ProviderButton>
    </div>
  );
}

function ProviderButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: "100%", padding: "11px 16px", cursor: "pointer", fontSize: 15, fontWeight: 600,
      background: "var(--color-bg)", color: "var(--color-text)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
    }}>{children}</button>
  );
}

// "Continue with Google / Facebook" buttons. Social/SSO is a FULL-PAGE redirect: this kicks it off
// with startSocialLogin, which sends the browser to the provider and returns to your /callback route
// (mount Callback there). callbackUri MUST be allow-listed on the OAuth app or Wix rejects it before
// returning — see INSTRUCTIONS (allowedRedirectUris). Styled with base44 design tokens (shadcn Tailwind classes).
import { startSocialLogin, IDP } from "@/rest/wix-members-auth";

// The exact /callback URL that must be registered as an allowed redirect URI. `returnTo` is where
// the member lands after login — carry the current path so they resume where they started.
function go(idp) {
  const callbackUri = new URL("/callback", window.location.origin).href;
  startSocialLogin(idp, callbackUri, window.location.pathname);
}

export default function SocialButtons() {
  return (
    <div className="flex flex-col gap-2.5">
      <ProviderButton onClick={() => go(IDP.GOOGLE)}>Continue with Google</ProviderButton>
      <ProviderButton onClick={() => go(IDP.FACEBOOK)}>Continue with Facebook</ProviderButton>
    </div>
  );
}

function ProviderButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full py-[11px] px-4 cursor-pointer text-[15px] font-semibold bg-background text-foreground border border-border rounded-sm"
    >{children}</button>
  );
}

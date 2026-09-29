// The members auth seam — no client of its own. It reuses the shared seam in ../sdk, so the member
// identity and the app's data identity are the same thing:
//
//   ambient (WIX_CLIENT_ID null — a Wix-managed Astro project): `membersAuth` is null. The raw
//     `members` module is authenticated by `@wix/astro` in islands and on the server, and the
//     credential flow runs through the integration's built-in routes (/api/auth/login, /signup,
//     /verify-email, /logout, /callback — see ./auth.ts), which write the member session cookie
//     server-side (HttpOnly). Nothing here touches cookies or tokens.
//
//   manual (WIX_CLIENT_ID set — a Vite SPA, another framework): `membersAuth` is the shared
//     client's OAuthStrategy. login/register/verify run on it in the browser and the one-shot
//     session token is exchanged for member tokens that the SAME strategy persists — so the cart,
//     the member's own records, everything the app reads, runs as the member from then on.
//
// Copy as-is; never instantiate another client, never one per component.
import type { IOAuthStrategy } from "@wix/sdk";
import { members } from "@wix/members";
import { wixAuth, wixModule } from "../sdk";

/** The manual-mode auth strategy (the shared client's); null under ambient auth, where the routes own the session. */
export const membersAuth: IOAuthStrategy | null = wixAuth();

/** True in a Wix-managed Astro project: the built-in auth routes carry the credential flow. */
export const AMBIENT_AUTH = membersAuth === null;

/** The members module under the app's auth, either mode. */
export const membersApi: typeof members = wixModule(members);

// Wix connection config — written by the skill's deploy step (install/deploy.mjs).
//
// WIX_CLIENT_ID = null  → ambient auth (a Wix-managed Astro project: `@wix/astro` authenticates
//                         every SDK call automatically; there is no client and nothing to set).
// WIX_CLIENT_ID = "..." → manual visitor client (any other React setup): the public OAuth client id.
//                         It is NOT a secret — it only mints anonymous visitor tokens — so
//                         hardcoding and committing it is fine. On a Wix-managed non-Astro project
//                         it equals the `appId` in wix.config.json.
export const WIX_CLIENT_ID: string | null = null;

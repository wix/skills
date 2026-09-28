// Wix connection config — written by the skill's deploy step (install/deploy.mjs).
//
// WIX_CLIENT_ID = null  → ambient auth (a Wix-managed Astro project: `@wix/astro` authenticates
//                         every SDK call automatically; there is no client and nothing to set).
// WIX_CLIENT_ID = "..." → manual visitor client (any other React setup): the public OAuth client id.
//                         It is NOT a secret — it only mints anonymous visitor tokens — so
//                         hardcoding and committing it is fine. deploy.mjs copies it from `.env.local`
//                         (`WIX_CLIENT_ID`, what `wix env pull` writes): the CONTENT site's app — on a
//                         migration preview the site being migrated, while wix.config.json names
//                         only the deploy target.
export const WIX_CLIENT_ID: string | null = null;

// Kept for projects deployed before the Members vertical moved onto the shared seam; the shipped
// members code no longer reads it (ambient Astro uses the built-in /api/auth routes, manual mode
// uses the shared client above). deploy.mjs still fills it so older code keeps compiling.
export const WIX_MEMBERS_CLIENT_ID: string | null = null;

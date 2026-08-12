# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured; use it for all admin API calls.

Your Wix client id is in your prompt — a public, buyer-facing credential (anonymous visitor tokens
only), safe in the frontend; use it directly for the Wix client setup.

> **`wix-vibe-headless` and `wix-docs` are the complete build and seed path for this app — the Wix connector supplies the token for admin API calls.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

Follow STEPs 1–5 below exactly (run STEP 4 in parallel with STEP 3).

## STEP 1 — Install the Wix skills locally

Install two skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — the client build **and** seed guide (STEPs 3–4): your main source of
  truth. Seeding lives here too, per-vertical under `references/<vertical>/seed/`.
- **`wix-docs`** — a **fallback**: search + read the Wix API docs for anything `wix-vibe-headless`
  doesn't cover.

Install via the skills CLI — run this through exec_tool, exactly as written. It installs the two
skills, then runs `deploy.cjs <vertical…> --client-id … --metasite-id …` (lays the shared transport +
**each** listed vertical's REST scaffolds and UI client into `src/`, writes `wix-config.js` from
those two ids and proves the client id against Wix) and `pin-agents-md.cjs` (pins the project's AGENTS.md
note so later turns keep the rules).

**Set `VERTICALS`** to what the prompt asks for (too vague to tell? do STEP 2 first, then set it):

| vertical | pick it when the app needs to |
|---|---|
| `storefront` | sell products |
| `bookings` | take appointments or service bookings |
| `blog` | publish articles |
| `events` | publish events with RSVPs or ticket sales |
| `portfolio` | showcase creative work |
| `pricing-plans` | sell memberships or subscriptions |
| `restaurants` | show a menu, take orders, book tables |
| `members` | let visitors sign in — this is **auth** |
| `cms` | keep its own structured content — user submissions, galleries, listings, anything the rows above don't already cover |

**List every vertical the app actually uses** — one is the common case, and name more when the intent
spans them, so all their scaffolds come from the skill rather than being written by hand. Anything the
app stores itself needs `cms`, and anything where visitors sign in needs `members`, so those two often
join whichever vertical is the main one. Adding one later is fine too: re-run with the extra name (the
copy only fills in missing files).

```js
const { execSync } = require('child_process');
const { readdirSync } = require('fs');
const VERTICALS = ['storefront'];        // ← set from the prompt; list every vertical the app uses
// const VERTICALS = ['members', 'cms']; // ← e.g. visitors sign in AND the app stores what they submit
// COPY these two straight from the prompt — deploy writes them into src/rest/wix-config.js and proves
// the client id against Wix, so never retype either one into a file by hand afterwards.
const WIX_CLIENT_ID = '<client id from the prompt>';
const WIX_METASITE_ID = '<site id from the prompt>';
const results = {};
for (const skill of ['wix-vibe-headless', 'wix-docs']) {
  try {
    const out = execSync(`CI=1 npx -y skills add wix/skills/skills/${skill} --yes 2>&1`,
      { cwd: '/app', timeout: 60000, shell: '/bin/bash' }).toString().replace(/\x1b\[[0-9;]*m/g, '');
    results[skill] = /installed 1 skill|found 1 skill/i.test(out) ? 'success'
      : out.includes('No valid skills') ? 'not_found' : 'unknown';
  } catch (e) { results[skill] = 'error: ' + e.message; }
}
// Deploy the shared transport + each listed vertical's scaffolds/UI into src/, and write+verify
// wix-config.js. A rejected client id exits non-zero here — fix the id, don't carry on.
const deploy = execSync(`node /app/.agents/skills/wix-vibe-headless/install/deploy.cjs ${VERTICALS.join(' ')} --client-id ${WIX_CLIENT_ID} --metasite-id ${WIX_METASITE_ID}`, { cwd: '/app' }).toString();
// Pin the project's AGENTS.md note (idempotent) so the rules survive after this doc leaves context.
const agentsMd = execSync(`node /app/.agents/skills/wix-vibe-headless/install/pin-agents-md.cjs`, { cwd: '/app' }).toString();
return { results, installed: readdirSync('/app/.agents/skills'), deploy: JSON.parse(deploy), agentsMd: JSON.parse(agentsMd) };
```

Read the skills with **`read_file`** (rooted at `/app` → workspace-relative path, e.g.
`.agents/skills/wix-vibe-headless/SKILL.md`; absolute `/app/...` fails — exec_tool/shell wants
absolute). Prefer it over `cat`/exec_tool and web-fetch, which cap output (~5000 chars) and
truncate. Always read from **`.agents/skills/` exactly**, on later turns too — don't guess; ignore
stray copies like `agent/skills/`.

## STEP 2 (optional) — Brief doesn't say what to build? Read the site

Only when the business description is vague or missing (else skip to STEP 3). Don't guess the Wix
Business Solution — **read the site in one call** via the connector (exec_tool):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const res = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ siteId: "<metasite id from your prompt>" }),
});
return (await res.json()).markdown;
```

It returns a markdown report — installed apps (by name), status, URL, locale, CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md)).
Build for the installed apps' solutions (several → prioritize by the user's words and which holds
real, non-sample content); the same output drives STEP 4's seeding — never seed guessed ones. If it
fails or shows nothing relevant, ask the user what they offer.

## STEP 3 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **EXACTLY** — the single source of
truth for how the client is built.

**REST scaffolds are already in `src/rest/`** (STEP 1), `wix-config.js` among them — STEP 1 wrote both
ids into it and proved the client id, so there is nothing to write or re-check here. Some
verticals also ship a **ready UI client** under `src/` (STEP 1 deployed it) — theme + wire it per
`INSTRUCTIONS.md`, don't rebuild. STEP 1 already deployed these files — **don't `read_file` the
deployed component/page source to inspect them**; every field shape is in `INSTRUCTIONS.md`. Read a
deployed file only on a real fallback (an error, or a field the snippets don't cover).

**`src/App.jsx`: edit surgically, never rewrite.** It carries required platform auth scaffolding
(`AuthProvider`/`useAuth` from `@/lib/AuthContext`); a full rewrite drops them → the validator
rejects the write. Wire routes/imports in with `find_replace`, leave the rest as-is.

## STEP 4 — Manage and seed the business

**Never delete or clean up anything on the user's site — seeding is additive only.** It's a live
user-owned business, so never delete or overwrite existing content, even apparent sample data. If a
cleanup truly seems needed, ask the user first.

Seed by calling your vertical's ready-made seed module — read
`.agents/skills/wix-vibe-headless/references/<vertical>/seed/SEED.md` and load its `seed-*.js` via
its loader snippet (build-time exec_tool); call its functions with your data. Gaps or an unexpected
shape → the **`wix-docs`** skill.

**Auth for these admin calls is the already-configured Wix connector — nothing else.** Get its
access token and send it as a bearer token; do **not** hand-roll a token getter (e.g.
`getAdminToken()`), install/run the Wix CLI (`@wix/cli`), or device-login (no managed-project auth
flow applies to Base44):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
// then: fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, ... })
```

Inline via exec_tool, `base44` is already declared — use it directly; do **not** import
`@base44/sdk`, re-declare it, or call `createClient()` (that's for standalone `.js` files only;
inline it throws *"Identifier 'base44' has already been declared."*).

**Entity images.** For image-bearing entities (store products, blog covers, bookings services,
restaurant items, portfolio projects, event heroes, CMS items), generate with **Base44's built-in
image generation**, then attach via the vertical seed module's image-attach step — `wix-docs` if the
module doesn't cover that entity.

**Seed images with the FINAL url, in one call.** Seeding writes to Wix, so use the real
`https://media.base44.com/...` url from the **completed** `generate_image` result and pass it straight
into your single `setupStore`/seed call (images included). A still-generating `/__generating__/<id>.png`
placeholder is not a real url — Wix can't fetch it. `generate_image` runs in the background while you
build the client, so the urls are ready by the time you seed.

The connector + seeding are **admin-only** (STEP 4) — **not** part of the client, which is built
solely per the `wix-vibe-headless` skill.

## Parallelism

Run STEP 3 and STEP 4 in parallel — building and seeding are independent. Within each, also
parallelize independent work (API calls, multiple entities).

## STEP 5 — Wrap up

Once the site is built and seeded:

1. **Mount the preview-only manage banner** (required; links the app to its Wix back office; shipped,
   self-gates to the preview, never on the published site): render the `<WixManageBanner/>` component
   in your Layout's fixed top region, above the header, per your vertical's INSTRUCTIONS STEP 4.
2. **Ask the user to open** `https://manage.wix.com/dashboard/{metaSiteId}` (substitute your
   metasite id) to complete setup in Wix (required), and mention that the preview shows a dismissible
   top banner linking to this same dashboard.

**Preview briefly, don't chase images.** A quick render check is enough. Generated images show as
alt-text/broken in this preview because `generate_image` returns a `/__generating__/…` placeholder —
the platform swaps every placeholder for the final url **automatically at the end of the turn**
(failed ones get a stock fallback), in your own components and the seeded data alike. So a broken
image in the preview is expected and already handled: **do NOT swap, re-seed, re-attach, or debug
image urls.** Hand-editing a placeholder `src` is wasted work and just risks find_replace errors on
urls that are about to be replaced anyway. Leave them and finish.

## Later admin requests

For any later admin/management request, work as in STEP 4: your vertical's seed module first, else
`wix-docs` — all over the connector.

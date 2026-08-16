# Wix Managed Headless — Base44 build instructions (client only)

You are building a **Wix Managed** headless site inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured; use it for all admin API calls.

Your Wix client id is in your prompt — a public, buyer-facing credential (anonymous visitor tokens
only), safe in the frontend; use it directly for the Wix client setup.

> **`wix-vibe-headless` and `wix-docs` are the complete build path for this app.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).** **This flow builds the client only — there is no seeding step.**

Follow STEPs 1–4 below exactly.

## STEP 1 — Install the Wix skills locally

Install two skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — the client build guide (STEP 3): your main source of truth.
- **`wix-docs`** — a **fallback**: search + read the Wix API docs for anything `wix-vibe-headless`
  doesn't cover.

Run this through exec_tool, exactly as written — installs both skills, deploys REST scaffolds + UI into `src/`, writes `wix-config.js`, and pins the AGENTS.md note.

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

**List every vertical the app uses.** `cms` for app-stored content, `members` for visitor sign-in — these often join the main vertical. Adding one later: re-run with the extra name.

```js
const { execSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const VERTICALS = ['storefront'];        // ← set from the prompt; list every vertical the app uses
// const VERTICALS = ['members', 'cms']; // ← e.g. visitors sign in AND the app stores what they submit
// COPY these two straight from the prompt — deploy writes them into src/rest/wix-config.js, so never
// retype either one into a file by hand afterwards.
const WIX_CLIENT_ID = '<client id from the prompt>';
const WIX_METASITE_ID = '<site id from the prompt>';
const results = {};
for (const skill of ['wix-vibe-headless', 'wix-docs']) {
  if (existsSync(`/app/.agents/skills/${skill}/SKILL.md`)) { results[skill] = 'already_installed'; continue; }
  try {
    const out = execSync(`CI=1 npx -y skills add wix/skills/skills/${skill} --yes 2>&1`,
      { cwd: '/app', timeout: 60000, shell: '/bin/bash' }).toString().replace(/\x1b\[[0-9;]*m/g, '');
    results[skill] = /installed 1 skill|found 1 skill/i.test(out) ? 'success'
      : out.includes('No valid skills') ? 'not_found' : 'unknown';
  } catch (e) { results[skill] = 'error: ' + e.message; }
}
const deploy = execSync(`node /app/.agents/skills/wix-vibe-headless/install/deploy.cjs ${VERTICALS.join(' ')} --client-id ${WIX_CLIENT_ID} --metasite-id ${WIX_METASITE_ID}`, { cwd: '/app' }).toString();
const agentsMd = execSync(`node /app/.agents/skills/wix-vibe-headless/install/pin-agents-md.cjs`, { cwd: '/app' }).toString();
return { results, installed: readdirSync('/app/.agents/skills'), deploy: JSON.parse(deploy), agentsMd: JSON.parse(agentsMd) };
```

Read skills with **`read_file`** using workspace-relative paths (e.g. `.agents/skills/wix-vibe-headless/SKILL.md`) — absolute `/app/...` fails. Always read from `.agents/skills/` exactly on every turn; ignore stray copies like `agent/skills/`.

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
real, non-sample content). If it fails or shows nothing relevant, ask the user what they offer.

## STEP 3 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **EXACTLY** — the single source of
truth for how the client is built.

**REST scaffolds + `wix-config.js` are already in `src/rest/`** (STEP 1 wrote them). Some verticals also ship a ready UI client in `src/` — theme + wire it per `INSTRUCTIONS.md`, don't rebuild. **Don't `read_file` deployed files** — every field shape is in `INSTRUCTIONS.md`; read one only on a real error or gap.

**`src/App.jsx`: edit surgically, never rewrite.** It carries required platform auth scaffolding
(`AuthProvider`/`useAuth` from `@/lib/AuthContext`); a full rewrite drops them → the validator
rejects the write. Wire routes/imports in with `find_replace`, leave the rest as-is.

## STEP 4 — Wrap up

**No seeding in this flow** — the client is the only deliverable. Do not seed, populate, or write data to Wix.

**Do NOT add the `<WixManageBanner/>` component** and do not send the user Wix dashboard links — this flow does not include the manage banner or back-office handoff.

**Preview briefly, don't chase images.** Broken images are expected — `generate_image` returns a `/__generating__/…` placeholder that the platform swaps for the final url automatically at turn end (failures get a stock fallback). **Do NOT edit, re-seed, or debug image urls.** Leave them and finish.

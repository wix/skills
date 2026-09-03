# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured; use it for all admin API calls.

Your Wix client id is in your prompt — a public, buyer-facing credential (anonymous visitor tokens
only), safe in the frontend; use it directly for the Wix client setup.

> **The Wix skills installed below are the complete build and seed path for this app — the Wix connector supplies the token for admin API calls.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

Follow STEPs 1–5 below exactly (run STEP 4 in parallel with STEP 3 — **except `forms`**, see STEP 3).

## STEP 1 — Install the Wix skills locally

Install three skills under `.agents/skills/`: **`wix-vibe-headless`** (the client build + seed guide — your main source of truth), **`wix-manage`** (REST recipes to manage/configure the site), and **`wix-base44-connector`** (site context + API-doc discovery, the fallback for anything the others don't cover).

Run this through exec_tool, exactly as written — installs all three skills, deploys REST scaffolds + UI into `src/`, writes `wix-config.js`, and pins the AGENTS.md note.

**Set `VERTICALS`** to what the prompt asks for — **list every vertical the app uses**, since several often join the main one (too vague to tell? do STEP 2 first, then set it). Adding one later: re-run with the extra name.

| vertical | pick it when the app needs to |
|---|---|
| `storefront` | sell products |
| `bookings` | take appointments or service bookings |
| `rentals` | rent out an item for a length the customer picks (by the hour or by the day) |
| `blog` | publish articles |
| `events` | publish events with RSVPs or ticket sales |
| `portfolio` | showcase creative work |
| `pricing-plans` | sell memberships or subscriptions, incl. paid enrollment/access to an online course or program — but an "online store selling courses" is still `storefront` |
| `restaurants` | show a menu, take orders, book tables |
| `members` | let visitors sign in — this is **auth** |
| `forms` | any visitor-fillable form: contact, signup, waitlist, application, survey, quote request (an event RSVP is `events`; a per-service booking form is `bookings`) |
| `cms` | structured content the app reads back — galleries, listings, "my submissions" (a visitor-fillable form is `forms`) |

```js
const { execSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const VERTICALS = ['storefront'];         // ← set from the prompt; list every vertical the app uses (e.g. ['members','cms'])
const WIX_CLIENT_ID = '<client id from the prompt>';   // copy both from the prompt — deploy writes them into src/rest/wix-config.js
const WIX_METASITE_ID = '<site id from the prompt>';
const results = {};
for (const skill of ['wix-vibe-headless', 'wix-manage', 'wix-base44-connector']) {
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
real, non-sample content); the same output drives STEP 4's seeding — never seed guessed ones. If it
fails or shows nothing relevant, ask the user what they offer.

## STEP 3 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **EXACTLY** — the single source of
truth for how the client is built.

**REST scaffolds + `wix-config.js` are already in `src/rest/`** (STEP 1 wrote them). Some verticals also ship a ready UI client in `src/` — theme + wire it per `INSTRUCTIONS.md`, don't rebuild. **Don't `read_file` deployed files** — every field shape is in `INSTRUCTIONS.md`; read one only on a real error or gap.

**⚠️ `forms` is the ONE vertical that does NOT run in parallel with STEP 4** — its UI is gated on a
file the seed writes. Read its `INSTRUCTIONS.md` **Prerequisites** before building any form UI; seed
it first (STEP 4) and build the rest of the app meanwhile.

**`src/App.jsx`: edit surgically, never rewrite.** It carries required platform auth scaffolding
(`AuthProvider`/`useAuth` from `@/lib/AuthContext`); a full rewrite drops them → the validator
rejects the write. Wire routes/imports in with `find_replace`, leave the rest as-is.

## STEP 4 — Manage and seed the business

Seed by calling your vertical's ready-made seed module — read
`.agents/skills/wix-vibe-headless/references/<vertical>/seed/SEED.md` and follow it (the loader
snippet, admin connector token, entity images with the final `media.base44.com` url, and every field
shape are there). Gaps or an unexpected shape → the **`wix-base44-connector`** skill's doc discovery.
Seeding is **admin-only** — not part of the client, which is built solely per the `wix-vibe-headless` skill.

- **Additive only:** never delete or overwrite the user's content, even apparent sample data; ask first if a cleanup truly seems needed.
- Inline in exec_tool, `base44` is already declared — use it directly; do **not** `import @base44/sdk`, re-declare it, or call `createClient()` (throws *"Identifier 'base44' has already been declared."*).

## STEP 5 — Wrap up

1. **Mount `<WixManageBanner/>`** (required) in your Layout's fixed top region, above the header, per your vertical's INSTRUCTIONS — it links the app to its Wix back office, self-gates to the preview, and never shows on the published site.
2. **Ask the user to open** `https://manage.wix.com/dashboard/{metaSiteId}` (your metasite id) to complete setup in Wix.

**Don't chase images.** A `/__generating__/…` placeholder is swapped for the final url automatically at turn end — do **not** edit, re-seed, or debug image urls.

## Later admin requests

For any later admin/management request, work as in STEP 4: your vertical's seed module first, else
`wix-base44-connector` doc discovery — all over the connector.

version: v1341

# Wix Managed Headless — Base44 storefront client + seed

You are building a **Wix Managed** headless storefront inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured.

Your Wix client id is in your prompt — a public, buyer-facing credential (anonymous visitor tokens
only), safe in the frontend; use it directly for the Wix client setup.

> **The Wix skills installed below are the complete build and seed path for this app.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

Follow STEPs 1–4 below exactly (run STEP 3 in parallel with STEP 2).

## STEP 1 — Install the Wix skills and deploy the storefront vertical to the app

Install three skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — the storefront build + seed guide (STEPs 2–3): your main source of truth.
- **`wix-manage`** — REST recipes for managing and configuring the site (install apps, seed
  catalogs, business setup).
- **`wix-base44-connector`** — building on Wix from the Base44 sandbox: site context, API
  contracts, and the docs **fallback** — find + read the Wix API docs for anything
  `wix-vibe-headless` doesn't cover.

Run this through exec_tool, exactly as written — installs all three skills, deploys the `storefront` REST scaffolds + UI into `src/`, and pins the AGENTS.md note.

```js
const { execSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
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
const deploy = execSync(`node /app/.agents/skills/wix-vibe-headless/install/deploy.cjs storefront`, { cwd: '/app' }).toString();
const agentsMd = execSync(`node /app/.agents/skills/wix-vibe-headless/install/pin-agents-md.cjs`, { cwd: '/app' }).toString();
return { results, installed: readdirSync('/app/.agents/skills'), deploy: JSON.parse(deploy), agentsMd: JSON.parse(agentsMd) };
```

Read skills with **`read_file`** using workspace-relative paths (e.g. `.agents/skills/wix-vibe-headless/SKILL.md`) — absolute `/app/...` fails. Always read from `.agents/skills/` exactly on every turn; ignore stray copies like `agent/skills/`.

## STEP 2 — Build the client

Read `.agents/skills/wix-vibe-headless/references/storefront/INSTRUCTIONS.md` and follow it **EXACTLY** — the single source of truth for how the storefront client is built.

**REST scaffolds are already in `src/rest/`** (STEP 1 deployed them). The storefront also ships a ready UI client in `src/` — theme + wire it per `INSTRUCTIONS.md`, don't rebuild. **Don't `read_file` deployed files** — every field shape is in `INSTRUCTIONS.md`; read one only on a real error or gap.

**`src/App.jsx`: edit surgically, never rewrite.** It carries required platform auth scaffolding
(`AuthProvider`/`useAuth` from `@/lib/AuthContext`); a full rewrite drops them → the validator
rejects the write. Wire routes/imports in with `find_replace`, leave the rest as-is.

## STEP 3 — Seed the storefront

**Never delete or clean up anything on the user's site — seeding is additive only.** It's a live
user-owned business, so never delete or overwrite existing content, even apparent sample data. If a
cleanup truly seems needed, ask the user first.

Seed by calling the storefront's ready-made seed module — read
`.agents/skills/wix-vibe-headless/references/storefront/seed/SEED.md` and load its `seed-*.js` via
its loader snippet (build-time exec_tool); call its functions with your data. Gaps or an unexpected
shape → the **`wix-base44-connector`** skill's doc discovery.

**Auth for these admin calls is the already-configured Wix headless connector — nothing else.** Get its
access token and send it as a bearer token:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
// then: fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, ... })
```

Inline via exec_tool, `base44` is already declared — use it directly; do **not** import
`@base44/sdk`, re-declare it, or call `createClient()` (that's for standalone `.js` files only;
inline it throws *"Identifier 'base44' has already been declared."*).

**Product images.** Generate with **Base44's built-in image generation**, then attach via the
storefront seed module's image-attach step — `wix-base44-connector` doc discovery if the module
doesn't cover it.

**Seed images with the FINAL url, in one call.** Use the real `https://media.base44.com/...` url
from the **completed** `generate_image` result and pass it straight into your single `setupStore`
call (images included). A still-generating `/__generating__/<id>.png` placeholder is not a real url
— Wix can't fetch it. `generate_image` runs in the background while you build the client, so the
urls are ready by the time you seed.

## STEP 4 — Wrap up

**Do NOT add the `<WixManageBanner/>` component** and do not send the user Wix dashboard links — this flow does not include the manage banner or back-office handoff.

**Preview briefly, don't chase images.** Broken images are expected — `generate_image` returns a `/__generating__/…` placeholder that the platform swaps for the final url automatically at turn end (failures get a stock fallback). **Do NOT edit or debug image urls.** Leave them and finish.

## Later admin requests

When the user asks for follow-up changes (next iterations), use the already-connected Wix headless connector — get an access token and call the Wix API directly:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const res = await fetch("https://www.wixapis.com/<api-path>", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ /* request body */ }),
});
return await res.json();
```

`base44` is already declared inline in exec_tool — use it directly; do **not** import `@base44/sdk` or call `createClient()`. For what to call, check the storefront seed module (`.agents/skills/wix-vibe-headless/references/storefront/seed/SEED.md`) or look up the endpoint via the `wix-base44-connector` skill's doc discovery.

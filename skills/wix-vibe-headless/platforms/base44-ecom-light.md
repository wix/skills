# Wix Managed Headless — Base44 storefront client

You are building a **Wix Managed** headless storefront inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured.

Your Wix client id is in your prompt — a public, buyer-facing credential (anonymous visitor tokens
only), safe in the frontend; use it directly for the Wix client setup.

> **`wix-vibe-headless` and `wix-docs` are the complete build path for this app.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).** **This flow builds the client only — there is no seeding step.**

Follow STEPs 1–3 below exactly.

## STEP 1 — Install the Wix skills and deploy the storefront vertical to the app

Install two skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — the storefront build guide (STEP 2): your main source of truth.
- **`wix-docs`** — a **fallback**: search + read the Wix API docs for anything `wix-vibe-headless`
  doesn't cover.

Run this through exec_tool, exactly as written — installs both skills, deploys the `storefront` REST scaffolds + UI into `src/`, and pins the AGENTS.md note.

```js
const { execSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
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

## STEP 3 — Wrap up

**No seeding in this flow** — the client is the only deliverable. Do not seed, populate, or write data to Wix.

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

`base44` is already declared inline in exec_tool — use it directly; do **not** import `@base44/sdk` or call `createClient()`. For what to call, check the storefront seed module (`.agents/skills/wix-vibe-headless/references/storefront/seed/SEED.md`) or look up the endpoint via `wix-docs`.

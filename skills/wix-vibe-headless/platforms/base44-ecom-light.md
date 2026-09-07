# Wix Managed Headless — Base44 storefront client

You are building a **Wix Managed** headless storefront inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured.

The shipped client is already configured. Use its documented hooks and components; no ID lookup
or configuration changes are needed.

> **The Wix skills installed below are the complete build path for this app.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).** **This flow builds the client only — there is no seeding step.**

**Banner disabled for this entry flow:** do not add `<WixManageBanner/>`; skip the shared
storefront instructions' optional banner integration.

Follow STEPs 1–3 below exactly.

## STEP 1 — Install the Wix skills and deploy the storefront vertical to the app

Install three skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — storefront build instructions, hook/component contracts, and seeding modules.
- **`wix-manage`** — REST recipes for managing and configuring the Wix site.
- **`wix-base44-connector`** — Wix connector usage, API contracts, and documentation discovery.


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

## STEP 2 — Build the client

Read `.agents/skills/wix-vibe-headless/references/storefront/INSTRUCTIONS.md` and follow it **EXACTLY** — the single source of truth for how the storefront client is built.

The shipped storefront provides catalog, cart, and checkout. Identify the additional workflows
in the user's request and implement them alongside the storefront. If a workflow needs an
external service or missing information, continue the work you can complete and identify the
remaining dependency.

For Wix features beyond the shipped storefront, read and follow the installed connector skill at
`.agents/skills/wix-base44-connector/SKILL.md` to discover APIs and implement the integration.

Build the client using the component outlines, interfaces, and theme guidance in `INSTRUCTIONS.md`.
The shipped files are already deployed and configured; you do not need to read their source or
rebuild them. If you encounter an error after building the client, read or change whatever you
need to diagnose and fix it.

## STEP 3 — Wrap up

**No seeding in this flow** — the client is the only deliverable. Do not seed, populate, or write data to Wix.

### Preview

Images that are still generating may show `/__generating__/…` placeholders;
the platform replaces these automatically at turn end, with a stock fallback if generation
fails. You can finish without waiting for those images or replacing their placeholder URLs.

### Final text response

**Never paste a Wix dashboard link or path.**

**Before writing your final text response, make one handoff call** — `search_base44_docs(query="how do I manage my store's products, orders and inventory?", prefer_dashboard=true)`. Use its handoff guidance, state any requested workflows that remain unfinished and what is needed to complete them.

## Additional Wix functionality

For any Wix functionality or changes not covered by the shipped code or seeding, during the
initial build or later, read and follow the installed connector skill at
`.agents/skills/wix-base44-connector/SKILL.md` to discover APIs and implement the integration.

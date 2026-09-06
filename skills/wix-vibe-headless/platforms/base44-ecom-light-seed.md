# Wix Managed Headless — Base44 storefront client + seed

You are building a **Wix Managed** headless storefront inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured.

The shipped client is already configured. Use its documented hooks and components; no ID lookup
or configuration changes are needed.

> **The installed Wix skills are the complete build and seed path for this app.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

**Banner disabled for this entry flow:** do not add `<WixManageBanner/>`; skip the shared
storefront instructions' optional banner integration.

## STEP 0 — Setup already completed by Base44

These skills are already installed under `.agents/skills/`:
- **`wix-vibe-headless`** — storefront build instructions, hook/component contracts, and seeding modules.
- **`wix-manage`** — REST recipes for managing and configuring the Wix site.
- **`wix-base44-connector`** — Wix connector usage, API contracts, and documentation discovery.

Base44 has also deployed the storefront hooks, cart components/context, image helpers, and REST
scaffolds into `src/`, configured the Wix connector/client, and added the Wix note to `AGENTS.md`.
No installation, deployment, or AGENTS.md update is needed.
The deployed implementation and configuration files do not need to be read; use the build and seed
guides below for their contracts and usage. Continue with STEP 1.

Follow STEPs 1–3 below exactly (run STEP 2 in parallel with STEP 1).

Read skills with **`read_file`** using workspace-relative paths (e.g. `.agents/skills/wix-vibe-headless/SKILL.md`) — absolute `/app/...` fails. Always read from `.agents/skills/` exactly on every turn; ignore stray copies like `agent/skills/`.

## STEP 1 — Build the client

Read `.agents/skills/wix-vibe-headless/references/storefront/INSTRUCTIONS.md` and follow it **EXACTLY** — the single source of truth for how the storefront client is built.

**Base44 setup has already deployed the REST scaffolds in `src/rest/` and shipped storefront files in `src/`.** Don't read or inspect the shipped files' source to confirm structure, and don't rebuild the shipped client. After reading `INSTRUCTIONS.md`, use its component outlines, interfaces, and theme guidance to build your presentation and wire it directly. Only read a shipped file if you can name a specific interface detail missing from the guide or need to diagnose an observed runtime error. Limit the read to the file relevant to that issue.

## STEP 2 — Seed the storefront

**Never delete or clean up anything on the user's site — seeding is additive only.** It's a live
user-owned business, so never delete or overwrite existing content, even apparent sample data. If a
cleanup truly seems needed, ask the user first.

Seed by calling the storefront's ready-made seed module — read
`.agents/skills/wix-vibe-headless/references/storefront/seed/SEED.md` and load its `seed-*.js` via
its loader snippet (build-time exec_tool); call its functions with your data. Gaps or an unexpected
shape → the documentation skill available in your environment.

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
storefront seed module's image-attach step.

**Seed images with the FINAL url, in one call.** Use the real `https://media.base44.com/...` url
from the **completed** `generate_image` result and pass it straight into your single `setupStore`
call (images included). `generate_image` runs in the background while you build the client, so the
urls are ready by the time you seed.

## STEP 3 — Wrap up

### Preview

**Preview briefly, don't chase images.** Broken images are expected — `generate_image` returns a `/__generating__/…` placeholder that the platform swaps for the final url automatically at turn end (failures get a stock fallback). **Do NOT edit or debug image urls.** Leave them and finish.

### Final text response

**Never paste a Wix dashboard link or path.**

**Before writing your final text response, make one handoff call** — `search_base44_docs(query="how do I manage my store's products, orders and inventory?", prefer_dashboard=true)`. It comes back telling you what to say; add only that the catalog you seeded is mock data they can edit, replace or delete.

## Follow-up changes and additional Wix features

For follow-up Wix requests or features not covered by the shipped storefront, read and follow the
already-installed `wix-base44-connector` skill at `.agents/skills/wix-base44-connector/SKILL.md`.
It covers building on the connected Wix site: gathering site context, discovering APIs and their
contracts, choosing visitor or admin authentication, and writing frontend and backend code, as
well as management and configuration. Use it to research and implement these changes.

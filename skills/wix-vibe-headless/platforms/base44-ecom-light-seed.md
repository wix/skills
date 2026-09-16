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

Follow STEPs 1–3 below exactly. Fire product image generations first, then build the client
(STEP 1), and seed (STEP 2) **after** the client is built — generation finishes while you build.

## STEP 1 — Build the client

Read `.agents/skills/wix-vibe-headless/references/storefront/INSTRUCTIONS.md` and follow it **EXACTLY** — the single source of truth for how the storefront client is built.

The shipped storefront provides catalog, cart, and checkout. Identify the additional workflows
in the user's request and implement them alongside the storefront. If a workflow needs an
external service or missing information, continue the work you can complete and identify the
remaining dependency.

For code or actions not covered by this skill, read and follow the installed connector skill at
`.agents/skills/wix-base44-connector/SKILL.md` to find Wix documentation and APIs.

Build the client using the component outlines, interfaces, and theme guidance in `INSTRUCTIONS.md`.
The shipped files are already deployed and configured; you do not need to read their source or
rebuild them. If you encounter an error after building the client, read or change whatever you
need to diagnose and fix it.

## STEP 2 — Seed the storefront

**Never delete or clean up anything on the user's site — seeding is additive only.** It's a live
user-owned business, so never delete or overwrite existing content, even apparent sample data. If a
cleanup truly seems needed, ask the user first.

Seed by calling the storefront's ready-made seed module, `seed-store.cjs` — `require()` it and use its
one-call `setupStore` (build-time exec_tool). Read
`.agents/skills/wix-vibe-headless/references/storefront/seed/SEED.md` for the full `setupStore`
contract — the `ctx` and the product/category shapes.

```js
const seed = require(require("path").resolve(".agents/skills/wix-vibe-headless/references/storefront/seed/seed-store.cjs"));
const result = await seed.setupStore(ctx, { products, categories }); // one call: install → products → categories → images
```

For code or actions not covered by this skill, read and follow the installed connector skill at
`.agents/skills/wix-base44-connector/SKILL.md` to find Wix documentation and APIs.

**Auth for these admin calls is the already-configured Wix headless connector — nothing else.** Get its
access token and send it as a bearer token:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
// then: fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, ... })
```

Inline via exec_tool, `base44` is already declared — use it directly; do **not** import
`@base44/sdk`, re-declare it, or call `createClient()` (that's for standalone `.js` files only;
inline it throws *"Identifier 'base44' has already been declared."*).

**Product images.** Fire every `generate_image` **before you build the client**, and seed **after**
it — generation finishes while you build, so by the time you write the seed call your images are
ready: each finished result now reads `status: "completed"` with its final
`https://media.base44.com/...` url. Read every `imageUrl` from the results **as they read at that
moment** — not from what they said when you called the tool — and pass them in the single
`setupStore` call. A result without a final url by then (still running, or failed) → seed that
product **without** `imageUrl` and attach it afterwards with `attachProductImages`.

## STEP 3 — Wrap up

### Verify

Verify **once, after the seed** — home, shop, and a product page against the populated catalog.

Images that are still generating may show `/__generating__/…` placeholders;
the platform replaces these automatically at turn end, with a stock fallback if generation
fails. You can finish without waiting for those images or replacing their placeholder URLs.

### Final text response

**Never paste a Wix dashboard link or path.**

**Before writing your final text response, make one handoff call** — `search_base44_docs(query="how do I manage my store's products, orders and inventory?", prefer_dashboard=true)`. Use its handoff guidance, note that the seeded catalog is mock data they can edit, replace or delete, and state any requested workflows that remain unfinished and what is needed to complete them.

## Additional Wix functionality

During the initial build or later, use the installed connector skill at
`.agents/skills/wix-base44-connector/SKILL.md` to find Wix documentation and APIs for writing code
or performing actions not covered by this skill.

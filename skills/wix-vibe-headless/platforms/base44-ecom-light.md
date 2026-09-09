# Wix Managed Headless — Base44 storefront client

You are building a **Wix Managed** headless storefront inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured.

The shipped client is already configured. Use its documented hooks and components; no ID lookup
or configuration changes are needed.

> **The installed Wix skills are the complete build path for this app.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).** **This flow builds the client only — there is no seeding step.**

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
The deployed implementation and configuration files do not need to be read; use the build guides
below for their contracts and usage. Continue with STEP 1.

Follow STEPs 1–2 below exactly.

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

## STEP 2 — Wrap up

**No seeding in this flow** — the client is the only deliverable. Do not seed, populate, or write data to Wix.

### Preview

Images that are still generating may show `/__generating__/…` placeholders;
the platform replaces these automatically at turn end, with a stock fallback if generation
fails. You can finish without waiting for those images or replacing their placeholder URLs.

### Final text response

**Never paste a Wix dashboard link or path.**

**Before writing your final text response, make one handoff call** — `search_base44_docs(query="how do I manage my store's products, orders and inventory?", prefer_dashboard=true)`. Use its handoff guidance, state any requested workflows that remain unfinished and what is needed to complete them.

## Additional Wix functionality

During the initial build or later, use the installed connector skill at
`.agents/skills/wix-base44-connector/SKILL.md` to find Wix documentation and APIs for writing code
or performing actions not covered by this skill.

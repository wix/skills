---
name: wix-base44-headless
description: Ship a full, working Base44 app template for a Wix-managed headless vertical (stores, bookings, …) — organized client REST utils, ready-made theme-neutral headless components + hooks built on them, wired pages, and a build-time seed module ready to call. The agent copies the vertical's template in, themes it by editing ONE tokens file, wires routes, sets credentials, and seeds by calling the module's functions — it does not regenerate the app. Use when a Base44 build targets a Wix Managed headless site and a template exists for the vertical.
---

# Wix Base44 Headless — full per-vertical templates

This skill ships a **complete Base44 app template per vertical** under `templates/<vertical>/`.
Instead of generating the frontend, the agent **copies the template in and connects the dots**:
theme it (one tokens file), set credentials, wire routes, and seed by calling ready-made
functions. Nothing is regenerated — so the build is mostly deterministic copies, not decode.

Available templates: **storefront** (Wix Stores), **bookings** (Wix Bookings). More verticals
land over time; if a vertical has no template here, fall back to the `wix-vibe-headless` skill
(per-piece scaffolds + reference components) and its `wix-docs` fallback.

## What each template ships (`templates/<vertical>/`)
```
src/rest/       client REST utils (visitor-token transport + the vertical's read/write helpers)
src/hooks/      headless hooks (data + selection logic; no markup)
src/components/ theme-NEUTRAL components built on the hooks/utils (read theme.css tokens only)
src/pages/      the functional commerce pages (catalog + detail) — routes consume the components/hooks
src/theme.css   THE styling surface — CSS-var tokens the agent edits to brand the whole app
seed/           build-time seed module (functions the agent calls with plain data)
TEMPLATE.md     the exact wiring steps for this vertical (routes, provider, tokens, seed call)
```
Some verticals add what they need: storefront ships `src/context/CartContext.jsx` (a `<CartProvider>`
+ `useCart()` mirroring the Wix server cart); bookings ships `src/lib/format.js`. The exact file list
+ wiring for each vertical is in its `TEMPLATE.md` — always read that first.

**Deliberately NOT shipped — you build these:** the **home / landing page**, the top nav / header,
and the overall layout & brand storytelling. The template gives you the hard, correct commerce
machinery (data, cart, PDP, checkout, seeding) and the functional pages; the marketing surface is
yours to design per the brief. See step 6.

## The flow (do these; the vertical's `TEMPLATE.md` has the specifics)
1. **Install this skill + copy the template in (one exec_tool call, run it as-is).** Installs the
   skill under `.agents/skills/` and copies the vertical's `src/*` into the app's `src/` (folders
   preserved; `App.jsx` untouched). Set `VERTICAL` to your vertical.

   ```js
   const { execSync } = require('child_process');
   const { cpSync, existsSync, readdirSync } = require('fs');

   const VERTICAL = 'storefront';   // your vertical: 'storefront' | 'bookings'

   // install the skill (lands under /app/.agents/skills/)
   const out = execSync('CI=1 npx -y skills add wix/skills/skills/wix-base44-headless --yes 2>&1',
     { cwd: '/app', timeout: 60000, shell: '/bin/bash' }).toString();

   // copy the vertical's template into src/ (recursive; overlays folders, leaves App.jsx alone)
   const TPL = `/app/.agents/skills/wix-base44-headless/templates/${VERTICAL}/src`;
   if (!existsSync(TPL)) throw new Error(`no template for vertical "${VERTICAL}"`);
   cpSync(TPL, '/app/src', { recursive: true });

   return { installed: /installed|found/i.test(out), src: readdirSync('/app/src') };
   ```
   The `seed/` module is **not** copied into the app — it's required at build time from the installed
   skill path (step 5).
2. **Set credentials in one file** — fill `src/wix.config.json` (`WIX_CLIENT_ID` + `WIX_METASITE_ID`,
   both from your prompt). Everything reads from there: the client (`wix-client.js` imports it) and
   the build-time seed (`require('/app/src/wix.config.json')`). Don't hardcode ids anywhere else.
3. **Theme by tokens only** — edit `src/theme.css` to the brand (palette, type, radius). **Do NOT
   restyle the components' JSX** — every component reads these tokens, so editing them re-skins the
   whole site. This is what makes copied components (fast) instead of a regeneration.
4. **Wire routes + provider** — add the template's pages to the router and wrap the app in the
   provider, exactly as `TEMPLATE.md` lists. Small `find_replace` edits to `App.jsx` — never a
   rewrite (it carries platform auth scaffolding).
5. **Seed** — load the vertical's `seed/` module (build-time, via exec_tool) with the loader snippet
   in its `TEMPLATE.md` — a plain `require` there can return empty exports, so use the snippet as
   written — and call its functions with plain data built from the brief + brand. See `TEMPLATE.md`
   and the seed module's own header for the exact calls; unexpected shape → the `wix-docs` skill.
6. **Build the app-specific surface (this is your creative job)** — the home / landing page, the top
   nav/header, the overall layout, brand imagery and copy, and any page the template doesn't include.
   Style it from the same `theme.css` tokens so it matches the template pages. Everything the template
   provides, keep and wire — don't rebuild the commerce machinery.

## Hard rules
- **Theme via `theme.css` tokens, never by rewriting components.** A component that hardcodes a
  color instead of `var(--…)` is a bug — fix the token, not the component.
- **Do NOT use any Base44 built-in kit/plugin/solution template** — this template IS the build.
- **`src/App.jsx`: surgical `find_replace` only** (route + provider wiring), never a full rewrite.
- Client REST utils use the public `WIX_CLIENT_ID` (visitor tokens, frontend-safe). Admin/seed
  calls use the Wix connector token at build time (see the seed module).

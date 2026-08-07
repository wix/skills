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
src/pages/      wired pages (routes consume the components/hooks)
src/theme.css   THE styling surface — CSS-var tokens the agent edits to brand the whole app
seed/           build-time seed module (functions the agent calls with plain data)
TEMPLATE.md     the exact wiring steps for this vertical (routes, provider, tokens, seed call)
```
Some verticals add what they need: storefront ships `src/context/CartContext.jsx` (a `<CartProvider>`
+ `useCart()` mirroring the Wix server cart); bookings ships `src/lib/format.js`. The exact file list
+ wiring for each vertical is in its `TEMPLATE.md` — always read that first.

## The flow (do these; the vertical's `TEMPLATE.md` has the specifics)
1. **Copy the template in** — copy `templates/<vertical>/src/*` into the app's `src/` (utils →
   `src/rest/`, plus `context/`, `hooks/`, `components/`, `pages/`, `theme.css`). This is a file
   copy, not a rewrite.
2. **Set credentials** — put `WIX_CLIENT_ID` in `src/rest/wix-client.js` and (if the vertical uses
   it) `WIX_METASITE_ID` where `TEMPLATE.md` says. Both come from your prompt.
3. **Theme by tokens only** — edit `src/theme.css` to the brand (palette, type, radius). **Do NOT
   restyle the components' JSX** — every component reads these tokens, so editing them re-skins the
   whole site. This is what keeps the template a copy (fast) instead of a regeneration.
4. **Wire routes + provider** — add the pages to the router and wrap the app in the provider,
   exactly as `TEMPLATE.md` lists. Small `find_replace` edits to `App.jsx` — never a rewrite (it
   carries platform auth scaffolding).
5. **Seed** — `require` the vertical's `seed/` module (build-time, via exec_tool) and call its
   functions with plain data built from the brief + brand. See the vertical's `TEMPLATE.md` and the
   seed module's own header for the exact calls; if a call returns an unexpected shape, fall back to
   the `wix-docs` skill (never guess).
6. **Generate only the app-specific bits** — home-page hero copy, brand imagery, any page the
   template doesn't include. Everything the template provides, keep.

## Hard rules
- **Theme via `theme.css` tokens, never by rewriting components.** A component that hardcodes a
  color instead of `var(--…)` is a bug — fix the token, not the component.
- **Do NOT use any Base44 built-in kit/plugin/solution template** — this template IS the build.
- **`src/App.jsx`: surgical `find_replace` only** (route + provider wiring), never a full rewrite.
- Client REST utils use the public `WIX_CLIENT_ID` (visitor tokens, frontend-safe). Admin/seed
  calls use the Wix connector token at build time (see the seed module).

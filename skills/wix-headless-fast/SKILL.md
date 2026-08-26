---
name: wix-headless-fast
description: "Build a Wix Headless site fast by wiring SHIPPED, verified @wix/sdk code instead of authoring the integration from recipes. Each Wix business vertical ships a typed, framework-agnostic React core (data layer returning plain DTOs, hooks, headless components) plus an Astro overlay (SSR pages with owner-editable SEO pre-wired) and a build-time REST seed script — the agent scaffolds via the Wix CLI, deploys the shipped code, seeds the backend, builds only the brand layer (home, layout, theme, copy), and releases to Wix hosting. Works on Wix-managed Astro (ambient auth, the default) and on any React-based project (Vite, non-Astro) over the public OAuth client id. Verticals: stores/storefront (products, categories, variants, cart, hosted checkout). Triggers: build me a store fast, storefront with shipped components, wix headless fast, connect Wix Stores with ready-made SDK code."
---

# Wix Headless Fast

Build a Wix Headless site by **deploying shipped code, not authoring it**. Where `wix-headless`
hands the agent recipes to code from, this skill ships the integration itself — a typed data
layer, hooks, components, pages, and a seed script that are already correct — and the agent's
job narrows to brand, layout, copy, and wiring. The decisions live in the code; don't
re-litigate them.

## Relationship to sibling skills

| Skill | Use when |
|---|---|
| **wix-headless-fast** (this) | A supported vertical fits the request and the frontend is Astro or React — the fast path. |
| `wix-headless` | A vertical this skill doesn't ship yet, a non-React frontend, backend-only runs, or stripe/self-managed project types. |
| `wix-vibe-headless` | Client-only REST over a `WIX_CLIENT_ID` inside a vibe platform (Base44 etc.) — no SDK, no CLI. |

## The model

- **Shipped code is the implementation.** Every vertical ships under `references/<vertical>/`:
  - `app/` — the framework-agnostic core (TypeScript): a data layer that returns **plain,
    serializable DTOs** (images resolved to https URLs, prices pre-formatted), React hooks, and
    routing-free headless components. Works in Astro islands, Vite SPAs, and Next.
  - `app-astro/` — a thin Astro overlay: SSR pages that fetch via the core and pass DTOs to
    islands, with owner-editable item-page SEO pre-wired.
  - `seed/` — a build-time REST seed script (plain-data plan in, created content out) plus its
    `SEED.md` contract.
  - `INSTRUCTIONS.md` — the vertical's playbook: file map, what you build, hard rules, verify.
- **One auth seam.** All shipped code calls Wix through `src/wix/sdk.ts`: on Wix-managed Astro
  auth is ambient (no client, no id); on any other React setup the same file runs a manual
  visitor client off the public client id in `src/wix/config.ts`. The deploy step configures
  this — nothing to wire by hand.
- **Copy as-is; extend by calling.** Wire the exported hooks/components/functions; never
  rewrite their internals, re-route them through API routes, or re-derive a request shape. For
  a genuine gap, add a new function in the data layer (or consult the `wix-docs` skill for the
  API contract) — never edit the shipped ones.
- **Never mock, fail loudly, purchases via Wix.** Live data or an honest empty state; surfaced
  errors, not swallowed ones; checkout/purchase always through the Wix redirect session.

## The run

1. **Resolve the stack.** Default is **Wix-managed Astro** — take it unless the user names a
   different React framework or the directory already holds a non-Astro React project. A
   non-React frontend is out of scope → `wix-headless`.
2. **Draft the seed plan** (the vertical's `SEED.md` plan file) — it depends only on the
   brief. Requires from here on: Node ≥ 20.11 and a logged-in Wix CLI
   (`npx @wix/cli@latest whoami`; login via the device-code flow — surface the URL+code, never
   read tokens into context).
3. **Create runs (empty directory): run the fast path** — one deterministic call:

   ```bash
   node <SKILL_ROOT>/install/fast-path.mjs --business-name "<Brand>" --plan plan.json
   ```

   It emits one JSON event per line and returns in **~35s**: **scaffolds** the project,
   **deploys** the shipped code (patching `package.json` with every dependency the code
   imports, and placing the pre-resolved lockfile), then **starts two detached background
   jobs** — the dependency install (`npm ci --ignore-scripts || npm install --ignore-scripts`)
   and the **seed** — whose logs and completion markers are in the events. The final
   `ready_for_brand_layer` event carries the project dir, siteId, ready-made dashboard links,
   and both markers. Relay notable events. On an `error` event, recover just that step via the
   manual path below, then continue.

   **Connect/iterate runs (a project already on disk): never scaffold — use the manual path:**
   `CI=1 npm create @wix/new@latest init` in place if there is no `wix.config.json` yet; then
   `node <SKILL_ROOT>/install/deploy.mjs <vertical…> --stack astro|react` from the project root
   (react stack: add `--client-id` if there is no `wix.config.json` to read the public id
   from); then ONE `npm ci --ignore-scripts || npm install --ignore-scripts` (backgroundable —
   but **never run a second npm install concurrently**: two npms in one `node_modules` race and
   redo each other's work); then seed per the vertical's `seed/SEED.md`. Seeding is
   **additive**: never delete or overwrite existing content; if a cleanup seems needed, ask.
4. **Build the brand layer while the install finishes** — in the project dir from the
   `ready_for_brand_layer` event, per the vertical's `INSTRUCTIONS.md`: the home page, the
   layout's header/footer/tokens, and the copy — composing the shipped pieces. Read the
   INSTRUCTIONS first, and don't open the shipped files themselves.
5. **When both background jobs have completed** — the install's marker
   (`node_modules/.package-lock.json`) and the seed's (`.seed-exit`) both exist — **verify the
   seed succeeded** (`.seed-exit` contains `0`; `seed-result.json` has the created counts for
   your summary — if non-zero, read `seed.log` and re-run the seed module manually). Then
   **build & release once** (managed):
   `npx @wix/cli@latest build` then `npx @wix/cli@latest release` (if the install failed, run
   it once more and then build). Don't build+release mid-flow; backend content is fetched at
   runtime, so a re-release never "refreshes" seeded data. The run is complete only when the
   site is released — close with the live URL and the dashboard link
   `https://manage.wix.com/dashboard/<siteId>`. **Copy the live URL verbatim from the
   `wix release` output — never retype it from memory** (a mistyped subdomain hands the user
   a 404).

Don't smoke-test with a dev server unless the user explicitly asks to verify — correctness
comes from the shipped code, and real errors surface at build/release.

## Verticals

| The user wants… | Vertical | Playbook |
|---|---|---|
| Online store: products, categories, variants, cart, checkout | **storefront** | `references/storefront/INSTRUCTIONS.md` |

A request that doesn't match a shipped vertical isn't this skill's fast path — route it to
`wix-headless` rather than improvising an unshipped vertical here.

## Adding a vertical (structure contract)

New verticals follow the same layout — the deploy script discovers them automatically (any
`references/<name>/app/` directory is a vertical):

```
references/<vertical>/
  INSTRUCTIONS.md      # playbook: file map, wiring per stack, what you build, hard rules, verify
  app/                 # framework-agnostic core — disjoint paths so verticals never collide:
    wix/<vertical>/    #   types.ts (DTOs) + data layer (calls via ../sdk, images via ../media)
    hooks/<vertical>/  #   React hooks (SSR-friendly: accept initial data)
    components/<vertical>/  # routing-free components (plain <a> default + LinkComponent prop)
    styles/global.css  # Tailwind v4 + the @theme design tokens (shared token family)
  app-astro/           # Astro overlay importing ONLY from the core:
    pages/…            #   SSR fetch → DTO props → client:load islands; item pages carry
                       #   wixMetadata + <SEO.Tags>; chrome islands are client:only
    layouts/…          #   (reuse SiteLayout when it fits)
  seed/                # seed-<vertical>.mjs (REST, mints its own CLI token) + SEED.md
```

Core rules the structure encodes: raw API entities never leave the data layer (DTOs only);
client-shared state uses a module-scope store (never React context — it can't span Astro
islands); every image URL is resolved through `src/wix/media.ts`; every money value is a
formatted string by the time a component sees it.

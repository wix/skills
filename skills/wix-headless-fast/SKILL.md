---
name: wix-headless-fast
description: "Build a Wix Headless site fast by wiring SHIPPED, verified @wix/sdk code instead of authoring the integration from recipes. Each Wix business vertical ships a typed, framework-agnostic React core (data layer returning plain DTOs, hooks, headless components) plus an Astro overlay (SSR pages with owner-editable SEO pre-wired) and a build-time REST seed script — the agent scaffolds via the Wix CLI, deploys the shipped code, seeds the backend, designs the presentation layer itself on the shipped hooks (product card/grid, PDP, home, theme), and releases to Wix hosting. Works on Wix-managed Astro (ambient auth, the default) and on any React-based project (Vite, non-Astro) over the public OAuth client id. Verticals: stores/storefront (products, categories, variants, cart, hosted checkout), bookings (services, appointment/class time slots, staff, booking form, checkout-or-place), blog (posts, categories/tags, rich content), cms (structured content collections), forms (schema-driven visitor forms: render, validate, submit), events (listing, RSVP, ticket sales), members (login, gated pages, account), portfolio (project collections, media galleries), pricing-plans (plan grid, hosted purchase), restaurants (menus, online ordering, table reservations). Triggers: build me a store/blog/booking/event/restaurant/portfolio site fast, take appointments fast, sell tickets or membership plans headless, wix headless fast, connect a Wix business app with ready-made SDK code."
---

# Wix Headless Fast

Build a Wix Headless site by **deploying shipped code, not authoring it**. Where `wix-headless`
hands the agent recipes to code from, this skill ships the integration itself — a typed data
layer, hooks, components, pages, and a seed script that are already correct — and the agent's
job narrows to brand, layout, copy, and wiring. The decisions live in the code; don't
re-litigate them.

## Relationship to sibling skills

| Skill                        | Use when                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **wix-headless-fast** (this) | A supported vertical fits the request and the frontend is Astro or React — the fast path.                              |
| `wix-headless`               | A vertical this skill doesn't ship yet, a non-React frontend, backend-only runs, or stripe/self-managed project types. |
| `wix-vibe-headless`          | Client-only REST over a `WIX_CLIENT_ID` inside a vibe platform (Base44 etc.) — no SDK, no CLI.                         |

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
- **Data as-is; presentation is yours.** The data layer, hooks, and cart chrome are wired
  as-is — never rewrite their internals, re-route them through API routes, or re-derive a
  request shape. For a genuine gap, first read the relevant official contract with the
  `wix-docs` skill; do not search generated SDK types, package files, or `node_modules` to
  infer it. A normal caller-permitted operation belongs in a new data-layer function. A
  privileged operation belongs in a validated server endpoint — see
  `references/shared/CUSTOM_OPERATIONS.md`. The presentation components ship only as
  **references**: the vertical's INSTRUCTIONS names the surfaces you design and implement
  yourself on the shipped hooks (for storefront: card, grid, shop + PDP surfaces, home).
- **Never mock, fail loudly, purchases via Wix.** Live data or an honest empty state; surfaced
  errors, not swallowed ones; checkout/purchase always through the Wix redirect session.
- **Optional capabilities are deployed from the plan.** A vertical can opt into a shared
  capability without copying sensitive code. For a normal file upload, add a named
  `capabilities.mediaUpload.policies` entry to the plan; Fast ships its client helper, Astro
  endpoint, dependencies, and generated policy module once. Read
  `references/shared/CUSTOM_OPERATIONS.md` before choosing it. The agent wires the helper to
  the product UI; it never authors or widens the endpoint.

## The run

1. **Resolve the stack.** Default is **Wix-managed Astro** — take it unless the user names a
   different React framework or the directory already holds a non-Astro React project. A
   non-React frontend is out of scope → `wix-headless`.
2. **Draft the seed plan** (read only the vertical's `SEED.md` for this — it depends only on
   the brief; save the vertical's `INSTRUCTIONS.md` for step 4, where it's needed). Requires from here on: Node ≥ 20.11 and a logged-in Wix CLI
   (`npx @wix/cli@latest whoami`; login via the device-code flow — surface the URL+code, never
   read tokens into context).
3. **Create runs (empty directory): run the fast path** — one deterministic call:

   ```bash
   node <SKILL_ROOT>/install/fast-path.mjs --business-name "<Brand>" --plan plan.json --vertical <vertical>
   ```

   `--vertical` is required and picks which shipped code deploys AND which seed runs — use
   the vertical you resolved from the Verticals table.

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
   `node <SKILL_ROOT>/install/deploy.mjs <vertical…> --stack astro|react --plan plan.json` from the project root
   (react stack: add `--client-id` if there is no `wix.config.json` to read the public id
   from); then ONE `npm ci --ignore-scripts || npm install --ignore-scripts` (backgroundable —
   but **never run a second npm install concurrently**: two npms in one `node_modules` race and
   redo each other's work); then seed per the vertical's `seed/SEED.md`. Seeding is
   **additive**: never delete or overwrite existing content; if a cleanup seems needed, ask.

4. **Design and build the presentation while the install finishes** — in the project dir from
   the `ready_for_brand_layer` event, per the vertical's `INSTRUCTIONS.md`: set the `@theme`
   tokens, brand the chrome, and implement the vertical's creative surfaces yourself on the
   shipped hooks (for storefront: your product card + grid, shop surface, PDP surface, and the
   home page) — designed to fit the brief, not copied from the reference components. Read the
   INSTRUCTIONS and the shared floors — `references/shared/DESIGN.md` +
   `references/shared/CONTENT.md` — now (not earlier — their contracts matter only from this
   step on); the hook/DTO
   contracts are inlined there, so don't open the shipped files themselves. **Author your
   surfaces in as few messages as possible** — batch multiple Write calls in one message
   (components are independent files); don't pay a round-trip per file.
   If the brief needs a core operation that shipped code does not cover, read
   `references/shared/CUSTOM_OPERATIONS.md` before writing it. Use one documented path and
   implement it; do not reverse-engineer SDK internals.
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

| The user wants…                                                                              | Vertical          | Playbook                                   |
| -------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| Online store: products, categories, variants, cart, checkout                                 | **storefront**    | `references/storefront/INSTRUCTIONS.md`    |
| Appointments/classes: services, time slots, staff, booking, checkout                         | **bookings**      | `references/bookings/INSTRUCTIONS.md`      |
| Blog: post feed, categories/tags, rich-content post pages                                    | **blog**          | `references/blog/INSTRUCTIONS.md`          |
| Structured content collections (directory, recipes, listings) with pages designed per schema | **cms**           | `references/cms/INSTRUCTIONS.md`           |
| Any visitor-fillable form: contact/enquiry, signup, application, survey — rendered from the live schema | **forms**         | `references/forms/INSTRUCTIONS.md`         |
| Events: listing, event pages, free RSVP, ticket sales via hosted checkout                    | **events**        | `references/events/INSTRUCTIONS.md`        |
| Member accounts: custom in-app login/sign-up, gated pages, account page                      | **members**       | `references/members/INSTRUCTIONS.md`       |
| Portfolio/showcase: collections of projects, project pages with media galleries              | **portfolio**     | `references/portfolio/INSTRUCTIONS.md`     |
| Membership/subscription plans: pricing page, plan detail, hosted purchase                    | **pricing-plans** | `references/pricing-plans/INSTRUCTIONS.md` |
| Restaurant: menu with photos, online ordering, table reservations                            | **restaurants**   | `references/restaurants/INSTRUCTIONS.md`   |

Verticals compose: a brief that spans several (a restaurant with a blog, a store with member
accounts) deploys them together — fast-path takes one vertical; deploy the rest with
`node <SKILL_ROOT>/install/deploy.mjs <vertical…>` from the project root before the install
starts, and run each vertical's seed. A request that doesn't match any shipped vertical isn't
this skill's fast path — route it to `wix-headless` rather than improvising an unshipped
vertical here.

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

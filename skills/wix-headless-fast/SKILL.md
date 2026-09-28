---
name: wix-headless-fast
description: "Build a Wix Headless site fast by wiring SHIPPED, verified @wix/sdk code instead of authoring the integration from recipes. Each Wix business vertical ships a typed, framework-agnostic React core (data layer returning plain DTOs, hooks, headless components) plus an Astro overlay (SSR pages with owner-editable SEO pre-wired) and a build-time REST seed script — the agent scaffolds via the Wix CLI, deploys the shipped code, seeds the backend, designs the presentation layer itself on the shipped hooks (product card/grid, PDP, home, theme), and releases to Wix hosting. Works on Wix-managed Astro (ambient auth, the default) and on any React-based project (Vite, non-Astro) over the public OAuth client id. Verticals: stores/storefront (products, categories, variants, cart, hosted checkout), bookings (services, appointment/class time slots, staff, booking form, checkout-or-place), blog (posts, categories/tags, rich content), cms (structured content collections), forms (schema-driven visitor forms: render, validate, submit), events (listing, RSVP, ticket sales), members (login, gated pages, account), portfolio (project collections, media galleries), pricing-plans (plan grid, hosted purchase), restaurants (menus, online ordering, table reservations), faq (categorized questions and answers, search, a link per question), donations (campaign pages, goal progress, one-time and recurring donations via hosted checkout). Triggers: build me a store/blog/booking/event/restaurant/portfolio/FAQ/donation site fast, take appointments fast, sell tickets or membership plans headless, collect donations headless, wix headless fast, connect a Wix business app with ready-made SDK code."
---

# Wix Headless Fast

Build a Wix Headless site on **shipped, verified code instead of authoring the integration**.
Each vertical ships the integration itself — a typed data layer, hooks, components, pages, and a
seed script that are already correct. On a stack that runs it (Wix-managed Astro, any React
project) the code is **deployed** and the agent's job narrows to brand, layout, copy, and wiring.
On a stack that can't run it (a static site with no bundler, a server-rendered app in another
language) the same code is the **reference**: its REST twin deploys for the browser side, and the
rules it encodes are what the agent ports. Either way the decisions live in the code; don't
re-litigate them.

**Scope.** Tuned for Wix-managed Astro, and each vertical ships *one* shape of its solution. Use
it as-is when the brief doesn't contradict it. When the brief asks for something that shape
doesn't express — or once the site exists and the work turns to managing or extending it — that's
`wix-docs` and `wix-manage`, not a workaround here.

## The model

- **Shipped code is the implementation.** Every vertical ships under `templates/<vertical>/` in
  the skill's repository, not in the skill folder: `node <SKILL_ROOT>/install/templates.mjs`
  fetches all of it once into `<SKILL_ROOT>/templates/` (a second) and prints the path; every
  script below fetches it itself when the folder is missing. The folder stays with the project
  (only the composed `project/` scaffolds are left out of its repository), so a later session
  reads the version the project was built from. Each vertical holds:
  - `app/` — the framework-agnostic core (TypeScript): a data layer that returns **plain,
    serializable DTOs** (images resolved to https URLs, prices pre-formatted), React hooks, and
    routing-free headless components. Works in Astro islands, Vite SPAs, and Next.
  - `app-astro/` — a thin Astro overlay: SSR pages that fetch via the core and pass DTOs to
    islands, with owner-editable item-page SEO pre-wired.
  - `seed/` — a build-time REST seed script (plain-data plan in, created content out) plus its
    `SEED.md` contract.
  - `INSTRUCTIONS.md` — the vertical's playbook: file map, what you build, hard rules.
  - `project/` — the vertical composed into the Wix CLI's blank Astro scaffold, with its
    lockfile: what `wix create` copies for a new site, so the first vertical installs without
    resolving.
- **One auth seam.** All shipped code calls Wix through `src/wix/sdk.ts`: on Wix-managed Astro
  auth is ambient (no client, no id); on any other React setup the same file runs a manual
  visitor client off the public client id in `src/wix/config.ts`. The deploy step configures
  this — nothing to wire by hand.
- **Data as-is; presentation is yours.** The data layer, hooks, and cart chrome are wired
  as-is — never rewrite their internals, re-route them through API routes, or re-derive a
  request shape. When the brief needs something they don't express, read the shipped file that
  owns it and confirm the contract with `wix-docs`; never infer one from generated SDK types,
  package files, or `node_modules`. A normal caller-permitted operation belongs in a new
  data-layer function. A privileged operation belongs in a validated server endpoint — see
  `templates/shared/CUSTOM_OPERATIONS.md`. The presentation **doesn't ship**: the vertical's
  INSTRUCTIONS names the surfaces you design and implement yourself on the shipped hooks,
  with a skeleton carrying each surface's contract (for storefront: the shop and PDP pages
  with their islands, and home).
- **NEVER work from training data or memory about the Wix APIs.** Not a URL, a path, a version,
  a header, a field name, a filter key, or a body. Every Wix call you make or write — in the
  frontend, in a seed, in a build-time read of a site — comes from the official Wix skills
  installed here, the code they deployed first, or, when they do not cover the call, from the
  official Wix documentation through `wix-docs`. Read it there first, then write the call.
  **The test, before every request:** the exact path and body appear in the output of a file
  read or a docs search you ran in this session, and you copy them from that output. Anything
  else is memory: a file whose output was cut short before the call, a source you remember
  reading earlier, a call built by changing part of one you did find. A guessed call that
  returns 400 or nothing is not a step toward the
  answer; it is the failure this rule exists to prevent, trying the next variant is still
  guessing, and an empty or error reply to a call that failed the test tells you about the
  call, never about the site. Keep errors visible while a call is unconfirmed: no `2>/dev/null`,
  no `| echo`. The shipped code is tested against live sites; a body that looks similar is the
  one that returns nothing, and the API rarely says why.
- **Never mock, fail loudly, purchases via Wix.** Live data or an honest empty state; surfaced
  errors, not swallowed ones; checkout/purchase always through the Wix redirect session.
- **Optional capabilities are deployed from the plan.** A vertical can opt into a shared
  capability without copying sensitive code. For a normal file upload, add a named
  `capabilities.mediaUpload.policies` entry to the plan; Fast ships its client helper, Astro
  endpoint, dependencies, and generated policy module once. Read
  `templates/shared/CUSTOM_OPERATIONS.md` before choosing it. The agent wires the helper to
  the product UI; it never authors or widens the endpoint. For a site-wide search (a header box
  with suggestions, a `/search?q=` page over the deployed verticals' products, services, posts
  and events), add a `capabilities.siteSearch` entry; Fast ships its data layer, stores, hooks,
  components and search page once. Enabling it means the Wix Site Search app is installed on the
  site by the seed step (`install: true`; the capability's `seed/install.mjs`, run after the
  content seed) — the index fills within about half a minute of the install. Playbook:
  `templates/shared/capabilities/site-search/INSTRUCTIONS.md`.

## The run

Needed throughout: Node ≥ 20.11, git, a logged-in Wix CLI (`npx @wix/cli@latest whoami`;
`npx @wix/cli@latest login` is a device-code flow: surface the URL and code to the user, never
read tokens into context), and the two companion skills beside this one, `wix-docs` and
`wix-manage` (if `.agents/skills/` lacks them:
`CI=1 npx skills@latest add wix/skills --skill wix-docs --skill wix-manage --yes`). The cold-start
page, `cold-start/cold-start.md`, gets a machine with none of this to that point. In a folder that
already holds a `wix.config.json`, `node <SKILL_ROOT>/install/context.mjs` first: it runs
`wix env pull` when `.env.local` is missing and prints the two identities a project has — the
deploy site (the config, where `wix release` goes) and the content site (the env, whose app the SDK
client runs as and whose dashboard manages the business). They are one site, except on a
**migration preview** (`guides/migration.md`), where the env names the site being migrated.
Every script here reads that context; the site a call targets is never guessed from the config
alone. Then fetch the shipped
code once: `node <SKILL_ROOT>/install/templates.mjs`. It prints the folder;
the `templates/…` paths below are relative to `<SKILL_ROOT>`, where it lands.
`node <SKILL_ROOT>/install/check.mjs` says whether the skill or its templates have a newer version
and prints the update commands; it changes nothing.

1. **Resolve the stack.** Default is **Wix-managed Astro** — take it unless the user names
   another framework or the directory already holds one. Then, by what the shipped code can run
   there:
   - **React** (Vite, Next, …) runs everything shipped — data layer, hooks, components:
     `--stack react`. The agent's own files may be JS; the shipped files are TypeScript and
     build untouched inside a JS project — never strip them by hand; if the brief wants no
     TypeScript anywhere, say the shipped code cannot meet that and ask before going on.
     A named framework is scaffolded with its own command
     first (`npm create vite@latest`, …), then step 3 runs in that folder.
   - **Another bundled JS framework** (Vue, Svelte, Solid, plain Vite): the data layer and the
     framework-free stores run (`src/wix/` has no React in it), the React hooks and components
     don't apply: `--stack lib`. The agent binds the stores and writes its framework's components
     against the same contracts.
   - **No bundler, or another language** — a static site (plain HTML/CSS/JS), a server-rendered
     app (Flask, Laravel, Rails, …): **reference mode** (its section below, and
     `<SKILL_ROOT>/guides/reference-mode.md`). Nothing from `app/` deploys; the REST layer
     deploys for the browser side, and the server side ports it for its reads.

   **What Wix hosting takes, and what each stack needs to be released there.** `wix release`
   uploads the folder named in `wix.config.json` (`site.outputDirectory`) and serves it as
   files — no SPA fallback, no directory index, no rewrites: `/` and real files resolve, a clean
   client-side route answers 404 when loaded directly or shared. Server code runs only as a
   Cloudflare Workers build, declared as `outputDirectory: { client, server }`.
   - **Managed Astro** is the stack the Wix CLI scaffolds: the Wix Astro integration
     (`@wix/astro`, ambient auth), the hosting adapter (`@wix/astro-wix-hosting-adapter`, the
     Workers build), `@astrojs/react` with React 18 for the shipped components, and in
     `astro.config.mjs` `integrations: [wix(), react()]`, `adapter: wixHostingAdapter()`,
     `output: "server"`, `security: { checkOrigin: false }`, `image.domains` with
     `static.wixstatic.com`. An Astro project made without the CLI has none of that; add it
     before deploying, and the site serves every route. The integration supports **Astro 5**: a
     project on another major is pinned to 5 first, or connected as a React host.
   - **React and other bundlers** release their own build as files. So routes are hash routes,
     or one emitted HTML file per route linked by its file name — decided before the first route
     is written; any URL handed to Wix as a return target must be one the host serves. Verify by
     loading a deep URL directly, not by navigating from `/`.
   - **A framework whose build is a server** (Next, Nuxt, Remix, SvelteKit, …) releases only as a
     static export (files, the rule above applies), or as a Workers build through
     `outputDirectory: { client, server }`; otherwise it is self-hosted, with its domain added to
     the OAuth app's allowed domains before checkout can return to it.
   - **Static** (no build): `outputDirectory` points at the folder the pages live in; a route is a
     page plus a query-string slug (reference mode).
2. **The seed plan.** When the brief supplies the content in any form — a CSV, JSON or
   spreadsheet, a list in the prompt, a PDF price list, a folder of photos and a text file, a
   link to their current catalog, anything else that names the content — that IS the plan: map
   it into `plan.json` per `templates/shared/SUPPLIED-CONTENT.md` and the vertical's `SEED.md`
   ("Supplied content"), every entry, names and prices verbatim, their images and no others.
   Draft a plan from the brief only when nothing was supplied (read only the vertical's
   `SEED.md` for this — it depends only on the brief; save the vertical's `INSTRUCTIONS.md` for
   step 4, where it's needed). **An existing site has no plan**: when the brief names a site by
   its id, the site holds the content already — nothing is seeded, and the frontend reads what
   is there (step 3's attach path).
3. **Set up the project, in its folder** — one deterministic call, the same for an empty folder
   and for a project already on disk; **the folder decides** what it does:

   ```bash
   node <SKILL_ROOT>/install/setup.mjs --vertical <vertical> [--plan plan.json] [--business-name "<Brand>"]
   ```

   - **Empty** (or only loose files: a CSV, a brief) → **create**: `wix create` with the
     vertical's composed template, here; `--business-name` names the site.
   - **A project without `wix.config.json`** (a `package.json`, or an `index.html` at the root:
     someone's Astro, Vite, Next, plain HTML) → **connect**: `init` in place links the folder
     to a new site (the site is named after the folder), then the shipped code deploys into
     the project as it is. Pass `--stack` for the stack you resolved in step 1, and make the
     project what that stack needs on Wix hosting (step 1) before or right after the call.
     With `--stack static` setup also makes `site/` the folder `wix release` uploads and deploys
     the REST layer into `site/js/wix/`; you move the pages, styles and assets in (`guides/reference-mode.md`).
   - **`wix.config.json` and a project** → refuses: the folder is already a Wix project with a
     frontend, whether the CLI made it, a hand wrote it, or this skill built it. Three commands
     from the project root do everything setup would: `deploy.mjs <vertical…> --stack <stack>`
     adds this skill's code or a solution (the client id comes from `.env.local`, the config as
     the fallback), then ONE
     `npm install`, then the seed module if there is content to create. A project this skill
     built needs only the first, for a new solution; a change to what is built is file edits
     and a release.
   - **`wix.config.json` and no project, and `.env.local` declares a migration** (a project
     downloaded from Wix for a site being moved to headless; the config names a site that only
     hosts the deployment, the env the site being migrated) → **migrate**: setup copies the
     vertical's composed template in around the config, deploys with the migrated site's app as
     the client, starts the install, seeds nothing. `ready_for_brand_layer` says `mode: "migrate"`,
     the parent as `siteId` and the child as `deploySiteId`. `guides/migration.md` has the rules.
   - **`wix.config.json` and no project**, no migration (what `init` leaves in an empty folder) →
     the site exists and has no frontend yet: `attach.mjs` (below), which takes the site from the
     config, reuses its hosting, scaffolds and deploys. No seed: the site owns its content.
   - The brief names a site by id → not this call: read `<SKILL_ROOT>/guides/existing-site.md`
     and follow it (read the site, then `attach.mjs`, which does what setup does against the
     site given; self-hosting and a project already on disk are in there too).

   `--vertical` is required and picks which shipped code deploys AND which seed runs — use
   the vertical you resolved from the Verticals table. **`--plan` decides whether anything is
   seeded**: pass the plan from step 2 when there is one; a site that already holds its content
   gets none. Seeding is **additive**: it never deletes or overwrites what the site holds; if a
   cleanup seems needed, ask. The `ready_for_brand_layer` event says `mode` (create or
   connect), the stack, and the `next` for that stack, including how it releases.

   setup scaffolds with `--skip-git`: it composes its own steps and leaves version control to
   you / the enclosing repo, so it does **not** create the scaffold's usual git repo + initial
   commit (which would otherwise become a nested-repo gitlink if the project lands inside a repo).

   The project is created **in the current directory** — the folder the entry had you work from,
   which already holds the installed skills — so the project is self-contained and a later session
   opened in it finds everything. It refuses if the folder already holds a file the scaffold would
   write. `--subfolder` creates it in a new folder named after the business instead, for a current
   folder that must stay as it is; the skills then sit one level above the project.

   It emits one JSON event per line and returns in **~35s**: **scaffolds** the project from the
   vertical's composed template (`wix create` copies it: the code and its lockfile arrive with
   the scaffold), **deploys** whatever the folder still lacks (patching `package.json` with every
   dependency the code imports), then **starts two detached background jobs** — the dependency install (`npm ci --ignore-scripts || npm install --ignore-scripts`)
   and the **seed** — whose logs and completion markers are in the events. The final
   `ready_for_brand_layer` event carries the project dir, siteId, ready-made dashboard links,
   and both markers. Relay notable events. On an `error` event, recover just that step via the
   manual path below, then continue.

   **Recovering one step, or adding a solution later:** the pieces run on their own from the
   project root — `node <SKILL_ROOT>/install/deploy.mjs <vertical…> --stack <stack>` (the client
   id is read from `wix.config.json`), ONE `npm ci --ignore-scripts || npm install
   --ignore-scripts` (**never a second npm install concurrently**: two npms in one
   `node_modules` race and redo each other's work; setup already started one — wait on its
   marker), the vertical's seed module per its `seed/SEED.md`.
   A code change on an existing project is done when it is **released** (step 5) and the live
   URL shows it — not when a dev server or a local build shows it. A management change (a
   recipe against the site) needs no release; the frontend reads it live.

4. **Design and build the presentation while the install finishes** — in the project dir from
   the `ready_for_brand_layer` event, per the vertical's `INSTRUCTIONS.md`: set the `@theme`
   tokens, brand the chrome, and implement the vertical's creative surfaces yourself on the
   shipped hooks (for storefront: your product card + grid, shop surface, PDP surface, and the
   home page) — designed to fit the brief, not copied from the reference components. Read the
   INSTRUCTIONS and the shared floors — `templates/shared/DESIGN.md` +
   `templates/shared/CONTENT.md` — now (not earlier — their contracts matter only from this
   step on); the hook/DTO
   contracts are inlined there, so don't open the shipped files themselves. **Author your
   surfaces in as few messages as possible** — batch multiple Write calls in one message
   (components are independent files); don't pay a round-trip per file.
   If the brief needs a core operation that shipped code does not cover, read
   `templates/shared/CUSTOM_OPERATIONS.md` before writing it. Use one documented path and
   implement it; do not reverse-engineer SDK internals.
5. **When both background jobs have completed** — the install's marker
   (`node_modules/.package-lock.json`) and the seed's (`.seed-exit`) both exist — **verify the
   seed succeeded** (`.seed-exit` contains `0`; `seed-result.json` has the created counts for
   your summary — if non-zero, read `seed.log` and re-run the seed module manually). Those two
   seed files exist **only when setup started the seed** (attach runs none: only the install
   marker is waited on). When you ran `seed-store.mjs`
   yourself (connect/iterate runs, reference mode), there is no marker to wait for: the process's
   exit code is the result and its stdout is the JSON — wait on the process (a foreground run,
   or `wait` on its pid), not on a file. Then
   **build & release once** (managed), as the `next` of the `ready_for_brand_layer` event says
   for the stack: Astro → `npx @wix/cli@latest build` then `npx @wix/cli@latest release`;
   React or another bundler → the project's own build, then `npx @wix/cli@latest release` of
   the build folder named in `wix.config.json` (deep URLs must answer 200 directly, step 1);
   static → `release` alone. If the install failed, run it once more and then build. Don't
   build+release mid-flow; backend content is fetched at
   runtime, so a re-release never "refreshes" seeded data. The run is complete only when the
   site is released — close with the live URL and the dashboard link
   `https://manage.wix.com/dashboard/<siteId>` (the `siteId` of the `ready_for_brand_layer`
   event: on a migration preview that is the migrated site's dashboard, the release URL is the
   preview's, the original site is unchanged, and completing the migration is the user's next
   step in the Wix CLI once they approve — say all three). **Copy the live URL verbatim from the
   `wix release` output — never retype it from memory** (a mistyped subdomain hands the user
   a 404).

## Reference mode — a static site, or a server-rendered app in another language

The shipped data layer exists a second time as a **REST layer** over `fetch`, for the stacks that
cannot run `app/`: a static site with no bundler, or a server-rendered app in another language
(Flask, Laravel, Rails). The REST layer deploys for the browser side; the server side ports its
reads. When step 1 resolves to one of these stacks, read `<SKILL_ROOT>/guides/reference-mode.md`
before step 3: it holds the mechanics (the `site/` layout and setup's part in it, what runs in the
browser versus the server, the OAuth allow-list for a self-hosted origin, pre-rendered output) and
how to close such a run. A public site is still better served by managed Astro; say so when you
close.

## Verticals

| The user wants…                                                                              | Vertical          | Playbook                                   |
| -------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| Online store: products, categories, variants, cart, checkout                                 | **storefront**    | `templates/storefront/INSTRUCTIONS.md`    |
| Appointments/classes: services, time slots, staff, booking, checkout                         | **bookings**      | `templates/bookings/INSTRUCTIONS.md`      |
| Blog: post feed, categories/tags, rich-content post pages                                    | **blog**          | `templates/blog/INSTRUCTIONS.md`          |
| Structured content collections (directory, recipes, listings) with pages designed per schema | **cms**           | `templates/cms/INSTRUCTIONS.md`           |
| Any visitor-fillable form: contact/enquiry, signup, application, survey — rendered from the live schema | **forms**         | `templates/forms/INSTRUCTIONS.md`         |
| Events: listing, event pages, free RSVP, ticket sales via hosted checkout                    | **events**        | `templates/events/INSTRUCTIONS.md`        |
| Member accounts: custom in-app login/sign-up, gated pages, account page                      | **members**       | `templates/members/INSTRUCTIONS.md`       |
| Portfolio/showcase: collections of projects, project pages with media galleries              | **portfolio**     | `templates/portfolio/INSTRUCTIONS.md`     |
| Membership/subscription plans: pricing page, plan detail, hosted purchase                    | **pricing-plans** | `templates/pricing-plans/INSTRUCTIONS.md` |
| Restaurant: menu with photos, online ordering, table reservations                            | **restaurants**   | `templates/restaurants/INSTRUCTIONS.md`   |
| FAQ: questions grouped by category, search, expandable answers, a link per question         | **faq**           | `templates/faq/INSTRUCTIONS.md`           |
| Donations: campaign pages, goal progress, one-time and recurring giving via hosted checkout   | **donations**     | `templates/donations/INSTRUCTIONS.md`     |

Verticals compose: a brief that spans several (a restaurant with a blog, a store with member
accounts) deploys them together — setup takes one vertical; deploy the rest with
`node <SKILL_ROOT>/install/deploy.mjs <vertical…>` from the project root before the install
starts, and run each vertical's seed. A request that matches no shipped vertical has no shipped
code: it is built from the Wix API reference through `wix-docs` (search, then the method page),
with the same rule as every other call, on the same project and stack.

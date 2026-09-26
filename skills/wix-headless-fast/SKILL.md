---
name: wix-headless-fast
description: "Build a Wix Headless site fast by wiring SHIPPED, verified @wix/sdk code instead of authoring the integration from recipes. Each Wix business vertical ships a typed, framework-agnostic React core (data layer returning plain DTOs, hooks, headless components) plus an Astro overlay (SSR pages with owner-editable SEO pre-wired) and a build-time REST seed script — the agent scaffolds via the Wix CLI, deploys the shipped code, seeds the backend, designs the presentation layer itself on the shipped hooks (product card/grid, PDP, home, theme), and releases to Wix hosting. Works on Wix-managed Astro (ambient auth, the default) and on any React-based project (Vite, non-Astro) over the public OAuth client id. Verticals: stores/storefront (products, categories, variants, cart, hosted checkout), bookings (services, appointment/class time slots, staff, booking form, checkout-or-place), blog (posts, categories/tags, rich content), cms (structured content collections), forms (schema-driven visitor forms: render, validate, submit), events (listing, RSVP, ticket sales), members (login, gated pages, account), portfolio (project collections, media galleries), pricing-plans (plan grid, hosted purchase), restaurants (menus, online ordering, table reservations). Triggers: build me a store/blog/booking/event/restaurant/portfolio site fast, take appointments fast, sell tickets or membership plans headless, wix headless fast, connect a Wix business app with ready-made SDK code."
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

- **Shipped code is the implementation.** Every vertical ships under `references/<vertical>/`:
  - `app/` — the framework-agnostic core (TypeScript): a data layer that returns **plain,
    serializable DTOs** (images resolved to https URLs, prices pre-formatted), React hooks, and
    routing-free headless components. Works in Astro islands, Vite SPAs, and Next.
  - `app-astro/` — a thin Astro overlay: SSR pages that fetch via the core and pass DTOs to
    islands, with owner-editable item-page SEO pre-wired.
  - `seed/` — a build-time REST seed script (plain-data plan in, created content out) plus its
    `SEED.md` contract.
  - `INSTRUCTIONS.md` — the vertical's playbook: file map, what you build, hard rules.
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
  `references/shared/CUSTOM_OPERATIONS.md`. The presentation **doesn't ship**: the vertical's
  INSTRUCTIONS names the surfaces you design and implement yourself on the shipped hooks,
  with a skeleton carrying each surface's contract (for storefront: the shop and PDP pages
  with their islands, and home).
- **NEVER work from training data or memory about the Wix APIs.** Not a URL, a path, a version,
  a header, a field name, a filter key, or a body. Every Wix call you make or write — in the
  frontend, in a seed, in a build-time read of a site — comes from the official Wix skills
  installed here or from the official Wix documentation, which `wix-docs` is the way to. Read it
  there first, then write the call. A guessed call that returns 400 or an empty page is not a
  step toward the answer; it is the failure this rule exists to prevent, and trying the next
  variant is still guessing. The shipped code is tested against live sites; a body that looks
  similar is the one that returns nothing, and the API rarely says why.
- **Never mock, fail loudly, purchases via Wix.** Live data or an honest empty state; surfaced
  errors, not swallowed ones; checkout/purchase always through the Wix redirect session.
- **Optional capabilities are deployed from the plan.** A vertical can opt into a shared
  capability without copying sensitive code. For a normal file upload, add a named
  `capabilities.mediaUpload.policies` entry to the plan; Fast ships its client helper, Astro
  endpoint, dependencies, and generated policy module once. Read
  `references/shared/CUSTOM_OPERATIONS.md` before choosing it. The agent wires the helper to
  the product UI; it never authors or widens the endpoint.

## The run

1. **Resolve the stack.** Default is **Wix-managed Astro** — take it unless the user names
   another framework or the directory already holds one. Then, by what the shipped code can run
   there:
   - **React** (Vite, Next, …) runs everything shipped — data layer, hooks, components:
     `--stack react`. The agent's own files may be JS.
   - **Another bundled JS framework** (Vue, Svelte, Solid, plain Vite): the data layer and the
     framework-free stores run (`src/wix/` has no React in it), the React hooks and components
     don't apply: `--stack lib`. The agent binds the stores and writes its framework's components
     against the same contracts.
   - **No bundler, or another language** — a static site (plain HTML/CSS/JS), a server-rendered
     app (Flask, Laravel, Rails, …): **reference mode** (below). Nothing from `app/` deploys; the
     REST layer deploys for the browser side, and the server side ports it for its reads.
2. **The seed plan.** When the brief supplies the content in any form — a CSV, JSON or
   spreadsheet, a list in the prompt, a PDF price list, a folder of photos and a text file, a
   link to their current catalog, anything else that names the content — that IS the plan: map
   it into `plan.json` per `references/shared/SUPPLIED-CONTENT.md` and the vertical's `SEED.md`
   ("Supplied content"), every entry, names and prices verbatim, their images and no others.
   Draft a plan from the brief only when nothing was supplied (read only the vertical's
   `SEED.md` for this — it depends only on the brief; save the vertical's `INSTRUCTIONS.md` for
   step 4, where it's needed). **An existing site has no plan**: when the brief names a site by
   its id, the site holds the content already — nothing is seeded, and the frontend reads what
   is there (step 3's attach path). Requires from here on: Node ≥ 20.11 and a logged-in Wix CLI
   (`npx @wix/cli@latest whoami`; login via the device-code flow — surface the URL+code, never
   read tokens into context).
3. **Create runs (empty directory): run the fast path** — one deterministic call:

   ```bash
   node <SKILL_ROOT>/install/fast-path.mjs --business-name "<Brand>" --plan plan.json --vertical <vertical>
   ```

   `--vertical` is required and picks which shipped code deploys AND which seed runs — use
   the vertical you resolved from the Verticals table.

   fast-path scaffolds with `--skip-git`: it composes its own steps and leaves version control to
   you / the enclosing repo, so it does **not** create the scaffold's usual git repo + initial
   commit (which would otherwise become a nested-repo gitlink if the project lands inside a repo).

   The project is created **in the current directory** — the folder the entry had you work from,
   which already holds the installed skills — so the project is self-contained and a later session
   opened in it finds everything. It refuses if the folder already holds a file the scaffold would
   write. `--subfolder` creates it in a new folder named after the business instead, for a current
   folder that must stay as it is; the skills then sit one level above the project.

   It emits one JSON event per line and returns in **~35s**: **scaffolds** the project,
   **deploys** the shipped code (patching `package.json` with every dependency the code
   imports, and placing the pre-resolved lockfile), then **starts two detached background
   jobs** — the dependency install (`npm ci --ignore-scripts || npm install --ignore-scripts`)
   and the **seed** — whose logs and completion markers are in the events. The final
   `ready_for_brand_layer` event carries the project dir, siteId, ready-made dashboard links,
   and both markers. Relay notable events. On an `error` event, recover just that step via the
   manual path below, then continue.

   **Existing-site runs (the brief names a Wix site by its id — a new frontend for a site that
   already has its content): read the site, then run attach.** First, one call tells you what
   the site is — its name, currency, and the Wix apps installed on it:

   ```bash
   curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
     -H "Authorization: $(npx -y @wix/cli@latest token)" -H 'Content-Type: application/json' \
     -d '{"siteId": "<siteId>"}'
   ```

   The installed apps name the verticals (Wix Stores → storefront, Wix Bookings → bookings, and
   so on per the Verticals table); the brief picks among them. Then one deterministic call, same
   shape as the fast path:

   ```bash
   node <SKILL_ROOT>/install/attach.mjs --site <siteId> --business-name "<site name>" --vertical <vertical>[,<vertical>]
   ```

   `init`/`wix create` always create a site, so they are not used here. attach does what they do
   after creating one — the site's OAuth app, Wix hosting, `wix.config.json` — against the site
   given, scaffolds the CLI's Astro template, deploys the shipped code, and starts the install
   detached. No seed runs and nothing on the site changes: the content is the site's own, read
   live through the deployed data layer. When the site already has a headless frontend,
   `attached` says so (`hosting: "reused"`) with its URL — `wix release` from this project
   replaces that frontend; say so when you close.

   **Get the measure of the site before you design.** Enough to know what you are building
   for: what the chosen verticals will render, roughly how much of it, and what it is like — a
   bakery with six products in three categories designs differently from six hundred. Go
   deeper only where the brief points (a flash sale on cakes: is there a Cakes category, do the
   cakes carry a sale price). Everything else the pages read live through the deployed data
   layer; you are sizing the content, not collecting it. These are build-time reads with the
   **site's** token, `npx -y @wix/cli@latest token --site <siteId>`, sent raw as the
   `Authorization` header (the account token from the call above does not scope to a site).
   **The rule above applies in full: not one of these calls comes from memory.** Read the
   request where it is written, then call. Where to read, in this order:
   - **The vertical's shipped `rest/` module**, at
     `.agents/skills/wix-headless-fast/references/<vertical>/rest/` — the same reads the pages
     make, written as literal `fetch` calls: URL, body, `fields`, filter keys. It is not in
     `src/` (the Astro stack deploys the SDK layer, which hides the body behind a method), so
     read it from the skill.
   - **`wix-manage`**, at `.agents/skills/wix-manage/` — REST recipes for managing a site's
     business solutions: exact endpoint, method and payload per operation, curl included. Its
     SKILL.md is the index, by solution; open the recipe for the vertical's solution.
   - **`wix-docs`**, at `.agents/skills/wix-docs/` — the Wix API reference, reached by
     **search, not by browsing files**: the skill folder holds the how-to, not the pages. Open
     its SKILL.md; it gives one `curl` to semantic search (`POST
     /mcp-docs-search/v1/docs/search/markdown`, natural-language `search_term`) that returns
     condensed method docs — endpoint, request example, response shape — and the rule that any
     `dev.wix.com/docs/…` URL plus `.md` is the full page. Progressive: search first, read the
     full page only when the hit lacks what you need.
   If what you opened does not have the call, go to the next; do not try a variant.

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
   your summary — if non-zero, read `seed.log` and re-run the seed module manually). Those two
   seed files exist **only when fast-path started the seed** (attach runs none: only the install
   marker is waited on). When you ran `seed-store.mjs`
   yourself (connect/iterate runs, reference mode), there is no marker to wait for: the process's
   exit code is the result and its stdout is the JSON — wait on the process (a foreground run,
   or `wait` on its pid), not on a file. Then
   **build & release once** (managed):
   `npx @wix/cli@latest build` then `npx @wix/cli@latest release` (if the install failed, run
   it once more and then build). Don't build+release mid-flow; backend content is fetched at
   runtime, so a re-release never "refreshes" seeded data. The run is complete only when the
   site is released — close with the live URL and the dashboard link
   `https://manage.wix.com/dashboard/<siteId>`. **Copy the live URL verbatim from the
   `wix release` output — never retype it from memory** (a mistyped subdomain hands the user
   a 404).

## Reference mode — a static site, or a server-rendered app in another language

The data layer ships a second time as a **REST layer**: `references/shared/rest/` (the auth seam
`client.ts`, `media.ts`, `config.ts`) and `references/<vertical>/rest/` (the same exports as the
vertical's `app/wix/<vertical>/` data layer, over `fetch`), typed against the same `types.ts` and
importing the same `*-core.ts` rule files as the SDK layer — one implementation of the rules, two
transports. The vertical's `INSTRUCTIONS.md` names its modules and what each surface does with
them; this section is the mechanics, the same for every vertical.

- **Static site (no bundler).** `npm create @wix/new@latest init` in the project folder (site,
  OAuth app, `wix.config.json`). The site lives in a **subfolder** — `site/` — holding only the
  pages, styles, and `js/`; set `site.outputDirectory` in the config to `"./site"`. `wix release`
  uploads that directory whole, so the project root (config, `plan.json`, seed output, anything
  else) must not be it. Then `node <SKILL_ROOT>/install/deploy.mjs <vertical> --stack static --out
  site` composes the REST layer and the vertical's framework-free stores flat into `site/js/wix/`
  and strips them to browser ESM (comments kept, the `.ts` kept beside the `.js` to read). Pages
  import the vertical's modules from `./js/wix/` in a `<script type="module">`: the stores hold
  the state machines (subscribe, render from `getState()`, call actions), the page holds the
  rendering. The visitor token lives in `localStorage` and is the
  visitor's identity across Wix — never mint one per page. A route is a page plus a query-string
  slug (`item.html?slug=…`). Wix static hosting serves files, not directories: `/shop` does not
  resolve to `shop/index.html`, and there is no routes configuration — name the file and link
  to it. Seed per the vertical's `SEED.md` (Node + the CLI token, no project dependencies).
  Release with `npx @wix/cli@latest release` — no build. Item-page tags come from the entity's
  `seoData`, set after the fetch (`document.title`, the meta description).
- **Server-rendered, another language (Flask, Laravel, Rails, …).** The same shape as managed
  Astro — pages rendered on the server, the interactive surfaces in the browser — with hosting and
  SEO plumbing theirs. `init` still runs in the project folder; run `deploy.mjs <vertical> --stack
  static` there too: it only needs `wix.config.json` and writes `js/wix/`. Split by where the call
  runs:
  - **Reads render on the server.** Port the vertical's `rest/` read module and its `*-core.ts` to
    the server language: each function is one HTTP call with a literal URL and JSON body, and the
    core carries the rules. That code is tested and proven against live sites — carry its bodies
    over as they are, `fields` arrays and filter keys included (they are not guessable, and a
    near-miss returns empty or unformatted data with no error), and render what Wix returns
    (`formattedAmount`, never a number you format yourself). The shipped JS runs: when in doubt,
    run the module with Node against the same site and compare one entity with your port. Public
    reads need no visitor identity — one anonymous visitor token per server process, refreshed per
    `client.ts`, is enough for them.
  - **Visitor-specific state runs in the browser.** Whatever the vertical does on the visitor's
    behalf (a store's cart and checkout, a booking, an RSVP, a form submit) loads the vertical's
    `js/wix/` module in the templates and talks to Wix from the page, exactly as a static site
    does: the browser owns the visitor token in `localStorage`, so the server handles no
    per-visitor tokens. If that state must run server-side anyway, `client.ts`'s header applies:
    one token set per visitor in the visitor's session, never one process-wide token (that is one
    identity shared by everyone).
  - **Pre-rendered → Wix-hosted.** If the project builds to static HTML (Frozen-Flask, Pelican,
    Hugo, Eleventy, any static-site generator), Wix can host the output: run `deploy.mjs
    <vertical> --stack static --out <build dir>` so `js/wix/` lands inside the build output (or
    copy it there after each build), make the generator emit a page for **every** entity slug the
    vertical's list read returns (walk it by cursor, never only the first page), point
    `site.outputDirectory` at the build folder, `wix release`. The build's own reads use one
    anonymous visitor token for the duration of the build. What Wix hosts is exactly the contents
    of that folder after your last build, served as files: every asset a page references must be
    in there and current — if the pipeline has more than one build step (templates, then a CSS or
    asset bundle), they all run, in order, on every rebuild, or the release carries a stale piece.
    `/shop` does not resolve to `shop/index.html`; name the file and link to it. Generated pages
    sit at different depths, so reference `js/wix/` through one base path (a template variable,
    or root-relative `/js/wix/…`), never `./js/wix/` — a relative path breaks one level down. **The generated page
    is the first paint, not the whole surface**: the vertical's interactive behaviour (a store's
    sort, filters, and cart; a blog's search; a booking flow) still runs client-side on top of it
    from the same `js/wix/` modules, so the vertical's surface contracts in `INSTRUCTIONS.md`
    apply unchanged. Close with the rebuild + release command and one line for the owner: content
    edits made in the dashboard reach the site when that command runs; the browser-side flows are
    live regardless. A running server (live reads on every request) stays theirs to host.
  Then read the vertical's `INSTRUCTIONS.md` for the surfaces and hard rules, and the shared
  `DESIGN.md`/`CONTENT.md`. **Before writing any surface, read the vertical's shipped hooks and
  components** — its `INSTRUCTIONS.md` lists which files and what to take from each. They don't
  deploy on this stack, and they are working, tested code for exactly the behaviour you are about
  to write in your own; rewriting them from prose is where the bugs come from (the runs that
  skipped them shipped a broken quick-add, the run that read them didn't). Both were written for
  the stacks that receive the code, so they speak that stack's dialect: the Tailwind classes in the
  skeletons and the components are one spelling of layout and behaviour rules that hold everywhere
  (a bounded image band on phones, name and price on separate lines, the buy control pinned to the
  tile's bottom, an overlay that locks scroll and returns focus). Take the rules; write them in the
  CSS your stack uses, on a token set you define — nothing here asks you to add Tailwind. Close with run (or
  rebuild) instructions, the live URL when Wix hosts the output, the dashboard link, and — when
  hosting is theirs — the allowed-domain step (add the public https origin to the OAuth app
  before a Wix-hosted flow such as checkout can return).
- Both: the calls in `rest/` are the ones a **visitor token** may make from a page — public reads
  and the visitor's own actions. Anything elevated (writes to content, other people's data) runs
  server-side per `references/shared/CUSTOM_OPERATIONS.md`; the seed's CLI token never belongs in
  a page. A static site has no SSR; neither case has owner-editable item-page SEO through
  `@wix/seo` (tags come from the entity's `seoData`) — say so in the closing message; managed
  Astro stays the recommendation for a public site.

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
  INSTRUCTIONS.md      # playbook: file map, wiring per stack, what you build, hard rules
  app/                 # framework-agnostic core — disjoint paths so verticals never collide:
    wix/<vertical>/    #   types.ts (DTOs) + data layer (calls via ../sdk, images via ../media)
                       #   + *-store.ts: the state machines, framework-free (ship on every stack)
    hooks/<vertical>/  #   React hooks — thin bindings of the stores (SSR-friendly: accept initial data)
    components/<vertical>/  # routing-free components (plain <a> default + LinkComponent prop)
    styles/global.css  # Tailwind v4 + the @theme design tokens (shared token family)
  app-astro/           # Astro overlay importing ONLY from the core:
    pages/…            #   SSR fetch → DTO props → client:load islands; item pages carry
                       #   wixMetadata + <SEO.Tags>; chrome islands are client:only
                       #   (storefront ships no pages — its INSTRUCTIONS carries their skeletons)
    layouts/…          #   (reuse SiteLayout when it fits)
  seed/                # seed-<vertical>.mjs (REST, mints its own CLI token) + SEED.md
  rest/                # the REST twin of app/wix/<vertical>/: same exports over fetch, importing
                       #   the same *-core.ts (rules + DTO mappers, type-only imports) and types.ts;
                       #   flat ./x.js imports — deploy --stack static composes and strips it
```

Core rules the structure encodes: a rule or mapper lives once, in `app/wix/<vertical>/*-core.ts`,
imported by both transports (a call added to `app/` gets its `rest/` twin in the same PR; `tsc`
over both is the parity check); raw API entities never leave the data layer (DTOs only);
client-shared state uses a module-scope store (never React context — it can't span Astro
islands); every image URL is resolved through `src/wix/media.ts`; every money value is a
formatted string by the time a component sees it.

# Reference mode: a static site, or a server-rendered app in another language

Read when SKILL.md step 1 resolves to a stack that cannot run `app/`. `<SKILL_ROOT>` is the
installed skill folder; the shipped code is under `<SKILL_ROOT>/templates/`. Steps 2 to 5 of
SKILL.md still apply; this file is the mechanics that differ.

The data layer ships a second time as a **REST layer**: `templates/shared/rest/` (the auth seam
`client.ts`, `media.ts`, `config.ts`) and `templates/<vertical>/rest/` (the same exports as the
vertical's `app/wix/<vertical>/` data layer, over `fetch`), typed against the same `types.ts` and
importing the same `*-core.ts` rule files as the SDK layer — one implementation of the rules, two
transports. The vertical's `INSTRUCTIONS.md` names its modules and what each surface does with
them; this section is the mechanics, the same for every vertical. The site-search capability
(`templates/shared/capabilities/site-search/`, on from `plan.capabilities.siteSearch`) has the same
two transports: with `--plan` its REST twin and stores land in `js/wix/` beside the vertical's
(`search.js`, `search-store.js`, `suggest-store.js`), and its `INSTRUCTIONS.md` applies.

- **Static site (no bundler).** Step 3's setup with `--stack static` runs `init` in the project
  folder (site, OAuth app, `wix.config.json`), points `site.outputDirectory` at `"./site"`, and
  runs `deploy.mjs <vertical> --stack static --out site`, which composes the REST layer and the
  vertical's framework-free stores flat into `site/js/wix/` and strips them to browser ESM
  (comments kept, the `.ts` kept beside the `.js` to read). The site lives in that **subfolder**,
  `site/`, holding only the pages, styles, assets and `js/`: `wix release` uploads it whole, so the
  project root (config, `plan.json`, seed output, the skills) must not be it; move the pages in.
  (On a project that already has its config, the same `deploy.mjs` call does the deploy.) Pages
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
  - **A Wix-hosted flow returns to the origin that started it, and only to one it knows.**
    Checkout, a booking payment, a plan purchase all open on Wix and come back to your server;
    the return works only for an origin on the site's OAuth app allow-list. Add the server's
    origin — the dev one while verifying (`http://localhost:<port>`), the public https one when it
    goes live — before the first checkout test: wix-manage's *Manage OAuth Apps* recipe, "Update an
    OAuth App", field `allowedRedirectDomains`, on the app whose id is `appId` in
    `wix.config.json`. Without it the Wix page opens and cannot return. Do it; do not only say it.
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
    a clean path does not resolve to a folder's `index.html`; name the file and link to it. Generated pages
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
  hosting is theirs — which origins are on the OAuth app's allow-list and that the public one
  must be added when the server moves (the step above).
- Both: the calls in `rest/` are the ones a **visitor token** may make from a page — public reads
  and the visitor's own actions. Anything elevated (writes to content, other people's data) runs
  server-side per `templates/shared/CUSTOM_OPERATIONS.md`; the seed's CLI token never belongs in
  a page. A static site has no SSR; neither case has owner-editable item-page SEO through
  `@wix/seo` (tags come from the entity's `seoData`) — say so in the closing message; managed
  Astro stays the recommendation for a public site.

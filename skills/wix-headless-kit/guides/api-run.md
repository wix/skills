# The kit's run as Wix API calls

Read when the commands this skill is built on cannot run where you are, or stopped: your shell
can't reach Wix, there is no shell, or the install, the
CLI or the login is blocked. Wix is then reachable through the Wix MCP: every call below is an
`ExecuteWixAPI` call, and files reach the site through the upload recipe. It walks the run of
SKILL.md step by step and names, for each, the Wix API call the CLI or the script performs and the
file beside this skill that carries the contract; where a script can run where you are, it says so.

## Where these skills are

This skill is one of a set, and the guide reads from three of them:

- `{SKILL_ROOT}` — this skill, `wix-headless-kit`: the run, its guides, the Verticals table.
- `{TEMPLATES}` — `wix-headless-templates`: the shipped, verified code per Wix Business Solution,
  one folder each, with its `INSTRUCTIONS.md` (the contracts), `seed/` (the seed script and
  `SEED.md`) and `rest/` (the data layer over plain `fetch`). Installed beside this skill, or
  fetched to `{SKILL_ROOT}/templates/`.
- `{MANAGE}` — `wix-manage`: REST recipes to configure and manage a site's business solutions, one
  recipe per operation with the exact endpoint and payload; its `SKILL.md` is the index.
- `{DOCS}` — `wix-docs`: how to look up the Wix API and SDK documentation and confirm a method's
  exact shape before writing a call.

Installed, they sit beside each other wherever your client keeps them: under `.agents/skills/` after
`npx skills add`, or in a plugin's folder. Read them from disk when they are there. Online, they are
published alongside each other under the same names, each with a manifest of its files, and in the
`wix/skills` repository on GitHub under `skills/{skill}/`; a sandbox that reaches GitHub has the
whole set on disk from a clone. Online pages are read with the Wix MCP's `ReadFullDocsArticle`
when it is connected: a client's web fetch may open only URLs the user gave or a search returned.

What such a run does not produce: the Astro build and its release. Those need a machine with the
CLI. Everything else the kit does to a site, it does through calls you can make, the frontend
included: step 5 ships it as static files.

## 0. Identity

Every call below runs as the site owner, with whatever identity your host gives you: the Wix
MCP's `ExecuteWixAPI` carries the user's login; an API key from the user's account goes in the
`Authorization` header of any call, as `{MANAGE}/SKILL.md` describes; a site token from the Wix CLI
works the same way when the user runs the CLI for you. The site's OAuth app (`client_id`) mints
visitor tokens only, which cover what a visitor may see and nothing here.

## 1. The brief → the solutions

Unchanged from SKILL.md step 2 and its Verticals table: the brief names the business, the table
names the solutions it needs. Read each solution's `{TEMPLATES}/{solution}/INSTRUCTIONS.md` for
what it covers and `{TEMPLATES}/{solution}/seed/SEED.md` for what a seeded site holds.

A brief that needs no solution (a game, a landing page, a tool) is a run of two steps: the site
(step 2, with no `seedOptions`) and the frontend (step 5). No apps, no seed.

## 2. The site

The CLI's `npm create @wix/new` is one call: `POST /headless-business-setup/v1/headless-business/provision`,
with `origin: agent-<your-id>`, a name, and the solutions to install as `seedOptions`. The recipe
is `{MANAGE}/references/sites/create-headless-site.md`; it returns the `metaSiteId` and the
site's OAuth client `appId`. Do not create a site any other way: a project from Create Project or
a template is neither headless nor publishable, and a later run with a machine cannot attach to it.

A site that already exists (the brief names it) is read first, never seeded unasked: SKILL.md
step 2 and `{SKILL_ROOT}/guides/existing-site.md` apply as written.

## 3. The apps

A solution the provision call did not install, or a capability's app (Members Area, Forms,
Restaurants, Donations, FAQ), goes on with the Apps Installer:
`{MANAGE}/references/app-installation/install-wix-apps.md`. The app ids are in each
`seed-{solution}.mjs`, which installs them before seeding.

## 4. The seed

`seed-{solution}.mjs` is a sequence of REST calls, and `SEED.md` is its contract: the plan shape
(what to create, how many, which images), the order the entities need, and the traps the script
encodes (a Bookings service needs a category to be visible and takes resource ids, not staff ids;
a Forms field is registered by its `validation` block; a product's choice photos are linked after
the gallery holds them; a product without options comes out of the bulk create `OUT_OF_STOCK`, even
when its inventory reports a provisioning error, and is stocked by a second call, Bulk Create
Inventory Items, as `SEED.md` says; stock that isn't counted, such as "made to order", is
`inStock: true`, never a missing quantity, which leaves the product unbuyable). Read `SEED.md`
before the first create call: it maps the brief's words to the fields. Then read the script for any
call `SEED.md` only names, and make the same
calls through `{MANAGE}`'s recipe for each (services, products, posts, events, collections). Keep
the script's rules: create, never delete, and report what the site already held. A photo already in
the site's Media Manager, such as one the user uploaded, goes in by its file id (`imageMediaId` in
`SEED.md`), as it is: an import by URL would copy it. A photo on a site the user dropped is served
with the drop, not from the Media Manager: it goes in by its live URL, imported once through
`{MANAGE}/references/media/upload-media-to-wix.md`, and the file id the import returns is what the
product or service takes. Image prompts need the Media Manager; without
it, products and services stay text-only, say so. The scripts read
a response body directly; `ExecuteWixAPI`'s `wix.request` returns `{ status, data }`, and the body
is `data`. A generated image is billed when it is generated, so a read of the wrong level discards
a paid image.

## 5. The frontend

The run is not done until the pages use what the backend holds: every control the page shows for
it (add to cart, the cart, book, submit) works on the live site. A backend with untouched pages is
half a run.

The Astro pages cannot be released here: that is a run with a machine and a CLI login, which
attaches to this site (`guides/existing-site.md`) rather than making a new one. What ships from here
is static files, dropped onto the site from step 2 through
`{MANAGE}/references/sites/upload-static-site.md`: the Wix MCP's upload tool, or a script that
downloads what the site serves, edits it and drops it back, so only what changed is written. Which
files depends on whether the compose can run, and on what writing them costs: when files reach the
upload tool as files (its `attachments`), anything on your disk travels as it is; when they don't,
every file you send is text you write, and the smallest set wins.

**When the compose can run** (the skills on disk, Node, and npm reachable, for the TypeScript compiler it fetches), the frontend is the kit's own shipped code. The compose
`{SKILL_ROOT}/install/deploy.mjs {solution} --stack static --out site --client-id {appId}` fetches the
templates and writes the solution's REST data layer and stores to `site/js/wix/` as plain ES modules
(`guides/reference-mode.md`, the static site): the transport, the cores, the state machines, verified,
with the `.ts` beside each `.js` for reading. You write the pages and the rendering on those stores,
imported relative to `site/` in a `<script type="module">`, and nothing of the data layer. The drop
takes the complete file set in one call and a response has a hard size limit; the recipe's "Change it
later" section downloads what the site serves, so a later drop adds files to a live set without
resending what is already there.

**When it cannot**, or when its output would all have to be written out by hand, a page that loads
the Wix SDK from a package CDN and talks to the site as a visitor. One file per call, a few hundred lines, written in full inside that call: a response has a
hard size limit, and a call that carries the whole frontend at once exceeds it. A second file joins
the first the recipe's way, "Change it later": the same call downloads the live set and drops the
union. The
SDK comes from a pinned package URL, `https://esm.sh/@wix/sdk@{version}` and the solution's package
(`@wix/bookings`, `@wix/stores`, `@wix/blog`, …); the client is
`createClient({ modules: { … }, auth: OAuthStrategy({ clientId }) })` with the `appId` the provision
call returned, and the SDK mints and refreshes the visitor token itself. Markup, a render function
per state, the event handlers: that is what you write. Keep what the page shows to what the site
holds; nothing invented, as in SKILL.md step 4.

**The calls**, on that second path, take their shape from the kit's own transport for the solution,
`{TEMPLATES}/{solution}/app/wix/{solution}/*.ts` (`services.ts`, `booking.ts`, `catalog.ts`, …,
with `{TEMPLATES}/shared/app/wix/sdk.ts` for the client wiring): those files call the same SDK
modules the page imports, and they are verified. Copy the form of the call, not the file. The
cores beside them (`*-core.ts`) hold the rules the page needs and nothing else does: which fields
to read, how a price or a duration is formatted, which slot is bookable, how an id is read. Copy
those core functions into the page as they are, with only the types removed (`cart-core.ts`'s
`toLine` and `toCart`, the price formatter, `rawId`), and run every API response through them: a
raw field read by hand is where a page breaks (a product name is a translatable object, a cart
line's quantity is `quantityInfo.confirmedQuantity`). What you write is the markup, the rendering
of what the cores return, and the event handlers.

**A call those files don't cover** is confirmed before it is written, the way `{DOCS}` describes:
the method's SDK page, and when the page and the package disagree, the package's own type
declarations (the `@wix/auto_sdk_{solution}_<module>` package the solution package depends on,
its `index.d.ts`) are the truth. Two shapes that recur, as examples of what the types settle and
the kit's files already encode: SDK query methods return a query builder finished with `.find()`;
and an entity's id arrives as `_id` on some objects and `id` on others (the kit reads both,
`rawId`). Dates travel as local wall-clock strings in the business time zone. A page cannot be run
here, so a wrong shape fails silently in the browser; the file beside the skill is the check that is
available.

## 6. Closing

SKILL.md step 5's closing, with two additions: the site id, so a run with a machine attaches to this
site (`guides/existing-site.md`) instead of making a new one; and, when files were dropped, that a
change re-drops the whole set.

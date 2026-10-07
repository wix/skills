# No machine: the kit's run through the Wix APIs

Read when you cannot run the commands this skill is built on: no shell, no file system, no Node, a
sandbox that blocks the install, the CLI or the login, or a host that only talks to Wix through
the Wix MCP. Nothing in this guide installs, downloads or runs anything. It walks the run of
SKILL.md step by step and names, for each, the Wix API call the CLI or the script performs, and
the file beside this skill that carries the contract.

## Where these skills are

This skill is one of a set, and the guide reads from three of them:

- `<SKILL_ROOT>` — this skill, `wix-headless-kit`: the run, its guides, the Verticals table.
- `<TEMPLATES>` — `wix-headless-templates`: the shipped, verified code per Wix Business Solution,
  one folder each, with its `INSTRUCTIONS.md` (the contracts), `seed/` (the seed script and
  `SEED.md`) and `rest/` (the data layer over plain `fetch`). Installed beside this skill, or
  fetched to `<SKILL_ROOT>/templates/`.
- `<MANAGE>` — `wix-manage`: REST recipes to configure and manage a site's business solutions, one
  recipe per operation with the exact endpoint and payload; its `SKILL.md` is the index.
- `<DOCS>` — `wix-docs`: how to look up the Wix API and SDK documentation and confirm a method's
  exact shape before writing a call.

They install together and sit beside each other. When you are reading this skill online rather
than from an install, the others are published alongside it, by those names, and each skill's
manifest lists its files. Read each file in full: a fetch tool that summarizes drops the exact
calls and shapes; a tool that returns the file's text, or one that runs code and can fetch a URL,
does not.

Two things such a run does not produce, and never claims: a frontend built from the shipped `app/`
code (that needs a build), and a release of one. Everything else the kit does to a site, it does
through calls you can make.

## 0. Identity

Every call below runs as the site owner, with whatever identity your host gives you: the Wix
MCP's `ExecuteWixAPI` carries the user's login; an API key from the user's account goes in the
`Authorization` header of any call, as `<MANAGE>/SKILL.md` describes; a site token from the Wix CLI
works the same way when the user runs the CLI for you. The site's OAuth app (`client_id`) mints
visitor tokens only, which cover what a visitor may see and nothing here.

## 1. The brief → the solutions

Unchanged from SKILL.md step 2 and its Verticals table: the brief names the business, the table
names the solutions it needs. Read each solution's `<TEMPLATES>/<solution>/INSTRUCTIONS.md` for
what it covers and `<TEMPLATES>/<solution>/seed/SEED.md` for what a seeded site holds.

## 2. The site

The CLI's `npm create @wix/new` is one call: `POST /headless-business-setup/v1/headless-business/provision`,
with `origin: agent-<your-id>`, a name, and the solutions to install as `seedOptions`. The recipe
is `<MANAGE>/references/sites/create-headless-site.md`; it returns the `metaSiteId` and the
site's OAuth client `appId`. Do not create a site any other way: a project from Create Project or
a template is neither headless nor publishable, and a later run with a machine cannot attach to it.

A site that already exists (the brief names it) is read first, never seeded unasked: SKILL.md
step 2 and `<SKILL_ROOT>/guides/existing-site.md` apply as written.

## 3. The apps

A solution the provision call did not install, or a capability's app (Members Area, Forms,
Restaurants, Donations, FAQ), goes on with the Apps Installer:
`<MANAGE>/references/app-installation/install-wix-apps.md`. The app ids are in each
`seed-<solution>.mjs`, which installs them before seeding.

## 4. The seed

`seed-<solution>.mjs` is a sequence of REST calls, and `SEED.md` is its contract: the plan shape
(what to create, how many, which images), the order the entities need, and the traps the script
encodes (a Bookings service needs a category to be visible and takes resource ids, not staff ids;
a Forms field is registered by its `validation` block; a product's choice photos are linked after
the gallery holds them). Read `SEED.md`, read the script for any call `SEED.md` only names, and make the same
calls through `<MANAGE>`'s recipe for each (services, products, posts, events, collections). Keep
the script's rules: create, never delete, and report what the site already held. Image prompts
need the Media Manager; without it, products and services stay text-only, say so.

## 5. The frontend

The shipped `app/` code cannot be built here, and the Astro pages cannot be released. A page can
still be shipped: one self-contained `index.html` that loads the Wix SDK from a package CDN and
talks to the site as a visitor, dropped onto the site from step 2 through
`<MANAGE>/references/sites/upload-static-site.md`. The kit's own frontend for this site is a run
with a machine, which attaches to this site (`guides/existing-site.md`) rather than making a new one.

**The page.** One file, a few hundred lines, written in full before the first drop: the drop takes
the complete file set in one call, and a response has a hard size limit, so there is no second
pass. The SDK comes from a pinned package URL, `https://esm.sh/@wix/sdk@<version>` and the
solution's package (`@wix/bookings`, `@wix/stores`, `@wix/blog`, …); the client is
`createClient({ modules: { … }, auth: OAuthStrategy({ clientId }) })` with the `appId` the provision
call returned, and the SDK mints and refreshes the visitor token itself. Markup, a render function
per state, the event handlers: that is what you write. Keep what the page shows to what the site
holds; nothing invented, as in SKILL.md step 4.

**The calls.** Take every SDK call's shape from the kit's own transport for the solution,
`<TEMPLATES>/<solution>/app/wix/<solution>/*.ts` (`services.ts`, `booking.ts`, `catalog.ts`, …,
with `<TEMPLATES>/shared/app/wix/sdk.ts` for the client wiring): those files call the same SDK
modules the page imports, and they are verified. Copy the form of the call, not the file. The
cores beside them (`*-core.ts`) hold the rules the page needs and nothing else does: which fields
to read, how a price or a duration is formatted, which slot is bookable, how an id is read.

**A call those files don't cover** is confirmed before it is written, the way `<DOCS>` describes:
the method's SDK page, and when the page and the package disagree, the package's own type
declarations (the `@wix/auto_sdk_<solution>_<module>` package the solution package depends on,
its `index.d.ts`) are the truth. Two shapes that recur, as examples of what the types settle and
the kit's files already encode: SDK query methods return a query builder finished with `.find()`;
and an entity's id arrives as `_id` on some objects and `id` on others (the kit reads both,
`rawId`). Dates travel as local
wall-clock strings in the business time zone. A page cannot be run here, so a wrong shape fails
silently in the browser; the file beside the skill is the check that is available.

## 6. Closing

As in SKILL.md step 5, minus the live URL when nothing was released: what exists on the site, by
name; the dashboard link `https://manage.wix.com/dashboard/<metaSiteId>` and each solution's own
pages from its INSTRUCTIONS.md table; what is placeholder; payments, when the site takes money;
and what this run could not do, with the site id, so a run with a machine continues here.

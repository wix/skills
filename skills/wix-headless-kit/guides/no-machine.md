# No machine: the kit's run through the Wix APIs

Read when you cannot run the commands this skill is built on: no shell, no file system, no Node, a
sandbox that blocks the install, the CLI or the login, or a host that only talks to Wix through
the Wix MCP. Nothing in this guide installs, downloads or runs anything. It walks the run of
SKILL.md step by step and names, for each, the Wix API call the CLI or the script performs, and
the file beside this skill that carries the contract. `<TEMPLATES>` is the `wix-headless-templates`
skill, installed beside this one (or fetched to `<SKILL_ROOT>/templates/`); `<MANAGE>` is the
`wix-manage` skill beside it.

Two things such a run does not produce, and never claims: a frontend built from the shipped `app/`
code (that needs a build), and a release of one. Everything else the kit does to a site, it does
through calls you can make.

## 0. Identity

Every call below runs as the site owner. The Wix MCP's `ExecuteWixAPI` carries the user's login;
without the MCP the user hands you a token (a site token from the Wix CLI, an API
key, or an OAuth app from their account, per `<MANAGE>/SKILL.md`). A visitor token covers only what
a visitor may see.

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

The shipped `app/` code cannot be built here, and the Astro pages cannot be released. What you
can read: `<TEMPLATES>/<solution>/INSTRUCTIONS.md` for the contracts, `<TEMPLATES>/<solution>/rest/`
and `<TEMPLATES>/shared/rest/` for the data layer over plain `fetch` (what a page asks of Wix and in
which order). What you can ship: static files, written in the conversation, through
`<MANAGE>/references/sites/upload-static-site.md`, which drops them onto the site from step 2 and
releases them. A page written that way is a static site; the kit's own frontend for this site is
a run with a machine, which attaches to this site (`guides/existing-site.md`) rather than making a
new one.

## 6. Closing

As in SKILL.md step 5, minus the live URL when nothing was released: what exists on the site, by
name; the dashboard link `https://manage.wix.com/dashboard/<metaSiteId>` and each solution's own
pages from its INSTRUCTIONS.md table; what is placeholder; payments, when the site takes money;
and what this run could not do, with the site id, so a run with a machine continues here.

# The kit's run as Wix API calls

Read when the commands this skill is built on cannot run where you are, or stopped: your shell
can't reach Wix, there is no shell, or the install, the
CLI or the login is blocked. Wix is then reachable through the Wix MCP: every call below is an
`ExecuteWixAPI` call, and files reach the site through the upload recipe. With no Wix MCP tools in
your tool list (a plugin's skills can be on disk while its Wix connector is not connected), ask the
user to connect Wix to this chat first. It walks the run of
SKILL.md step by step and names, for each, the Wix API call the CLI or the script performs and the
file beside this skill that carries the contract; where a script can run where you are, it says so.

As in SKILL.md's run, keep the site working at every step so the user can try it as it grows.
Steps only the site owner can take never hold a flow back: drafted content is live, and anything
that takes money reaches Wix's checkout before payments are connected. The owner's steps go in the
closing with their links, as next steps the user can take or ask for.

## Where these skills are

This skill is one of a set, and the guide reads from three of them:

- `{SKILL_ROOT}` — this skill, `wix-headless-kit`: the run, its guides, the Verticals table.
- `{TEMPLATES}` — `wix-headless-templates`: the shipped, verified code per Wix Business Solution,
  one folder each, with its `INSTRUCTIONS.md` (the contracts), `seed/` (the seed script and
  `SEED.md`) and `rest/` (the data layer over plain `fetch`). Not every install carries it (a
  plugin may leave it out): it is installed beside this skill, or fetched to
  `{SKILL_ROOT}/templates/` by `node {SKILL_ROOT}/install/templates.mjs` (a git clone), or installed
  with `npx skills@latest add wix/skills --skill wix-headless-templates`; with none of those, read
  online at `https://www.wix.com/skills/wix-headless-templates/{path}`.
- `{MANAGE}` — `wix-manage`: REST recipes to configure and manage a site's business solutions, one
  recipe per operation with the exact endpoint and payload; its `SKILL.md` is the index.
- `{DOCS}` — `wix-docs`: how to look up the Wix API and SDK documentation and confirm a method's
  exact shape before writing a call.

Installed, they sit beside each other wherever your client keeps them: under `.agents/skills/` after
`npx skills add` or a similar skills folder, or in a plugin's folder. A skill your client offers you
by name is read from there, or through the client's skill tool when it is served rather than a file,
with no install, clone or online read. List them first, through that tool or the folder: a catalog
shown at the start can leave skills out. Online, they are published alongside each other under the
same names (the registry also serves each without its `wix-` prefix, `headless-templates` for
`wix-headless-templates`, which is the `base` its manifest shows; both forms resolve), and in the
`wix/skills` repository on GitHub under `skills/{skill}/`; a sandbox that reaches GitHub has the
whole set on disk from a clone. Online pages are read with the Wix MCP's `ReadFullDocsArticle` when
it is connected: a client's web fetch may open only URLs the user gave or a search returned.

Online, a skill's files are found through its manifest,
`https://www.wix.com/skills/{skill}.manifest.json` (for the templates,
`headless-templates.manifest.json`): every file it holds, by path, with its size in bytes. A
folder's URL lists its files, and `<folder>/_content` returns them in one response. Open it once
before the first file and take each path from it: the files this guide names by pattern
(`{solution}/rest/*.ts`, `*-core.ts`), and the files an import points to. A path the manifest
doesn't list is a wrong path; find the file there before writing anything in its place. A copy you
hold, served or on disk, is current when its size in bytes matches the manifest's; a file whose size
differs is read online.

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
with `origin: "drop"`, a name, and the solutions to install as `seedOptions`. The recipe
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
(what to create, how many, which images), the order the entities need, the request bodies and the
traps the script encodes. Write the seed as your own `ExecuteWixAPI` script, its calls made on the
new site: `wix.request({ scope: "site", siteId: <the metaSiteId>, … })`. Read `SEED.md` before
the first create: it maps the brief's words to the fields. Build each request body in your script the
way the script's builder functions do. A call `SEED.md` only names is made through `{MANAGE}`'s recipe for
it. Keep the script's rules: create, never delete, and report what the site already held. The closing
names entities you drafted as placeholders.

A photo already in the site's Media Manager, such as one the user uploaded, goes in by its file id
(`imageMediaId` in `SEED.md`), as it is: an import by URL would copy it. A photo on a site the user
dropped is served with the drop, not from the Media Manager: it goes in by its live URL, imported
once through `{MANAGE}/references/media/upload-media-to-wix.md`, and the file id the import returns
is what the entity takes. An `imagePrompt` is generated through
`{MANAGE}/references/media/generate-image-with-ai.md` (`POST /runwareschemaless/v1/request`, the
body `generateImage` in `{TEMPLATES}/shared/seed/images.mjs` builds), then imported through
`upload-media-to-wix.md`, and the file id goes on the entity, as for a dropped photo; this is the
seed's default for every entity that shows a picture. An entity stays text-only only when generation
or the import fails; say which. The scripts read a response body directly; `ExecuteWixAPI`'s
`wix.request` returns `{ status, data }`, and the body is `data`. A generated image is billed when
it is generated, so a read of the wrong level discards a paid image.

## 5. The frontend

The run is not done until the pages use what the backend holds: every control the page shows for
it (add to cart, the cart, book, submit) works on the live site. A backend with untouched pages is
half a run.

A payment (a cart, a paid booking, a ticket, a plan, a donation) ends in Wix's hosted checkout,
reached through a redirect session, and is wired on the first pass, payments connected or not.

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

**When it cannot**, or when its output would all have to be written out by hand, a page that talks
to the site as a visitor over plain `fetch`. One file per call, a few hundred lines, written in full inside that call: a response has a
hard size limit, and a call that carries the whole frontend at once exceeds it. A second file joins
the first the recipe's way, "Change it later": the same call downloads the live set and drops the
union. The
page calls the Wix REST API with `fetch` and mints the visitor token itself with the `appId` the
provision call returned, as `{TEMPLATES}/shared/rest/client.ts` does. Markup, a render function
per state, the event handlers: that is what you write. Keep what the page shows to what the site
holds; nothing invented, as in SKILL.md step 4.

**The calls**, on that second path, take their shape from the kit's REST twins for the solution:
`{TEMPLATES}/shared/rest/client.ts` (the visitor token and the request) and
`{TEMPLATES}/{solution}/rest/*.ts` (the calls), each importing its helpers by their real paths.
They are verified. Copy the form of the call, not the file.
The cores,
`{TEMPLATES}/{solution}/app/wix/{solution}/*-core.ts`, hold the rules the page needs and nothing else
does: which fields to read, how a price or a duration is formatted, which slot is bookable, how an
id is read. Copy those core functions into the page as they are, with only the types removed, and
run every API response through them: a raw field read by hand is where a page breaks (a name can be
a translatable object, a quantity a nested one). What you write is the markup, the rendering of what
the cores return, and the event handlers.

**A call those files don't cover** is confirmed before it is written, the way `{DOCS}` describes:
the method's REST page, and its schema (SearchWixAPISpec on the method's docs URL) for the exact
request and response. A shape that recurs, as an example of what the kit's files already encode:
an entity's id arrives as `_id` on some objects and `id` on others (the kit reads both,
`rawId`). Dates travel as local wall-clock strings in the business time zone.

**The check**, before every upload: a page cannot be opened here, so a wrong shape fails silently in
the browser. In one `ExecuteWixAPI` script, make each control's calls the way the page makes them,
as a visitor, with the bodies from `{solution}/rest/*.ts`. Then read the solution's cores,
`{TEMPLATES}/{solution}/app/wix/{solution}/*-core.ts` (online, that folder's `_content` returns them
in one response), and run each response through them in your sandbox's Node, as the page does:

```js
async function () {
  const api = "https://www.wixapis.com", clientId = "<appId>";
  const post = (path, body, token) => fetch(api + path, { method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: token }) },
    body: JSON.stringify(body) }).then(async (r) => ({ path, status: r.status, data: await r.json() }));
  const { data: { access_token: token } } = await post("/oauth2/token", { clientId, grantType: "anonymous" });
  const results = [];
  // each call the control makes, in order: results.push(await post(path, body, token));
  // a payment's last call is the redirect session the solution's rest/*.ts creates
  return results;
}
```

Done when every call returns 200, the cores turn each response into the names, prices, quantities or
times the page shows, and a payment's redirect session returns a URL. The upload waits for that: a
failing call is fixed first, on the site or in the page. The closing reports the check.

## 6. Closing

SKILL.md step 5's closing, with two additions: the site id, so a run with a machine attaches to this
site (`guides/existing-site.md`) instead of making a new one; and, when files were dropped, that a
change re-drops the whole set.

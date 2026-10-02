# An existing site: a new frontend for a site that already has its content

Read when the brief names a Wix site by its id. That site existed before the run, so it owns its
content and the frontend reads it live. Pass `--plan` only for content the brief **supplies or
asks to add**; never draft demo content for it, however the brief describes the business (that
is the create flow's job on a site made for the run — a folder holding only a `wix.config.json`
is that case too: `init` made the site; SKILL.md step 3). (A project downloaded from Wix whose `.env.local` declares a
migration is the other way to arrive at an existing site: `guides/migration.md`; the reading
part below applies there too, against the migrated site.) `<SKILL_ROOT>` is the installed skill folder; the shipped code is
under `<SKILL_ROOT>/templates/` (SKILL.md, "The run").

**Read the site, then run attach.** First, one call tells you what
the site is — its name, currency, and the Wix apps installed on it:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H "Authorization: $(npx -y @wix/cli@latest token)" -H 'Content-Type: application/json' \
  -d '{"siteId": "<siteId>"}'
```

The installed apps name the verticals (Wix Stores → storefront, Wix Bookings → bookings, and
so on per the Verticals table); the brief picks among them. Then one deterministic call, same
shape as setup (SKILL.md step 3):

```bash
node <SKILL_ROOT>/install/attach.mjs --site <siteId> --business-name "<site name>" --vertical <vertical>[,<vertical>] [--plan plan.json]
```

`init`/`wix create` always create a site, so they are not used here. attach does what they do
after creating one — the site's OAuth app, Wix hosting, `wix.config.json` — against the site
given, copies the first vertical's composed template, deploys the rest, and starts the install
detached. With `--plan` the first vertical's seed runs with it, detached like setup's (sync on
`.seed-exit` before release; `preexisting[]` in the result names what the site already held —
nothing is deleted or overwritten). `--plan` also carries the plan's `capabilities` into the
deploy. Without it nothing seeds and nothing on the site changes: the content is the site's own,
read live through the deployed data layer. A vertical whose seed only installs an app (members:
the Members Area, the profile layer) still needs that seed; attach says so in a `note`. `attached` also says whether a frontend is already
serving at the site's address (`frontend.serving`, with the release date). When it is, a
`wix release` from this project replaces it — the old deployment keeps its own address and
production can be pointed back, but the user's site changes. Tell the user before you release,
with the address and the date; if the brief did not ask for a new frontend, ask first and
wait. Say it again when you close.

**Get the measure of the site before you design.** Enough to know what you are building
for: what the chosen verticals will render, roughly how much of it, and what it is like —
six items in three groups design differently from six hundred. Run the vertical's reader:

```bash
node <SKILL_ROOT>/templates/<vertical>/seed/read-site.mjs --site <siteId> [--limit <n>]
```

It prints one JSON: whether the vertical's app is installed, counts, one page of each entity
with the fields the pages render, and `calls`, the requests it made with their documentation
URLs. The lists are one page; the counts are the site.

When the brief needs a read the script does not make, it is a build-time call with the
**site's** token, sent raw as the `Authorization` header (the account token from the call
above does not scope to a site), minted inline in each command —
`-H "Authorization: $(npx -y @wix/cli@latest token --site <siteId>)"` — and never written to
a file, not in the project and not in `/tmp`.
**The rule above applies in full: not one of these calls comes from memory.** Read the
request where it is written, then call. Where to read, in this order:
- **The reader**, `templates/<vertical>/seed/read-site.mjs` — the reads the pages make, as
  literal calls with their documentation URLs.
- **`wix-manage`**, at `.agents/skills/wix-manage/` — REST recipes for managing a site's
  business solutions: exact endpoint, method and payload per operation, curl included. Its
  SKILL.md is the index, by solution; open the recipe for the vertical's solution.
- **`wix-docs`**, at `.agents/skills/wix-docs/` — the Wix API reference, reached by
  **search, not by browsing files**: the skill folder holds the how-to, not the pages. Open
  its SKILL.md; it gives one `curl` to semantic search (`POST
  /mcp-docs-search/v1/docs/search/markdown`, natural-language `search_term`) that returns
  condensed method docs — endpoint, request example, response shape — and the rule that any
  `dev.wix.com/docs/…` URL plus `.md` is the full page. Progressive: search first, read the
  full document only when the hit lacks what you need.
If what you opened does not have the call, go to the next; do not try a variant, and do not
build one from a call you did find: the path and body you send are copied from the output
you read or they are not sent.

**In a folder that already holds a project** (a `package.json` or `index.html`, no
`wix.config.json`), attach writes the config into it and deploys for `--stack` instead of
scaffolding; pass the stack resolved in SKILL.md step 1. **A frontend that will be hosted
elsewhere** (Vercel, your own server) runs attach with `--hosting self --origin <url>[,<url>]`: no
Wix hosting is created, and the origins go on the OAuth app's allow-list so checkout can return
to them; add the public origin when it goes live. Then SKILL.md steps 4 and 5 as for any run,
with the install marker the only one to wait on.

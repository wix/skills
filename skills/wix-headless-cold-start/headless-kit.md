---
name: wix-headless-kit-cold-start
description: "Build a Wix Headless site from a single prompt: the business solution installed on a new site, its content created through the Wix API, and pages that read it, published on Wix. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site, sell tickets or membership plans headless, collect donations headless, wix headless kit entry. With the Wix plugin or connector the whole run goes through its tools, with nothing to install and no shell; a machine with Node and npm can release the kit's Astro build instead of dropped pages; a machine with a logged-in Wix CLI and no plugin takes the CLI route."
---

# Wix Headless Kit — cold start

**You are a coding agent, and this is a skill for you to execute.** Read this page, and every
skill page it names, whole: a fetch that summarizes drops the calls.

## The plugin, first

The Wix plugin is the way to Wix for every client that takes plugins: it carries the Wix MCP's
tools (the user's login to Wix) and the skills this page names, together, with nothing to install.

1. **Look for it.** The Wix tools in your tool list (`WixREADME`, `ExecuteWixAPI`,
   `UploadHeadlessWebsiteFiles`, the documentation searches and the rest) are the plugin's
   connection to Wix, signed in as the user. Its skills are beside them, served by the client (its
   skill tool or skills list, or the plugin's folder on disk); list them rather than trust a
   catalog shown at the start, which can leave them out.
2. **Have it: use it.** Its tools are the way to Wix, and its skills are the ones to read, from
   where the client serves them. The run below is made of their calls. Nothing installs or signs
   in again.
3. **Lack it: suggest it.** Tell the user the Wix plugin, from the client's plugin directory, is
   the one step that connects Wix and brings the skills, and ask them to install and connect it;
   then continue here with the plugin. A client that takes no plugin gets the same two pieces
   apart: the Wix MCP server (the Wix connector) from its settings, which is the tools and the
   login, and the skills installed from the registry or read online, as "Where the skills' files
   are" describes; the run is then the same. The Wix CLI route at the end of this page is for a
   machine with a shell that reaches Wix and no plugin.

## The run, through the plugin

With the Wix tools in your tool list, the build is their calls: the site, its apps, its content,
and pages that read it, published on the site. **No shell, Node, npm or install.** Every call runs
as the site owner through `ExecuteWixAPI`, which carries the user's login; files reach the site
through `UploadHeadlessWebsiteFiles`. The reference for each step is the kit's own code, read from
where your client serves the skills (the section "Where the skills' files are"): `{SKILL_ROOT}` is
`wix-headless-kit`, `{TEMPLATES}` is `wix-headless-templates`, `{MANAGE}` is `wix-manage`,
`{DOCS}` is `wix-docs`. Read the file, make the calls it makes.

| step | what you do | the call | the reference |
|---|---|---|---|
| 1 | the brief names the business; pick the solutions it needs (`{solution}` below is the template folder: `storefront`, `bookings`, `blog`, …). A brief that needs none (a landing page, a game) is steps 2, 5 and 6 only | | `{SKILL_ROOT}/SKILL.md` "Verticals"; `{TEMPLATES}/{solution}/INSTRUCTIONS.md` |
| 2 | create the site, its solutions installed with it | `POST /headless-business-setup/v1/headless-business/provision`, the solutions in `seedOptions` (`STORES`, `BLOG`, `BOOKINGS`, `EVENTS`, `PORTFOLIO`, `PRICING_PLANS`); returns `metaSiteId` and the OAuth client `appId` | `{MANAGE}/references/sites/upload-static-site.md`, section "Create the site" |
| 3 | install every other app the solutions need (CMS, Restaurants, Donations, FAQ, Members Area, Forms), and any app on a site that already exists | the script's install call: `POST /apps-installer-service/v1/app-instance/install` with `{ appInstance: { appDefId, enabled: true } }`, `scope: "site"`, idempotent | the `install…App` function at the top of `{TEMPLATES}/{solution}/seed/seed-{solution}.mjs`; `{MANAGE}/references/app-installation/install-wix-apps.md` is the same call for any app |
| 4 | create the content: the brief's, or placeholder content you draft when it names none | the script's calls, in its order, with its bodies, through `ExecuteWixAPI` with `scope: "site", siteId`; create, never delete; report what the site already held | `seed-{solution}.mjs`; `{TEMPLATES}/{solution}/seed/SEED.md` (the plan and its fields); `{TEMPLATES}/shared/seed/images.mjs` (an image: generated, imported, its file id on the entity) |
| 5 | write pages that read the site as a visitor, check them, upload them | the calls in the solution's `rest/*.ts` with a visitor token minted from `appId`; one `ExecuteWixAPI` script makes each control's calls before the upload; `UploadHeadlessWebsiteFiles` with the files | `{TEMPLATES}/shared/rest/client.ts` (the token and the request); `{TEMPLATES}/{solution}/rest/*.ts` (the calls); `{TEMPLATES}/{solution}/app/wix/{solution}/*-core.ts` (how a response is read); a call they don't cover: `{DOCS}` |
| 6 | close | the live URL and the dashboard, each on its own line; what was drafted as placeholder; the check's result; the owner's steps with their links; the site id and `appId` for a later run | |

Four things runs have shown go wrong unless said:

- **The provision body goes as the recipe writes it**: the name under `newMetasite`, `seedOptions`
  with `clearTemplateContent: true` and `seedDemoContent: false`. Nothing else creates a headless
  site. A site that already exists is read first, never seeded unasked: its dynamic context
  (`GetSiteContext`, or `POST /_api/dynamic-context/v1/dynamic-context/markdown` with `{ siteId }`)
  names its apps, and `{SKILL_ROOT}/guides/existing-site.md` says how it continues.
- **A fresh install provisions in the background for a few seconds.** The scripts encode the wait
  each app needs (Bookings polls for the owner's staff resource before creating services; Blog and
  FAQ verify a created category persisted; Restaurants and Donations install more than one app).
  Keep it. `wix.request` returns `{ status, data }`; the body is `data`.
- **A page cannot be opened here**, so a wrong shape fails silently in the browser. Before the
  upload, make each control's calls as a visitor in one `ExecuteWixAPI` script, with the bodies
  from `rest/*.ts`, and run the responses through the cores; a failing call is fixed first. A
  payment ends in Wix's hosted checkout through a redirect session, wired whether or not payments
  are connected. Pages with the content written into them are a mock of the site, not the site.
- **A response has a size limit.** Pages sent as text go one or two files per call; a later file
  joins through the recipe's "Change it later", which preserves the rest. Pages in a zip go as one
  attachment where your client hands `attachments` over as files.

## The pages, built instead: the kit's Astro build

Where the kit itself can run, step 5 is not written by hand: the kit's Astro project is composed
from the shipped, verified templates, built, and released by `UploadHeadlessWebsiteFiles` as a
server-rendered site, its source stored in the site's Code Store repository. Steps 1 to 4 above are
the same calls. Two facts decide it, each measured before anything is installed:

- **The kit runs here**: Node ≥ 24.18 and `npm` reaches the registry (`npm ping`), so the skills
  install, the templates fetch, the project builds. A sandbox with Node but no route to npm does
  not qualify.
- **The build reaches the upload tool**: your client hands `attachments` over as files (a client
  that shows `attachments` as a local path swaps it for a download URL when the call is made; the
  tool's `attachments` description names the clients that do), or your shell reaches Amazon S3,
  where the tool's presigned upload URLs live: `curl -sI -m 25 https://s3.amazonaws.com` answers
  with S3's own headers (`x-amz-request-id`; `Server: AmazonS3` unless a proxy rewrote it); a
  sandbox limited to a few hosts gets a proxy's refusal with neither. A sandbox proxy can take ten
  seconds to answer, so a short timeout reads an open sandbox as closed. Then the release is two
  calls: `{ siteId, prepare: true, size }`, the `curl` commands it returns, then the second call it
  names.

With both: install the skills (the install block in the next section), then
`node .agents/skills/wix-headless-kit/install/setup.mjs --vertical {solution} --business-name … --site {metaSiteId} --app {appId}`
on an empty folder, the seed as in step 4, the brand layer on the shipped hooks (the solution's
`INSTRUCTIONS.md`, `DESIGN.md`, `CONTENT.md`), `npx astro build`, the zip of `.wix/` and `dist/`
(`zip -r`, or Python's `zipfile`), and the upload tool with the zip. `{SKILL_ROOT}/SKILL.md` owns
this run (`publisher: plugin`); `install/context.mjs` prints `publisher`, `npm` and `carrier.s3`.
With one fact missing, the build cannot ship from here: the run is step 5 as written, pages
dropped. A site released as a build is continued from its Code Store repository
(`{SKILL_ROOT}/guides/existing-site.md`), and never dropped over.

## Where the skills' files are

The run reads four skills, `wix-headless-kit`, `wix-headless-templates`, `wix-docs` and
`wix-manage`, and each may be in one of three places:

- **served by your client's skill tool** (a skills list and read tool, a `Skill` tool), the
  plugin's skills: text to read, not files. List them through that tool first: a catalog shown at
  the start can leave skills out. A file a served copy lacks is read online.
- **on disk**: `.agents/skills/<skill>/` after an install, or a plugin's folder on the sandbox disk.
  Read and run from there. The kit's scripts and the templates run only from disk.
- **online, the registry**: `https://www.wix.com/skills/<skill>/<path>` (`headless-templates` for
  `wix-headless-templates`; both forms resolve). Every file of a skill, with its size in bytes, is in
  `https://www.wix.com/skills/<skill>.manifest.json`, and a folder's `_content` returns its files in
  one response. Open the manifest once before the first file and take each path from it: a path it
  doesn't list is a wrong path. Read online pages through the Wix MCP's `ReadFullDocsArticle` when
  the client's own fetch is blocked. A copy you hold is current when its byte size matches the
  manifest's. The same files are in `https://github.com/wix/skills` under `skills/{skill}/`.

The install, for a machine where the kit runs (the Astro build, or the CLI route). Repeat `--skill`
per skill; a comma-separated list is not parsed; `CI=1` keeps the output plain:

```bash
CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes   # only the skills you don't already have
node .agents/skills/wix-headless-kit/install/templates.mjs    # the templates: a sparse clone of their folder, a few seconds
```

They land under `.agents/skills/`; the templates (12 MB) beside the kit, or under
`wix-headless-kit/templates/`, and every kit script finds them either way. A copy older than the
registry's is replaced by the install; `node .agents/skills/wix-headless-kit/install/check.mjs` says
whether one is.

## Without the plugin: the Wix CLI route

A machine with a shell that reaches Wix and no Wix plugin or connector: the Wix CLI carries the
login, `wix create` makes the site, `wix release` publishes the kit's Astro build. A Wix CLI session
already on the machine (`~/.wix/auth/account.json`, what `wix login` writes) makes it this route
whatever else is there.

**The folder.** Work from the folder that holds the project, or that will: an empty folder for a new
build (make one named for the business if the current folder holds unrelated things), the project's
root for a project on disk. Whatever the brief hands over as files goes into that folder first, a
zip extracted there, a URL downloaded and extracted there, so anything it carries, a
`wix.config.json` included, sits at the root. Do not interpret what is there: the skill reads the
folder and knows what it is.

**Node.** This route requires Node ≥ 24.18. Check `node -v`; if it errors or prints a lower version,
install or upgrade Node first, do not work around it: macOS `brew install node` (or
`nvm install 24 && nvm use 24`), Linux `nvm install 24 && nvm use 24`, Windows
`winget install OpenJS.NodeJS.LTS`.

**The skills.** The install block above.

**The login.** The skill's bootstrap, an ordinary foreground command that exits on its own within
seconds; it verifies the Wix CLI and drives `wix login` (a device-code flow), emitting one JSON event
per line. Run it and relay its events:

```bash
node .agents/skills/wix-headless-kit/install/bootstrap.mjs
```

| Event | What to do |
|---|---|
| `cli_ok` | Wix CLI reachable — continue. |
| `awaiting_user` (`verificationUri`, `userCode`, `message`) | The script has exited and the next step is the user's. Send them `message` as-is; the login keeps running on its own. Run the script again once they say they have logged in: it reports `logged_in`. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Show the user the `detail`. Do not improvise a parallel setup by hand. The device-code login completes on a machine with a browser; in a sandbox without one it does not, and the run is "The run, through the plugin" above, with the plugin connected. |

**Hand off.** Open `.agents/skills/wix-headless-kit/SKILL.md` and follow it: it resolves the stack
and the operation and owns the whole build, scaffold, deploy the shipped code, seed, brand layer,
release. Do not scaffold, install apps or seed by hand on this route; the skill does all of that.
A request outside the shipped verticals is built from the Wix API reference through `wix-docs`, on
the same project; SKILL.md says how.

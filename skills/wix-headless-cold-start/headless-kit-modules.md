---
name: wix-headless-kit-cold-start-modules
description: "Build a Wix Headless site from a single prompt: the business solution installed on a new site, its content created through the Wix API, and pages that read it, published on Wix. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site, sell tickets or membership plans headless, collect donations headless, wix headless kit entry. With the Wix plugin or connector the whole run goes through its tools; where the kit runs and a build reaches the upload tool, both measured, the kit's Astro build is released instead of dropped pages; a machine with a logged-in Wix CLI and no plugin takes the CLI route."
---

# Wix Headless Kit — cold start

**This page is the build, step by step.** Read this page, and every
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
3. **Lack it: find it, suggest it.** Search your client's plugin directory for the Wix plugin, with
   the client's own plugin commands or tools where it has them, and suggest it to the user as the
   directory names it, with how to install it there: the one step that connects Wix and brings the
   skills. Ask them to install and connect it; then continue here with the plugin. A client that takes no plugin gets the same two pieces
   apart: the Wix MCP server (the Wix connector) from its settings, which is the tools and the
   login, and the skills installed or read online, as "Where the skills are" describes; the run
   is then the same. The Wix CLI route at the end of this page is for a machine with no plugin
   where the Wix CLI runs and reaches Wix.

## The run, through the plugin

With the Wix tools in your tool list, the build is their calls: the site, its apps, its content,
and pages that read it, published on the site. The tools alone are enough for the whole run. Where
the kit can also run on this machine, the pages can instead be the kit's Astro build, described
further down; two facts about the machine, measured there, decide it. Every call runs
as the site owner through `ExecuteWixAPI`, which carries the user's login; files reach the site
through `UploadHeadlessWebsiteFiles`. The reference for each step is the kit's own code, read
online through `ReadFullDocsArticle` from `https://www.wix.com/skills/{skill}/{path}`: `{SKILL_ROOT}`
is `wix-headless-kit`, `{TEMPLATES}` is `headless-templates`, `{MANAGE}` is `wix-manage`, `{DOCS}` is
`wix-docs`. A folder's URL lists its files (`https://www.wix.com/skills/headless-templates/blog/rest/`
names the five files there): read a folder's listing first and its files by the names it gives,
never by a name you supply. The online copy is the current release; a copy your client serves or
holds on disk is the one it shipped with ("Where the skills are"). Read the file, make the calls it
makes.

**Reading a reference.** Read one file per call, and read it whole. A file that arrives cut short,
or with a gap in the middle, is read again in parts until you have every line: an `ExecuteWixAPI`
script can `fetch()` any `https://www.wix.com/skills/...` URL and return the lines you name
(`text.split("\n").slice(100, 220)`), so each part is one call of the size you choose. One file per
result. The skill's manifest (`https://www.wix.com/skills/<skill>.manifest.json`) gives each file's
size; a folder's `_content` is one result, so use it for a folder under 30K bytes and read a bigger
folder's files one by one.

| step | what you do | the call | the reference |
|---|---|---|---|
| 1 | the brief names the business; pick the solutions it needs (`{solution}` below is the template folder: `storefront`, `bookings`, `blog`, …). A brief that needs none (a landing page, a game) is steps 2, 5 and 6 only | | `{SKILL_ROOT}/SKILL.md` "Verticals"; `{TEMPLATES}/{solution}/INSTRUCTIONS.md` |
| 2 | create the site, its solutions installed with it | the provision call, with exactly the body below; returns `metaSiteId` and the OAuth client `appId` | the body below |
| 3 | install every other app the solutions need (CMS, Restaurants, Donations, FAQ, Members Area, Forms), and any app on a site that already exists | the script's install call: `POST /apps-installer-service/v1/app-instance/install` with `{ appInstance: { appDefId, enabled: true } }`, `scope: "site"`, idempotent | the `install…App` function at the top of `{TEMPLATES}/{solution}/seed/seed-{solution}.mjs`; `{MANAGE}/references/app-installation/install-wix-apps.md` is the same call for any app |
| 4 | create the content: the brief's, or placeholder content you draft when it names none | the script's calls, in its order, with its bodies, through `ExecuteWixAPI` with `scope: "site", siteId`; create, never delete; report what the site already held | `seed-{solution}.mjs`, with the modules it imports from its folder; `{TEMPLATES}/{solution}/seed/SEED.md` (the plan and its fields); `{TEMPLATES}/shared/seed/images.mjs` (an image: generated, imported, its file id on the entity) |
| 5 | write pages on the solution's modules, upload them, put the modules beside them | the pages import the solution's published browser modules (its `client.ts`, `rest/*.ts` and cores, already built) and use what their functions return; `UploadHeadlessWebsiteFiles` with the pages, then one `ExecuteWixAPI` call copies the modules into the site (below). The pages' design is the solution's design job | the functions and their arguments: the solution's `{TEMPLATES}/{solution}/rest/` folder, listed first, then its files (the modules export the same functions); what they return: `{TEMPLATES}/{solution}/app/wix/{solution}/types.ts`; the design: `{TEMPLATES}/{solution}/INSTRUCTIONS.md`, `{TEMPLATES}/shared/DESIGN.md`, `{TEMPLATES}/shared/CONTENT.md`; a call they don't cover: `{DOCS}` |
| 6 | close | the live URL and the dashboard, each on its own line; what was drafted as placeholder; a check's result; the owner's steps with their links; the site id and `appId` for a later run | |

**Step 2, the provision.** Send this, changing only the name and the solutions. `seedOptions` is a
list inside `newMetasite`, one entry per solution, each with `businessSolution` set to one of
`STORES`, `BLOG`, `BOOKINGS`, `EVENTS`, `PORTFOLIO`, `PRICING_PLANS`; a site with none of them
leaves `seedOptions` out. Any other shape is accepted and installs nothing, with no error.

```javascript
async function run() {
  return wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: {
      origin: 'agent',
      newMetasite: {
        namingStrategy: { metaSiteName: 'The Light Journal' },
        seedOptions: [{ businessSolution: 'BLOG', clearTemplateContent: true, seedDemoContent: false }]
      },
      synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP']
    }
  });
}
// result.data: { metaSiteId, appId }
```

**A site that already exists.** The provision is the one call that creates a headless site. A
site that exists is read first and continued: its dynamic context (`GetSiteContext`, or
`POST /_api/dynamic-context/v1/dynamic-context/markdown` with `{ siteId }`) names its apps, and
`{SKILL_ROOT}/guides/existing-site.md` says how it continues; it is seeded only when asked.

**Step 4, the content.** A fresh install finishes provisioning in the background over a few
seconds, and each script waits for what its app needs (Bookings polls for the owner's staff
resource before creating services; Blog and FAQ verify a created category persisted; Restaurants
and Donations install more than one app). Run its calls in its order, with its waits.
`wix.request` returns `{ status, data }`; the body is `data`. A write that succeeded says nothing
about the shape of the visitor's read: a create body and a query response are different objects,
and the read's shape is in the solution's `*-core.ts`.

**Step 5, the pages.** The pages read the content from the site; none of it is written into them.
They call the solution's modules and show what they return: every field a page shows, a name, an
amount, a date, a count, a body of text, is a field of a shape in the solution's `types.ts`, never a
field of a raw Wix response and never a Wix call of the page's own. The modules are the kit's code
itself, so the cores are not read or ported. A field that can be empty (an image, a description, a
price on request) has a designed empty state wherever it appears. A payment ends in Wix's hosted
checkout through the solution's checkout function.

**Step 5, the design.** The modules carry the data; the pages are the design job, as the solution's
`INSTRUCTIONS.md` describes it, on `DESIGN.md` and `CONTENT.md`. An entity the pages show with a
picture gets its image in step 4 (`{TEMPLATES}/shared/seed/images.mjs`).

**Step 5, the modules.** The pages import them from the site's own `js/wix/rest/`:

```html
<script type="module">
  import { … } from "./js/wix/rest/{solution}/<rest file>.js";   // e.g. ./js/wix/rest/storefront/cart.js
</script>
```

Each file is named after the solution's `rest/` file it was built from and exports the same functions.
Upload the pages with `UploadHeadlessWebsiteFiles` first; an upload replaces every file on the site,
so the modules go in after it, and again after any later full upload. Then one `ExecuteWixAPI` call
with the site's `siteId` copies the solution's modules and the shared client into the site, checking
each file against its published hash, and writes the site's `appId` as the client id:

```javascript
async function run() {
  const base = 'https://static.parastorage.com/services/headless-sdk-browser/0.4.0/0.4.0-preview/';
  const solution = 'storefront';                       // the template folder
  const appId = '<appId from step 2>';
  const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const files = [];
  for (const family of ['rest/shared', 'rest/' + solution]) {
    const manifest = await (await fetch(base + family + '/manifest.json')).json();
    for (const f of manifest.files) {
      const text = await (await fetch(base + family + '/' + f.path)).text();
      if ((await sha(text)) !== f.sha256) throw new Error('hash mismatch: ' + f.path);
      files.push({ path: f.path, content: text });
    }
  }
  files.push({ path: 'js/wix/config.js', content: `export const WIX_CLIENT_ID = "${appId}";\n` });
  const result = await wix.headless.files.patch({ siteId, files });
  return { copied: files.length, result };
}
```

The patch keeps the pages and returns only a summary, so the modules never pass through your reply.

**Step 5, a check.** The site is done when the fields its pages show were seen on the live site,
not when the upload succeeded: read the site's files back (`wix.headless.files.list`) to see the
modules beside the pages, and read the content as a visitor would through the solution's functions.

**Step 5, the upload.** A response has a size limit, so pages sent as text go one or two files per
call; a later file joins through the recipe's "Change it later", which preserves the rest. Pages in
a zip go as one attachment where your client hands `attachments` over as files.

## The pages, built instead: the kit's Astro build

Where the kit itself can run, step 5 is not written by hand: the kit's Astro project is composed
from the shipped, verified templates, built, and released by `UploadHeadlessWebsiteFiles` as a
server-rendered site, its source stored in the site's Code Store repository. Steps 1 to 4 above are
the same calls. The point of this build is that the shipped code is copied into the project, not
retyped from a reference, so the kit and the templates must sit on the disk the project is built
on. Two facts decide it, each measured before anything is installed:

- **The kit runs here**: the kit's folder on this disk, from the plugin or installed ("Where the
  skills are"), Node ≥ 22.12 (Astro's and the hosting adapter's own line; this route runs no Wix
  CLI), and `npm` reaching the registry (`npm ping`), so the templates fetch and the project builds. A sandbox with Node but no route to npm does not qualify, and neither
  does a client that serves the skills as text with no folder: read online, the kit is reference,
  and the run is the drop.
- **The build reaches the upload tool**: your client hands `attachments` over as files (a client
  that shows `attachments` as a local path swaps it for a download URL when the call is made; the
  tool's `attachments` description names the clients that do), or your shell reaches Amazon S3,
  where the tool's presigned upload URLs live: `curl -sI -m 25 https://s3.amazonaws.com` answers
  with S3's own headers (`x-amz-request-id`; `Server: AmazonS3` unless a proxy rewrote it); a
  sandbox limited to a few hosts gets a proxy's refusal with neither. A sandbox proxy can take ten
  seconds to answer, so a short timeout reads an open sandbox as closed. Then the release is two
  calls: `{ siteId, prepare: true, size }`, the `curl` commands it returns, then the second call it
  names.

With both: the kit on disk (`{SKILL_ROOT}`, "Where the skills are" below), then
`node {SKILL_ROOT}/install/setup.mjs --vertical {solution} --business-name … --site {metaSiteId} --app {appId}`
on an empty folder, the seed as in step 4, the brand layer on the shipped hooks (the solution's
`INSTRUCTIONS.md`, `DESIGN.md`, `CONTENT.md`), `npx astro build`, the zip of `.wix/` and `dist/`
(`zip -r`, or Python's `zipfile`), and the upload tool with the zip. `{SKILL_ROOT}/SKILL.md` owns
this run (`publisher: plugin`); `install/context.mjs` prints `publisher`, `npm` and `carrier.s3`.
With one fact missing, the build cannot ship from here: the run is step 5 as written, pages
dropped. A site released as a build is continued from its Code Store repository
(`{SKILL_ROOT}/guides/existing-site.md`), and never dropped over.

## Where the skills are

Four skills: `wix-headless-kit`, `wix-headless-templates`, `wix-docs`, `wix-manage`. Three ways to
have them:

1. **Already on disk, from the plugin.** A client with the Wix plugin installed has the skills in
   the plugin's folder; the skill tool names that folder when it loads a skill. The kit's scripts run
   from there, `{SKILL_ROOT}` is its `wix-headless-kit`, and there is nothing to install. A client
   whose skill tool shows the text without a folder (a chat client) has them to read, not to run.
2. **Installed, then on disk.** A machine with no plugin folder where the kit must run (the Astro
   build, the CLI route). Repeat `--skill` per skill; `CI=1` keeps the output plain:

   ```bash
   CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
   ```

   They land under `.agents/skills/`; `{SKILL_ROOT}` is `.agents/skills/wix-headless-kit`.
3. **Read online.** `https://www.wix.com/skills/<skill>/<path>` (`headless-templates` for
   `wix-headless-templates`), through the Wix MCP's `ReadFullDocsArticle` or your client's own
   fetch. A folder's URL lists its files; read the listing, then the files by the names it gives. A
   folder's `_content` returns its files in one response, for a folder under 30K bytes ("Reading a
   reference"). The same files are in `https://github.com/wix/skills` under `skills/<skill>/`. This is
   the current release; `node {SKILL_ROOT}/install/check.mjs` says whether a disk copy is behind it.

The templates (12 MB) are not in the plugin's folder: every kit script fetches them on first use, a
sparse clone of their folder, a few seconds; `node {SKILL_ROOT}/install/templates.mjs` does it alone.

## Without the plugin: the Wix CLI route

A machine with no Wix plugin or connector where the Wix CLI runs and reaches Wix: the CLI carries the
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

**The skills.** The install, "Where the skills are" above (no plugin, so no folder of theirs).

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

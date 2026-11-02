---
name: wix-headless-kit-cold-start
description: "Build a Wix Headless site from a single prompt: the business solution installed on a new site, its content created through the Wix API, and pages that read it, published on Wix. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site, sell tickets or membership plans headless, collect donations headless, wix headless kit entry. With the Wix plugin or connector, the whole build goes through its tools. If wix-headless-kit runs on the machine and a build can reach the upload tool, the Astro build of wix-headless-kit is released instead of hand-written pages. A machine with a logged-in Wix CLI and no plugin takes the CLI route."
---

# Wix Headless Kit: cold start

This page tells you how to build the site, step by step. Read this page in full. Read each skill
page that this page names in full. A fetch that makes a summary removes the calls. Do not use one.

## 1. Find and use the Wix Plugin and tools

The Wix plugin connects you to Wix. It has the Wix tools (the Wix MCP, signed in as the user) and
the skills that this page names. You do not install anything.

1. **Look at your tool list.** If it has `WixREADME`, `ExecuteWixAPI`, `UploadHeadlessWebsiteFiles`
   and the documentation search tools, you have the plugin. These tools are signed in as the user.
2. **If you have the plugin, use it.** Its tools are your way to Wix. Read its skills from the
   place where your client serves them: its skill tool, its skills list, or the plugin folder on
   the disk. List the skills. Do not trust a catalog shown at the start; it can leave skills out.
   Do not install anything. Do not sign in again.
3. **If you do not have the plugin, find it.** Search the plugin directory of your client for the
   Wix plugin. Use the plugin commands or tools of your client, if it has them. Tell the user the
   name that the directory shows and how to install the plugin there. Ask the user to install it
   and connect it. Then continue with this page.
4. **If your client does not take plugins, get the two parts separately.** Add the Wix MCP server
   (the Wix connector) in the settings of the client. This gives the tools and the login. Get the
   skills as "Where the skills are" says. Then the build is the same.
5. **If the machine has no plugin and no connector, but the Wix CLI runs on it and reaches Wix,**
   use "The Wix CLI route" at the end of this page.

## 2. Choose how to make the pages

Steps 1 to 4 of the build are the same for every route. Step 5, the pages, has two routes. Decide
the route now, before you install anything. Make two checks: the build check and the upload check.

**The build check: `wix-headless-kit` runs on this machine.** All of these must be true:

- The `wix-headless-kit` folder is on this disk, from the plugin or installed ("Where the skills are").
- `node -v` prints 22.12 or higher. This is the requirement of Astro and of the hosting adapter.
  This route does not run the Wix CLI.
- `npm ping` succeeds. The templates must download, and the project must build.

The build check fails if the machine has Node but no route to npm. It also fails if your client
serves the skills as text, with no folder.

**The upload check: a build can reach the upload tool.** One of these must be true:

- Your client passes `attachments` as files. A client that shows `attachments` as a local path
  replaces it with a download URL when the call is made. The description of `attachments` in the
  upload tool names the clients that do this.
- Your shell reaches Amazon S3. The presigned upload URLs of the upload tool are on S3. Run
  `curl -sI -m 25 https://s3.amazonaws.com`. S3 answers with its
  own headers: `x-amz-request-id`, and `Server: AmazonS3` unless a proxy changed it. A sandbox that
  allows only some hosts gets a refusal from the proxy, with neither header. A sandbox proxy can
  take ten seconds to answer. Use a timeout of 25 seconds or more. With a short timeout, an open
  sandbox looks closed.

If the build check and the upload check both pass, make the pages with the Astro build of `wix-headless-kit` ("The Astro build"
below). If one check fails, write the pages by hand on the modules (step 5 below).

## 3. The build, through the Wix tools

Every call runs as the site owner through `ExecuteWixAPI`. This tool carries the login of the user.
Files go to the site through `UploadHeadlessWebsiteFiles`.

The reference for each step is the code of `wix-headless-kit`. Read it online with `ReadFullDocsArticle` from
`https://www.wix.com/skills/{skill}/{path}`. In this page:

- `{SKILL_ROOT}` is `wix-headless-kit`
- `{TEMPLATES}` is `headless-templates`
- `{MANAGE}` is `wix-manage`
- `{DOCS}` is `wix-docs`

A folder URL lists the files in the folder. For example,
`https://www.wix.com/skills/headless-templates/blog/rest/` names the five files there. Read the
folder listing first. Then read the files by the names that the listing gives. Do not use a file
name that you supply yourself. The online copy is the current release. A copy that your client
serves, or that is on the disk, is the release it came with ("Where the skills are"). Read the
file. Then make the same calls that the file makes.

### How to read a reference file

Read one file per call. Read the file in full. If a file arrives cut short, or with a gap, read it
again in parts until you have every line. An `ExecuteWixAPI` script can `fetch()` any
`https://www.wix.com/skills/...` URL and return the lines you name, for example
`text.split("\n").slice(100, 220)`. Each part is one call of the size you choose. Return one file
per result.

The manifest of a skill, `https://www.wix.com/skills/<skill>.manifest.json`, gives the size of each
file. The `_content` URL of a folder returns all its files in one result. Use `_content` for a
folder under 30K bytes. For a bigger folder, read the files one by one.

### The steps

Do the six steps in this order. For each step: what you do, the call, and the reference.

**Step 1: choose the solutions.**
- Find the business in the brief. Choose the solutions it needs. `{solution}` is the template
  folder, for example `storefront`, `bookings`, `blog`.
- If the brief needs no solution (a landing page, a game), do steps 2, 5 and 6 only.
- Reference: `{SKILL_ROOT}/SKILL.md`, section "Verticals"; `{TEMPLATES}/{solution}/INSTRUCTIONS.md`.

**Step 2: create the site.**
- Create the site, with its solutions installed.
- Call: the provision call, with the body in "Step 2: the provision call" below. Change only the
  name and the solutions. It returns `metaSiteId` and the OAuth client `appId`.

**Step 3: install the other apps.**
- Install each other app that the solutions need. On a site that already exists, install each app
  it needs.
- Call: `POST /apps-installer-service/v1/app-instance/install` with
  `{ appInstance: { appDefId, enabled: true } }` and `scope: "site"`. You can repeat this call
  safely.
- Reference: the `install…App` function at the top of
  `{TEMPLATES}/{solution}/seed/seed-{solution}.mjs`.
  `{MANAGE}/references/app-installation/install-wix-apps.md` shows the same call for any app.

**Step 4: set the region, then create the content.**
- Set the region settings that the brief gives. Then create the content: the content in the brief,
  or placeholder content that you write if the brief gives none.
- Calls, first the region settings: the Update Business Region call from the recipe (currency, time
  zone), and the region `PATCH` for a place. Then the calls of the seed script, in its order, with
  its bodies, through `ExecuteWixAPI` with `scope: "site"` and `siteId`. Create. Do not delete.
  Report what the site already had.
- Reference: `seed-{solution}.mjs` and the modules it imports from its folder;
  `{TEMPLATES}/{solution}/seed/SEED.md` (the plan and its fields);
  `{TEMPLATES}/shared/seed/images.mjs` (how to make an image and put its file id on the item);
  `{MANAGE}/references/site-properties/change-payment-currency-site-properties.md` (currency, time
  zone, region).

**Step 5: write the pages, upload them, install the modules.**
- Write the pages on the modules of the solutions. Upload the pages. Then install the modules next
  to them.
- Calls: the pages import the published browser modules of the solutions (`client.ts`, `rest/*.ts`
  and the cores, already built). The pages use what the module functions return.
  `UploadHeadlessWebsiteFiles` with the pages, then one `ExecuteWixAPI` call that copies the
  modules into the site ("Step 5: the modules" below). The design of the pages is the design job
  of the solution.
- Reference, the functions and their arguments: the `{TEMPLATES}/{solution}/rest/` folder, its
  listing first, then its files. The modules export the same functions. If a file imports a
  function and exports it again, the function is written in the file it imports from.
- Reference, what the functions return: `{TEMPLATES}/{solution}/app/wix/{solution}/types.ts`.
- Reference, the design: `{TEMPLATES}/{solution}/INSTRUCTIONS.md`, `{TEMPLATES}/shared/DESIGN.md`,
  `{TEMPLATES}/shared/CONTENT.md`. For a call that these files do not cover: `{DOCS}`.

**Step 6: close.**
- Give the live URL and the dashboard URL, each on its own line.
- Say what you wrote as placeholder content.
- Give the result of the check.
- Give the steps for the owner, with their links.
- Give the site id and the `appId` for a later run.

### Step 2: the provision call

Send this body. Change only the name and the solutions.

`seedOptions` is a list inside `newMetasite`. It has one entry per solution. Set `businessSolution`
to one of `STORES`, `BLOG`, `BOOKINGS`, `EVENTS`, `PORTFOLIO`, `PRICING_PLANS`. If the site needs
none of these, leave `seedOptions` out.

**Caution:** the call accepts any other shape, installs nothing, and gives no error.

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

The new site has a hosting address, and `GetSiteContext` shows it as "Published". It serves nothing
until the upload in step 5: the address answers 404. Do not give the user a URL before step 6.

### A site that already exists

The provision call is the only call that creates a headless site. Do not use it on a site that
exists. First read the site. Its dynamic context names its apps: use `GetSiteContext`, or
`POST /_api/dynamic-context/v1/dynamic-context/markdown` with `{ siteId }`. A site with no files also
shows a URL and "Published"; the URL answers 404 until the first upload. Then follow
`{SKILL_ROOT}/guides/existing-site.md`. Seed a site that exists only if the user asks for it.

### Step 4: the content

Set the region settings first:

- the currency, if the brief gives a price with its unit;
- the time zone and the region, if the brief names a place.

A new site starts with default settings. These are not the settings of the business. If you change
a setting after you create the content, the change takes minutes to reach the content.

A new install finishes its provisioning in the background. This takes a few seconds. Each seed
script waits for what its app needs. Run its calls in its order, with its waits.

`wix.request` returns `{ status, data }`. The response body is `data`. A write that succeeds does
not tell you the shape of a visitor's read. A create body and a query response are different
objects. The shape of the read is in the `*-core.ts` file of the solution.

### Step 5: the pages

The pages read their content from the site. Do not write the content into the pages. The pages call
the modules of the solution and show what the modules return. Each field that a page shows (a name,
an amount, a date, a count, a body of text) is a field of a shape in the `types.ts` of the
solution. Do not show a field of a raw Wix response. Do not make a Wix call from a page. The
modules are the code of `wix-headless-kit`. Do not port the cores.

Do not repeat a value from the modules in the text around it (a price, a currency, a list of
options). Show the field, or keep the text general. Then a change by the owner reaches every line.
A field can be empty (an image, a description, a price on request). Design an empty state for it in
each place where it appears.

### Step 5: the design

The modules carry the data. The pages are the design job. `INSTRUCTIONS.md` of the solution tells
you how to do it, with `DESIGN.md` and `CONTENT.md`.

If the pages show an item with a picture, put the picture on the item itself in step 4
(`{TEMPLATES}/shared/seed/images.mjs`). Then the pages of Wix, for example checkout, show it too.
Put every other picture on a page (a hero, a banner) in the Wix Media of the site, in the same way.
Do not link to a picture on another website. If the user gave no pictures, you can suggest to
generate them. You can generate them yourself and upload them with `UploadImageToWixSite`. Or you
can use the image generation of Wix (`generateImage` in `images.mjs`).

### Step 5: the modules

The pages import the modules from the `js/wix/` folder of the site. Use an absolute path. Then a
page in a subfolder imports the same files:

```html
<script type="module">
  import { … } from "/js/wix/<rest file>.js";   // e.g. /js/wix/posts.js
</script>
```

Each module file has the name of the `rest/` file or store it was built from. It exports the same
functions. It starts with its declarations: what it exports, the arguments, and what each function
returns. The files of every solution on the site share the one folder. This is the layout that
`INSTRUCTIONS.md` of the solution describes for a static site.

Upload the pages first, with `UploadHeadlessWebsiteFiles`. Then make one `ExecuteWixAPI` call with
the `siteId` of the site. This call copies the modules of the solutions and the shared client into
the site, as the templates build them. It writes the `appId` of the site as the client id:

```javascript
async function run() {
  return wix.headless.modules.install({
    siteId,
    clientId: '<appId from step 2>',
    solutions: ['blog']                                // the template folders, as in step 1
  });
}
// { entrypoints: ['/js/wix/client.js', '/js/wix/posts.js', …], files: { added, replaced, unchanged }, … }
```

The call keeps the pages. It returns the entry points and the file counts. The modules do not pass
through your reply. If `wix.headless.modules` is missing, use this script. It does the same steps:

```javascript
async function run() {
  const solutions = ['blog'];                          // the template folders, as in step 1
  const appId = '<appId from step 2>';
  const files = [];
  for (const name of ['shared', ...solutions]) {
    const res = await fetch('https://www.wix.com/skills/wix-headless-templates/static/' + name + '.json');
    if (!res.ok) throw new Error('no modules for ' + name);
    for (const [path, content] of Object.entries((await res.json()).files)) files.push({ path, content });
  }
  files.push({ path: 'js/wix/config.js', content: `export const WIX_CLIENT_ID = "${appId}";\n` });
  const result = await wix.headless.files.patch({ siteId, files });
  return { copied: files.length, result };
}
```

### Step 5: the check

The site is done when a visitor's response shows the fields that the pages show. A successful
upload is not enough. Write one `ExecuteWixAPI` script that reads as a visitor:

1. Mint the token in the way that `client.ts` does.
2. Send the calls that the page functions make, with `fetch()` and that token. Take the bodies from
   the `.ts` file that holds each function.

**Caution:** `wix.request` always sends the owner token. It does not matter which token you give
it. A check through `wix.request` reads what the owner sees, not what a visitor sees.

The check passes when the read returns the content that step 4 created, by name. An empty 200
response right after the seed can come from the new-install window, or from the query. Read again
after a few seconds. Then compare your query with the file of `wix-headless-kit`. Read the site files back with
`wix.headless.files.list`. The modules must be next to the pages.

### Step 5: the upload

A response has a size limit. Send pages as text one or two files per call. Add a later file through
"Change it later" in the upload recipe; it keeps the other files. If your client passes
`attachments` as files, send the pages as one zip attachment.

## The Astro build

Use this route if the build check and the upload check pass. Steps 1 to 4 are the same calls. Step 5 is different:
you do not write the pages by hand. The Astro project of `wix-headless-kit` is composed from the shipped,
verified templates, built, and released through `UploadHeadlessWebsiteFiles` as a server-rendered site. Its
source is stored in the Code Store repository of the site. The shipped code is copied into the
project, not written again from a reference. For this, `wix-headless-kit` and the templates must be on the
disk where you build the project.

Do these steps:

1. Get `wix-headless-kit` on the disk (`{SKILL_ROOT}`; see "Where the skills are").
2. In an empty folder, run
   `node {SKILL_ROOT}/install/setup.mjs --vertical {solution} --business-name … --site {metaSiteId} --app {appId}`.
3. Seed the site as in step 4.
4. Add the brand layer on the shipped hooks. Follow `INSTRUCTIONS.md` of the solution, `DESIGN.md`
   and `CONTENT.md`.
5. Run `npx astro build`.
6. Make a zip of `.wix/` and `dist/` (`zip -r`, or `zipfile` in Python).
7. Upload the zip with `UploadHeadlessWebsiteFiles`. If you upload through S3, the release is two
   calls: `{ siteId, prepare: true, size }`, then the `curl` commands it returns, then the second
   call it names.

`{SKILL_ROOT}/SKILL.md` owns this run (`publisher: plugin`). `install/context.mjs` prints
`publisher`, `npm` and `carrier.s3`.

To change a site that was released as a build, continue from its Code Store repository
(`{SKILL_ROOT}/guides/existing-site.md`). Do not upload hand-written pages over it.

## Where the skills are

There are four skills: `wix-headless-kit`, `wix-headless-templates`, `wix-docs`, `wix-manage`.
There are three ways to get them:

1. **On the disk, from the plugin.** A client with the Wix plugin has the skills in the plugin
   folder. The skill tool names that folder when it loads a skill. The `wix-headless-kit` scripts run from there.
   `{SKILL_ROOT}` is its `wix-headless-kit` folder. There is nothing to install. A chat client that
   shows the skill text without a folder can read the skills, but cannot run them.
2. **Installed on the disk.** Use this on a machine with no plugin folder where `wix-headless-kit` must run
   (the Astro build, the CLI route). Repeat `--skill` for each skill. `CI=1` keeps the output plain:

   ```bash
   CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
   ```

   The skills go under `.agents/skills/`. `{SKILL_ROOT}` is `.agents/skills/wix-headless-kit`.
3. **Read online.** Use `https://www.wix.com/skills/<skill>/<path>` (`headless-templates` for
   `wix-headless-templates`), through `ReadFullDocsArticle` of the Wix MCP, or the fetch tool of
   your client. A folder URL lists its files. Read the listing, then the files by the names it
   gives. The `_content` URL of a folder returns its files in one response, for a folder under 30K
   bytes ("How to read a reference file"). The same files are in `https://github.com/wix/skills`
   under `skills/<skill>/`. This is the current release. `node {SKILL_ROOT}/install/check.mjs` tells
   you if a disk copy is behind it.

The templates (12 MB) are not in the plugin folder. Each `wix-headless-kit` script downloads them on first use, as
a sparse clone of their folder. This takes a few seconds. `node {SKILL_ROOT}/install/templates.mjs`
downloads them alone.

## The Wix CLI route

Use this route on a machine with no Wix plugin or connector, where the Wix CLI runs and reaches Wix.
The CLI carries the login. `wix create` makes the site. `wix release` publishes the Astro build of
`wix-headless-kit`. If the machine has a Wix CLI session (`~/.wix/auth/account.json`, written by `wix login`),
use this route, even if other tools are on the machine.

**The folder.** Work from the folder that holds the project, or that will hold it. For a new build,
use an empty folder. If the current folder holds unrelated things, make a new folder named for the
business. For a project on the disk, use its root folder. Put the files from the brief into that
folder first: extract a zip there, or download a URL and extract it there. Then everything the
brief gives, a `wix.config.json` included, is at the root. Do not interpret what is in the folder.
The skill reads the folder and knows what it is.

**Node.** This route requires Node 24.18 or higher. Run `node -v`. If it fails, or prints a lower
version, install or upgrade Node first. Do not work around it. macOS: `brew install node`, or
`nvm install 24 && nvm use 24`. Linux: `nvm install 24 && nvm use 24`. Windows:
`winget install OpenJS.NodeJS.LTS`.

**The skills.** Install them as "Where the skills are" says. There is no plugin, so there is no
plugin folder.

**The login.** Run the bootstrap script of the skill. It is a normal foreground command. It exits on
its own within seconds. It checks the Wix CLI and runs `wix login` (a device-code flow). It prints
one JSON event per line. Run it, and pass its events on to the user:

```bash
node .agents/skills/wix-headless-kit/install/bootstrap.mjs
```

The events, and what to do for each:

- `cli_ok`: the Wix CLI is reachable. Continue.
- `awaiting_user` (with `verificationUri`, `userCode`, `message`): the script has exited. The next
  step is for the user. Send them `message` as it is. The login continues on its own. When the user
  says they have logged in, run the script again. It then reports `logged_in`.
- `logged_in` or `success`: the login is done. Continue.
- `cli_unreachable` or `login_failed` (with `detail`): show the user the `detail`. Do not make a
  parallel setup by hand. The device-code login completes on a machine with a browser. In a sandbox
  without a browser, it does not complete. Then use "The build, through the Wix tools" above, with
  the plugin connected.

**Hand off.** Open `.agents/skills/wix-headless-kit/SKILL.md` and follow it. It finds the stack and
the operation. It owns the whole build: scaffold, deploy the shipped code, seed, brand layer,
release. Do not scaffold, install apps, or seed by hand on this route. The skill does all of that.
For a request outside the shipped verticals, build from the Wix API reference through `wix-docs`, on
the same project. SKILL.md says how.

---
name: wix-readme
description: "What the Wix plugin holds and how to work with Wix through it: the flow the Wix MCP README returns, an index of the plugin's skills with what each does, and the Wix MCP tools with what each does. Use when the plugin was just installed or when the user asks what the Wix plugin can do or which skill or tool fits a task."
---

# The Wix plugin

The plugin is two things: skills, folders of instructions and shipped code for building on Wix, each with a `SKILL.md` at its root; and the Wix MCP server at `https://mcp.wix.com/mcp`, whose tools read and change the user's Wix sites and account. The skills say how; the tools do.

## How to work with Wix through the plugin

Every Wix task ends in one of two places: a call made now with the user's account, or code the user keeps that makes the same calls (an app, a headless site, a script). The way there is the same.

1. **Start with `WixREADME`**, once per conversation. It returns this flow in full and the account's sites with their installed apps.
2. **Pick the site.** The `siteId` comes from the site context; when several fit, ask. A business solution's API works only on a site with that app installed, and an app's version changes its endpoints, so check the site's apps first.
3. **Find the method.** The first source that gives it: an earlier tool result in the conversation; else the skill that covers the task (the index below says what each is for), whose example is the model when it matches the case; else the docs, `SearchWixRESTDocumentation` or `BrowseWixRESTDocsMenu` for REST, the SDK, CLI, headless and apps searches for code, then `ReadFullDocsArticle` on the method's page.
4. **Get the exact shape.** A request is modeled on an example that matches the case: a skill's recipe or template, or the method's docs page, when it shows the fields the case needs. That is enough. The schema is for what no example shows: a field, an enum, a filter or sort key (a closed list per method). `SearchWixAPISpec` on the method's docs URL returns the request and response schemas, the REST URL and the JavaScript SDK call; `ReadFullDocsMethodSchema` when it is not available.
5. **Make the call, or write the code.** To do it now: `ExecuteWixAPI`, one function holding every step of the task, the reads and the writes they feed. For code the user keeps: write the call from the shape found in step 4, REST or SDK. `wix-headless-templates` is that code already written and verified, one folder per business solution, and `wix-headless-kit` builds a site on it.

Throughout: nothing Wix-specific from memory. Every URL, id, setting location, product fact, request shape and field name comes from a skill, the docs tools, an earlier tool result or the user.

## Creating a site

A new Wix site is written in code and uploaded. `StartDeployWebsite` returns the guide for a site the agent writes or files the user brought; `StartHeadlessBuild` returns the guide for a site that needs Wix business features (a store, bookings, a CMS, members, payments and the rest). Each guide creates the site, uploads it and says what comes next; call one and follow it.

What the guides stand on:

- **One site, created once**, by the provision call (`POST .../headless-business-setup/v1/headless-business/provision`, `origin: 'agent'`), which returns `metaSiteId`, the id every later call takes. A site made earlier is found with `ListWixSites` and uploaded to again; the URL never changes.
- **Static pages are dropped, a Wix Astro build is released.** A drop sends the complete file set each time. A build (`.wix/build-metadata.json` beside `dist/`) is released to Wix hosting, server-rendered, through `UploadHeadlessWebsiteFiles` only: as an attachment, or in two calls (`prepare: true` with the zip's `size`, then `uploadKey`) from a shell that reaches the internet. The project's source is stored with the release, and a later session continues the site from it.
- **`UploadHeadlessWebsiteFiles`** takes `siteId` and the files, as `attachments` or the `files` text bundle, and returns the live URL and the dashboard. Without the MCP, the same drop is a `curl` multipart call, with or without a login.
- **Business features** come from `wix-headless-kit`'s run on the same site and `appId`: apps installed and content seeded, the Astro project built from `wix-headless-templates`, the build released.

To read more: the recipe, `wix-manage/references/sites/upload-static-site.md` (https://www.wix.com/skills/wix-manage/references/sites/upload-static-site.md): the calls for every route, drop and release, finding and changing a site, the anonymous route, limits and failures. The cold start (https://www.wix.com/skills/headless-cold-start/headless-kit.md): the headless build from a cold environment to the released site.

## Two ways to Wix

### The plugin with the Wix MCP

The preferred way. The plugin's MCP configuration connects the Wix MCP server at `https://mcp.wix.com/mcp`; the client signs the user in on the first call and the tools below are in the tool list, with nothing to install. The flow above runs on them: `WixREADME` for the context, the documentation tools to find a method and its shape, `ExecuteWixAPI` to call it, `StartDeployWebsite` and `StartHeadlessBuild` with `UploadHeadlessWebsiteFiles` to create a site and put it live. The skills are read from the plugin's folder, and `ReadFullDocsArticle` reads them online when they are not there.

Context first:

| Tool | What it does |
|---|---|
| `WixREADME` | The context every other tool assumes. Call it once per conversation before a Wix task; for another site later, call `GetSiteContext` instead. |
| `ListWixSites` | Lists the user's sites, with an optional name filter. Needs no `WixREADME` first. |
| `GetSiteContext` | Deep context for one site, by name or id: its apps, settings and data, as markdown. |

Building and deploying a site:

| Tool | What it does |
|---|---|
| `StartDeployWebsite` | Returns the guide to create a site on Wix and put files on it: HTML, CSS and JS, a static build, a zip, another builder's export. Updates keep the site and URL. Works with or without a Wix login. |
| `StartHeadlessBuild` | Returns the headless guide, for a site that needs Wix business features: a store, bookings, events, a restaurant menu, a blog, pricing plans, donations, forms, members, a CMS, payments. |
| `UploadHeadlessWebsiteFiles` | The upload step of those two guides: puts a static site or a Wix Astro build onto an existing Wix Headless site by its metaSiteId, as files, as attachments, or in two calls with presigned URLs. |
| `GetSuggestedDomains` | Domain name suggestions for a site. |

Calling Wix APIs:

| Tool | What it does |
|---|---|
| `ExecuteWixAPI` | Reads and changes a site's or account's data with one JavaScript function over the Wix REST API: chained calls, pagination, loops, the reads that feed the writes. The preferred way to call Wix APIs. |
| `SearchWixAPISpec` | Inspects the Wix REST API spec and each method's JavaScript SDK call by running JavaScript against the index: the exact request and response shape, enums, the SDK import and signature. |

Documentation:

| Tool | What it does |
|---|---|
| `SearchWixRESTDocumentation` | Searches the Wix REST API docs. The starting point for finding an endpoint. |
| `BrowseWixRESTDocsMenu` | Browses the REST docs as a menu, category by category. |
| `SearchWixSDKDocumentation` | Searches the Wix JavaScript SDK docs. |
| `SearchWixHeadlessDocumentation` | Searches the Wix Headless docs. |
| `SearchWixCLIDocumentation` | Searches the Wix CLI docs: commands, local development, authentication. |
| `SearchWixWDSDocumentation` | Searches the Wix Design System docs. |
| `SearchBuildAppsDocumentation` | Searches the Wix Build Apps docs. |
| `SearchDevelopmentDocumentation` | Broad Wix developer docs: platform concepts and guides, after the specific searches return nothing. |
| `SearchWixHelpCenter` | Searches the Wix Help Center: how site owners do things by hand in the dashboard and editors. |
| `ReadFullDocsArticle` | Reads a page in full by URL: a docs article or method page, a skill's `SKILL.md` or any of its files, a Help Center article. |
| `ReadFullDocsMethodSchema` | The full request and response schema of one method, by its docs URL. |

Media and feedback:

| Tool | What it does |
|---|---|
| `UploadImageToWixSite` | Uploads images to a site's Media Manager and returns their URLs and media ids. |
| `PickImagesForWixMedia` | Shows the user a file picker to upload images from their device to the Media Manager. |
| `ReportIssueToWix` | Reports one problem with Wix's tools, APIs or docs to the Wix team, when the user asks for it. |

### The Wix CLI

The other way, from a shell. `@wix/cli` is Wix's command-line tool: it signs in to a Wix account, creates and manages Wix projects on disk, a Wix app or a Wix Headless site, builds them and releases them to Wix, and mints tokens for REST calls. Its session lives on the machine. All as `npx @wix/cli@latest <command>`:

| Command | What it does |
|---|---|
| `login` | Signs in with a device code and writes the session to `~/.wix/auth/account.json`. |
| `whoami` | Shows the signed-in account. |
| `create` | Creates a Wix project with its site: for a headless site, the site, its OAuth app and hosting, and the project's `wix.config.json` (`siteId`, `appId`). |
| `env pull` | Writes the project's environment to `.env.local`: the site's client id and the values the build reads. |
| `build` | Builds the project for Wix: for an Astro site, `dist/` and `.wix/build-metadata.json`. |
| `release` | Releases the build to Wix; the site keeps its URL. |
| `token`, `token --site <siteId>` | Mints an admin token, account-scoped or site-scoped, for REST calls from a shell: `Authorization: Bearer <token>` (`wix-docs/references/CALLING.md`). |

`wix-headless-kit` builds a Wix Headless site through the MCP's tools or through the CLI; a CLI session already on the machine makes its run the CLI route, where `install/setup.mjs` runs `create`, and `build` then `release` put the site live.

Without the MCP, each tool is a plain HTTP call to the same backend. `wix-docs` covers these, with the request bodies, as its `curl` lane:

| Tool | Without the MCP |
|---|---|
| `SearchWixRESTDocumentation`, `SearchWixSDKDocumentation`, `SearchWixHeadlessDocumentation`, `SearchWixCLIDocumentation`, `SearchWixWDSDocumentation`, `SearchBuildAppsDocumentation`, `SearchDevelopmentDocumentation` | `POST https://www.wixapis.com/mcp-docs-search/v1/docs/search` (or `/search/markdown`) with `search_term` and the `document_type` of that corpus. |
| `BrowseWixRESTDocsMenu` | `POST https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse`. |
| `ReadFullDocsArticle` | Append `.md` to any `https://dev.wix.com/docs/...` URL; a skill's file is `https://www.wix.com/skills/<skill>/<path>`. |
| `SearchWixAPISpec`, `ReadFullDocsMethodSchema` | `POST https://mcp.wix.com/api/code-mode/search` with the same JavaScript. |
| `ExecuteWixAPI` | The REST call itself, to `https://www.wixapis.com`, with a token: which identity a method takes and how to mint the token are in `wix-docs/references/CALLING.md`. |
| `StartDeployWebsite`, `StartHeadlessBuild`, `UploadHeadlessWebsiteFiles` | `create`, `build` and `release` from a shell; the `wix-manage` recipe `references/sites/upload-static-site.md` creates a site and drops files over REST. |

## Skills

Each skill is a folder with a `SKILL.md` at its root that says what it does and which of its files to read when. A skill may already be on disk, in the plugin's folder or under `.agents/skills/<skill>/` after `npx skills add wix/skills`, or served by the client's skill tool; read it from there. Otherwise every file is online at `https://www.wix.com/skills/<skill>/<path>`, read with `ReadFullDocsArticle` or `curl`; `https://www.wix.com/skills/<skill>/` with the trailing slash lists the skill's files. Paths below are inside the skill's folder.

### wix-headless-kit

Online: https://www.wix.com/skills/wix-headless-kit/SKILL.md. On disk: the plugin's `skills/wix-headless-kit/`, or `.agents/skills/wix-headless-kit/`.

Builds a Wix Headless site on shipped, verified `@wix/sdk` code: one typed data layer, hooks, components, Astro pages and a seed script per Wix business solution, from `wix-headless-templates`. The agent designs the presentation on those hooks and releases to Wix hosting. Runs as a CLI flow from a shell, or as Wix API calls through the MCP.

**The cold start**, `wix-headless-cold-start/headless-kit.md` (https://www.wix.com/skills/headless-cold-start/headless-kit.md, what `StartHeadlessBuild` returns), takes a cold environment to where wix-headless-kit runs, then hands off to its `SKILL.md`. It measures three facts: the Wix MCP's tools in the tool list; Node 24.18 or later with `npm` reaching the registry; a way to get a build to `UploadHeadlessWebsiteFiles`, as an attachment or by `curl` to its upload URLs. The facts pick the route: all three, the plugin route (site through `ExecuteWixAPI`, Astro build here, release through the upload tool); MCP but no way to release a build, the API-call guide (`guides/api-run.md`, static pages in the upload tool's `files`); a Wix CLI session on the machine, the CLI route. The project folder comes first, with any handed-over files extracted into it. Skills on disk are used where they are; otherwise `CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes`, then `node .agents/skills/wix-headless-kit/install/templates.mjs` for the templates, and `install/bootstrap.mjs` on the CLI route.

- `SKILL.md`: the steps of a build and the table of business solutions.
- `guides/api-run.md`: the whole run as Wix API calls through the MCP, for the closed sandbox, where the kit cannot run because `npm` does not reach the registry. The cold start sends the agent here.
- `guides/capabilities.md`: which Wix product owns which feature, and what ships for it.
- `guides/existing-site.md`: a new frontend for a Wix site that already has its content, and continuing a site built in an earlier session.
- `guides/migration.md`: a site moving to code after "Go Headless" in its dashboard.
- `guides/reference-mode.md`: a stack that cannot run the shipped React code.
- `guides/feedback.md`: sending the user's feedback on building with Wix.
- `install/`: the scripts of a run (`setup.mjs`, `attach.mjs`, `deploy.mjs`, `install.mjs`, `templates.mjs`, `context.mjs`, `bootstrap.mjs`, `check.mjs`) and `pins.json`, the pinned CLI and templates versions.

### wix-headless-templates

Online: https://www.wix.com/skills/wix-headless-templates/SKILL.md. On disk: the plugin's `skills/wix-headless-templates/`, or `.agents/skills/wix-headless-templates/`.

The code wix-headless-kit builds from, one folder per business solution: `storefront`, `bookings`, `rentals`, `blog`, `cms`, `forms`, `members`, `events`, `restaurants`, `donations`, `pricing-plans`, `portfolio`, `faq`, plus `blank` and `shared`. Each folder holds:

- `INSTRUCTIONS.md`: the playbook, with the contracts.
- `app/`: the typed, framework-agnostic data layer over `@wix/sdk`, React hooks and reference components.
- `app-astro/`: the Astro pages with owner-editable SEO.
- `rest/`: the same data layer as plain REST calls, for a site without a bundler.
- `seed/`: the seed script that fills the site from a plan, `SEED.md` as the plan's contract, and a reader of what the site already holds.
- `project/`: the solution composed into the CLI's Astro scaffold.

`compose.mjs` at the root composes a solution's layers into a project.

### wix-manage

Online: https://www.wix.com/skills/wix-manage/SKILL.md. On disk: the plugin's `skills/wix-manage/`, or `.agents/skills/wix-manage/`.

REST recipes to configure and manage a site's business solutions, one recipe per task with the exact endpoints, request bodies and order of steps. `SKILL.md` is the index of every recipe by area, each a link. The recipes are under `references/<area>/`: `app-installation`, `stores`, `ecommerce`, `bookings`, `calendar`, `donations`, `get-paid`, `pricing-plans`, `restaurants`, `events`, `blog`, `cms`, `rich-content`, `forms`, `contacts`, `automations`, `marketing`, `google-ads`, `google-business-profile`, `analytics`, `seo`, `media`, `sites`, `domains`, `site-properties`, `collaborators`, `custom-apps`, `dashboard-navigation`, `accessibility`. Each recipe is also a docs article under its API's section.

### wix-docs

Online: https://www.wix.com/skills/wix-docs/SKILL.md. On disk: the plugin's `skills/wix-docs/`, or `.agents/skills/wix-docs/`.

Looks up the Wix API and SDK documentation to confirm an endpoint, method, request and response shape, field, enum or error before writing Wix code. `SKILL.md` has the two lanes, plain `curl` and the MCP's documentation tools, with the search, browse and read requests. `references/API_SPEC_SEARCH.md`: the spec index and its queries. `references/CALLING.md`: the identities a call runs as and how each token is minted. `references/EXTRACTING.md`: reading only the needed part of a big menu or method page with `curl` and `grep`.

### wix-readme

This index.

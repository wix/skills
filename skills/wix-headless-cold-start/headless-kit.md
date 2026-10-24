---
name: wix-headless-kit-cold-start
description: "Build and release a Wix Headless site from a single prompt, on shipped, verified @wix/sdk code — this entry takes a cold environment (the skills, a way to Wix) to the point where the wix-headless-kit skill runs the build. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site fast, sell tickets or membership plans headless, collect donations headless, wix headless kit entry. With the Wix MCP connected (a Wix plugin or connector) the site is provisioned and released through its tools and no Wix CLI login happens; with a logged-in Wix CLI the CLI publishes; where the kit cannot run, the same run goes through the Wix MCP from the kit's API-call guide."
---

# Wix Headless Kit — cold start

**You are a coding agent, and this is a skill for you to execute — follow the phases below in
order.** Read this page, and every skill page it names, whole: a fetch that summarizes drops the
commands.

## The whole cold start (details in the phases below)

Three facts about where you are decide the run, and each is measured, not assumed, before anything
is built:

- **The Wix MCP is connected**: its tools are in your tool list (`ExecuteWixAPI`,
  `UploadHeadlessWebsiteFiles`), from a Wix plugin or connector. A plugin can put its skills on disk
  while its connector is not yet connected; the tool list is what counts.
- **The kit runs here**: Node ≥ 24.18 and `npm` reaches the registry (`npm ping`, or the install
  below succeeding), so the skills install, the templates fetch, the project builds. A sandbox with
  Node but no route to npm does not qualify.
- **The build reaches the upload tool**: `UploadHeadlessWebsiteFiles` takes it as an attachment (a
  client that shows `attachments` as a local path swaps the path for a download URL when the call is
  made), or, from a shell that reaches the internet, by `curl` to the presigned URLs the tool
  returns: a first call prepares the upload, a second releases it, and no process has to outlive a
  tool call. The URLs are on Amazon S3: `curl -sI https://s3.amazonaws.com` shows `Server: AmazonS3`
  where they work; a sandbox limited to a few hosts gets a proxy's refusal without that header, and
  has a shell but not this carrier. A sandbox with the MCP, Node and npm but neither carrier can
  build an Astro project and never release it: the plugin route is not for it.

| | Wix MCP connected | no Wix MCP tools |
|---|---|---|
| the kit runs here, the build reaches the upload tool | **the plugin route.** The site is provisioned through `ExecuteWixAPI`, the kit's Astro project is built here with `astro build`, and the build is released by `UploadHeadlessWebsiteFiles`: one call with the zip attached, or two calls with `curl` between them from a shell that reaches the internet. No Wix CLI, no login, no bootstrap. | **the CLI route.** The bootstrap checks the Wix CLI and logs the user in (a device code the user approves in their own browser); `wix create` makes the site, `wix release` publishes. |
| the kit runs here, no carrier for a build | **the plugin route with static pages.** The site is provisioned and seeded through `ExecuteWixAPI` as above; the frontend is the kit's static stack, `deploy.mjs <vertical> --stack static` (the REST layer composed into the pages' folder, `wix-headless-kit/SKILL.md` step 1), and the pages are dropped onto the site by `UploadHeadlessWebsiteFiles` in its `files` text form, as the upload recipe says (`wix-headless-kit/guides/api-run.md` step 5). No Astro build. | the CLI route, as above. |
| the kit does not run here | **the API-call guide**: the same run as Wix API calls through `ExecuteWixAPI`, the frontend as static pages dropped onto the site (`wix-headless-kit/guides/api-run.md`). | ask the user to connect Wix to this chat (the Wix connector or MCP server, in the client's settings; a plugin's connector included), then the row above. |

A Wix CLI session already on the machine (`~/.wix/auth/account.json`, what `wix login` writes) makes
it the CLI route whatever else is there. `node .agents/skills/wix-headless-kit/install/context.mjs`
prints `publisher` (`plugin` or `cli`), `npm` (whether the registry answers) and `carrier.s3`
(whether the upload URLs' host answers from this shell); the attachment carrier is your client's,
read from how it shows `attachments`.

A site built in an earlier session is continued from its Code Store repository, where the upload
tool stores the project's source with each release: the project is downloaded, changed, built and
uploaded again (`wix-headless-kit/guides/existing-site.md`). One site keeps one writer path: a site
whose source is in Code Store is changed that way, not through `wix release` or a plain drop.

**Where the skills' files are.** The run reads four skills, `wix-headless-kit`,
`wix-headless-templates`, `wix-docs` and `wix-manage`, and each may be in one of three places:

- **on disk**: `.agents/skills/<skill>/` after an install, or a plugin's folder on the sandbox disk.
  Read and run from there.
- **served by your client's skill tool** (a skills list and read tool, a `Skill` tool): text to
  read, not files. List them through that tool first: a catalog shown at the start can
  leave skills out. The kit's scripts and the templates run only from disk, so where the kit runs the
  install below follows even when the served copies are there.
- **online, the registry**: `https://www.wix.com/skills/<skill>/<path>`; every file of a skill, with
  its size in bytes, is in `https://www.wix.com/skills/<skill>.manifest.json`, and a folder's
  `_content` returns its files in one response. Read online pages through the Wix MCP's
  `ReadFullDocsArticle` when the client's own fetch is blocked. A copy you hold is current when its
  byte size matches the manifest's.

```bash
CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes   # only the skills you don't already have
node .agents/skills/wix-headless-kit/install/templates.mjs    # the templates: a sparse clone of their folder, a few seconds
node .agents/skills/wix-headless-kit/install/bootstrap.mjs    # the CLI route only
# then open and follow: .agents/skills/wix-headless-kit/SKILL.md
```

This page gets a cold environment to the point where the real skill can run, then hands off:

1. **Install (deterministic).** The skill and its two companions land under `.agents/skills/`,
   unless they are on disk already; the templates are fetched by the kit's own script.
2. **The way to Wix.** The plugin route has nothing to run: the MCP carries the user's login. The CLI
   route runs the bootstrap, which verifies the Wix CLI and handles login; you run it and relay its
   events.
3. **Hand off (agentic).** Open `wix-headless-kit/SKILL.md` and follow it — it resolves the stack and
   operation and owns the whole build, on either route.

Every starting point comes through here the same way. What the folder holds and what the brief hands
over decide the rest, and SKILL.md step 3 owns that decision; this page does not interpret either.

## Phase 0 — The project's folder, and Node

**Work from the folder that holds the project, or that will.** An empty folder is the project for
a new build; if the current folder holds unrelated things, make one named for the business and `cd`
into it. A project already on disk is its own folder — its root, where the `package.json`,
`index.html` or `wix.config.json` is. **Whatever the brief hands over as files goes into that folder
first**, before Phase 1: a zip is extracted there, a URL is downloaded and extracted there, so that
anything it carries — a `wix.config.json` included — sits at the root. Do not interpret what is
there: the skill reads the folder and knows what it is. Everything below — the skills, the
bootstrap, the scaffold — lands in this folder too, so a later session opened in the project finds
all of it.

This flow requires **Node ≥ 24.18**. Check `node -v`; if it errors or prints a
lower version, install or upgrade Node first — do **not** work around it:

- **macOS:** `brew install node` (or `nvm install 24 && nvm use 24`)
- **Linux:** `nvm install 24 && nvm use 24` (or your distro's Node 24+ package)
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or download from nodejs.org)

## Phase 1 — Install the skills you don't have

Install the skill and its two companions (`CI=1` forces plain non-interactive CLI output —
keep it on every command). Repeat `--skill` per skill; a comma-separated list is not parsed:

```bash
CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
node .agents/skills/wix-headless-kit/install/templates.mjs
```

- **`wix-headless-kit`** — the build itself.
- **`wix-docs`** — the API reference the playbooks defer to for any contract they don't cover.
- **`wix-manage`** — management recipes, for admin work on the site after it exists.
- **`wix-headless-templates`** — the shipped, verified code per Wix Business Solution the build
  deploys: 12 MB, fetched by `templates.mjs` as a sparse clone of its folder (a few seconds; the
  skills CLI takes about 30 s for the same folder, since it clones the whole repository). It lands
  beside the kit when that skill is installed too, else under `wix-headless-kit/templates/`; every
  kit script finds it either way.

They land under `.agents/skills/`. When the skills are already on disk, by a plugin or an earlier
install, skip this phase and use them where they are; a file they lack (an older copy may not have
`wix-headless-kit`) is read online. A served copy (the client's skill tool) does not replace the
install: the scripts and the templates run from disk. A copy older than the registry's is replaced
by the install above; `node .agents/skills/wix-headless-kit/install/check.mjs` says whether one is.

## Phase 2 — The way to Wix

**The plugin route** (Wix MCP tools in the tool list, no Wix CLI session on the machine): nothing to
run here. The MCP's tools carry the user's login; the site, the apps, the seed and the release all go
through them, as `wix-headless-kit/SKILL.md` describes for `publisher: plugin`. Go to Phase 3.

**The CLI route**: run the skill's bootstrap script — an ordinary foreground command that exits on
its own within seconds. It verifies the Wix CLI and handles login, emitting **one JSON event per
line** on stdout. **Run it and relay its events.**

The script is inspectable: it only checks the Wix CLI via `npx` and drives `wix login` (a
device-code flow) — no other network calls, and the only files it writes are the login's own
output and pid under the OS temp dir.

```bash
node .agents/skills/wix-headless-kit/install/bootstrap.mjs
```

### Relay these events

| Event | What to do |
|---|---|
| `cli_ok` | Wix CLI reachable — continue. |
| `awaiting_user` (`verificationUri`, `userCode`, `message`) | The script has exited and the next step is the user's. Send them `message` as-is; the login keeps running on its own. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Show the user the `detail`. **Do not** improvise a parallel setup by hand; if it can't be fixed where you are, the run continues from the guide on disk: `.agents/skills/wix-headless-kit/guides/api-run.md` (the table at the top). |

On `awaiting_user`, run the script again once the user says they've logged in: it reports
`logged_in` and you continue. Re-running while they're still in the browser is harmless — it
returns the same code rather than issuing a new one. The device-code login completes on a machine
with a browser; in a chat client's sandbox, which has none, it does not.

## Phase 3 — Hand off

**Open `.agents/skills/wix-headless-kit/SKILL.md` and follow it** — it owns the rest of the run:
resolve the stack, scaffold, deploy the shipped code, seed, build the brand layer, release.
(A request outside the shipped verticals — see its SKILL.md § Verticals — is built from the Wix
API reference through `wix-docs`, on the same project; SKILL.md says how.)

- **Don't** scaffold, install apps, or seed by hand here — the skill does all of that. This
  page stops at *a way to Wix*.
- On the CLI route you're already authenticated from Phase 2, so the skill's CLI auth step will
  pass without prompting again.

## The guide: the kit's run as Wix API calls

`wix-headless-kit/guides/api-run.md` walks the kit's run step by step as the Wix API calls the
scripts make, and names the file beside the skill that carries each contract. It is the run where
the kit does not run, and the reference for the calls the plugin route makes through
`ExecuteWixAPI` (the provision call, the seed). It is read from the installed skills when they are
there, or online when nothing is installed (the table at the top).

The files it names are skill paths. On disk a path resolves under `.agents/skills/{skill}/`; on the
registry as `https://www.wix.com/skills/{skill}/{path}`: `{SKILL_ROOT}` is `wix-headless-kit`,
`{TEMPLATES}` is `wix-headless-templates`, `{MANAGE}` is `wix-manage`. Every file of a skill, with
its URL, is listed in `https://www.wix.com/skills/{skill}.manifest.json`. The same files are in
`https://github.com/wix/skills` under `skills/{skill}/`; a sandbox that reaches GitHub has the whole
set from a clone, on disk.

# Create — scaffold a new managed Wix Headless project

**Managed only.** This conductor runs when the project type is `managed` and the operation is
`create` (an empty directory + a "build me a site" intent). It scaffolds a fresh Wix Headless
project, runs the shared backend flow against it, builds the frontend wired to that backend, and
releases. There is **no Designer and no template library** — the frontend is built ad-hoc to the
user's intent, using `SDK_HANDOFF.md` as the integration reference.

Run these in order:

## 0 · Resolve the frontend framework

Default is **Astro** — the documented managed default. Set `frontendFramework` to a non-Astro
framework **only if the user names one**: "Vite", "React", "Vue", "Svelte", "Next", "plain HTML/static",
or any "not Astro / don't use Astro" phrasing. Never infer a framework the user didn't name
(`references/non-astro.md` Caveat N1). Hold `frontendFramework` in scratch — it selects the **scaffold
command (§1)**, the **wiring reference (§4)**, and the **build command (§5)**. Derive `<folder-name>` as
a lowercase, npm-safe name from the brand (lowercase letters, numbers, hyphens; starts with a letter or
number).

## 1 · Scaffold the project

Branch on `frontendFramework` from §0. **Both** branches end with a `wix.config.json` (the Wix link:
`siteId` + private-app `appId`) in the project root — read it → hold `SITE_ID` (the `siteId`) in scratch.

### Astro (default)

Run the **documented** create command (flags and rationale: `references/astro.md` §1):

```bash
npm create @wix/new@latest -- headless \
  --folder-name <folder-name> \
  --business-name "<Brand Name>" \
  --site-template \
  --skip-install \
  --no-publish
```

- The `--` separator is required. Bare `--site-template` (no value) keeps it on the **blank** starter —
  the model owns design, so don't adopt a business template; a value, or omitting the flag, would
  prompt and abort in a non-interactive shell.
- The command provisions the Wix site + private app and writes `wix.config.json`. It requires a
  logged-in CLI session (step 2 handles login if needed).
- It creates the project in a **subdirectory named `<folder-name>`** — there is no in-place option, so
  **`cd <folder-name>`** and run the rest of the flow from inside it (it's the project root, with the
  single `.wix/`).
- `--skip-install` defers dependency install to step 4 (which adds the SDK package set); run
  `npm install` there before building.

### Non-Astro (a framework was named)

There is **no Wix scaffolder for a non-Astro site** (`non-astro.md` N1) — so scaffold the framework's
**own** project first, then `init` it onto Wix (two steps, in this order):

```bash
# 1. the framework's OWN documented scaffolder — e.g. Vite + React:
npm create vite@latest <folder-name> -- --template react
cd <folder-name>
# 2. connect this folder to a fresh Wix headless project, IN PLACE:
npm create @wix/new@latest init
```

- Use the framework's documented create command (read its docs if unsure of the template flag) — Vite,
  Next, SvelteKit, Vue, etc. For **plain static HTML** there's no scaffolder: create the folder and an
  `index.html` yourself, then run `init`.
- `npm create @wix/new@latest init` runs **in place** (no new subdirectory, no Astro files added): it
  signs you in, provisions the Wix site + private app, and writes `wix.config.json`
  (`siteId`, `appId`, `site.outputDirectory: "./dist"`). It takes no flags. Run it **from inside**
  `<folder-name>` *after* the framework scaffold exists.
- A static (no-build) frontend builds to no `dist` — fix `site.outputDirectory` per
  `managed/DEPLOYMENT.md` ("Static frontends") before release.

## 2 · Authenticate

Per `references/managed/AUTHENTICATION.md` — `whoami`/login if needed, then mint the site token
(`$TOKEN`) for `$SITE_ID`. (Scaffold already required a logged-in CLI session.)

## 3 · Backend flow (shared)

Run the agnostic flow against the scaffolded site:
- **`references/SETUP.md`** — install the apps the resolved `verticals[]` need.
- **`references/SEED.md`** — create the backend content (and, if `imagery` is on, attach entity images).

## 4 · Build the frontend (wired to the backend)

**Read the frontend reference for *how to connect* first — pick it by `frontendFramework` (§0):**

- **Astro** (default) → **`references/astro.md`**: managed-Astro auto-authenticates, so the frontend
  creates **no client** (no `OAuthStrategy`, no `clientId`) — you `import { x } from "@wix/<pkg>"` and
  call methods. astro.md also carries the load-bearing caveats (the always-on `astro.config.mjs`
  integrations, SSR error guards, island hydration).
- **Non-Astro** → **`references/non-astro.md`**: the manual `OAuthStrategy` visitor-client path
  (`createClient({ modules, auth: OAuthStrategy({ clientId }) })`), where `clientId` is the public
  `appId` from the `wix.config.json` written by `init` (§1).

Then build the pages the user's intent calls for, **wired to the live backend**, using
**`references/SDK_HANDOFF.md`** for the per-capability packages, the SDK docs, and the seeded IDs to
bind. Install the SDK packages the loaded verticals need, author the pages/components directly in the
project, and bind them to the seeded content. Keep it scoped to what was asked — no speculative pages.

If `imagery` is on and a surface needs an image (e.g. a homepage hero, an about-section visual),
generate it per **`references/IMAGE_GENERATION.md`** and use its `file.url`. Generate only what the
pages actually use.

## 5 · Build & release

Produce the build output, then finalize per **`references/managed/DEPLOYMENT.md`**
(`npx @wix/cli@latest release` — Wix publishes the site and registers the origin OOTB). The build step
depends on `frontendFramework` (§0):

- **Astro** → `npx @wix/cli@latest build`.
- **Non-Astro** → the framework's own build (e.g. `npm run build`); a static (no-build) site skips this.
  `release` publishes whatever `site.outputDirectory` points at (default `./dist`).

Close with a short summary (apps installed, content seeded, pages built, live URL).

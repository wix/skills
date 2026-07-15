# Create — scaffold a new managed Wix Headless project

**Managed only.** This flow runs when the project type is `managed` and the operation is
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
CI=1 npm create @wix/new@latest -- headless \
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
CI=1 npm create @wix/new@latest init
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
**`references/SDK_HANDOFF.md`** for the per-capability packages, the SDK docs, and the seeded schema to
bind (collection/form names + field keys; all other content is queried live). Install the SDK packages the loaded verticals need, author the pages/components directly in the
project, and bind them to the live backend content. Keep it scoped to what was asked — no speculative pages.

> **`npm install` note (Astro):** always run **`npm install --ignore-scripts`**. Astro pulls `sharp`
> as an *optional* transitive dep for **local, build-time**
> image optimization this headless flow never uses (all imagery is remote Wix Media URLs served through
> plain `<img>`), and its from-source native build can fail and abort the whole install; `--ignore-scripts`
> skips that failing build up front. **Do not** use the deprecated `--no-optional` (silent no-op in modern
> npm — sharp still builds) or `--omit=optional` (sharp still resolves). A failed/absent `sharp` is
> **expected and harmless — never build, retry, or repair it, and never spend time diagnosing it**
> (`astro.md` Caveat A9).

If `imagery` is on and a surface needs an image (e.g. a homepage hero, an about-section visual),
generate it per **`references/IMAGE_GENERATION.md`** and use its `file.url` — up to the per-run
`imageCap` (Discovery §4). Generate only what the pages actually use. For any slot **not** generated
(imagery off, over the cap, or a generation failure), render the **themed-block fallback** — a styled
`div` on the site's design tokens — never an empty slot or a broken `<img>` (`IMAGE_GENERATION.md`).

## 5 · Build & release

**Release once, at the very end.** Do **not** `build && release` mid-flow to "preview" progress. Reach this step only after **all** of the earlier work is done: Setup (§3), Seed **including the entity-image attach** (`SEED.md` § "Entity images" — pass-2 patches), the frontend wiring (§4), and any page imagery. A single release at the end is the target; each extra build+release cycle is wasted wall time.

**A re-release does not refresh backend content — don't reach for one to "fix" seeded data or images.** A headless frontend fetches seeded backend content **and entity images at runtime** (via the SDK / REST), so that content is *not* baked into the build output. If you change a seeded entity or attach an image **after** releasing, the live site already reflects it on the next request — there is nothing to re-publish. Re-release **only** when the **frontend build output itself** changed. In particular, a backend image that isn't showing is an **attach-shape bug** (wrong write shape → the entity has no image — see `SEED.md` § "Entity images" / the capability recipe's **Attach images** step), **not** a stale CDN cache; don't re-release to "clear a cache" for it.

Produce the build output, then finalize per **`references/managed/DEPLOYMENT.md`**
(`npx @wix/cli@latest release` — Wix publishes the site and registers the origin OOTB). The build step
depends on `frontendFramework` (§0):

- **Astro** → `npx @wix/cli@latest build`.
- **Non-Astro** → the framework's own build (e.g. `npm run build`); a static (no-build) site skips this.
  `release` publishes whatever `site.outputDirectory` points at (default `./dist`).

Close with a short summary (apps installed, content seeded, pages built, live URL).

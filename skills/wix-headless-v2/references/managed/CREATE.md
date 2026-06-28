# Create — scaffold a new managed Wix Headless project

**Managed only.** This conductor runs when the project type is `managed` and the operation is
`create` (an empty directory + a "build me a site" intent). It scaffolds a fresh Wix Headless
project, runs the shared backend flow against it, builds the frontend wired to that backend, and
releases. There is **no Designer and no template library** — the frontend is built ad-hoc to the
user's intent, using `SDK_HANDOFF.md` as the integration reference.

Run these in order:

## 1 · Scaffold the project

Run the **documented** create command (flags and rationale: `references/astro.md` §1). Derive
`<folder-name>` as a lowercase, npm-safe name from the brand (lowercase letters, numbers, hyphens;
starts with a letter or number):

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
  single `.wix/`). Then read `./wix.config.json` → hold `SITE_ID` (the `siteId`) in scratch.
- `--skip-install` defers dependency install to step 4 (which adds the SDK package set); run
  `npm install` there before building.

## 2 · Authenticate

Per `references/managed/AUTHENTICATION.md` — `whoami`/login if needed, then mint the site token
(`$TOKEN`) for `$SITE_ID`. (Scaffold already required a logged-in CLI session.)

## 3 · Backend flow (shared)

Run the agnostic flow against the scaffolded site:
- **`references/SETUP.md`** — install the apps the resolved `verticals[]` need.
- **`references/SEED.md`** — create the backend content (and, if `imagery` is on, attach entity images).

## 4 · Build the frontend (wired to the backend)

**Read the frontend reference for *how to connect* first.** The scaffold (step 1) is **Astro** — the
documented default — so read **`references/astro.md`**: managed-Astro auto-authenticates, so the
frontend creates **no client** (no `OAuthStrategy`, no `clientId`) — you `import { x } from "@wix/<pkg>"`
and call methods. astro.md also carries the load-bearing caveats (the always-on `astro.config.mjs`
integrations, SSR error guards, island hydration). Only if the user named a **non-Astro** framework,
use **`references/non-astro.md`** instead (the manual `OAuthStrategy` client path — and the model
scaffolds that framework's own project per non-astro.md Caveat N1, since Wix has no non-Astro scaffolder).

Then build the pages the user's intent calls for, **wired to the live backend**, using
**`references/SDK_HANDOFF.md`** for the per-capability packages, the SDK docs, and the seeded IDs to
bind. Install the SDK packages the loaded verticals need, author the pages/components directly in the
project, and bind them to the seeded content. Keep it scoped to what was asked — no speculative pages.

If `imagery` is on and a surface needs an image (e.g. a homepage hero, an about-section visual),
generate it per **`references/IMAGE_GENERATION.md`** and use its `file.url`. Generate only what the
pages actually use.

## 5 · Build & release

`npx @wix/cli@latest build`, then finalize per **`references/managed/DEPLOYMENT.md`**
(`npx @wix/cli@latest release` — Wix publishes the site and registers the origin OOTB). Close with a
short summary (apps installed, content seeded, pages built, live URL).

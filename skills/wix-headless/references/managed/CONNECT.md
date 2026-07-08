# Connect — wire an existing project to a managed Wix backend

**Managed only.** This flow runs when the project type is `managed` and the operation is
`connect` **or** `iterate` — a frontend project is already on disk (or a design URL was fetched into
CWD) and the user wants it hosted on Wix and powered by Wix Business Solutions. It attaches Wix to the
project (or reuses the existing connection when iterating), runs the shared backend flow, wires the UI
to that backend, builds, and releases. **The only difference for `iterate`** — the project is already
connected, so §1 skips `init` and reuses the existing `wix.config.json`.
**No Designer, no templates, no binding-map machinery** — `SDK_HANDOFF.md` is the wiring reference.

Run these in order:

## 1 · Attach Wix to the project — skip if already connected

**If a `wix.config.json` (or `.wix/`) is already present, the project is already connected to Wix — this is the *iterate* case.** Do **not** run `init` again (it's for attaching a *new* Wix project). Read `./wix.config.json` → hold `SITE_ID` in scratch, and skip to §2.

> **Iterate is incremental.** An already-connected project may already be set up and/or seeded from a prior run. In §3–§4, **check current state before acting** — query installed apps before installing, check for already-seeded content before seeding (re-seeding duplicates it), and inspect existing wiring before adding. Do only the delta the new intent requires; leave the rest untouched.

Otherwise, attach Wix in place:

```bash
CI=1 npm create @wix/new@latest init
```

Run from the project directory. It creates `wix.config.json` (with the `siteId` and the headless
OAuth app) and registers the project's origin on that app. Read `./wix.config.json` → hold `SITE_ID`
in scratch.

**If the design was brought in from elsewhere** (a `.zip`/folder/file, or a fetched design-file URL),
place it into CWD **first** — unzip/copy/fetch the design's files into the working directory so it's the
project on disk — **then** `init`. An empty CWD plus a brought-in design is still `connect`, not create:
land the design, then attach Wix to it.

## 2 · Authenticate

Per `references/managed/AUTHENTICATION.md` — `whoami`/login if needed, then mint the site token
(`$TOKEN`) for `$SITE_ID`.

## 3 · Backend flow (shared)

- **`references/SETUP.md`** — install the apps the resolved `verticals[]` need.
- **`references/SEED.md`** — create the backend content (and, if `imagery` is on, attach entity images).

## 4 · Wire the existing UI

**Read the frontend reference for *how to connect* first**, keyed on the brought project's framework:
an **Astro** project → **`references/astro.md`** (auto-auth, no client); **any other framework or a
static design** → **`references/non-astro.md`** (manual `OAuthStrategy` client). The chosen file carries
the connect mechanics and the framework caveats; **`references/SDK_HANDOFF.md`** carries the
per-capability packages, the SDK docs, and the seeded schema (all other content is queried live).

Connect the existing project to the live backend. Install the SDK packages the loaded verticals need;
then, with **additive** edits:
- bind seeded content into the regions that already exist (product grids, post lists, item pages…);
- add the connected feature the intent implies where it's missing (e.g. a contact/RSVP form, a cart);
- always guard SDK calls (try/catch + fallback) so a failed call never blanks the page.

A run must end with the site actually reading from / writing to Wix — `init` + `release` with nothing
wired is not an acceptable outcome. If `imagery` is on and a surface needs an image, generate it per
**`references/IMAGE_GENERATION.md`** (up to the per-run `imageCap`, Discovery §4); for any slot not
generated — off, over the cap, or a failure — render the **themed-block fallback** (a styled `div` on
the design tokens), never an empty or broken slot.

## 5 · Build & release

**Release once, at the very end** — only after Setup (§3), Seed **including the entity-image attach** (`SEED.md` § "Entity images"), the UI wiring (§4), and any imagery are all complete. Don't `build && release` mid-flow to preview. **A re-release does not refresh backend content:** a headless frontend fetches seeded content and entity images at **runtime**, so they're not in the build output — changing a seeded entity or attaching an image after release is live on the next request with **no** re-publish. Re-release only when the **frontend build output** changed. A backend image that isn't showing is an attach-shape bug (`SEED.md` § "Entity images"), not a stale cache — don't re-release to clear one.

If the project has its own build (`package.json` with a `build` script), run `npm run build` and point
`wix.config.json`'s `site.outputDirectory` at the build output. A **static** site (no build) needs the
static-hosting fixes in **`references/managed/DEPLOYMENT.md`** — the entry file must be named
`index.html`, and `outputDirectory` must point at the directory holding it (init's `./dist` default is
wrong for static). Then finalize per **`references/managed/DEPLOYMENT.md`** (`npx @wix/cli@latest release` — Wix
publishes + registers the origin OOTB). Close with a short summary (apps installed, content seeded, what
was wired, live URL).

# Connect — wire an existing project to a managed Wix backend

**Managed only.** This conductor runs when the project type is `managed` and the operation is
`connect` — a frontend project is already on disk (or a design URL was fetched into CWD) and the
user wants it hosted on Wix and powered by Wix Business Solutions. It attaches Wix to the existing
project, runs the shared backend flow, wires the existing UI to that backend, builds, and releases.
**No Designer, no templates, no binding-map machinery** — `SDK_HANDOFF.md` is the wiring reference.

Run these in order:

## 1 · Init the existing project

```bash
npm create @wix/new@latest init
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

Connect the existing project to the live backend using **`references/SDK_HANDOFF.md`** as the
reference. Install the SDK packages the loaded verticals need; then, with **additive** edits:
- bind seeded content into the regions that already exist (product grids, post lists, item pages…);
- add the connected feature the intent implies where it's missing (e.g. a contact/RSVP form, a cart);
- always guard SDK calls (try/catch + fallback) so a failed call never blanks the page.

A run must end with the site actually reading from / writing to Wix — `init` + `release` with nothing
wired is not an acceptable outcome. If `imagery` is on and a surface needs an image, generate it per
**`references/IMAGE_GENERATION.md`**.

## 5 · Build & release

If the project has its own build (`package.json` with a `build` script), run `npm run build` and point
`wix.config.json`'s `site.outputDirectory` at the build output; a static site (plain `index.html`) needs
no build. Then finalize per **`references/managed/DEPLOYMENT.md`** (`npx @wix/cli@latest release` — Wix
publishes + registers the origin OOTB). Close with a short summary (apps installed, content seeded, what
was wired, live URL).

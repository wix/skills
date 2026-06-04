# Build — own-build framework class (`frontendBuild ∈ {none, own}`)

The post-approval conductor for the **non-astro** framework classes. Opened from `BUILD.md` the moment the run routes on `frontendBuild === "none"` (static HTML, no build) or `frontendBuild === "own"` (own-build SPA — Vite/React/Vue/Svelte, the project's own `npm run build`). This file owns the **framework spine** (install, build) for those classes; the **(operation × framework) bootstrap/wiring cells** and the **shared release tail** are owned by `BUILD.md` and detailed for this file's cells below.

The cross-cutting operational sections both framework conductors share — **Subagent rate / credit limits**, the **parallel-batch diagnostic**, the **Final Message** (summary + run.json), the **Final run.json format**, and the **Shared release tail** — live in `BUILD.md`. The pre-approval flow is `PLAN.md` → `PLAN-create.md`/`PLAN-connect.md`; the three cross-cutting rules referenced below — **Two tracks**, **Batching discipline**, **User-facing output** — live in `PLAN.md`. Set the model tier on every dispatch (`SKILL.md` § "Subagent model tier").

> **This file is framework-routed; the *operation* (create/connect/extend) reaches it only through the two cells.** The install/build spine below is operation-blind — it reads only `frontendBuild`. The Bootstrap cell and Wiring cell sections are the operation-specific halves (they read the contract's operation section). Live (operation × framework) pairings on this file: **connect × none** (a brought-in static HTML site), **connect × own** (a brought-in framework SPA), and **create × own** (the skill scaffolds a framework SPA — the companion case). The `extend` operation column is reserved.

## Framework spine — `none` (static HTML)

Operation-blind. The brought design ships as-is; there is **no build**, and `@wix/sdk` loads from a CDN at runtime, so the usual install steps are skipped:

- **Install** — apply `SETUP.md` Step 4a (app installs per inferred capability, with `x-wix-request-id` capture) **only**. **Skip** `env pull` (Step 4b — CDN `@wix/sdk` inlines the `appId` from `wix.config.json`, needs no `WIX_CLIENT_ID`, and the `init`-bootstrapped project has no `env` command), **skip** the Step 4c per-pack `npm install` (CDN imports), and **skip** `scaffold.sh` / `seed-utilities.sh`.
- **Build** — **none.** The HTML is the deployable. Proceed straight to the shared release tail.

## Framework spine — `own` (own-build SPA)

Operation-blind. A client-build single-page app (Vite + React/Vue/Svelte or similar) that ships its **own** build. `@wix/sdk` is **bundled**, not CDN-loaded, and the app is **built before release**.

**Framework-agnostic by construction — read this before touching anything framework-specific.** The skill carries **no per-framework instructions** (there is no `references/vite/`, no `references/vue/`):
- **Runtime is identical across every framework.** All of them call Wix through the same `@wix/sdk` modules (`createClient`, `OAuthStrategy`, `@wix/data`/`@wix/forms`/…). The wiring writes the *same SDK calls* whether the host is React, Vue, or Svelte — only the surrounding idiom differs (`useEffect` vs `onMounted` vs a store). The wiring agent adapts the idiom to whatever framework it finds.
- **Build is framework-dependent and derived, never hardcoded.** Each framework builds differently and `wix build` builds **astro only** — so for `own` you run the **project's own build command**. Derive the specifics from the project itself — its `package.json` scripts (`build` is the near-universal name), the framework config file (`vite.config.*`, `svelte.config.*`, …), and the framework's official docs via whatever doc source is available (web search, or a docs MCP **only if the user has one — never assume it**). React + Vite is the eval fixture, never a special case.

- **Install** — `SETUP.md` Step 4a (app installs per inferred capability, with `x-wix-request-id` capture). Then **bundle the SDK**: in the project dir, `npm install @wix/sdk` + the capability modules the connection needs (`@wix/data` for a CMS persistence swap, `@wix/forms`, `@wix/stores`, …) as real dependencies, so the bundler includes them. **Skip** `env pull` (the `appId` is inlined from `wix.config.json`, no `WIX_CLIENT_ID` at runtime) and **skip** the CDN-only `none` path. Capture timing as a `npm-install` phase.
- **Build** — run the **project's own build** (`npm run build`, confirmed against `package.json` `scripts`), producing the static output dir (commonly `dist/`). Then point `wix.config.json.site.outputDirectory` at that dir. This is **step 1 of the shared release tail** for `own`; never `wix build`. A build failure is a **code bug** — fix it (or report it), do **not** retry blindly (`BUILD-astro.md` § "Build failure modes").

## The run from approval — `none` tenant (connect × none)

The user just approved; `init-site-json.mjs --frontend custom` wrote `.wix/site.json`. **Nothing is dispatched yet.** The frontend-track playbook is `<SKILL_ROOT>/references/custom/INSTRUCTIONS.md` (the conductor follows its § "The flow"; the subagents open the per-capability guides). The run:

1. **Bootstrap cell (connect × none)** — see § "Bootstrap cell" below.
2. **Setup (business track) — app installs only.** Apply the framework-spine install rule above (`SETUP.md` Step 4a; skip 4b/4c).
3. **Seed (business track) — DISPATCH seeders as subagents, do NOT inline.** This is the **same per-pack seeder-dispatch model as astro** (`SEED.md` + `BUILD-astro.md` § "Wave 3"): fire **one seeder subagent per capability** that has a seed recipe, as a single concurrent background batch; capture a handle per seeder. Backend creation the augmentation needs — the **Wix Form definition** (forms), a **CMS collection + items** (cms), products/posts (stores/blog) — is each a seeder subagent. **Never run seeding inline in the orchestrator:** the number of seeders is unpredictable (it scales with the brought-in site's content), and inlining serializes the work and bloats the orchestrator's context — exactly the failure the per-pack dispatch exists to prevent. Collect each seeder's returned IDs / form IDs at the gate.
4. **Wiring cell (connect × none)** — see § "Wiring cell" below.
5. **Release** — the **shared release tail** (`BUILD.md` § "Shared release tail"): `none` has no build, so run `npx @wix/cli@latest release` directly. See § "Release" below for the run.json shape.

## The run from approval — `own` tenant

The user just approved; `init-site-json.mjs --frontend custom` wrote `.wix/site.json` and `frontendBuild: own` is in scratch. The frontend-track playbook is still `<SKILL_ROOT>/references/custom/INSTRUCTIONS.md` (the connection model is framework-blind); only the *mechanics* below differ from `none`. The run differs by **operation**:

1. **Bootstrap cell** — `connect × own` (a brought-in SPA: connection plan + `init` over the source) or `create × own` (the companion case: Designer → scaffold the SPA → `init` → emit DESIGN.md + token CSS → generate the app importing it). See § "Bootstrap cell".
2. **Setup (business track) — app installs + bundle the SDK.** Apply the `own` framework-spine install rule above: `SETUP.md` Step 4a app installs, then `npm install @wix/sdk` + capability modules in the project dir. Skip `env pull`.
3. **Seed (business track) — DISPATCH seeders as subagents** (+ Image Phase 1 Decorative, gated). Same per-pack seeder-dispatch model as the `none` tenant and astro (`SEED.md`). For a **persistence swap**, the cms seeder creates a **public-read CMS collection** whose schema is the connection plan's `persistenceSwap.inferredShape` (one collection per entity-shape — e.g. `Lists` + `Todos`), and returns the `collectionId`(s). In the **same concurrent batch**, dispatch `image-phase-1-decorative` when `imagery === "ai-generated"` (§ "Imagery gates (own)"). Collect seeder IDs + the Phase-1 slot→URL map at the gate; at the gate, write that map to `src/decorative-images.json` (see § "Imagery gates (own)").
4. **Wiring cell** — `connect × own` (rewrite the source data layer to `@wix/data`) or `create × own` (write a fresh data module). See § "Wiring cell". In the message that opens this cell (post seed-gate, entities exist), also dispatch **Image Phase 2 Entity** when `imagery === "ai-generated"` (§ "Imagery gates (own)").
5. **Build + Release** — the **shared release tail** (`BUILD.md` § "Shared release tail"): for `own`, step 1 runs the project's own `npm run build` and points `outputDirectory` at the build output (`dist/`), then `npx @wix/cli@latest release`. See § "Release" below for the run.json shape. **On `ai-generated`, wait the Image Phase 2 handle (120 s cap) *before* `npm run build`** (§ "Imagery gates (own)").

## Bootstrap cell

> **(operation × framework) cell.** Owned conceptually by `BUILD.md` § "The two (operation × framework) cells"; the content lives here (read-isolation — only the own-build conductor loads it). Three live tenants: **connect × none**, **connect × own**, **create × own**.

### connect × none

**Connection plan (background) + init (foreground), as the entry batch:**
- **Connection plan** — dispatch one subagent with Instruction file `<SKILL_ROOT>/references/custom/CONNECTION_PLAN.md`; inline the site's file list + inferred capabilities (from the contract's operation section / Discovery scratch). Capture `connplan_handle`. It returns the binding map + augmentation spec (JSON).
- **Init** — `npm create @wix/new@latest init` in the project dir (foreground; non-interactive when logged in). Then **fix `wix.config.json.site.outputDirectory`** to the dir holding the entry HTML (init defaults it to `./dist`), and patch `siteId`/`appId` into `.wix/site.json` (`SETUP.md` Step 1–2 shape). Init registers the OAuth app's `allowedDomains` for the published origin — **no separate OAuth call needed.**

### connect × own

A brought-in framework SPA. **Connection plan (background) + init (foreground), as the entry batch** — same shape as connect × none, with two `own` differences:
- **Connection plan** — dispatch the `CONNECTION_PLAN.md` subagent as for `none`, but inline `frontendBuild: own` so it reads **un-built `src/**` source** and emits a `persistenceSwap` (not an empty binding map). Capture `connplan_handle`.
- **Init** — `npm create @wix/new@latest init` in the project dir (the SPA repo). **Do NOT fix `outputDirectory` to the source dir** — for `own` it points at the **build output** (`dist/`), set later by the release tail *after* the build. Patch `siteId`/`appId` into `.wix/site.json`. The source SPA is untouched at bootstrap (wiring edits it later).

### create × own (companion case — scaffold a framework SPA)

No brought-in site; the prompt explicitly named a framework (`DISCOVERY.md` Wave 0 resolved `operation: create`, `frontendBuild: own`). Bootstrap is **Designer (background) + framework-native scaffold → `init` → emit tokens → generate app**:
- **Designer (background, dispatch first).** Dispatch the Designer (`<SKILL_ROOT>/references/DESIGN_SYSTEM.md`), inlining the vibe/aesthetic craft held in scratch from Discovery — **identical to the astro branch** (`BUILD-astro.md` run-step 0). Its output is framework-agnostic (`data.design` — the DESIGN.md frontmatter + `data.shell`), so it runs the same regardless of framework. Capture `designer_handle`. **Only the astro `compose.mjs` (the 6 astro files) is skipped on this branch — not the Designer.**
- **Scaffold** — run the framework's own create command, non-interactively, in the working dir: `npm create vite@latest <dir> -- --template react` (or `svelte`/`vue` per the named framework), then `npm install`. Derive the exact command from the named framework (the scaffold command is framework-specific and **not** hardcoded in the skill — pick the framework's documented create command). This replaces astro's `scaffold.sh` (which is astro-only). **Do not** use a `npm create @wix/new` template flag — scaffold-then-`init` is framework-general.
- **Emit design tokens + placeholder decorative map** — once `designer_handle` returns and the project dir exists, pipe its `data.design` into `emit-design-tokens.mjs` (project dir as `argv[2]`, brand as `argv[3]`): writes the canonical `DESIGN.md` + `.wix/design-tokens.css` + `.wix/site.d.ts`. **Do NOT run `compose.mjs`** — it writes astro files. Then write a **placeholder decorative map**: `: | node <SKILL_ROOT>/scripts/write-decorative-json.mjs "<project-dir>"` (empty stdin → `src/decorative-images.json = {}`), so the generated app builds and renders themed blocks even if Image Phase 1 never runs (themed-blocks mode, or a Phase-1 failure). The real URLs overwrite this at the seed gate (§ "Imagery gates (own)").
- **Generate the initial app (first cut: minimal scaffold).** Produce a small, clean app — a few components — that **imports `.wix/design-tokens.css`** (or copies it into the app's styles) so the brand palette/type apply as CSS custom properties (`var(--color-paper)`, `var(--font-display)`, …) and `data.shell` strings fill the hero/nav copy. This is the **brand's look on the SPA** — real tokens, not invented ones. **Decorative images:** the app must `import` `src/decorative-images.json` and render a **`hero`** image from `decorativeImages.hero` and an **`about`** section image from `decorativeImages.about` — when the value is present render `<img src={…} alt="" loading="lazy" />`, when **empty/absent render a themed block** (`background: var(--color-paper-warm)` with the hero copy over it). **Exactly these two slot keys (`hero`, `about`) — do not invent others** (they must match the `["hero","about"]` set Image Phase 1 is asked for and the credit estimate in `DISCOVERY-create.md` §2.5.1). Astro's framework-specific *component composition* (`compose.mjs`'s 6 files) is **not** re-homed (deferred — SPA plan § Companion case 4b); the **tokens + imagery are**. The app generation is a normal subagent dispatch (inline the DESIGN.md token vocabulary + `data.shell`); the connection then runs over it via the spine below.
- **Rendering contract for live Wix data — inline these two rules into the app-gen dispatch** (the SPA *owns* its markup + CSS, so unlike astro it gets no pre-sized templates; without these, real data breaks the layout):
  1. **Constrain every Wix image.** Wix media URLs serve full-resolution images; an `<img>` with no sizing renders at intrinsic size and **overflows its card onto the text**. Every image (product, hero/decorative, CMS) must sit in a slot with a fixed `aspect-ratio` (or `height`) and use `width: 100%; height: 100%; object-fit: cover` — mirror the astro rule in `references/astro/templates/stores/components-stores.css` (`.product-card-media > img`). Never render a Wix image unconstrained.
  2. **Rich-text fields are HTML — render the plain variant.** A Wix Stores product `description` (and many CMS rich fields) is **HTML/ricos**; rendered as text it shows literal `<p>…</p>` tags. Bind the **plain** field: products → **`product.plainDescription`** (fall back to `description.replace(/<[^>]*>/g, "")` if absent); never bind raw `description` into `textContent`/`{…}`. (The astro path does this at `references/astro/templates/stores/products/[slug].astro`.) Per-capability field paths (product image/price/slug, CMS fields) live in `references/custom/<cap>/WIRING.md` — follow them.
- **Init** — `npm create @wix/new@latest init` over the scaffolded project; point `outputDirectory` at the build output later (release tail). Patch `siteId`/`appId`.

## Wiring cell

> **(operation × framework) cell.** Owned conceptually by `BUILD.md` § "The two (operation × framework) cells"; the content lives here (read-isolation). Three live tenants: **connect × none**, **connect × own**, **create × own**.

### connect × none

**Wiring gate → wire (parallelism is a RUNTIME decision keyed on file topology).** Wait `connplan_handle` + all seeder handles. Each capability's `<SKILL_ROOT>/references/custom/<capability>/WIRING.md` is the how-to; *how many writers* run is decided from the connection plan's `injectAt.file` / region `file` set:
- **Capabilities share a file (the common single-page case — e.g. one `index.html` with both a form and a feedback list):** wire them with a **single writer** — either inline, or one subagent handling *all* capabilities for that file. **Never dispatch parallel agents at the same file** — they clobber each other's edits and duplicate the SDK bootstrap. This mirrors the astro shared-shell-patcher discipline (serialize writers to a shared file).
- **Capabilities map to distinct files:** dispatch one wiring subagent per file (concurrent batch) — no conflict.

Inline each agent with its binding-map/augmentation-spec slice + seeded IDs + the site's CSS token names; each injects client-side `@wix/sdk` `<script type="module">` (additive; styled from the design's tokens). The orchestrator decides writer count from the plan; the WIRING guides don't dictate it.

### connect × own

The brought-in SPA's data layer is **rewritten in source** to call `@wix/sdk` — **not** a `<script>` injection. The connection plan's `persistenceSwap` entries name the source file + the load/save functions to replace and the seeded `collectionId`(s).
- **Wire per `persistenceSwap.sourceFile`, not per capability.** Each swap entry targets one source file (e.g. `src/App.jsx`); dispatch one wiring subagent per distinct source file (or inline if one). **Never two writers on the same source file** (same shared-file discipline as `none`).
- Each writer opens `<SKILL_ROOT>/references/custom/cms/WIRING.md` § "Framework SPA — persistence swap" and rewrites the named `load`/`save` functions/effects to `@wix/data` `query`/`insert`/`update`/`remove` against the seeded collection, using bundled `import { items } from "@wix/data"` (the app `npm install`ed it — **not** the CDN). The component tree, JSX, and styling are untouched. Inline the `appId` (OAuth `clientId`) + `collectionId` literally.
- The agent adapts to the framework idiom it finds (React `useEffect`/state, Vue `onMounted`/refs, Svelte stores) — the SDK calls are identical; only the surrounding idiom differs.

### create × own (companion case)

The skill controls the source (it scaffolded the app), so there is **no data-layer archaeology** — the wiring agent **writes a fresh data module** (e.g. `src/wixData.js`) exposing the same `load`/`save` surface the generated components call, backed by `@wix/data` against the seeded collection. Same SDK calls as connect × own; the only difference is *write-fresh* vs *rewrite-existing*. `custom/cms/WIRING.md` § "Framework SPA — persistence swap" covers the call shapes.

> **Manifest check (two timings for `own`).** Run `node <SKILL_ROOT>/scripts/check-manifest.mjs <project-dir> integration <connection-plan.json>`:
> - **After wiring, before build** — verifies the *connection*: for `none`, an SDK `<script>` in each binding-map/augmentation `file`; for `own`, the bundled `@wix/sdk` import + a `@wix/data` CRUD call in each `persistenceSwap.sourceFile` (or the fresh data module). The always-connect invariant must hold (exit 1 if zero connections).
> - **After the build, before release (`own` only)** — re-run with `--build-output <dir>` (e.g. `--build-output dist`) to assert the build output exists and is non-empty, so release publishes the *built* app, not the un-built dev entry that 404s. (For `create × own` with no connection-plan JSON, feed a synthesized `{persistenceSwap:[{sourceFile:"src/wixData.js"}]}` so the same checker verifies the fresh module.)
>
> `BUILD-astro.md` § "Build failure modes" applies the same fail-loud discipline.

> **Always connect.** This framework class must end with the site reading from or writing to Wix; `init`+`release` of a static page with no connection is not acceptable (`references/custom/INSTRUCTIONS.md` § "Two locked principles"). The per-capability `custom/<cap>/WIRING.md` guides own the wiring step.

## Imagery gates (own)

The `imagery` flag (`"ai-generated"` | `"themed-blocks"`, captured in `DISCOVERY-create.md` Step 2.5, default `"themed-blocks"`) gates **both** image phases on the `own` branch — exactly as it does on astro (`BUILD-astro.md` § "Imagery gates"; keep the two in sync). Both phases are framework-agnostic: Phase 2 PATCHes Wix-side entities (no frontend dependency at all); Phase 1's decorative URLs reach the SPA through `src/decorative-images.json` (which the generated app imports), **not** through astro's `patch-decorative-slots.mjs` (that script stays astro-only).

- **Image Phase 1 — Decorative** (seed-wave batch, run-step 3). Dispatch the `image-phase-1-decorative` subagent (`<SKILL_ROOT>/references/images/INSTRUCTIONS.md`) **only when `imagery === "ai-generated"`**, passing **`decorativeSlots: ["hero","about"]`** (the canonical `own` set — matches the app-gen components + the credit estimate). At the **seed gate**, when it returns, overwrite the decorative map: pipe its `data.slots` into `write-decorative-json.mjs` —
  ```bash
  echo '<image-phase-1 data.slots JSON>' | node <SKILL_ROOT>/scripts/write-decorative-json.mjs "<project-dir>"
  ```
  This rewrites `src/decorative-images.json` with the real URLs **before** the build. On `"themed-blocks"` (default): do **not** dispatch, leave the placeholder `{}` from bootstrap in place (the app renders themed blocks), and record `{phase: "image-phase-1-decorative", status: "skipped", notes: "themed-blocks mode"}`.
- **Image Phase 2 — Entity** (opens the Wiring cell, run-step 4). Same gate — dispatch `image-phase-2-entity` only on `ai-generated`, after the seed gate (entities exist); inline the `seeded.<pack>` slice (productIds/collectionIds/itemIds + names/descriptions) + brand context. It PATCHes Wix entities (`stores/v3/products`, `wix-data/v2/items`, `blog/v3/...`) — identical to astro, no frontend touch. On `themed-blocks`: skip, record `{phase: "image-phase-2-entity", status: "skipped"}`.

> **The load-bearing ordering:** the seed-gate `write-decorative-json.mjs` overwrite **must precede `npm run build`** (Release step 1). Vite resolves the `src/decorative-images.json` import at build time, so a build run before the overwrite ships themed blocks even in `ai-generated` mode. The bootstrap placeholder + the seed-gate overwrite both run before Release, so the order holds — do not move the build earlier.

## Release

Apply the **shared release tail** (`BUILD.md` § "Shared release tail"). Step 1 (build) is **framework-keyed**:

**`none`** — no build; the HTML is the deployable. Run release directly:

```bash
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npx @wix/cli@latest release 2>&1   # parse `Site published on <url>`; NO `wix build` first
```

Record `{ phase: "release", seconds }` — no `{ phase: "build" }`/`{ phase: "compose" }` entry.

**`own`** — first settle imagery, then run the **project's own build**, point `outputDirectory` at the build output, then release:

- **On `imagery === "ai-generated"`:** wait the Image Phase 2 handle (dispatched at the Wiring cell) with a hard **120 s timeout** from when wiring finishes; on timeout, proceed and record `{code: "IMAGE_PHASE_2_TIMEOUT"}` in `run.json`. (Entity images attach server-side, so they don't block the SPA *build* — the gate is mainly so `run.json` doesn't record `image-phase-2-entity` as `in_progress`.) Confirm the seed-gate `write-decorative-json.mjs` overwrite already ran (decorative URLs are in `src/decorative-images.json`) **before** building.
- **On `imagery === "themed-blocks"`:** no wait — `src/decorative-images.json` is the bootstrap `{}` placeholder; proceed to build.

```bash
BUILD_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npm run build 2>&1                 # the PROJECT's build (Vite/…), confirmed from package.json scripts — NEVER `wix build`
# ensure wix.config.json.site.outputDirectory points at the build output (e.g. ./dist)
BUILD_ENDED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npx @wix/cli@latest release 2>&1   # parse `Site published on <url>`
```

Record both `{ phase: "build", seconds }` (the project build) **and** `{ phase: "release", seconds }`. A `npm run build` failure is a **code bug** — fix it, do not retry (only the `release` step retries on transient errors).

Either way: extract the published URL from `Site published on <url>`. Transient release errors (`ECONNRESET`, `STATE_MISMATCH`, `temporarily unavailable`, …) — retry serially up to 3× with `attempt * 5`s backoff (`references/shared/PRODUCTION_SHARP_EDGES.md`). Then the **Final Message** (`BUILD.md` § "Final Message" — the shared summary + run.json turn).

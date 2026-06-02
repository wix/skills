# Build — own-build framework class (`frontendBuild ∈ {none, own}`)

The post-approval conductor for the **non-astro** framework classes. Opened from `BUILD.md` the moment the run routes on `frontendBuild === "none"` (static HTML — the live tenant today) or `frontendBuild === "own"` (own-build SPA — **reserved**, filled by the framework-SPA plan). This file owns the **framework spine** (install, build) for those classes; the **(operation × framework) bootstrap/wiring cells** and the **shared release tail** are owned by `BUILD.md` and detailed for this file's cells below.

The cross-cutting operational sections both framework conductors share — **Subagent rate / credit limits**, the **parallel-batch diagnostic**, the **Final Message** (summary + run.json), the **Final run.json format**, and the **Shared release tail** — live in `BUILD.md`. The pre-approval flow is `PLAN.md` → `PLAN-create.md`/`PLAN-connect.md`; the three cross-cutting rules referenced below — **Two tracks**, **Batching discipline**, **User-facing output** — live in `PLAN.md`. Set the model tier on every dispatch (`SKILL.md` § "Subagent model tier").

> **This file is framework-routed; the *operation* (create/connect/extend) reaches it only through the two cells.** The install/build spine below is operation-blind — it reads only `frontendBuild`. The Bootstrap cell and Wiring cell sections are the operation-specific halves (they read the contract's operation section). Today the only live (operation × framework) pairing on this file is **connect × none** (a brought-in HTML site); the `own` framework rows and the `create`/`extend` operation columns are reserved.

## Framework spine — `none` (static HTML)

Operation-blind. The brought design ships as-is; there is **no build**, and `@wix/sdk` loads from a CDN at runtime, so the usual install steps are skipped:

- **Install** — apply `SETUP.md` Step 4a (app installs per inferred capability, with `x-wix-request-id` capture) **only**. **Skip** `env pull` (Step 4b — CDN `@wix/sdk` inlines the `appId` from `wix.config.json`, needs no `WIX_CLIENT_ID`, and the `init`-bootstrapped project has no `env` command), **skip** the Step 4c per-pack `npm install` (CDN imports), and **skip** `scaffold.sh` / `seed-utilities.sh`.
- **Build** — **none.** The HTML is the deployable. Proceed straight to the shared release tail.

## Framework spine — `own` (own-build SPA) — RESERVED

> **Reserved for the framework-SPA plan.** When `frontendBuild === "own"`: install bundles `@wix/sdk` into the app's dependencies (`npm install`), and Build runs `npm run build` before the shared release tail (which then points `outputDirectory` at the build output). The bootstrap is "create the framework app (vite/vue/svelte) → `init`"; wiring is "write/rewrite the source data-layer." No per-framework instruction files — one agnostic playbook. **Do not implement here** — this stub marks the slot the SPA plan fills.

## The run from approval — `none` tenant (connect × none)

The user just approved; `init-site-json.mjs --frontend custom` wrote `.wix/site.json`. **Nothing is dispatched yet.** The frontend-track playbook is `<SKILL_ROOT>/references/custom/INSTRUCTIONS.md` (the conductor follows its § "The flow"; the subagents open the per-capability guides). The run:

1. **Bootstrap cell (connect × none)** — see § "Bootstrap cell" below.
2. **Setup (business track) — app installs only.** Apply the framework-spine install rule above (`SETUP.md` Step 4a; skip 4b/4c).
3. **Seed (business track) — DISPATCH seeders as subagents, do NOT inline.** This is the **same per-pack seeder-dispatch model as astro** (`SEED.md` + `BUILD-astro.md` § "Wave 3"): fire **one seeder subagent per capability** that has a seed recipe, as a single concurrent background batch; capture a handle per seeder. Backend creation the augmentation needs — the **Wix Form definition** (forms), a **CMS collection + items** (cms), products/posts (stores/blog) — is each a seeder subagent. **Never run seeding inline in the orchestrator:** the number of seeders is unpredictable (it scales with the brought-in site's content), and inlining serializes the work and bloats the orchestrator's context — exactly the failure the per-pack dispatch exists to prevent. Collect each seeder's returned IDs / form IDs at the gate.
4. **Wiring cell (connect × none)** — see § "Wiring cell" below.
5. **Release** — the **shared release tail** (`BUILD.md` § "Shared release tail"): `none` has no build, so run `npx @wix/cli@latest release` directly. See § "Release" below for the run.json shape.

## Bootstrap cell

> **(operation × framework) = connect × none.** Owned conceptually by `BUILD.md` § "The two (operation × framework) cells"; the content lives here because connect-none is its only live tenant (read-isolation — only the own-build conductor loads it).

**Connection plan (background) + init (foreground), as the entry batch:**
- **Connection plan** — dispatch one subagent with Instruction file `<SKILL_ROOT>/references/custom/CONNECTION_PLAN.md`; inline the site's file list + inferred capabilities (from the contract's operation section / Discovery scratch). Capture `connplan_handle`. It returns the binding map + augmentation spec (JSON).
- **Init** — `npm create @wix/new@latest init` in the project dir (foreground; non-interactive when logged in). Then **fix `wix.config.json.site.outputDirectory`** to the dir holding the entry HTML (init defaults it to `./dist`), and patch `siteId`/`appId` into `.wix/site.json` (`SETUP.md` Step 1–2 shape). Init registers the OAuth app's `allowedDomains` for the published origin — **no separate OAuth call needed.**

## Wiring cell

> **(operation × framework) = connect × none.** Owned conceptually by `BUILD.md` § "The two (operation × framework) cells"; the content lives here because connect-none is its only live tenant.

**Wiring gate → wire (parallelism is a RUNTIME decision keyed on file topology).** Wait `connplan_handle` + all seeder handles. Each capability's `<SKILL_ROOT>/references/custom/<capability>/WIRING.md` is the how-to; *how many writers* run is decided from the connection plan's `injectAt.file` / region `file` set:
- **Capabilities share a file (the common single-page case — e.g. one `index.html` with both a form and a feedback list):** wire them with a **single writer** — either inline, or one subagent handling *all* capabilities for that file. **Never dispatch parallel agents at the same file** — they clobber each other's edits and duplicate the SDK bootstrap. This mirrors the astro shared-shell-patcher discipline (serialize writers to a shared file).
- **Capabilities map to distinct files:** dispatch one wiring subagent per file (concurrent batch) — no conflict.

Inline each agent with its binding-map/augmentation-spec slice + seeded IDs + the site's CSS token names; each injects client-side `@wix/sdk` `<script type="module">` (additive; styled from the design's tokens). The orchestrator decides writer count from the plan; the WIRING guides don't dictate it.

> **Manifest check.** After wiring (before release), run `node <SKILL_ROOT>/scripts/check-manifest.mjs <project-dir> integration <connection-plan.json>` to verify every binding-map region was wired — an SDK `<script>` present, the augmentation injected, and the always-connect invariant satisfied (exit 1 if zero connections). `BUILD-astro.md` § "Build failure modes" applies the same fail-loud discipline.

> **Always connect.** This framework class must end with the site reading from or writing to Wix; `init`+`release` of a static page with no connection is not acceptable (`references/custom/INSTRUCTIONS.md` § "Two locked principles"). The per-capability `custom/<cap>/WIRING.md` guides own the wiring step.

## Release

Apply the **shared release tail** (`BUILD.md` § "Shared release tail"). For `none`, step 1 (build) is skipped — run release directly from the project dir, timestamp-wrapped for `run.json.phases`:

```bash
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npx @wix/cli@latest release 2>&1   # parse `Site published on <url>`; NO `wix build` first
```

Extract the published URL from the `Site published on <url>` line. Record `{ phase: "release", seconds }` (no `{ phase: "build" }` or `{ phase: "compose" }` entry for `none`). Transient release errors (`ECONNRESET`, `STATE_MISMATCH`, `temporarily unavailable`, …) — retry serially up to 3× with `attempt * 5`s backoff (`references/shared/PRODUCTION_SHARP_EDGES.md`). Then the **Final Message** (`BUILD.md` § "Final Message" — the shared summary + run.json turn), identical to astro except the `phases` array records `release` with no `build`/`compose` entry.

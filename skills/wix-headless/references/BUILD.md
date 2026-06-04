# Build — the post-approval conductor (router)

Opened the moment the user approves the plan (the approval gate lives in the operation discovery file — `DISCOVERY-create.md` / `DISCOVERY-connect.md`). This file is the **router, and it routes on FRAMEWORK-BUILD-CLASS** (`frontendBuild`), not on operation. It branches to the matching framework conductor, owns the two **(operation × framework) cell lookups** (bootstrap, wiring), owns the **shared release tail**, and owns the cross-cutting sections both framework conductors share (rate limits, the parallel diagnostic, the Final Message, the run.json format).

The **pre-approval** flow (operation routing, the Discovery questions, the plan + approval gate, the background scaffold + Designer dispatches that hide latency) is in `PLAN.md`; it hands off here on approval. The **Plan→Build contract** (`PLAN.md` § "The Plan→Build contract") — `operation`, `frontend`, `frontendBuild`, `verticals[]`, `designSource`, `brand` + the operation section — is held in orchestrator scratch and threaded into dispatch prompts. Build reads its install/build/release spine **purely off `frontendBuild`** (the core) and reads the operation-specific payload **only** at the bootstrap/wiring cells. Three cross-cutting rules referenced below — **Two tracks**, **Batching discipline**, and **User-facing output** — also live in `PLAN.md`.

## The run from approval — route on `frontendBuild` (framework)

The user just approved; `init-site-json.mjs` wrote the slim `.wix/site.json` (only `frontend` persisted). **Nothing is dispatched yet** — the funnel intentionally dispatched nothing so it could present the plan fast. Read `frontendBuild` from orchestrator scratch (resolved in Wave 0 / `DISCOVERY-connect.md` § 1.5). **On scratch loss**, recover it from durable disk: `frontend: astro` ⇒ `wix`; `frontend: custom` ⇒ read `package.json` — a `scripts.build` + a client bundler/framework dep ⇒ `own`, otherwise `none` (the same signal Discovery used). Then open the matching framework conductor — **read only that one**:

| `frontendBuild` | Framework class | Conductor |
|---|---|---|
| `wix` | astro-native (`wix build`) | **`BUILD-astro.md`** — Phase axis → run-steps 0–5 → Wave 3 → Step 4.5 → Step 7 → Build & Release |
| `none` | static HTML (no build) | **`BUILD-own-build.md`** (none tenant) — install-skip → Seed → wiring → inline no-build release |
| `own` | own-build (`npm run build`) | **`BUILD-own-build.md`** (own tenant) — bundle `@wix/sdk` install → Seed → source-edit wiring → project's own build → release |

Everything framework-specific (install, build command) lives in that conductor file. The **(operation × framework) cells** (bootstrap, wiring) and the **shared release tail** are below this line — both conductors point back here for them.

> **Build routes on framework, not operation.** `operation` (`create`/`connect`) already routed Discovery + Plan; it does **not** re-route Build. Build's only contact with operation is the two cells below (bootstrap, wiring), which read the operation section of the contract. The install/build/release spine is operation-blind.

> **Set the model tier on every dispatch.** Both framework classes dispatch subagents. Tier policy lives in `SKILL.md` § "Subagent model tier" — apply it by table lookup (the Phase axis table in `BUILD-astro.md`; the seeder/wiring rows in `BUILD-own-build.md`). The tier is selected via the dispatch primitive's model parameter, not the prompt; if you omit it, Default-tier roles silently run under-powered on the orchestrator's default model.

---

## The two (operation × framework) cells — bootstrap & wiring

Almost everything in Build is a 1-D framework switch (install/build/release, below). **Two** sub-steps genuinely need both axes — **bootstrap** (how the project comes into being) and **wiring** (how live Wix data reaches the frontend). Each is a small lookup over (operation × framework). The cell *content* lives co-located with the conductor that runs it (read-isolation per `SKILL.md`); this section is the **seam map** — which cell resolves to where. Adding a framework (SPA) adds a row; adding an operation (extend) adds a column. No new phase files.

**Bootstrap cell** — how the working project is created before Setup:

| | `create` | `connect` | `extend` *(later)* |
|---|---|---|---|
| **astro** (`wix`) | `scaffold.sh <folder-name> "<brand>" --frontend astro` → `npm create @wix/new@latest headless` — `BUILD-astro.md` run-step 0 | — | add `.astro` + nav/home markers *(extend plan)* |
| **own-build** (`own`) | scaffold framework (`npm create vite`/…) → `init` — `BUILD-own-build.md` § "Bootstrap cell → create × own" | connection plan + `init` over brought source — `BUILD-own-build.md` § "Bootstrap cell → connect × own" | add to source *(extend plan)* |
| **none / html** (`none`) | — | `npm create @wix/new@latest init` over the brought HTML + fix `wix.config.json.site.outputDirectory` — `BUILD-own-build.md` § "Bootstrap cell → connect × none" | — |

**Wiring cell** — how the frontend reads/writes Wix entities:

| | `create` | `connect` | `extend` *(later)* |
|---|---|---|---|
| **astro** (`wix`) | write `.astro` pages with live SDK queries — `BUILD-astro.md` Phase 3 Components + Phase 4 Pages | — | add `.astro` + markers *(extend plan)* |
| **own-build** (`own`) | write fresh data module (`@wix/data`) — `BUILD-own-build.md` § "Wiring cell → create × own" | rewrite source data-layer → `@wix/data` — `BUILD-own-build.md` § "Wiring cell → connect × own" | add to source *(extend plan)* |
| **none / html** (`none`) | — | inject client-side `@wix/sdk` `<script type="module">` (additive, styled from the design's tokens) — `BUILD-own-build.md` § "Wiring cell → connect × none" | inject `<script>` *(extend plan)* |

Reserved cells are single placeholders with a downstream-plan pointer — no empty files, no unexercised branches (the refactor's "crux" rule). Live cells: **astro-create** (in `BUILD-astro.md`); **connect-none**, **connect-own**, and **create-own** (in `BUILD-own-build.md`). Only the `extend` column remains reserved.

## Shared release tail (framework-blind)

Release is one step both framework classes share — it reads a single field (`outputDirectory`) and publishes:

1. **Build, if the framework has one** — `wix` runs `npx @wix/cli@latest build` (`BUILD-astro.md` § "Build & Release"); `own` runs the **project's own** `npm run build` then points `outputDirectory` at the build output (`BUILD-own-build.md` § "Release"); `none` has **no build** (the HTML is the deployable). **Never `wix build` for `own`** — that is astro-only.
2. **Release** — `npx @wix/cli@latest release`; extract the published URL from the `Site published on <url>` line. This also populates the **Frontend link** in headless settings natively. Transient release errors (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `STATE_MISMATCH`, `temporarily unavailable`, `try again shortly`) — retry serially up to 3× with `attempt * 5`s backoff (`references/shared/PRODUCTION_SHARP_EDGES.md`). Do **not** retry build failures — those are code bugs to fix.

`wix release` is framework-tolerant: for non-astro frontends it deploys whatever `wix.config.json.site.outputDirectory` points at. The only framework difference is step 1 (whether/how to build); release itself is identical.

---

## Subagent rate / credit limits

Some runtimes apply per-session rate or credit limits to subagents. When a subagent return looks truncated, treat it as a rate-limit hit and recover.

### Detection

A subagent has hit a rate / credit limit when its return contains any of:
- Literal text `"You've hit your limit"`, `"quota exceeded"`, `"rate limit"`
- Total return under ~100 tokens with no fenced JSON block
- Return ending mid-sentence without a completion indicator

### Recovery procedure

1. **Check the subagent's declared output files on disk.** Each scope's reference lists the files it owns (e.g., the Phase 4 store-pages scope owns `products/index.astro`, `products/[slug].astro`, `cart.astro`, `thank-you.astro`, `ProductCard.astro`). Read each expected path.
2. **If all expected files exist on disk and look syntactically valid** (no empty files, no unterminated strings): synthesize a `status: "complete"` entry for `run.json` with `notes: "Sub-agent hit rate limit after writing all files; files on disk are valid."` Proceed with the next dispatch.
3. **If expected files are missing or empty:** retry the subagent once with an identical prompt. If the retry also hits the limit, mark the phase `status: "partial"` in `run.json` with `errors: [{code: "RATE_LIMIT", message: "Subagent rate-limited; <N> of <M> files produced"}]` and decide per-case — the orchestrator may fall back to inline emission of the missing files if they're trivial (single-file scope), or fail the run.
4. **Do not loop.** Retrying the same subagent more than once after a rate limit wastes budget — the limit is session-scoped and persists.

Record the rate-limit event in `run.json` `notes[]` regardless of recovery outcome — it's important observability for tuning scope sizes.

---

## Diagnostic: did the concurrent batch actually run in parallel?

If a build feels slow, check whether dispatches that should have been concurrent actually overlapped in execution. Two failure modes:

1. **Serialized launch:** the orchestrator emitted subagent invocations one at a time across multiple turns instead of as a single batch. Symptom: multi-second gaps between subagent starts in the run log.
2. **Serialized execution:** the runtime dispatched the batch but executed it sequentially (rare; most runtimes parallelize properly).

The fix for (1) depends on the runtime — check whether your dispatch primitive supports a single concurrent batch and whether anything between the subagent invocations (status updates, narration, file writes) is splitting the batch into multiple turns. Even when (1) cannot be fixed, **background dispatch alone gives ~2× compression** by overlapping execution. Make every subagent that doesn't block downstream work a background subagent.

---

## Final Message — summary FIRST, then run.json, in ONE turn

**Ordering is strict and user-perceived latency depends on it.** The summary prose is the **first content of your final turn**; the `Write .wix/run.json` is the **last tool call in that same message**. Composing `run.json` takes ~15–25 s (it aggregates every subagent return), so writing it *before* the summary makes the user wait that whole time to see their live URL — for no reason, since `run.json` is a silent observability artifact they never read.

Hard rules:
- **Do NOT write `run.json` before the summary.** A run that emits the `run.json` `Write` first (or in an earlier turn) is wrong even if the content is identical — it just delays the URL.
- **Do NOT emit a pre-narration turn** ("Site is live, writing run.json…", "delivering the summary…"). That is orchestration machinery (`PLAN.md` § "User-facing output") and it splits the single turn. The summary prose itself is the first thing the user sees after release.
- **One turn:** summary prose → then the `Write` tool call, as siblings in the same assistant message. The turn does not close until the `Write` completes, so the record still lands on disk before control returns — you get on-disk durability without making the user wait for it.

The summary prose contains, in order:

1. **Production URL** — bold link, first line (the exact `Site published on <url>` string; do not retype it).
2. **Dashboard link** — `https://manage.wix.com/dashboard/<siteId>`.

**Do not present timings.** No total-wall figure, no per-phase breakdown ("scaffold 26s · design-system 13s · …"), no "built in ~N min." Phase timings are machinery and the self-reported number is easy to get wrong (it has under-reported true wall in past runs); they belong in `run.json`, not the user-facing summary. The user wants their site, not a stopwatch.

Then, in the same turn after the summary prose, write `.wix/run.json` silently — the observability record aggregating every subagent return (format per § "Final run.json format" below), including the phase timings. Use the subagent returns already in session context — do not re-read anything to compose it.

---

## Final run.json format

The orchestrator is the **sole writer** of `.wix/run.json` and the one audience that needs every phase's `data` shape (the per-phase shapes are indexed in `references/shared/RETURN_CONTRACT.md` § "Where your phase-specific data shape lives"). It aggregates every agent return into one file.

**Timing is required** — the `run` object MUST include `started`, `ended`, and `totalSeconds`, and every entry in `phases` MUST include `seconds`. All timing values are captured by the orchestrator (from runtime `duration_ms` for subagents, from `date -u` wraps for its own Bash calls) — agents do not self-report. If timing is missing for any phase, record `seconds: null` + `errors: [{code: "MISSING_TIMING"}]` and investigate what broke capture.

For the orchestrator's own Bash calls (scaffold, env-pull, npm-install, app-install), wrap in `date -u` captures:

```bash
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# ... run the command ...
ENDED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# compute seconds and append to run.json
```

Example:

```json
{
  "version": "1.0",
  "run": {
    "started": "2026-01-15T09:16:14Z",
    "ended": "2026-01-15T09:28:03Z",
    "totalSeconds": 709,
    "brand": "Acme Coffee",
    "prompt": "I want to sell tables online",
    "verticals": ["stores", "cms"],
    "packs": ["stores", "cms"]
  },
  "outcome": {
    "build": "success",
    "previewUrl": "https://goj5lj-tabula-...-alexp775.wix-host.com",
    "dashboardUrl": "https://manage.wix.com/dashboard/<siteId>"
  },
  "phases": [
    { "phase": "scaffold", "status": "complete", "seconds": 45 },
    { "phase": "app-install-stores", "status": "complete", "seconds": 6 },
    { "phase": "env-pull", "status": "complete", "seconds": 4 },
    { "phase": "npm-install", "status": "complete", "seconds": 42, "packageCount": 725 },
    { "phase": "stores-seed", "status": "complete", "seconds": 112, "data": { ... } },
    { "phase": "cms-seed", "status": "complete", "seconds": 98, "data": { ... } },
    { "phase": "stores-components", "status": "complete", "seconds": 134, "data": { ... } },
    { "phase": "design-system", "status": "complete", "seconds": 13, "data": { ... } },
    { "phase": "compose", "status": "complete", "seconds": 0, "data": { "filesWritten": [ ... 6 ... ], "componentCssImports": [ ... ], "homeMarkers": [ ... ], "tokensApplied": { ... } } },
    { "phase": "designer-home", "status": "complete", "seconds": 287, "data": { ... } },
    { "phase": "designer-static", "status": "complete", "seconds": 265, "data": { ... } },
    { "phase": "designer-store-pages", "status": "complete", "seconds": 298, "data": { ... } },
    { "phase": "stores-pages-products", "status": "complete", "seconds": 89, "data": { ... } },
    { "phase": "stores-pages-cart-checkout", "status": "complete", "seconds": 67, "data": { ... } },
    { "phase": "stores-pages-home-and-nav", "status": "complete", "seconds": 54, "data": { ... } },
    { "phase": "pages", "status": "complete", "seconds": 78, "data": { ... } },
    { "phase": "image-phase-1-decorative", "status": "complete", "seconds": 112, "data": { "decorativeCount": 3, ... } },
    { "phase": "image-phase-2-entity", "status": "complete", "seconds": 287, "data": { "entityCount": { "products": 6, "cmsAboutContent": 1 }, ... } },
    { "phase": "build", "status": "complete", "seconds": 9 },
    { "phase": "preview", "status": "complete", "seconds": 21 }
  ],
  "notes": []
}
```

Notes:
- Total serial wall time ≈ max parallel paths, not sum of seconds
- `data` blocks preserve what each agent returned — recoverable without re-reading agent transcripts
- `files` lists are omitted from the aggregate; query individual phase `data` if needed
- **No-build frameworks (`frontendBuild === "none"`, today the connect/custom path)** record a `release` phase with **no** `build` or `compose` entry — the HTML is the deployable, there is no astro build step.

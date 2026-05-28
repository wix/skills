# Build — the post-approval conductor

Opened the moment the user approves the plan in `DISCOVERY.md`. This file owns the **execution flow** — Setup → design-system bridge → Seed → Components → Pages → Build → Release: every subagent dispatch, background handle, wait/gate, and the imagery gates. Read it top to bottom from the approval point.

The **pre-approval** flow (mode routing, the Discovery questions, the plan + approval gate, and the background scaffold + Designer dispatches that hide latency) is in `PLAN.md`; it hands off here on approval. Three cross-cutting rules referenced below — **Two tracks**, **Batching discipline**, and **User-facing output** — also live in `PLAN.md`.

## Phase axis

Each phase belongs to one of the two tracks (`PLAN.md` § "Two tracks"). All phases are background (`bg`); this table is the *what* and *which track*, the sections below are the *when*.

| Phase | Track | Tier | What | When (bg) |
|---|---|---|---|---|
| **Phase 1 — Seed** | business | Fast | Per-pack seeders → orchestrator collects `seeded` map in scratch | Seed wave |
| **Phase 2 — Design System** | frontend | Default | **Designer** returns tokens + brand-voice JSON (no files); **Composer** writes the 6 files (`global.css`, `astro.config.mjs`, `Layout`, `Nav`, `Footer`, `index`) by substituting into pinned skeletons | Designer: BUILD entry (run-step 0) · Composer: Setup-window bridge |
| **Image Phase 1 — Decorative** | frontend | Fast | Hero/about/page-header decoratives | Seed wave (imagery-gated) |
| **Phase 3 — Components** | frontend | Default | Per-vertical React islands, styling contract inlined per prompt | Step 4.5 |
| **Phase 4 — Pages** | frontend | Default | Per-vertical routes; each agent writes its routes once with both visual design and live data queries | Step 7 |
| **Image Phase 2 — Entity** | business | Fast | Product / blog / CMS item images PATCHed onto Wix entities | Step 4.5 (imagery-gated) |

> **Set the model tier on every dispatch.** The `Tier` column is binding (full policy: `SKILL.md` § "Subagent model tier" — Fast = recipe-following work returning JSON of IDs/URLs; Default = anything that authors files the build consumes or exercises creative judgment). The tier is selected via the **dispatch primitive's model parameter**, not the prompt — if you omit it, every subagent inherits the orchestrator's default model and the Default-tier roles (Designer, Composer, Components, Pages) silently run under-powered. Apply by table lookup, not per-dispatch deliberation: seeders + both image phases → Fast; Designer, Composer, Phase 3 Components, Phase 4 Pages → Default.

## The run from approval (Setup → Release)

The user just approved; `init-site-json.mjs` wrote the slim `.wix/site.json`. **Nothing is dispatched yet** — the funnel intentionally dispatched nothing so it could present the plan fast. Start by firing the two background jobs the rest of the run needs, then run Setup.

### 0. Dispatch scaffold + Designer (background, immediately on entry)

Fire both as one concurrent batch (`PLAN.md` § "Batching discipline") — they are independent:
- **Scaffold** — `scaffold.sh <slug> "<brand>" --frontend <value>` (background, capture `scaffold_handle` + its stderr tempfile). Slug derivation + the command shape are `DISCOVERY.md` § "After Q1". `npm install` is **not** chained here (Setup Step 4c dispatches it).
- **Designer** — background, capture `designer_handle`, per the prompt template in `DESIGN_SYSTEM.md`, inlining Discovery's aesthetic craft (brand, aesthetic direction, palette, type, mood, page color strategy) held in scratch. Judgment-only (~10–15 s; JSON `data.designTokens` + `data.shell`, no files). Do **not** pass application inputs (packs, nav links) — those go to the Composer.

The Designer's ~13 s overlaps the scaffold's ~23 s. Setup waits on `scaffold_handle` at Step 1; the bridge (step 2) waits on `designer_handle`.

### 1. Setup Step 1 (foreground)

Apply `SETUP.md` Step 1 only: wait `scaffold_handle` (load `wix-manage` in the same batch), then patch `site.json` with `siteId`/`appId`. **Do not run Setup Step 4 (the app-install batch) yet** — it goes in run-step 2 below, alongside the bridge.

### 2. Setup Step 4 batch **+** design-system bridge — ONE concurrent super-batch

**Timing pin: these two are independent and MUST run concurrently. Do not serialize them.** Past runs that fired the Step-4 batch first, *then* the bridge after, cost ~60–90 s of Composer wall that should have been absorbed (the Composer ended up the Wave-1 longest pole, ending after both seeders). The bridge's only gates are `designer_handle` returning and the scaffold being verified — both true the instant Step 1 completes. App installs / `env pull` / `npm install` are business-track work the bridge has zero dependency on.

Fire as one concurrent batch (`PLAN.md` § "Batching discipline"):

**(a) Setup Step 4 — business track.** Apply `SETUP.md` Step 4: app installs (one curl per `pack.apps[*]`) + `env pull` + background `npm install` (capture `npm_handle` + its stderr tempfile). Frontend-blind; `SETUP.md` owns the recipes/package set.

**(b) Design-system bridge — frontend track.** Composer dispatch, gated only on `designer_handle` + scaffold-verified:
- **Wait `designer_handle`** (near-instant; it has been running since run-step 0, ~10–15 s).
- **Emit tokens:** pipe `data.designTokens` into `emit-design-tokens.mjs` (writes `.wix/design-tokens.css` + `.wix/site.d.ts`). Hold `designTokens` + `shell` in scratch.
- **Dispatch the Composer** (background, capture `composer_handle`) per the prompt template in `COMPOSE.md`, inlining tokens + shell + brand + nav links + packs.

> **Why concurrent, not sequential.** The Composer's only inputs are the Designer's tokens (ready from run-step 0) and the verified scaffold (ready at Setup Step 1) — neither depends on the seeders, app installs, env, or npm. Firing the bridge alongside the Step 4 batch lets its ~80–160 s authoring wall absorb into Setup + the whole seed window. **Firing it after the Step 4 batch — or worse, in the seed wave — makes it start late and land as a fresh longest pole that ends *after* the seeders.** The Composer self-retries its pre-write scaffold reads if the scaffold is somehow still in flight (`COMPOSE.md` § "Pre-write"). On `react-vite`/`user-provided` the Composer is skipped (record `{phase: "compose", status: "skipped"}`).

### 3. Seed wave (Wave 3) — business track + co-scheduled frontend prep

**One concurrent batch** (§ "Wave 3" below for the detailed dispatch): `seed-utilities.sh --template <…>` (frontend project prep) + per-pack seeders (background) + Image Phase 1 Decorative (background, gated — § "Imagery gates"). Apply `SEED.md` for the recipe map + seeder prompt template. **No design-system dispatch here** — `composer_handle` is already running from the bridge in step 2.

### 4. Seed gate

Wait on the seeders + `composer_handle` + `npm_handle`; once `composer_handle` returns, run the post-Composer Layout-import verify; aggregate seeder returns into the `seeded` scratch map; optionally run `patch-decorative-slots.mjs`. Because the Composer started back in Setup, by the time the seeders return its wall is typically already complete — so the design-system phase no longer extends the seed window.

### 5. Continue

**Step 4.5** (Phase 3 Components + Image Phase 2) → **Step 7** (Phase 4 Pages) → **Build & Release** → **Final message** — all detailed below.

## Imagery gates

The `imagery` value (`"ai-generated"` | `"themed-blocks"`, captured in `DISCOVERY.md` Q2.5, default `"themed-blocks"`) gates **both** image phases. The conductor owns the gate; the step files describe what each image scope does when it runs.

- **Image Phase 1 — Decorative** (Wave-3 batch). Dispatch the `image-phase-1-decorative` subagent (`<SKILL_ROOT>/references/images/INSTRUCTIONS.md`) **only when `imagery === "ai-generated"`**. When `"themed-blocks"` (default): do **not** dispatch — decorative slots render as solid color blocks via the designer placeholder pattern; record `{phase: "image-phase-1-decorative", status: "skipped", notes: "themed-blocks mode"}` and **skip the post-seed `patch-decorative-slots.mjs`** too (`{phase: "decorative-slot-patch", status: "skipped"}`). Dispatching it regardless wastes ~140–175 s + 0.3–0.5 Wix AI credits.
- **Image Phase 2 — Entity** (Step 4.5 batch). Same gate — dispatch only on `ai-generated`; on `themed-blocks` skip and record `{phase: "image-phase-2-entity", status: "skipped"}`. Detailed dispatch + the hard build gate are in § "Step 4.5" and § "Wait: Phase 4 → Build" below.

---

## Wave 3 — Seed + frontend prep + Image Phase 1

The seed-wave dispatch list (the run's step 3). No design-system dispatch here — `composer_handle` is already running from the Setup-window bridge. Launch as **one concurrent batch** (`PLAN.md` § "Batching discipline"):

- `seed-utilities.sh --template <astro|react-vite>` — frontend-track project prep (idempotent), run from the project dir. Apply `SEED.md` § "Pre-batch".
- Per-pack seed subagents (background) — apply `SEED.md` for the recipe map + seeder prompt template.
- Image Phase 1 Decorative (background) — `<SKILL_ROOT>/references/images/INSTRUCTIONS.md`, scope `image-phase-1-decorative` — **only when `imagery === "ai-generated"`** (§ "Imagery gates").

The **seed gate** that follows (wait on seeders + `composer_handle` + `npm_handle`, Layout-import verify, aggregate `seeded`, optional decorative patch) is run-step 4 above — then continue to **Step 4.5** below.

### Subagent prompt template

Every dispatch sends a self-contained prompt with these fields. Every input the subagent needs is inlined — subagents do NOT read `.wix/site.json` during the run.

```
Instruction file (absolute path): <SKILL_ROOT>/references/<vertical>/INSTRUCTIONS.md
  Read this file in full before doing anything else. It defines your role,
  scope routing, and return contract.
Phase instruction: <exact phase/scope string from the pack>
Scope: <scope string>
Project directory (absolute path): <project path>
siteId: <from orchestrator scratch — captured by SETUP.md Step 1>
Auth: <SKILL_ROOT>/references/shared/AUTHENTICATION.md — mint TOKEN once via npx @wix/cli token --site "$SITE_ID"; every curl uses Bearer + wix-site-id headers
Brand context: name, vibe, aesthetic direction, colors, fonts, mood, page color strategy
Design tokens (Phase 3 Components / Phase 4 Pages): the full styling-contract JSON inlined here — same shape the orchestrator passed to emit-design-tokens.mjs; .wix/design-tokens.css + .wix/site.d.ts are on disk for the build to consume
Seeded entities (Phase 3 Components / Phase 4 Pages / Image Phase 2): the relevant pack-specific slice from the orchestrator's seeded scratch, inlined here as JSON
```

**`Instruction file` must point to one of these vertical instruction files:**
- `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/ecom/INSTRUCTIONS.md` — Phase 3 Components (cart/checkout — passive, required by stores)
- `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md` — Phase 4 CMS Pages
- `<SKILL_ROOT>/references/blog/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/forms/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/gift-cards/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages (passive/dashboard-gated)
- `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` — `image-phase-1-decorative` + `image-phase-2-entity`
- `<SKILL_ROOT>/references/DESIGN_SYSTEM.md` — Phase 2 Designer (design spec, JSON only); `<SKILL_ROOT>/references/COMPOSE.md` — Phase 2 Composer (writes the 6 design-system files)
- `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md` — all Phase 4 Page designers (`home`, `static`, `store-pages`, `blog-pages`, `contact-page`)

For **image subagents**, the prompt additionally includes: page list (for decorative brief), entity types to cover (products, about-content, etc.).

Phase 3 Components subagents (Step 4.5) additionally receive the full styling-contract JSON inlined in their prompt — they do not read `.wix/design-tokens.css` + `.wix/site.d.ts` from disk. See § "Styling contract coordination" below.

### Subagent return

Every subagent returns a structured JSON block at the end of its run, per `references/shared/RETURN_CONTRACT.md`. The orchestrator parses each return as it arrives.

---

## Step 4.5 — Phase 3 Components + Image Phase 2 Entity (one concurrent batch, all background)

**Gate (from the seed gate, run-step 4):** the `seeded` map is populated and the Composer has returned. Verify `.wix/design-tokens.css` + `.wix/site.d.ts` exist on disk and the Composer wrote `src/layouts/Layout.astro` + `src/styles/global.css` — the `cp` pre-batch and Layout imports below depend on them. If `patch-decorative-slots.mjs` was deferred at the seed gate, run it now.

Read `.wix/design-tokens.css` + `.wix/site.d.ts` once.

**Pre-batch (same message, before subagent dispatches):** copy the per-pack component-CSS templates into the project. This is a deterministic `cp` — the templates are static and use direct `var(--token)` references against the standard designer vocabulary, so no subagent is needed to author them. The Phase 3 Components subagents below write only `.tsx` React islands; this step writes the matching `src/styles/components-<pack>.css`. **If you skip this `cp` step, `astro build` fails at Step 8 with `Could not resolve "../styles/components-<pack>.css"` from `src/layouts/Layout.astro`** — the Composer's Layout imports those files unconditionally for every pack that declares `components`. If the Phase 3 subagents write only `.tsx`, the build falls back to slow orchestrator recovery (`cp` + manual rewrite to strip `@apply`).

For each loaded pack whose vertical INSTRUCTIONS declares a `components` scope (today: `stores`, `ecom`, `blog`, `forms`, `gift-cards`), copy the template:

```bash
for pack in <loaded packs with components>; do
  cp "<SKILL_ROOT>/templates/$pack/components-$pack.css" \
     "src/styles/components-$pack.css"
done
```

Record `{ phase: "copy-component-css", packs: [...], seconds }` in `run.json`. Idempotent — re-running overwrites identical content. Packs without a `components-<pack>.css` template (today: `cms` — SSR inline, no component CSS) are skipped silently.

**Also pre-copy the Phase-3 utility templates in the same `cp` batch.** Each vertical's INSTRUCTIONS declares utility files under "Pre-copied by the orchestrator (do NOT write these yourself)" that its `components` scope only *imports* — the conductor must put them on disk before dispatch so no subagent races to author them. Today that is the **stores** pack:

```bash
# only if the stores pack is loaded
cp "<SKILL_ROOT>/templates/stores/back-in-stock.ts" "src/utils/back-in-stock.ts"
```

If you skip this, the `components` subagent falls back to writing `src/utils/back-in-stock.ts` itself, and on multi-pack runs two scopes can race the same path (`File has not been read yet` / `modified since read`). Record `{ phase: "copy-utils", scope: "components", files: [...] }`.

Then dispatch in a single concurrent batch:

1. **One Phase 3 Components subagent per loaded pack** that declares `components`. Each prompt carries:
   - All standard fields (see "Subagent prompt template" above)
   - The **full styling-contract JSON inlined** — not a file path
   - A note: *"`src/styles/components-<pack>.css` is already on disk (copied from the skill template by the orchestrator). Do NOT write that file — write only `.tsx` islands and any `.astro` shells in your scope."*

2. **One Image Phase 2 Entity subagent** — imagery-gated (§ "Imagery gates"): not dispatched on `themed-blocks` (default). On `ai-generated`, when `seeded` scratch has entities, dispatch it — the prompt inlines the relevant `seeded.<pack>` slice (entity IDs + names + descriptions) + brand context (no disk reads). Instruction file: `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity".

The Phase 3 Components group is **background** regardless. Image Phase 2 (when dispatched) is also background — it starts immediately and continues running through Step 7 dispatch with no polling.

**Why Image Phase 2 lives here, not in Step 7.** Image Phase 2 only depends on entity IDs/names/descriptions + brand context (all inlined in its prompt). It does not read or write anything Phase 3 Components or Phase 4 Pages produce — its PATCH/PUT targets are Wix-side entities (`stores/v3/products`, `wix-data/v2/items`, `blog/v3/posts`). Launching it here lets it overlap entirely with Phase 3 (and often Phase 4 too) instead of becoming a post-Phase-4 tail blocker.

---

## Wait: Phase 3 → Step 7

Phase 3 Components must complete before Step 7 dispatches — Phase 4 Pages mount the islands Components wrote, so launching early causes missing-island build failures. (Image Phase 2, if dispatched, keeps running through Phase 4 and is gated only at Build.)

**Data carry-forward:** Phase 4 subagents receive the relevant `seeded.<vertical>` slice inlined from scratch — **Stores** → `seeded.stores` (`productIds`, slugs, categories), **CMS** → `seeded.cms` (`collectionIds`, `itemIds`). The orchestrator built the `seeded` map at the seed gate — do not re-dispatch seeders. Subagents do NOT read `.wix/site.json`.

---

## Step 7 Dispatch — Phase 4 (Pages)

### Pre-batch (same message, before subagent dispatches)

Pre-copy the Phase-4 utility templates each pack's INSTRUCTIONS declares under "Pre-copied by the orchestrator (do NOT write these yourself)" — the conductor puts them on disk so no `pages-*` scope authors them. Today that is the **stores** pack's category helper:

```bash
# only if the stores pack is loaded
cp "<SKILL_ROOT>/templates/stores/categories.ts" "src/utils/categories.ts"
```

`categories.ts` is a static, brand-agnostic SDK wrapper. **It must be pre-copied, not written by a subagent.** `pages-categories`, `pages-products`, and `pages-home-and-nav` all *import* it; if it isn't on disk, two of those concurrently-dispatched scopes each fall back to writing it and race the same path (`File has not been read yet`). Record `{ phase: "copy-utils", scope: "pages", files: ["src/utils/categories.ts"] }`.

### Concurrent batch

For each loaded pack's `pages`:
- One Phase 4 subagent per scope — **background**. Each writes its routes ONCE with both visual design and live data queries (the merged design+wire model). Earlier flows split this into a placeholder-writing dispatch followed by a page-rewrite dispatch; that double-write was eliminated.

> **Shared-shell patchers serialize; everyone else runs concurrent.** Most scopes write files in their own exclusive ownership — those all dispatch as one concurrent background batch. But a scope that **patches a shared shell file at a marker** — `src/components/Navigation.astro` (`<!-- nav:links -->`, CartBadge) or `src/pages/index.astro` (`<!-- home:<pack> -->`, featured grid) — read-modify-writes a file another scope also patches. Dispatching two such patchers concurrently trips the harness staleness guard (`File has been modified since read`) on whichever reads first. **Dispatch the shell-patching scopes one at a time — launch one, wait for its return, then launch the next** — so each sees the previous one's marker insertion. In the example below that is `home-and-nav` and `gift-cards pages` (both touch `Navigation.astro` + `index.astro`); the private-file scopes (`product-pages`, `category-pages`, `cart-checkout`, `cms-pages`) stay in the concurrent batch. The serialized chain runs alongside the concurrent batch, not after it.

> **Image Phase 2 is NOT dispatched here.** When it was launched at Step 4.5 (i.e. on an `ai-generated` run), it has been running concurrent with Phase 3 + Phase 4 and is typically finished or near-finished by the time Step 7 fires; the Step 8 hard gate waits for it before invoking `release.sh`. **On a `themed-blocks` run (the default), Image Phase 2 was not dispatched at all** — no gate wait, no images, the build runs as soon as Phase 4 finishes.

### Example (ecommerce run — stores pack contributes 4 Phase 4 scopes + cms pack 1)

Five subagents launched concurrently:

1. **product-pages** — `products/index.astro`, `products/[slug].astro`, `ProductCard.astro`
2. **category-pages** — `category/[slug].astro`, `CategoryRail.astro` (imports the pre-copied `utils/categories.ts`)
3. **cart-checkout** — `cart.astro`, `thank-you.astro`
4. **home-and-nav** — patch `index.astro` product grid + `Navigation.astro` (CartBadge mount + Shop submenu insert at `<!-- nav:links -->`)
5. **cms-pages** — wire About + FAQ to live `@wix/data` queries

Scopes 1, 2, 3, 5 own their files exclusively → one concurrent background batch. `home-and-nav` (scope 4) patches the shared `Navigation.astro` + `index.astro` shells; on a run that also loads gift-cards, the gift-cards `pages` scope patches the same two shells — so those two serialize against each other per the shared-shell rule above. `product-pages` and `home-and-nav` import `CategoryRail.astro` and the pre-copied `utils/categories.ts`, but those imports resolve at build time (Step 8), not write time, so they don't force ordering against `category-pages`.

### Phase 4 prompt additions

```
Scope: <scope name from pack.pages[*].name>
Files to own (absolute paths): <from pack.pages[*].files>
Phase 1 Seed data: <the relevant seeded.<vertical> slice inlined here as JSON, from the orchestrator's scratch>
Design tokens: the styling-contract JSON is inlined above; .wix/design-tokens.css + .wix/site.d.ts are also on disk (already imported by the build)
```

Each scope subagent writes its `.astro` files directly with live SDK queries, wires up analytics events, and mounts the React islands written by Phase 3 Components.

Scope subagents MUST NOT:
- Modify files outside their declared scope
- Modify CSS (`global.css` owned by the Composer; `components-<pack>.css` owned by Phase 3 Components)
- Modify React islands (owned by Phase 3 Components)

---

## Wait: Phase 4 → Build

> **HARD GATE: Do NOT run `npx @wix/cli build` until `image-phase-2-entity` has completed or timed out (120s) — ONLY when it was dispatched.** This gate applies only to runs where `intent.imagery === "ai-generated"` and Step 4.5 actually dispatched Image Phase 2. On the default `themed-blocks` run, Image Phase 2 was skipped at Step 4.5 and recorded as `{phase: "image-phase-2-entity", status: "skipped"}` in `run.json` — there is no handle to wait on; proceed to the build immediately when Phase 4 Pages return. **Skipping it on an ai-generated run has shipped previews with no product images and `run.json` recording `image-phase-2-entity` as `"in_progress"`, so do not collapse this gate.**

All Step 7 Phase 4 Pages subagents return. When Image Phase 2 was dispatched (ai-generated runs), it has been running through Phase 3 + Phase 4 in parallel — typically ~5–8 minutes by the time Phase 4 Pages finish, which is enough for it to be done or in its tail. When skipped (themed-blocks runs), no wait. All return JSON is in session context.

When Image Phase 2 was dispatched (ai-generated mode) and Phase 4 finishes before it, wait for it before proceeding. Without this wait, the preview shows empty image placeholders on products (images not yet PATCHed). With Image Phase 2 dispatched earlier (in Step 4.5), this wait is usually a no-op. On themed-blocks runs Image Phase 2 was never dispatched — skip this wait entirely.

> **Timeout safety:** if `image-phase-2-entity` has not completed within 120s after all Phase 4 subagents finish, proceed to Build and note `{code: "IMAGE_PHASE_2_TIMEOUT"}` in `run.json`. The timeout is a safety valve — under the Step-4.5-dispatch model it should rarely fire.

Also ensure the background `npm install` (`npm_handle` from `SETUP.md` Step 4c, waited on at the seed gate) completed successfully before Build. On non-zero exit, follow the recovery ladder in `SETUP.md` § "npm install recovery".

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

## Build & Release

1. `npx @wix/cli build` — if it fails, inspect `.wix/debug.log` for the specific error, fix, retry. Common failure modes are listed in `references/shared/RETURN_CONTRACT.md` § "Common failure modes".
2. `npx @wix/cli release` — extract the published URL from the `Site published on <url>` line in stdout. This command also populates the **Frontend link** in headless settings natively, so transactional emails link to the deployed frontend without any extra API calls.

---

## Final Message — emit the summary first, then write run.json

The instant `release` returns the published URL, emit the **complete user-facing summary as one message** — and emit it *before* any `run.json` work:

1. **Production URL** — bold link, first line (the exact `Site published on <url>` string; do not retype it).
2. **Dashboard link** — `https://manage.wix.com/dashboard/<siteId>`.
3. **One-line perf summary** (optional) — total wall + the headline phase timings, plain prose.

That summary is the only thing the user is waiting for at the end. Send it immediately, in one turn, with **no preceding "Site published — now writing run.json…" filler and no second closing message.**

**Then, in the same turn, after the summary text, write `.wix/run.json` silently** — the observability record aggregating every subagent return (format per `references/shared/RETURN_CONTRACT.md` § "Final run.json format"). Do not announce it. Do not re-read anything to compose it — use the subagent returns already in session context.

Ordering matters: composing `run.json` first put ~1 min between "published" and the summary the user actually wants. Summary first. The turn still does not close until the `run.json` write completes, so the record is guaranteed on disk before the turn ends — the user just sees the links immediately instead of after the write.

---

## Styling contract coordination

The **design tokens** (`.wix/design-tokens.css` + `.wix/site.d.ts`) are the coordination artifacts between subagents. Read by every downstream phase that touches styled markup.

### Producer: Phase 2 (Designer Wave 0 + Composer Setup-window bridge)

Dispatch timing: the Designer is dispatched at BUILD entry (run-step 0); the Composer at the Setup-window bridge (run-step 2 above). Net: `emit-design-tokens.mjs` writes `.wix/design-tokens.css` + `.wix/site.d.ts` (pure projections of the Designer's `data.designTokens`); the **Composer** writes the `@theme` palette into `global.css` from the same tokens plus the other 5 files. `designTokens` is the single source of truth — the script projects it, the Composer applies it.

### Consumer: Phase 3 Components (Step 4.5)

Phase 3 is dispatched in Step 4.5 above. The styling contract is passed inline in each Phase 3 prompt.

### Consumers: Phase 4 Pages (Step 7)

Contract already exists when Phase 4 launches. Subagents receive the contract contents inline in their prompt (no polling).

---

## Diagnostic: did the concurrent batch actually run in parallel?

If a build feels slow, check whether dispatches that should have been concurrent actually overlapped in execution. Two failure modes:

1. **Serialized launch:** the orchestrator emitted subagent invocations one at a time across multiple turns instead of as a single batch. Symptom: multi-second gaps between subagent starts in the run log.
2. **Serialized execution:** the runtime dispatched the batch but executed it sequentially (rare; most runtimes parallelize properly).

The fix for (1) depends on the runtime — check whether your dispatch primitive supports a single concurrent batch and whether anything between the subagent invocations (status updates, narration, file writes) is splitting the batch into multiple turns. Even when (1) cannot be fixed, **background dispatch alone gives ~2× compression** by overlapping execution. Make every subagent that doesn't block downstream work a background subagent.

# Build — astro framework class (`frontendBuild === "wix"`)

The post-approval conductor for the **astro-native** framework class — reached on the `create × astro` path (the skill scaffolds and writes the site). Opened from `BUILD.md` the moment the run routes on `frontendBuild === "wix"`. This file owns the **astro execution flow** — Setup → design-system bridge → Seed → the build wave (merged Components + Pages) → Build → Release: every subagent dispatch, background handle, wait/gate, and the imagery gates. Read it top to bottom from the approval point.

> **This file is the astro framework spine *and* hosts the astro-create cells.** Per `BUILD.md` § "The two (operation × framework) cells", the **bootstrap cell** for `create × astro` is run-step 0 (scaffold → `npm create @wix/new@latest headless`) and the **wiring cell** is the build wave — per-vertical agents writing components + pages (`.astro` with live SDK queries) in one dispatch. They live inline here rather than as separate cell files because astro is their only tenant and the content is large. The **shared release tail** (`BUILD.md`) is the Build & Release step below.

The cross-cutting operational sections that both framework classes share — **Subagent rate / credit limits**, the **parallel-batch diagnostic**, the **Final Message** (summary + run.json), and the **Final run.json format** — live in `BUILD.md` (the router). The pre-approval flow is in `PLAN.md` → `PLAN-create.md`; the three cross-cutting rules referenced below — **Two tracks**, **Batching discipline**, **User-facing output** — live in `PLAN.md`.

## Phase axis

Each phase belongs to one of the two tracks (`PLAN.md` § "Two tracks"). All phases are background (`bg`); this table is the *what* and *which track*, the sections below are the *when*.

| Phase | Track | Tier | What | When (bg) |
|---|---|---|---|---|
| **Phase 1 — Seed** | business | Fast | Per-pack seeders → orchestrator collects `seeded` map in scratch | Seed wave |
| **Phase 2 — Design System** | frontend | Default (Designer only) | **Designer** returns tokens + brand-voice JSON (no files); **`compose.mjs`** (deterministic script, no subagent) writes the 6 files (`global.css`, `astro.config.mjs`, `Layout`, `Nav`, `Footer`, `index`) by substituting into pinned skeletons | Designer: BUILD entry (run-step 0) · compose.mjs: Setup-window bridge (Bash) |
| **Image Phase 1 — Decorative** | frontend | Fast | Hero/about/page-header decoratives | Seed wave (imagery-gated) |
| **Phase 3 + 4 — Components + Pages (merged)** | frontend | Default | **One merged "build" agent per vertical** writes that vertical's React islands **then** the routes that mount them (styling contract inlined; seeded slice read from `.wix/seeded.json`). Private-file verticals run concurrent; shell-patchers (ecom, stores `home-and-nav`, gift-cards) serialize | The build wave (§ "Step 4.5") |
| **Image Phase 2 — Entity** | business | Fast | Product / blog / CMS item images PATCHed onto Wix entities | The build wave (imagery-gated) |

> **Set the model tier on every dispatch.** Tier policy lives in `SKILL.md` § "Subagent model tier" — apply by table lookup. The tier is selected via the dispatch primitive's model parameter, not the prompt; if you omit it, Default-tier roles silently run under-powered on the orchestrator's default model.

## The run from approval (Setup → Release)

The user just approved; `init-site-json.mjs` wrote the slim `.wix/site.json`. **Nothing is dispatched yet** — the funnel intentionally dispatched nothing so it could present the plan fast. (`BUILD.md` already confirmed `frontendBuild === "wix"` and routed here; the **Final Message** + **Shared release tail** sections it owns are the only parts shared with the own-build framework class.)

### 0. Dispatch scaffold + Designer (background, immediately on entry)

Fire both as one concurrent batch (`PLAN.md` § "Batching discipline") — they are independent:
- **Scaffold** — `scaffold.sh <folder-name> "<brand>" --frontend <value>` (background, capture `scaffold_handle` + its stderr tempfile). Folder-name derivation + the command shape are `DISCOVERY-create.md` § "After Q1". **`scaffold.sh` flattens the scaffolded project into CWD** — so on return the project (`wix.config.json`, `src/`, `package.json`, …) is in the current directory next to `.wix/site.json`, a single folder with one `.wix/` (`SKILL.md` § "Path resolution"). The `<folder-name>` is still required (the CLI mandates it) but the local subdir is transient — there is **no `nugget/` subdir to `cd` into**. `npm install` is **not** chained here (Setup Step 4c dispatches it). The stderr tempfile is for **post-hoc error inspection only** (read it *if* the scaffold reports a failure) — it is **not** a progress file to poll.
- **Designer** — background, capture `designer_handle`. Dispatch with **Instruction file = `<SKILL_ROOT>/references/DESIGN_SYSTEM.md`** (the subagent opens it — **do not Read it in the orchestrator**, per `SKILL.md` § "Path resolution"). Inline Discovery's aesthetic craft held in scratch: brand, aesthetic direction, palette, type, mood, page color strategy. **Also pass `designMdPath` = the absolute path `<cwd>/DESIGN.md`** (CWD is the project/site-root, which exists). The Designer **authors `DESIGN.md` there** (its YAML frontmatter = the tokens) and returns only `data.shell` + the `designMdPath` — so the tokens never round-trip through your output. Judgment-only (~10–15 s). Do **not** pass application inputs (packs, nav links) — those go to `compose.mjs` at the bridge, not to the Designer.

The Designer's ~13 s overlaps the scaffold's ~23 s. Setup waits on `scaffold_handle` at Step 1; the bridge (step 2) waits on `designer_handle`.

### 1. Setup Step 1 (foreground)

Apply `SETUP.md` Step 1 only: wait `scaffold_handle` (load `wix-manage` in the same batch), then patch `site.json` with `siteId`/`appId`. **Do not run Setup Step 4 (the app-install batch) yet** — it goes in run-step 2 below, in the message right after the design-system bridge.

> **How to wait — await the notification, never sleep-poll** (`PLAN.md` § "Concurrency vocabulary" → "Wait (gate)"). "Wait `scaffold_handle`" means await the harness's background-task **completion notification**. Do **not** run a `sleep`/poll loop against the scaffold's stdout/stderr/output file — that blocks the turn for the whole scaffold wall (~20–30 s, longer if you over-sleep) and needlessly delays the run-step 2 bridge (`compose.mjs` reads the scaffold's `astro.config.mjs`, so it can't run until the scaffold is verified). Burn zero orchestrator time here: the notification is the only signal you need.

### 2. Setup window — fire the bridge + platform batch as ONE concurrent message

**The whole Setup window is a single message of sibling `Bash` calls — emit them, do not plan them.** The moment Setup Step 1 returns (scaffold verified, `site.json` patched) and the Designer has returned, fire the design-system bridge **and** the business platform batch **together, in one turn**, as independent concurrent `Bash` calls. They share no data and no ordering constraint, so there is nothing to sequence. `designer_handle` has been running since run-step 0; it **authored `DESIGN.md`** and returned `data.shell` + the `designMdPath` (in scratch). The bridge scripts read `DESIGN.md` directly — **you never re-emit the palette/type tokens in your own output.**

> **The bridge is a one-line judgment: `DESIGN.md` exists → run the two scripts.** The Designer wrote it, so project the tokens (`emit-design-tokens.mjs`) and compose the site files (`compose.mjs`) from it — both deterministic, no judgment of their own. There is nothing to decide beyond "the file is there, run them." (`compose.mjs` is **astro-only**; the own-build path runs `emit-design-tokens` alone.)

> **Do NOT open this step with a planning turn.** Ordering, parallelism, the working directory, and the pack-skip logic are all pre-resolved below. A run that begins Setup with a long extended-thinking turn re-deriving the batch — observed in a trace as a **94 s, 7k-token turn** re-reasoning *"can I run these in parallel? which dir? which packs skip the app install?"* — has already burned the wall this step exists to save (~80 s of pure orchestrator idle, with zero tool calls in flight). The decisions are made; act on them. Emit the bridge `Bash` + the platform `Bash` calls as siblings in the next message, then proceed to the seed wave. The batch is **order-free**: the only mistake is spending a turn *deciding* an order it doesn't have.

**Frontend bridge — project tokens + compose from the Designer's `DESIGN.md`, one `Bash` call (two scripts; both read `DESIGN.md`, `compose` also takes a stdin heredoc of app-inputs):**

1. `emit-design-tokens.mjs <project-dir>` — reads the Designer's **`DESIGN.md`** (in the project dir) and projects **`.wix/design-tokens.css` + `.wix/site.d.ts`** from its frontmatter (format: `references/shared/DESIGN_MD.md`). It does **not** write `DESIGN.md` (the Designer authored it). No JSON to pipe or inline.
2. `compose.mjs` — pipe the **application inputs** on **stdin** (shell, brand, nav links, packs — **not** tokens), project dir as **`argv[2]`**. It **reads the Designer's `DESIGN.md` frontmatter** (the single token source; standard roles map to the wix `--color-*` vocabulary via the role table) and substitutes into the six pinned skeletons — `global.css`, `astro.config.mjs` (anchored **merge**, not clobber), `Layout.astro`, `Navigation.astro`, `Footer.astro`, `index.astro`. It prints a manifest JSON to **stdout** (same `{ status, phase: "compose", data, files }` shape — parse it from stdout). **Only run it when `frontendBuild === "wix"`** (defensive — non-astro framework classes never reach `BUILD-astro.md`); otherwise record `{phase: "compose", status: "skipped"}`.

   ```bash
   node <SKILL_ROOT>/scripts/emit-design-tokens.mjs "<project-dir>"

   node <SKILL_ROOT>/scripts/compose.mjs "<project-dir>" <<'COMPOSE'
   {
     "shell": { ...the Designer's data.shell... },
     "brand": { "name": "<brand>", "description": "<one-line context>" },
     "navLinks": [ { "href": "/", "label": "Home" }, ... ],
     "loadedPacks": ["stores", "cms", ...],
     "packsWithComponents": ["stores", "ecom", ...],
     "disabledPacks": ["gift-cards", ...]
   }
   COMPOSE
   ```

   The compose-input shape is documented in `scripts/compose.mjs`'s header (its sole spec). `compose.mjs` reads tokens from `DESIGN.md` only, guarantees the required-token contract resolves (deriving any role the Designer omitted as a fail-safe), and is idempotent — re-running it re-applies the same anchored config merge without duplicating the plugin/import.

**In the SAME message, as sibling `Bash` calls — the business Setup Step 4 batch** (frontend-blind — `SETUP.md` owns the recipes/package set). These fire **alongside** the bridge above, not after it — so the bridge's `compose.mjs` (~20 s) overlaps the app-install + npm rather than adding serial wall:

3. `Bash` × N — app installs, one curl per `pack.apps[*]` → `SETUP.md` § Step 4a. **Packs with no `apps[*]` (e.g. `cms`, `ecom`, `gift-cards`) install nothing** — record them `{status: "skipped"}` in run.json later; do not deliberate this at dispatch time.
4. `Bash` — `npx @wix/cli@latest env pull --json` → `SETUP.md` § Step 4b (the `--json` flag suppresses the interactive spinner that otherwise bloats context).
5. `Bash` (background) — `npm install …`, capture `npm_handle` + its stderr tempfile → package set in `SETUP.md` § Step 4c. **Trust the exit code at the seed gate — do not probe `node_modules` / `package.json` to "confirm packages landed."**

> **Rationale — keep `compose.mjs` overlapped.** `compose.mjs` is a deterministic ~20 s Bash step whose only inputs are the Designer's tokens (ready from run-step 0) and the verified scaffold (ready at Setup Step 1) — zero dependency on seeders, app installs, env, or npm. Run inline and *serial* it adds its ~20 s to the critical path; fired in the **same concurrent message** as the platform batch it hides under that work. There is no `composer_handle` to wait on — the six files are on disk the moment the bridge `Bash` returns. **The failure mode is not mis-ordering this batch — it has no order — it is (a) burning an orchestrator turn deciding an order, or (b) running the bridge as its own serial step instead of inside the concurrent batch.**

### 3. Seed wave (Wave 3) — business track + co-scheduled frontend prep

**One concurrent batch** (§ "Wave 3" below for the detailed dispatch): `seed-utilities.sh --template <…>` (frontend project prep) + per-pack seeders (background) + Image Phase 1 Decorative (background, gated — § "Imagery gates"). Apply `SEED.md` for the recipe map + seeder prompt template. **No design-system work here** — `compose.mjs` already wrote the six files synchronously in the bridge (step 2).

### 4. Seed gate

Wait on the seeders + `npm_handle`; aggregate seeder returns into the `seeded` scratch map. (No `composer_handle` — `compose.mjs` wrote the six files synchronously in the bridge; its manifest was already parsed from stdout there. The Step 4.5 gate still re-verifies the design-system files exist on disk before dispatching.) Run `patch-decorative-slots.mjs` only when `imagery === "ai-generated"` and Image Phase 1 Decorative returned; otherwise skip and record `{phase: "decorative-slot-patch", status: "skipped"}`.

**Write `.wix/seeded.json` here — once, at the gate, before any reader is dispatched.** The moment the `seeded` scratch map is aggregated, persist it to `.wix/seeded.json` (one `Write`, by the conductor — the sole writer). This is the **producer→consumer handoff** the Phase 4 Page readers pull from instead of receiving their slice inlined — see § "The `.wix/seeded.json` handoff" below for the schema and the scoped isolation-rule exception. Because the seed gate barriers all seeders *before* this write, and the build wave (which contains every reader) dispatches only *after* it, no reader ever sees a missing or partial file. Skipped packs are written as `{"<pack>": {"status": "skipped"}}` so a reader can distinguish "seeded nothing" from "file not written yet" (the latter must never happen).

### 5. Continue

**The build wave** (§ "Step 4.5": merged Components + Pages per vertical + Image Phase 2) → **Build & Release** → **Final message** — all detailed below.

## Imagery gates

The `imagery` value (`"ai-generated"` | `"themed-blocks"`, captured in `DISCOVERY.md` Q2.5, default `"themed-blocks"`) gates **both** image phases. The conductor owns the gate; the step files describe what each image scope does when it runs.

- **Image Phase 1 — Decorative** (Wave-3 batch). Dispatch the `image-phase-1-decorative` subagent (`<SKILL_ROOT>/references/images/INSTRUCTIONS.md`) **only when `imagery === "ai-generated"`**. When `"themed-blocks"` (default): do **not** dispatch — decorative slots render as solid color blocks via the Composer-emitted decorative-slot CSS (color blocks tokenised against the Designer's palette); record `{phase: "image-phase-1-decorative", status: "skipped", notes: "themed-blocks mode"}` and **skip the post-seed `patch-decorative-slots.mjs`** too (`{phase: "decorative-slot-patch", status: "skipped"}`). Dispatching it regardless wastes ~140–175 s + 0.3–0.5 Wix AI credits.
- **Image Phase 2 — Entity** (build-wave batch). Same gate — dispatch only on `ai-generated`; on `themed-blocks` skip and record `{phase: "image-phase-2-entity", status: "skipped"}`. Detailed dispatch + the hard build gate are in § "Step 4.5" and § "Wait: build wave → Build" below.

---

## Wave 3 — Seed + frontend prep + Image Phase 1

The seed-wave dispatch list (the run's step 3). No design-system work here — `compose.mjs` already wrote the six files synchronously in the Setup-window bridge. Launch as **one concurrent batch** (`PLAN.md` § "Batching discipline"):

- `seed-utilities.sh --template astro` — frontend-track project prep (idempotent), run from the project dir. Apply `SEED.md` § "Pre-batch".
- Per-pack seed subagents (background) — apply `SEED.md` for the recipe map + seeder prompt template.
- Image Phase 1 Decorative (background) — `<SKILL_ROOT>/references/images/INSTRUCTIONS.md`, scope `image-phase-1-decorative` — **only when `imagery === "ai-generated"`** (§ "Imagery gates").

The **seed gate** that follows (wait on seeders + `npm_handle`, aggregate `seeded`, optional decorative patch) is run-step 4 above — then continue to **Step 4.5** below.

### Subagent prompt template

See `SEED.md` § "Subagent prompt template" for the base fields (Instruction file, Phase instruction, Scope, Project directory, siteId, Auth, Brand context). Each merged build agent additionally inlines the full styling-contract JSON. **The page side of a merged agent no longer receives its seeded slice inlined** — every merged build agent is dispatched with *"read your `<vertical>` slice from `.wix/seeded.json`"* and reads it itself (§ "The `.wix/seeded.json` handoff"). (Image Phase 2's single slice stays inlined — see § "Step 4.5".) Subagents do NOT read `.wix/site.json` during the run — that rule stands; `.wix/seeded.json` is the one scoped, read-only exception.

**`Instruction file` must point to one of these vertical instruction files** (one merged build agent per loaded vertical opens its file and writes **components then pages** in a single dispatch — § "Step 4.5"):
- `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` — components + pages (private pages merge; `pages-home-and-nav` is the serialized shell agent)
- `<SKILL_ROOT>/references/ecom/INSTRUCTIONS.md` — components + cart/thank-you pages + CartBadge nav mount (shell chain; passive, required by stores)
- `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md` — CMS pages (no components scope)
- `<SKILL_ROOT>/references/blog/INSTRUCTIONS.md` — components + pages (private — own `src/pages/blog/*`, no shared-shell patch)
- `<SKILL_ROOT>/references/forms/INSTRUCTIONS.md` — components + pages (private)
- `<SKILL_ROOT>/references/gift-cards/INSTRUCTIONS.md` — components + pages (shell chain; passive/dashboard-gated)
- `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` — `image-phase-1-decorative` + `image-phase-2-entity`
- `<SKILL_ROOT>/references/DESIGN_SYSTEM.md` — Phase 2 Designer (design spec, JSON only). (There is no Composer subagent — `scripts/compose.mjs` writes the six design-system files deterministically in the run-step 2 bridge; see § "2. Setup window".)
- `<SKILL_ROOT>/references/astro/designer/INSTRUCTIONS.md` — **page-design specification** (not a separately-dispatched scope). The merged build agents apply this for the visual-design spec of their routes (layout, contract classes, decorative slots, per-scope structure for `home`/`static`/`store-pages`/`blog-pages`/`contact-page`) while writing their islands and live SDK data in the same pass. There is no separate placeholder-writing page-designer dispatch — single-write merged (see § "Step 4.5").

For **image subagents**, the prompt additionally includes: page list (for decorative brief), entity types to cover (products, about-content, etc.).

Merged build agents additionally receive the full styling-contract JSON inlined in their prompt — they do not read `.wix/design-tokens.css` + `.wix/site.d.ts` from disk. See § "Styling contract coordination" below.

### Subagent return

Every subagent returns a structured JSON block at the end of its run, per `references/shared/RETURN_CONTRACT.md`. The orchestrator parses each return as it arrives.

**Put the return-contract closing line in the dispatch prompt verbatim.** Every merged build-agent prompt ends with the same line the seeder template uses (`SEED.md` § "Subagent prompt template"), naming the scope's `data` shape:

```
Return contract (your sole output channel — end your message with this fenced JSON block; it MUST be the last content, no trailing prose, no "**What was done:**" recap after it):
{ ...the data shape for your scope, per references/shared/IMPLEMENTER.md § "Return contract"... }
```

Do **not** soften this to "return the structured JSON when done." A `pages`/`components` subagent that reads only its leaf `INSTRUCTIONS.md` never reaches the no-trailing-prose rule — it lives two self-load hops away in `IMPLEMENTER.md` → `RETURN_CONTRACT.md` — so the prompt line is the only copy it is guaranteed to see. Without it, agents append a prose recap after the JSON (a contract violation, even when the orchestrator still parses the block).

---

## The `.wix/seeded.json` handoff

Seeded entity IDs reach the **N Phase 4 Page subagents** through a **write-once, read-only shared artifact** — not through the orchestrator re-inlining a per-vertical slice into every page prompt. The conductor writes `.wix/seeded.json` once at the seed gate (run-step 4); each Phase 4 Page agent reads its own `<vertical>` slice from it. (Image Phase 2 is a single dispatch and keeps its inlined slice — the N-prompt marshaling cost this handoff removes only applies to the per-vertical page fan-out. Phase 3 Components need no seeded IDs at all.)

**Why this is a safe exception to the "inputs are inlined / don't read shared state" rule.** That rule exists to stop subagents depending on **mutable / observability** state — `.wix/site.json` is the orchestrator's resume + run.json snapshot, rewritten across phases, racy to share, so it stays orchestrator-only (sole reader/writer). `.wix/seeded.json` is the opposite shape: a **producer→consumer handoff — exactly one writer (the seed gate), written once before any reader is dispatched, read-only thereafter, never mutated by a reader.** That is clean dataflow, not the shared-mutable-state footgun the rule guards against. The `site.json` sole-reader/writer rule is **untouched**; this is a single, named, read-only carve-out.

**Scope of the exception (all three must hold):**
- exactly one writer — the conductor at the seed gate, before any reader dispatch;
- readers read only their own `<vertical>` slice; no reader writes the file;
- it carries **seeded entity IDs only** (the carry-forward payload below), never the `site.json` observability fields.

**Location.** `.wix/` — alongside `site.json`. `.wix/` sits **outside** the Astro/Vite bundler root, so the file never ships to `dist/` (same reason `.wix/design-tokens.css` is imported, not bundled). Readers pull it with the `Read` tool to author code (resolve slugs, generate `getStaticPaths`, author demo content); pages still query the live SDK at request time and **must not `import` `.wix/seeded.json`** into route files — same discipline as the existing "don't import `.wix/site.json` from pages" rule.

**Schema** — one top-level key per loaded pack, mirroring the orchestrator's `seeded` scratch map:

```json
{
  "stores": { "products": [{ "id": "...", "name": "...", "slug": "...", "variantId": "...", "price": 0 }], "productIds": ["..."], "categoryIds": ["..."] },
  "cms":    { "collectionIds": { "about": "...", "faq": "..." }, "itemIds": { "about": ["..."], "faq": ["..."] } },
  "blog":   { "postIds": ["..."], "categoryIds": ["..."] },
  "forms":  { "formIds": ["..."] }
}
```

Packs that seeded nothing are written as `{"<pack>": {"status": "skipped"}}`. The exact per-pack keys are the seeders' `Returns` column in `SEED.md` § "Recipe map" — pass them through verbatim.

**Reader failure mode (fail loud, never silent).** A Phase 4 Page reader asserts its `<vertical>` slice is present in `.wix/seeded.json` before using it. If the file or its slice is absent, it returns `status: "partial"` with `errors: [{ code: "SEEDED_JSON_SLICE_MISSING", missing: "seeded.<vertical>" }]` — it does **not** silently render an empty/unstyled page, and does **not** fall back to reading `.wix/site.json` or re-querying via curl. A missing slice means an upstream phase didn't complete; masking it ships a broken preview.

---

## Step 4.5 — the build wave (Components + Pages merged per vertical) + Image Phase 2 Entity

**This step replaces the old two-wave split (a Phase 3 Components wave → barrier → Phase 4 Pages wave) with ONE wave of per-vertical "build" agents.** Each merged agent writes its vertical's **components first, then the pages that mount them** — the within-agent write-order replaces the cross-agent barrier, so the orchestrator never re-enters between components and pages. (`Phase 3 Components` / `Phase 4 Pages` survive only as *labels* for the two kinds of work now done inside one agent; they are no longer two dispatches.) Image Phase 2 rides this wave too. All background.

**Gate (from the seed gate, run-step 4):** the `seeded` map is populated, `.wix/seeded.json` is written, and the bridge has run. Verify **both** `.wix/design-tokens.css` **and** `.wix/site.d.ts` exist on disk, and `compose.mjs` wrote `src/layouts/Layout.astro` + `src/styles/global.css` — the `cp` pre-batch and Layout imports below depend on them. If either design-tokens file is missing, do not dispatch the wave — surface the missing path and stop. (`patch-decorative-slots.mjs` was already run or skipped at the seed gate per § "4. Seed gate" — do not re-run it here.)

Read `.wix/design-tokens.css` + `.wix/site.d.ts` once.

### Pre-batch (same message, before subagent dispatches) — ALL pre-copies up front

Because each merged agent writes both islands **and** the pages that import them, **both** the old "components" pre-copies and the old "pages" pre-copies must be on disk before this single wave dispatches — there is no longer a second pre-batch between waves.

**1 · Per-pack component-CSS templates.** Deterministic `cp` — static templates using direct `var(--token)` references, no subagent needed. `compose.mjs`'s Layout imports `src/styles/components-<pack>.css` unconditionally for every pack that declares `components`; **skip this and `astro build` fails at Step 8 with `Could not resolve "../styles/components-<pack>.css"`.** For each loaded pack whose vertical INSTRUCTIONS declares a `components` scope (today: `stores`, `ecom`, `blog`, `forms`, `gift-cards`):

```bash
for pack in <loaded packs with components>; do
  cp "<SKILL_ROOT>/references/astro/templates/$pack/components-$pack.css" \
     "src/styles/components-$pack.css"
done
```

Record `{ phase: "copy-component-css", packs: [...], seconds }`. Idempotent. Packs without a `components-<pack>.css` template (today: `cms` — SSR inline) are skipped silently.

**2 · Pre-copied utility templates (both the old components-phase AND pages-phase utils, since one agent now imports both).** Each vertical's INSTRUCTIONS lists files under "Pre-copied by the orchestrator (do NOT write these yourself)" that its scopes only *import* — the conductor puts them on disk so no merged agent races to author them. Today:

```bash
# stores (loaded)
cp "<SKILL_ROOT>/references/astro/templates/stores/back-in-stock.ts" "src/utils/back-in-stock.ts"
cp "<SKILL_ROOT>/references/astro/templates/stores/categories.ts"     "src/utils/categories.ts"
# ecom (loaded)
cp "<SKILL_ROOT>/references/astro/templates/ecom/discounts.ts"        "src/utils/discounts.ts"
```

`categories.ts` is imported by `pages-categories`, `pages-products`, and `pages-home-and-nav`; `back-in-stock.ts` by the stores components; `discounts.ts` by ecom components + stores product pages. All are static, brand-agnostic SDK wrappers — if not pre-copied, multiple scopes fall back to authoring them and race the same path. Record `{ phase: "copy-utils", files: [...] }`.

### Dispatch the wave — one concurrent batch (private agents) + a serialized shell chain alongside it

Dispatch **one merged "build" agent per loaded vertical** (Instruction file = that vertical's `references/<vertical>/INSTRUCTIONS.md`). Each agent owns its vertical's `components` scope **and** its private-file `pages` scopes, and writes them **islands-first, then pages** in a single dispatch. Split by whether the agent's scopes touch a **shared shell** (`src/components/Navigation.astro` or `src/pages/index.astro`):

**A · Concurrent batch — agents that own only private files:**
- **stores-build** — `components` (AddToCartButton, ProductPurchase, BackInStockForm, SeoTags) → `pages-categories` (`category/[slug].astro`, `CategoryRail.astro`) → `pages-products` (`products/index.astro`, `products/[slug].astro`, `ProductCard.astro`). All private to stores. **Write order matters: islands → `pages-categories` (writes `CategoryRail.astro`) → `pages-products` (mounts `CategoryRail`).** Doing it in this order means every import a later scope mounts is already on disk — no cross-agent dispatch-order assertion needed.
- **blog-build** — `components` (blog service module, RicosViewer, consts) → `pages` (listing, detail, RSS, BlogPost layout — all under `src/pages/blog/*`). Blog gets **no `home:` marker** (only stores + gift-cards contribute home sections — `compose.mjs`), so it patches no shared shell and stays private/concurrent.
- **cms-build** — `pages` (About + FAQ wired to live `@wix/data`). No `components` scope (SSR inline).
- **forms-build** — `components` (ContactForm island) + `pages` (`contact.astro`, private).

**B · Serialized shell chain — agents whose scopes patch `Navigation.astro` / `index.astro`** (read-modify-write a shared file → concurrent dispatch trips the staleness guard `File has been modified since read`, **even when each patches a different marker** — the guard is per-file, not per-marker). **Launch one, wait for its return, then launch the next** — each sees the previous one's marker insertion. This chain runs **alongside** the concurrent batch (A), not after it. The complete set of shell-patchers (today): **ecom, stores `pages-home-and-nav`, gift-cards** — exactly the packs with `nav:` / `home:` markers.
- **ecom-build** — `components` (CartView, CartBadge) → `pages` (`cart.astro`, `thank-you.astro` private, **+ CartBadge mount in `Navigation.astro` at `<!-- nav:actions -->`**). The Navigation patch is why the whole ecom agent joins the chain.
- **stores-home-and-nav** — patch `index.astro` product grid at `<!-- home:stores -->` + `Navigation.astro` Shop submenu at `<!-- nav:links -->`. Writes no islands; pure shell-patcher. (Split out of stores-build precisely so the bulk of stores stays in concurrent batch A.)
- **gift-cards-build** — `components` (probe util, GiftCardPurchase island) → `pages` (gift-cards landing + `Navigation.astro` `<!-- nav:links -->` / `index.astro` `<!-- home:gift-cards -->` patches).

> **Why stores splits but ecom/gift-cards don't (Open Q1 resolution).** Stores exposes three distinct `pages` scopes, so its private pages (`products`, `categories`) merge into the concurrent **stores-build** while the shell-patching `pages-home-and-nav` stays its own serialized agent — keeping the bulk of stores off the serialized critical path. Ecom and gift-cards each expose a single `pages` scope that mixes private routes with a shell patch; rather than invent a finer scope split, the whole vertical agent joins the chain. (ecom always co-occurs with stores, so its CartBadge nav mount always shares `Navigation.astro` with `pages-home-and-nav` — they must serialize.) Blog, cms, and forms patch no shared shell, so they merge fully and run in batch A. The chain runs concurrent with batch A, so it is not the critical-path pole.

**Cross-vertical imports resolve at build time, not write time** — `stores-home-and-nav` imports `CategoryRail`/`ProductCard`/`utils/categories.ts` (from stores-build / pre-copy) and mounts no ecom island; ecom mounts its own `CartBadge`. Those imports resolve at Step 8, so they impose **no** write-ordering between the chain and batch A. The only ordering that matters is (i) shell-patchers serialize against each other (per-file, regardless of marker), and (ii) everything is on disk before Build.

**C · Image Phase 2 Entity** (imagery-gated, § "Imagery gates") — same batch, background. Not dispatched on `themed-blocks` (default). On `ai-generated` with entities in `seeded` scratch, dispatch it; the prompt **inlines** the relevant `seeded.<pack>` slice (entity IDs + names + descriptions) + brand context — its single, battle-tested inline contract (`images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity") stays inlined (only the N-prompt page readers moved to `.wix/seeded.json`). It runs through the whole wave and is gated only at Build.

**Why Image Phase 2 lives here.** It depends only on entity IDs/names/descriptions + brand context, never on anything the build agents write — its PATCH/PUT targets are Wix-side entities. Launching it in this wave lets it overlap the entire build wave instead of becoming a post-wave tail blocker.

### Merged-agent prompt additions (per vertical)

```
Scopes (write in this order — islands/components FIRST, then pages, and a page-scope that writes a shared component before the page-scope that mounts it): <e.g. components, pages-categories, pages-products>
Files to own (absolute paths): <union of the scopes' files from the vertical's pack frontmatter>
Phase 1 Seed data: read your `seeded.<vertical>` slice from `.wix/seeded.json` (written once at the seed gate; do NOT import it into route files — use it to resolve slugs / getStaticPaths / demo content, then query the live SDK at request time). Fail loud (status: "partial", errors:[{code:"SEEDED_JSON_SLICE_MISSING", missing:"seeded.<vertical>"}]) if your slice is absent — do not render an empty page or read .wix/site.json.
Styling contract: the full styling-contract JSON is inlined above (components do not write CSS — components-<pack>.css is already on disk). .wix/design-tokens.css + .wix/site.d.ts are also on disk (already imported by the build).
```

Each merged agent writes its `.tsx` islands first, then its `.astro` routes with live SDK queries + analytics events that mount those islands — in one dispatch, no orchestrator round-trip between them.

Merged agents MUST NOT:
- Modify files outside their declared scopes (the union listed in their prompt)
- Modify CSS (`global.css` owned by `compose.mjs`; `components-<pack>.css` is pre-copied — never authored)
- Patch a shared shell unless they are the chain agent assigned to it (batch-A agents own only private files)

---

## Wait: build wave → Build

Wait on **all** build-wave agents — batch A (concurrent) **and** the full serialized shell chain (B) — to return, then:

- **If `imagery === "ai-generated"`** (the wave dispatched `image-phase-2-entity`): wait for that handle to return, with a hard **120 s timeout** from when the build agents finish. On timeout, proceed to Build and record `{code: "IMAGE_PHASE_2_TIMEOUT"}` in `run.json`. Image Phase 2 has been running in parallel since the wave opened, so the timeout rarely fires.
- **If `imagery === "themed-blocks"`** (the wave skipped `image-phase-2-entity`): no wait — proceed to Build immediately.

Skipping this gate on an ai-generated run ships previews with no product images and leaves `run.json` recording `image-phase-2-entity` as `"in_progress"`.

Also ensure the background `npm install` (`npm_handle` from `SETUP.md` Step 4c, waited on at the seed gate) completed successfully before Build. On non-zero exit, follow the recovery ladder in `SETUP.md` § "npm install recovery".

## Build & Release

1. `npx @wix/cli@latest build` — if it fails, inspect `.wix/debug.log` for the specific error, fix, retry. Build failure modes are listed in § "Build failure modes" below; the Astro/React build-blockers a subagent should have caught are in `references/shared/IMPLEMENTER.md` § "Astro/React build-blockers".
2. `npx @wix/cli@latest release` — extract the published URL from the `Site published on <url>` line in stdout. This command also populates the **Frontend link** in headless settings natively, so transactional emails link to the deployed frontend without any extra API calls. Transient release errors (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `STATE_MISMATCH`, `temporarily unavailable`, `try again shortly`) — retry serially up to 3× with `attempt * 5`s backoff (`references/shared/PRODUCTION_SHARP_EDGES.md`). Do **not** retry build failures — those are code bugs to fix.

Then **Final Message** (`BUILD.md` § "Final Message" — the shared summary + run.json turn).

---

## Styling contract coordination

The **design tokens** (`.wix/design-tokens.css` + `.wix/site.d.ts`) are the coordination artifacts between subagents. Read by every downstream phase that touches styled markup.

### Producer: Phase 2 (Designer at BUILD entry + `compose.mjs` in the Setup-window bridge)

Timing: the Designer is dispatched at BUILD entry (run-step 0) and **authors `DESIGN.md`**; the bridge runs at the Setup-window (run-step 2 above) as a single Bash step. Net: `emit-design-tokens.mjs` projects `.wix/design-tokens.css` + `.wix/site.d.ts` from the Designer's `DESIGN.md` frontmatter; `compose.mjs` reads the same `DESIGN.md` and writes the `@theme` palette into `global.css` plus the other 5 files (substituting into pinned skeletons). **`DESIGN.md` is the single source of truth** — the Designer writes it, `emit-design-tokens.mjs` projects the `.wix` artifacts from it, `compose.mjs` reads it to apply the site files.

### Consumer: the merged build agents (the build wave, § "Step 4.5")

The contract already exists when the build wave launches (the Designer + bridge ran in run-steps 0–2). Each merged build agent receives the styling-contract contents inline in its prompt — both for the islands it writes first and the routes it writes after (no polling, no disk read of the contract).

---

## Build failure modes

Inspect `.wix/debug.log` after a failed `npx @wix/cli@latest build`; match the stderr against this table. (Subagents should have caught the Astro/React row before returning — see `references/shared/IMPLEMENTER.md` § "Astro/React build-blockers".)

| Failure | How to detect | Fix |
|---------|---------------|-----|
| `Legacy HTML single-line comments` | build stderr | A Phase 2 or build-wave agent emitted HTML comments in `.astro` frontmatter — replace with `//` or `/* */` |
| `Missing environment variable WIX_CLIENT_ID` | build stderr | Run `npx @wix/cli@latest env pull --json` then retry |
| `Cannot find module '@wix/…'` | build stderr | npm install didn't include that package; check the pack's `packages` list |

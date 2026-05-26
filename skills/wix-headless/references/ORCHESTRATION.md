# Orchestration — Concurrency Model

This file describes **what runs in parallel and what blocks**. It does not prescribe a specific tool API — map each step to whatever subagent / parallel-execution primitive your runtime offers.

## Concurrency vocabulary

The terms below appear throughout this skill. They describe the *shape* of work; the runtime decides how to implement them:

- **Subagent** — an isolated worker with its own context. The orchestrator sends it a prompt (an `Instruction file` path + inputs); the subagent reads the instruction file, performs the scope, and returns a structured result.
- **Concurrent batch** — N subagents (or N tool calls) launched together so they execute in parallel rather than serially. Whether this is concurrent sibling calls, async tasks, threads, or a parallel-fan-out primitive doesn't matter — only that they overlap in execution.
- **Background subagent** — a subagent the orchestrator does not block on; it runs while the orchestrator continues with downstream work and reports its result asynchronously.
- **Foreground subagent** — a subagent the orchestrator blocks on before continuing.
- **Wait (gate)** — the orchestrator pauses until specified background subagents finish.
- **Result** — the structured JSON block each subagent returns at the end of its run, per `references/shared/RETURN_CONTRACT.md`.

## Phase axis

| Phase | What | Dispatched at |
|---|---|---|
| **Phase 1 — Seed** | Per-pack seeders → `.wix/site.json.seeded` | `SEED.md` Step 2 (background) |
| **Phase 2 — Design System** | Designer writes tokens + Layout + Nav + Footer | **`DISCOVERY.md` Step 2.6 (background, `designer_handle`)**; `SEED.md` Step 2 waits on the handle in foreground + runs the bridge (emit tokens) |
| **Image Phase 1 — Decorative** | Hero/about/page-header decoratives | `SEED.md` Step 2 (background) |
| **Phase 3 — Components** | Per-vertical React islands, with styling contract inlined into each prompt | Step 4.5 (after Phase 2 + seed merge complete) |
| **Phase 4 — Pages** | Per-vertical routes; each page agent writes its routes once with both visual design and live data queries | Step 7 (concurrent with Image Phase 2) |
| **Image Phase 2 — Entity** | Product / blog post / CMS item images | Step 4.5 (concurrent with Phase 3 Components) — reads entity IDs from `.wix/site.json.seeded`. **Gated on `intent.imagery === "ai-generated"`** — skipped in themed-blocks mode (the default). |

## Why batching matters

Historical runs lost 1–2 minutes per phase to serialized dispatch — N subagents emitted one-per-turn instead of in a single concurrent batch. Even when each subagent ran fast, the inter-dispatch gaps (12–39s in measured runs) accumulated to >25% overhead per phase.

Two mitigations exist; use both:

1. **State the batch as a single concurrent step.** The skill's dispatch sections below say "launch N subagents concurrently" — that is one orchestration step, not N. Implement it as a single batch.
2. **Use background-on-dispatch for subagents that don't block downstream work.** Even if the runtime serializes the launch turns, background dispatch lets subagents overlap in execution. Measured compression on a sequential-launch / background-execute model: ~2× wall-time vs. serial.

If your runtime forces serialization across the orchestrator's turns, make every subagent that can run in the background a background subagent. Phase 2 Design System is dispatched in `DISCOVERY.md` Step 2.6 as background `designer_handle`; the foreground gate is the **wait** on that handle inside `SEED.md` Step 2 (Step 4.5 needs `.wix/design-tokens.css` on disk before continuing, and the bridge produces it).

---

## Wave 3 (Seed + Image Phase 1) — runs in `SEED.md`; Designer continues from Discovery

**Do not re-dispatch here.** Designer was dispatched in `DISCOVERY.md` Step 2.6 and is already running. `SEED.md` Step 2 launches, in one concurrent batch:

- Per-pack seed subagents (background)
- Image Phase 1 Decorative (background) — `<SKILL_ROOT>/references/images/INSTRUCTIONS.md`, scope `image-phase-1-decorative`

Then the orchestrator **waits on `designer_handle`** (the handle captured in `DISCOVERY.md` Step 2.6, scope `design-system`). When Designer returns, the orchestrator runs the bridge in `SEED.md` (merge `designTokens`, `emit-design-tokens.mjs`, Layout import check) **without** waiting for seed merge.

After `SEED.md` Step 4 (seed merge + optional `patch-decorative-slots.mjs`), Step 5 opens **this doc at Step 4.5** below — not a second designer dispatch.

### Subagent prompt template

Every dispatch sends a self-contained prompt with these fields:

```
Instruction file (absolute path): <SKILL_ROOT>/references/<vertical>/INSTRUCTIONS.md
  Read this file in full before doing anything else. It defines your role,
  scope routing, and return contract.
Phase instruction: <exact phase/scope string from the pack>
Scope: <scope string>
Project directory (absolute path): <project path>
site-root: <absolute path to eval run dir — parent of scaffold; .wix/site.json lives here>
siteId: <from wix.config.json>
Auth: <SKILL_ROOT>/references/shared/AUTHENTICATION.md — mint TOKEN once via npx @wix/cli token --site "$SITE_ID"; every curl uses Bearer + wix-site-id headers
Brand context: name, vibe, aesthetic direction, colors, fonts, mood, page color strategy
Design tokens: .wix/design-tokens.css (generated from site.json.designTokens)
```

**`Instruction file` must point to one of these vertical instruction files:**
- `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/ecom/INSTRUCTIONS.md` — Phase 3 Components (cart/checkout — passive, required by stores)
- `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md` — Phase 4 CMS Pages
- `<SKILL_ROOT>/references/blog/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/forms/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/gift-cards/INSTRUCTIONS.md` — Phase 3 Components + Phase 4 Pages (passive/dashboard-gated)
- `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` — `image-phase-1-decorative` + `image-phase-2-entity`
- `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md` — Phase 2 Design System + all Phase 4 Page designers

For **image subagents**, the prompt additionally includes: page list (for decorative brief), entity types to cover (products, about-content, etc.).

Phase 3 Components subagents (Step 4.5) additionally receive the full styling-contract JSON inlined in their prompt — they do not read `.wix/design-tokens.css` + `.wix/site.d.ts` from disk. See § "Styling contract coordination" below.

### Subagent return

Every subagent returns a structured JSON block at the end of its run, per `references/shared/RETURN_CONTRACT.md`. The orchestrator parses each return as it arrives.

---

## Wait: Phase 2 → Step 4.5 (Phase 3 Components + Image Phase 2) → Step 7 (Phase 4 Pages)

Phase 2 completed during `SEED.md` Step 2 (foreground in the Wave 3 batch). Before Step 4.5, verify `.wix/design-tokens.css` + `.wix/site.d.ts` exist on disk (from the Step 2 bridge). If Image Phase 1 finished after seed merge and `patch-decorative-slots.mjs` was skipped in `SEED.md` Step 4, run it now before dispatching components.

### Step 4.5 — Phase 3 Components + Image Phase 2 Entity (one concurrent batch, all background)

Read `.wix/design-tokens.css` + `.wix/site.d.ts` once.

**Pre-batch (same message, before subagent dispatches):** copy the per-pack component-CSS templates into the project. This is a deterministic `cp` — the templates are static and use direct `var(--token)` references against the standard designer vocabulary, so no subagent is needed to author them. The Phase 3 Components subagents below write only `.tsx` React islands; this step writes the matching `src/styles/components-<pack>.css`. **If you skip this `cp` step, `astro build` fails at Step 8 with `Could not resolve "../styles/components-<pack>.css"` from `src/layouts/Layout.astro`** — the Designer's Layout imports those files unconditionally for every pack that declares `components`. Observed in 2026-05-24 runs (Bakin Goods, French Goods, Frenchies) where the Phase 3 subagents wrote only `.tsx` and the build fell back to ~3 minutes of orchestrator recovery (`cp` + manual rewrite to strip `@apply`).

For each loaded pack whose vertical INSTRUCTIONS declares a `components` scope (today: `stores`, `ecom`, `blog`, `forms`, `gift-cards`), copy the template:

```bash
for pack in <loaded packs with components>; do
  cp "<SKILL_ROOT>/templates/$pack/components-$pack.css" \
     "src/styles/components-$pack.css"
done
```

Record `{ phase: "copy-component-css", packs: [...], seconds }` in `run.json`. Idempotent — re-running overwrites identical content. Packs without a `components-<pack>.css` template (today: `cms` — SSR inline, no component CSS) are skipped silently.

Then dispatch in a single concurrent batch:

1. **One Phase 3 Components subagent per loaded pack** that declares `components`. Each prompt carries:
   - All standard fields (see "Subagent prompt template" above)
   - The **full styling-contract JSON inlined** — not a file path
   - A note: *"`src/styles/components-<pack>.css` is already on disk (copied from the skill template by the orchestrator). Do NOT write that file — write only `.tsx` islands and any `.astro` shells in your scope."*

2. **One Image Phase 2 Entity subagent** — **gated on `.wix/site.json.intent.imagery === "ai-generated"`**. When `imagery === "themed-blocks"` (the default), **do NOT dispatch this subagent**. Stores seeders use placeholder image patterns (Unsplash URLs from the bulk-create recipe); CMS items and blog posts use their seeder-supplied placeholder media. Skipping Image Phase 2 in themed-blocks mode saves ~300–475 s of wall (often the critical-path subagent between Phase 3 return and Phase 4 dispatch) plus 0.4–1.2 Wix AI credits.

   Write a phase entry to `run.json` directly:
   ```json
   {"phase": "image-phase-2-entity", "status": "skipped",
    "notes": "themed-blocks mode — entity images use seeder placeholders"}
   ```

   When `imagery === "ai-generated"` AND `.wix/site.json.seeded` has entities (stores products, CMS items, blog posts), dispatch the subagent. Prompt carries paths to `site.json` + brand context; the image agent reads seeded IDs from disk. Instruction file: `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity".

The Phase 3 Components group is **background** regardless. Image Phase 2 (when dispatched) is also background — it starts immediately and continues running through Step 7 dispatch with no polling.

**Why Image Phase 2 lives here, not in Step 7.** Image Phase 2 only depends on `.wix/site.json.seeded` entity IDs/names/descriptions + brand context. It does not read or write anything Phase 3 Components or Phase 4 Pages produce — its PATCH/PUT targets are Wix-side entities (`stores/v3/products`, `wix-data/v2/items`, `blog/v3/posts`). Launching it here lets it overlap entirely with Phase 3 (and often Phase 4 too) instead of becoming a post-Phase-4 tail blocker.

**Gate.** Image Phase 2 requires `merge-seed-results.mjs` to have completed (`.wix/site.json.seeded` populated). `SEED.md` Step 4 runs merge before Step 5 handoff here — do not launch Step 4.5 until seed merge exit-0. Phase 2 Design System (dispatched in `DISCOVERY.md` Step 2.6, bridge ran in `SEED.md` Step 2) and `.wix/design-tokens.css` must already exist.

### Then Phase 4 (Pages)

Phase 4 launches in Step 7. Phase 3 Components is typically still running (or finished) at that point; Image Phase 2 (when dispatched, i.e. ai-generated mode) is also still running or finished. Step 6 explicitly waits for Phase 3 before Step 7 dispatches; Image Phase 2, when present, is allowed to continue running through Phase 4 and is gated only at Step 8 / Build.

---

## Wait: Phase 3 → Step 7 (Phase 4 Pages)

**Phase 3 Components** must complete before Step 7 dispatches — Phase 4 Pages mount the React islands Components wrote.

Do NOT launch Phase 4 prematurely — missing islands or incomplete `seeded` data causes build failures.

### Data carry-forward

Phase 4 subagents read `.wix/site.json` at `<site-root>/.wix/site.json` (absolute path from session scratch):
- **Stores** → `seeded.stores` (`productIds`, slugs, categories, …)
- **CMS** → `seeded.cms` (`collectionIds`, `itemIds`, …)

Seed merge already ran in `SEED.md` — do not re-dispatch seeders or re-inline raw seeder returns.

---

## Step 7 Dispatch — Phase 4 (Pages)

### Concurrent batch

For each loaded pack's `pages`:
- One Phase 4 subagent per scope — **background**. Each writes its routes ONCE with both visual design and live data queries (the merged design+wire model — see SKILL.md Step 5 note). Earlier flows split this into a placeholder-writing dispatch followed by a page-rewrite dispatch; that double-write was eliminated.

> **Image Phase 2 is NOT dispatched here.** When it was launched at Step 4.5 (i.e. on an `ai-generated` run), it has been running concurrent with Phase 3 + Phase 4 and is typically finished or near-finished by the time Step 7 fires; the Step 8 hard gate waits for it before invoking `release.sh`. **On a `themed-blocks` run (the default), Image Phase 2 was not dispatched at all** — no gate wait, no images, the build runs as soon as Phase 4 finishes.

### Example (ecommerce run — stores pack contributes 4 Phase 4 scopes + cms pack 1)

Five subagents launched concurrently:

1. **product-pages** — `products/index.astro`, `products/[slug].astro`, `ProductCard.astro`
2. **category-pages** — `category/[slug].astro`, `CategoryRail.astro`, `utils/categories.ts`
3. **cart-checkout** — `cart.astro`, `thank-you.astro`
4. **home-and-nav** — patch `index.astro` product grid + `Navigation.astro` (CartBadge mount + Shop submenu insert at `<!-- nav:links -->`)
5. **cms-pages** — wire About + FAQ to live `@wix/data` queries

`product-pages` and `home-and-nav` import files written by `category-pages` (`CategoryRail.astro`, `utils/categories.ts`) — but the imports resolve at build time (Step 8), not at write time, so the three can dispatch concurrently.

### Phase 4 prompt additions

```
Scope: <scope name from pack.pages[*].name>
Files to own (absolute paths): <from pack.pages[*].files>
Phase 1 Seed data: read from `.wix/site.json.seeded.<vertical>` (path reference — see SKILL.md Step 7)
Design tokens: .wix/design-tokens.css (read from disk if needed)
```

Each scope subagent writes its `.astro` files directly with live SDK queries, wires up analytics events, and mounts the React islands written by Phase 3 Components.

Scope subagents MUST NOT:
- Modify files outside their declared scope
- Modify CSS (owned by Phase 2 Design System)
- Modify React islands (owned by Phase 3 Components)

---

## Wait: Phase 4 → Build

> **HARD GATE: Do NOT run `npx @wix/cli build` until `image-phase-2-entity` has completed or timed out (120s) — ONLY when it was dispatched.** This gate applies only to runs where `intent.imagery === "ai-generated"` and Step 4.5 actually dispatched Image Phase 2. On the default `themed-blocks` run, Image Phase 2 was skipped at Step 4.5 and recorded as `{phase: "image-phase-2-entity", status: "skipped"}` in `run.json` — there is no handle to wait on; proceed to the build immediately when Phase 4 Pages return. **Skipping it on an ai-generated run has shipped previews with no product images and `run.json` recording `image-phase-2-entity` as `"in_progress"`, so do not collapse this gate.**

All Step 7 Phase 4 Pages subagents return. When Image Phase 2 was dispatched (ai-generated runs), it has been running through Phase 3 + Phase 4 in parallel — typically ~5–8 minutes by the time Phase 4 Pages finish, which is enough for it to be done or in its tail. When skipped (themed-blocks runs), no wait. All return JSON is in session context.

When Image Phase 2 was dispatched (ai-generated mode) and Phase 4 finishes before it, wait for it before proceeding. Without this wait, the preview shows empty image placeholders on products (images not yet PATCHed). With Image Phase 2 dispatched earlier (in Step 4.5), this wait is usually a no-op. On themed-blocks runs Image Phase 2 was never dispatched — skip this wait entirely.

> **Timeout safety:** if `image-phase-2-entity` has not completed within 120s after all Phase 4 subagents finish, proceed to Build and note `{code: "IMAGE_PHASE_2_TIMEOUT"}` in `run.json`. The timeout is a safety valve — under the Step-4.5-dispatch model it should rarely fire.

Also ensure the background `npm install` (`npm_handle` from `SETUP.md` Step 4c, waited on in `SEED.md` Step 4) completed successfully before Build. On non-zero exit, follow the recovery ladder in `SETUP.md` § "npm install recovery".

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

## Final Message — single concluding turn

Contains (in order):

1. **Release URL** as the very first thing — bold heading or link. The user must see it immediately.
2. **Write `.wix/run.json`** in the same turn — a single observability record aggregating every subagent return. Format per `references/shared/RETURN_CONTRACT.md` § "Final run.json format".

Why URL-first within one turn: the user perceives the URL instantly, but the turn does not close until the file write completes — so the observability record is guaranteed on disk before the turn ends. Earlier flows composed the final log BEFORE emitting the URL, adding ~70s to the user's wait.

Do NOT re-read anything to compose `run.json`. Use the subagent return data already in session context.

---

## Styling contract coordination

The **design tokens** (`.wix/design-tokens.css` + `.wix/site.d.ts`) are the coordination artifacts between subagents. Read by every downstream phase that touches styled markup.

### Producer: Phase 2 Design System (`DISCOVERY.md` Step 2.6 dispatch; bridge in `SEED.md` Step 2)

Phase 2 is dispatched from `DISCOVERY.md` Step 2.6 as background `designer_handle`. Its wall runs in parallel with Q3 + plan + approval + Setup + the Seed batch dispatch. `SEED.md` Step 2 waits on the handle in foreground; when Designer returns, the orchestrator merges `designTokens` into `.wix/site.json` and runs `node <SKILL_ROOT>/scripts/emit-design-tokens.mjs "<site-root>"` — see `SEED.md` § "Bridge: when `designer_handle` returns". Both `.wix/design-tokens.css` and `.wix/site.d.ts` are pure projections from JSON.

**Decorative slot patch:** after seed merge (and when Image Phase 1 has returned), run `patch-decorative-slots.mjs` per `SEED.md` Step 4 item 4.

### Consumer: Phase 3 Components (Step 4.5 — after Phase 2 bridge + seed merge)

Phase 3 is dispatched in Step 4.5 below, not during Wave 3. The styling contract is passed inline in each Phase 3 prompt.

### Consumers: Phase 4 Pages (Step 7)

Contract already exists when Phase 4 launches. Subagents receive the contract contents inline in their prompt (no polling).

---

## Diagnostic: did the concurrent batch actually run in parallel?

If a build feels slow, check whether dispatches that should have been concurrent actually overlapped in execution. Two failure modes:

1. **Serialized launch:** the orchestrator emitted subagent invocations one at a time across multiple turns instead of as a single batch. Symptom: 12–39s gaps between subagent starts in the run log.
2. **Serialized execution:** the runtime dispatched the batch but executed it sequentially (rare; most runtimes parallelize properly).

The fix for (1) depends on the runtime — check whether your dispatch primitive supports a single concurrent batch and whether anything between the subagent invocations (status updates, narration, file writes) is splitting the batch into multiple turns. Even when (1) cannot be fixed, **background dispatch alone gives ~2× compression** by overlapping execution. Make every subagent that doesn't block downstream work a background subagent.
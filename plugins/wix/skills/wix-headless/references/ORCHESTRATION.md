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
| **Phase 1 — Seed** | Per-vertical MCP data → `.wix/site.json.seeded.<vertical>` | Step 3 (concurrent with Phase 2 + Image Phase 1) |
| **Phase 2 — Design System** | Designer writes tokens + Layout + Nav + Footer | Step 3 (foreground) |
| **Phase 3 — Components** | Per-vertical React islands, with styling contract inlined into each prompt | Step 4.5 (after Phase 2 completes) |
| **Phase 4 — Pages** | Per-vertical routes; each page agent writes its routes once with both visual design and live data queries | Step 7 (concurrent with Image Phase 2) |
| **Image Phase 1 — Decorative** | Hero/about/page-header decoratives | Step 3 (concurrent with Phases 1 + 2) |
| **Image Phase 2 — Entity** | Product / blog post / CMS item images | Step 4.5 (concurrent with Phase 3 Components) — depends only on Phase 1 Seed entity IDs + brand context |

## Why batching matters

Historical runs lost 1–2 minutes per phase to serialized dispatch — N subagents emitted one-per-turn instead of in a single concurrent batch. Even when each subagent ran fast, the inter-dispatch gaps (12–39s in measured runs) accumulated to >25% overhead per phase.

Two mitigations exist; use both:

1. **State the batch as a single concurrent step.** The skill's dispatch sections below say "launch N subagents concurrently" — that is one orchestration step, not N. Implement it as a single batch.
2. **Use background-on-dispatch for subagents that don't block downstream work.** Even if the runtime serializes the launch turns, background dispatch lets subagents overlap in execution. Measured compression on a sequential-launch / background-execute model: ~2× wall-time vs. serial.

If your runtime forces serialization across the orchestrator's turns, make every subagent that can run in the background a background subagent. Only the Phase 2 Design System is foreground (because Step 4.5 needs `.wix/design-tokens.css` on disk before continuing).

---

## Step 3 Dispatch — Phase 1 (Seed) + Phase 2 (Design System) + Image Phase 1 (Decorative)

Runs immediately after Step 2 (Setup) completes.

### Concurrent batch

For each loaded vertical pack (stores, cms, blog, …):
- Phase 1 Seeder — **background**

Always:
- Image Phase 1 Decorative subagent — **background**. Generates decoratives from brand context only; no Phase 1 Seed dependency. Internally it issues ONE batched generation call for all slots — no per-image sequential calls.
- Phase 2 Design System subagent — **foreground** (orchestrator waits for this before Step 4 / Step 4.5 / Step 7). Writes `global.css`, `Layout.astro`, `Navigation.astro`, `Footer.astro`, `astro.config.mjs`, `index.astro` shell, and returns `designTokens` JSON. The orchestrator emits `.wix/design-tokens.css` + `.wix/site.d.ts` deterministically from the merged JSON via `<SKILL_ROOT>/scripts/emit-design-tokens.mjs` in Step 4 (the agent does not write either file).

**Phase 3 Components is not dispatched here.** It runs in Step 4.5 with the design tokens inlined into each prompt — see § "Styling contract coordination" below.

**Image Phase 2 (entity images) is not dispatched here.** It runs in Step 4.5 (alongside Phase 3 Components, gated on Phase 1 Seed having returned) with Phase 1 Seed entity IDs inlined — see § "Wait: Phase 2 → Step 4.5" below.

### Example (ecommerce run — stores + cms packs loaded)

Four subagents launched concurrently, each pointed at a vertical instruction file:

1. Phase 1 stores seeder (bg) — instruction file: `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md`, scope: `seed-seed`
2. Phase 1 CMS seeder (bg) — instruction file: `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md`, scope: `seed-seed`
3. Image Phase 1 Decorative (bg) — instruction file: `<SKILL_ROOT>/references/images/INSTRUCTIONS.md`, scope: `image-phase-1-decorative`
4. Phase 2 Design System (fg) — instruction file: `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md`, scope: `design-system`

### Subagent prompt template

Every dispatch sends a self-contained prompt with these fields:

```
Instruction file (absolute path): <SKILL_ROOT>/references/<vertical>/INSTRUCTIONS.md
  Read this file in full before doing anything else. It defines your role,
  scope routing, and return contract.
Phase instruction: <exact phase/scope string from the pack>
Scope: <scope string>
Project directory (absolute path): <project path>
siteId: <from wix.config.json>
MCP tool prefix: <prefix>
  Use this prefix for every Wix MCP call. Example: <prefix>CallWixSiteAPI, <prefix>WixREADME.
Brand context: name, vibe, aesthetic direction, colors, fonts, mood, page color strategy
Design tokens: .wix/design-tokens.css (generated from site.json.designTokens)
```

**`Instruction file` must point to one of these vertical instruction files:**
- `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` — Phase 1 Seed + Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/ecom/INSTRUCTIONS.md` — Phase 1 Seed + Phase 3 Components (cart/checkout — passive, required by stores)
- `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md` — Phase 1 Seed + Phase 4 CMS Pages
- `<SKILL_ROOT>/references/blog/INSTRUCTIONS.md` — Phase 1 Seed + Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/forms/INSTRUCTIONS.md` — Phase 1 Seed + Phase 3 Components + Phase 4 Pages
- `<SKILL_ROOT>/references/gift-cards/INSTRUCTIONS.md` — Phase 1 Seed + Phase 3 Components + Phase 4 Pages (passive/dashboard-gated)
- `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` — `image-phase-1-decorative` + `image-phase-2-entity`
- `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md` — Phase 2 Design System + all Phase 4 Page designers

For **image subagents**, the prompt additionally includes: page list (for decorative brief), entity types to cover (products, about-content, etc.).

Phase 3 Components subagents (Step 4.5) additionally receive the full styling-contract JSON inlined in their prompt — they do not read `.wix/design-tokens.css` + `.wix/site.d.ts` from disk. See § "Styling contract coordination" below.

### Subagent return

Every subagent returns a structured JSON block at the end of its run, per `references/shared/RETURN_CONTRACT.md`. The orchestrator parses each return as it arrives.

---

## Wait: Phase 2 → Step 4.5 (Phase 3 Components + Image Phase 2) → Step 7 (Phase 4 Pages)

Phase 2 completes (~2–3 min) in the foreground — the orchestrator resumes automatically. Verify `.wix/design-tokens.css` + `.wix/site.d.ts` exist on disk before launching Step 4.5.

### Step 4.5 — Phase 3 Components + Image Phase 2 Entity (one concurrent batch, all background)

Read `.wix/design-tokens.css` + `.wix/site.d.ts` once, then dispatch in a single concurrent batch:

1. **One Phase 3 Components subagent per loaded pack** that declares `components`. Each prompt carries:
   - All standard fields (see "Subagent prompt template" above)
   - The **full styling-contract JSON inlined** — not a file path

2. **One Image Phase 2 Entity subagent** (when any pack produced entities — stores products, CMS items, blog posts), provided the relevant Phase 1 Seeder has returned. Prompt carries Phase 1 Seed return data inline + brand context. The image agent reads `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity".

Both groups are **background**. They start immediately and continue running through Step 7 dispatch — no polling.

**Why Image Phase 2 lives here, not in Step 7.** Image Phase 2 only depends on Phase 1 Seed entity IDs/names/descriptions + brand context. It does not read or write anything Phase 3 Components or Phase 4 Pages produce — its PATCH/PUT targets are Wix-side entities (`stores/v3/products`, `wix-data/v2/items`, `blog/v3/posts`). Launching it here lets it overlap entirely with Phase 3 (and often Phase 4 too) instead of becoming a post-Phase-4 tail blocker.

**Gate.** If a Phase 1 Seeder is still running when this batch is dispatched, hold Image Phase 2 back until that seeder returns. Phase 3 Components dispatch does not wait — Phase 3 agents don't need entity data. In practice Phase 1 Seeders (~99–121 s typical) finish well before Phase 2 DS (~500 s typical), so this gate rarely fires.

### Then Phase 4 (Pages)

Phase 4 launches in Step 7. Phase 1 Seeders, Phase 3 Components, and Image Phase 2 are typically still running (or finished) at that point. Step 6 explicitly waits for Phase 1 + Phase 3 before Step 7 dispatches; Image Phase 2 is allowed to continue running through Phase 4 and is gated only at Step 8 / Build.

---

## Wait: Phase 3 + Phase 1 → Step 7 (Phase 4 Pages)

Both must complete before Step 7 dispatches:

1. **Phase 1 Seeders** — return data includes product slugs, CMS item IDs, etc. that Phase 4 subagents need for wiring.
2. **Phase 3 Components** — writes the React islands that Phase 4 Pages mount.

If one is still running when the other finishes, wait for its return. Do NOT launch Phase 4 prematurely — Phase 4 subagents would fail reading missing islands or missing product slugs.

### Data carry-forward

Parse these from Phase 1 Seed returns into session scratch for Phase 4 subagent prompts:
- **Stores Phase 1 return** → `products: [{id, name, slug, variantId, price, inventory, sku}]`
- **CMS Phase 1 return** → `collections: [{name, items: [{id, …}]}]`

Since 2026-04 the orchestrator also merges each Seeder's `data` block into `.wix/site.json.seeded.<vertical>` — Phase 4 prompts reference the `site.json` path rather than re-inlining the raw data, but the shape above is what Phase 4 subagents ultimately read.

---

## Step 7 Dispatch — Phase 4 (Pages)

### Concurrent batch

For each loaded pack's `pages`:
- One Phase 4 subagent per scope — **background**. Each writes its routes ONCE with both visual design and live data queries (the merged design+wire model — see SKILL.md Step 5 note). Earlier flows split this into a placeholder-writing dispatch followed by a page-rewrite dispatch; that double-write was eliminated.

> **Image Phase 2 is NOT dispatched here.** It was launched earlier in Step 4.5, alongside Phase 3 Components. By the time Step 7 fires, Image Phase 2 has typically been running for ~5–8 minutes and is finished or close to finishing. The Step 8 hard gate still waits for it before invoking `release.sh`.

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

> **HARD GATE: Do NOT run `npx @wix/cli build` until `image-phase-2-entity` has completed or timed out (120s).** This gate is non-negotiable even if earlier phases had failures or were written inline. Skipping it after cascading failures has shipped previews with no product images and `run.json` recording `image-phase-2-entity` as `"in_progress"`.

All Step 7 Phase 4 Pages subagents return. Image Phase 2 was dispatched in Step 4.5 (not Step 7), so it has been running through Phase 3 + Phase 4 in parallel — typically ~5–8 minutes by the time Phase 4 Pages finish, which is enough for Image Phase 2 to be done or in its tail. All return JSON is in session context.

If Phase 4 finishes before `image-phase-2-entity`, wait for it before proceeding. Without this wait, the preview shows empty image placeholders on products (images not yet PATCHed). With Image Phase 2 dispatched earlier (in Step 4.5), this wait is usually a no-op.

> **Timeout safety:** if `image-phase-2-entity` has not completed within 120s after all Phase 4 subagents finish, proceed to Build and note `{code: "IMAGE_PHASE_2_TIMEOUT"}` in `run.json`. The timeout is a safety valve — under the Step-4.5-dispatch model it should rarely fire.

Also ensure the background `npm install` (started in Step 2 Setup) has completed. Wait on its handle rather than polling. On non-zero exit, follow the recovery ladder in `SETUP.md` § "npm install recovery".

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

### Producer: Phase 2 Design System (Step 3, foreground) → orchestrator (Step 4, deterministic)

Phase 2 writes `global.css` and returns `designTokens` JSON. The orchestrator merges the JSON into `.wix/site.json.designTokens` and runs `node <SKILL_ROOT>/scripts/emit-design-tokens.mjs` (Step 4), which deterministically emits `.wix/design-tokens.css` + `.wix/site.d.ts` from the JSON. Both derived files are pure projections — no agent-side template, no LLM. See `<SKILL_ROOT>/scripts/emit-design-tokens.mjs` for the projection rules.

### Consumer: Phase 3 Components (Step 4.5 — launched AFTER Phase 2 completes; no polling)

Phase 3 Components is **not** dispatched in Step 3 alongside Phase 2. The orchestrator waits for Phase 2 to finish (foreground) and then launches Phase 3 in the background in Step 4.5. The contract is passed inline in each Phase 3 prompt.

Why serialized instead of polled: a polling mechanic would only save time if Phase 3 could finish early — but Step 7 (Phase 4) already depends on Phase 2, so Phase 2 is the critical-path gate regardless. Serializing Phase 3 behind Phase 2 adds zero to critical-path `max(Phase 2, Phase 3)` wall time and eliminates one failure mode (a missing-contract timeout).

### Consumers: Phase 4 Pages (Step 7)

Contract already exists when Phase 4 launches. Subagents receive the contract contents inline in their prompt (no polling).

---

## Diagnostic: did the concurrent batch actually run in parallel?

If a build feels slow, check whether dispatches that should have been concurrent actually overlapped in execution. Two failure modes:

1. **Serialized launch:** the orchestrator emitted subagent invocations one at a time across multiple turns instead of as a single batch. Symptom: 12–39s gaps between subagent starts in the run log.
2. **Serialized execution:** the runtime dispatched the batch but executed it sequentially (rare; most runtimes parallelize properly).

The fix for (1) depends on the runtime — check whether your dispatch primitive supports a single concurrent batch and whether anything between the subagent invocations (status updates, narration, file writes) is splitting the batch into multiple turns. Even when (1) cannot be fixed, **background dispatch alone gives ~2× compression** by overlapping execution. Make every subagent that doesn't block downstream work a background subagent.

# Seed

> **Track ownership.** The per-pack seeders in this article are the **business track** — they populate
> the Wix backend and are **frontend-blind** (no step in the seeder dispatch, recipe map, return
> contract, or aggregation reads `frontend`/template; a product is a product regardless of what renders
> it). *Whether* this phase runs at all is an orchestrator **routing** decision, not a property of this
> doc: integrate-mode (`user-provided`) runs skip Seed entirely (see `SKILL.md` § "Frontend modes" and
> SETUP.md § "Existing project flow"). A few **frontend-track** steps are *co-scheduled* in this same
> time-window for wall-time (the project-prep script, the Designer bridge, Image Phase 1) — they are
> fenced under "Frontend track — co-scheduled in this window" in Step 2 and are the only places `frontend`
> appears here.

Runs once, immediately after Setup Step 5 transitions here. Every loaded pack with a seed recipe gets its own subagent; the orchestrator collects each subagent's JSON return into session context (per `references/shared/RETURN_CONTRACT.md`) and holds the `seeded` map in memory for the rest of the run, prints a short progress summary, then **continues immediately** into `ORCHESTRATION.md` — seed is not the end of the run.

Target wall (Wave 3 critical path): **≤ 150 s** = `max(longest seed subagent, remaining designer wall)`. Designer was dispatched in DISCOVERY.md Step 2.6 as `designer_handle` and has been running through Q3 + plan + approval + Setup; by the time you reach Step 2 here it is typically partway through its work, sometimes already done. Seed subagents + Image Phase 1 run in background; the orchestrator waits on `designer_handle` (foreground) and runs the bridge when it returns. Step 4 then waits on seeders + npm.

---

## Step 1 — Build the dispatch list

The recipe map and per-pack input notes are inlined below — **do NOT separately `Read references/seed-recipes.md`** (the file exists for human reference but is redundant during a run; reading it adds a turn and a thinking gap before the dispatch batch).

From the `verticals` list in orchestrator scratch (captured in Discovery, also persisted to `.wix/site.json`), build the dispatch list. For each loaded pack:
- If the pack has a recipe in the table below (`stores`, `cms`, `blog`, `forms`) → add to the dispatch list.
- If the pack has no recipe (`gift-cards`, `ecom`) → record a phase entry as `{phase: "seed-<pack>", status: "skipped", notes: "no seed surface for this pack"}` directly. No subagent.

Resolve absolute recipe paths by joining `<wix-manage-root>` (already in scratch from Phase 2 Step 4 — do **not** re-invoke `Skill(name="wix-manage")` here) + the relative paths in this table.

### Recipe map

| Pack       | Recipes (relative to `<wix-manage-root>`)                                                                                                                                                                                                                                    | Returns                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| stores     | `references/stores/setup-online-store-catalog-v3.md` (idempotent catalog setup) + `references/stores/bulk-create-products-with-options.md` (single bulk call for N products)                                                                                                 | `productIds[]`, `categoryIds[]` (when `intent.stores.categoriesNamed` is non-empty) |
| cms        | `references/cms/cms-schema-management.md` (collection create) + `references/cms/cms-data-items-crud.md` (item create per collection) + `references/cms/cms-references-and-relationships.md` (only when a collection's `intent.cms.collections[N]` declares cross-references) | `collectionIds{}`, `itemIds{<collection>: []}`                                      |
| blog       | `references/blog/how-to-create-blog-posts.md`                                                                                                                                                                                                                                | `postIds[]`, `categoryIds[]`                                                        |
| forms      | `references/forms/create-form.md`                                                                                                                                                                                                                                            | `formIds[]`                                                                         |
| gift-cards | — (no seed surface; activation lives in Phase 2 app-install)                                                                                                                                                                                                                 | `{status: "skipped"}`                                                               |
| ecom       | — (cart/checkout vertical; no seed surface)                                                                                                                                                                                                                                  | `{status: "skipped"}`                                                               |

### Per-pack input notes

These notes reduce dispatch-time guesswork. The recipe itself is the source of truth for the API shape — these notes are about how to translate `intent.<pack>` + `brand` into the recipe's input.

**stores:**
- Bulk recipe wants `products: [{name, slug, sku, price, options?, variants?}]`. Populate `name` and `slug` from `intent.stores.productCount` and `brand` (e.g. for a coffee shop with `productCount: 3`, generate three product names that fit the brand vibe).
- `sku` defaults to `<slug>-001`; `price` is a positive brand-appropriate value (don't default to $1).
- When `intent.stores.categoriesNamed` is non-empty, the subagent creates those categories via the Categories API after the bulk product create and assigns products into them. **Fire the N category-create calls as one parallel batch** (independent calls — they don't need to serialize). When the array is empty, skip categories entirely (do not invent a default set).
- 5-product cap on the bulk endpoint. If `intent.stores.productCount` exceeds it, fan out into batches of 5.
- Text-only seeding: do not generate or attach product images. Follow the recipe's documented placeholder pattern.

**cms:**
- Schema recipe wants one `POST /wix-data/v2/collections` call per collection in `intent.cms.collections`. Field shape comes from `collection.purpose` — e.g. `purpose: "about"` → single-row text collection with `title` + `body`; `purpose: "faq"` → repeated `question` + `answer` rows.
- After all collections exist, the items recipe inserts `intent.cms.collections[N].itemCount` rows per collection, content generated from `brand`.
- `cms-references-and-relationships.md` is consulted **only** when a collection's intent block declares cross-references. Otherwise skip it.
- Return shape: `collectionIds: { <purpose>: <id> }` and `itemIds: { <purpose>: [<id>, ...] }`. Keying by `purpose` (not display name) lets Phase 4 wire pages without re-deriving slug ↔ id.

**blog:**
- Part 0 (member ID lookup) is mandatory. One `GET /members/v1/members?paging.limit=1`; reuse the returned id for every post.
- `intent.blog.postCount` posts created. Topics from `intent.blog.topics` when present; otherwise pick brand-appropriate topics from `brand.description`.
- **Use the bulk endpoint** `POST https://www.wixapis.com/blog/v3/bulk/draft-posts/create` for any `postCount ≥ 2`. The recipe's single-post curl is for demonstration; the bulk URL is the production path. (Skipping this and using N single-post creates costs ~30s per post.)
- Text-only: cover images use the recipe's documented placeholder pattern; no Media Manager import.

**forms:**
- One `POST /form-schema-service/v4/forms` call per entry in `intent.forms.forms`. Map `intent.forms.forms[N].fields` (string array) into the recipe's `formFields` payload using the documented field templates (`CONTACTS_FIRST_NAME`, `CONTACTS_EMAIL`, etc.).
- `purpose` ("contact", "lead", "signup") drives the form's `name` — e.g. `"contact"` → `"Contact Form"`.
- Wix Forms app is pre-installed via Phase 2; don't reinstall.

---

## Step 2 — One concurrent batch (Wave 3: seeders + image phase 1) + wait on Designer

> **BATCHING — read this twice before proceeding.**
>
> Launch **every** subagent dispatch below in a single concurrent batch (one assistant message containing N `Agent` tool_uses as siblings). That includes per-pack seeders and Image Phase 1 Decorative. No narration, no *"Dispatching seeders:"*, no transition text between dispatches.
>
> **Designer is NOT dispatched here.** It was dispatched in DISCOVERY.md Step 2.6 as `designer_handle` (background) and has been running since Q2 returned. The orchestrator's foreground action in this step is to **wait on `designer_handle`** and run the bridge when it returns (see § "Bridge" below).
>
> Any text adjacent to a dispatch closes the batch and forces remaining subagents into separate turns. Same regression class as Setup Step 5.
>
> **Two-dispatch trap (read this even if you only have 2 packs to seed):** When the dispatch list is short — e.g. only `forms` + `cms` for a contact-only site — it is tempting to issue them as two consecutive `Agent` calls, one per assistant message, with a *"Dispatching forms now…"* and *"Now dispatching cms…"* TEXT between them. **Don't.** Even with just 2 packs, issue both `Agent` tool_uses as siblings in one message. The 12 s gap that one extra TEXT turn introduces is the difference between the seed phase being "longest pole = max(forms, cms)" and "longest pole = forms + 12 s + cms." Verified in interactive runs: a 2-dispatch run lost 12 s by serializing.
>
> The single-batch rule scales: 2 seed dispatches, 4 seed dispatches, seeders + image1 — all go in **one** assistant message. The orchestrator's job is to fire the batch and wait, not to narrate the dispatch.

> **Two tracks share this window.** The subagent dispatches below are the **business track** (per-pack
> seeders — frontend-blind). The pre-batch project-prep script, the Designer bridge, the Layout-import
> verify, and Image Phase 1 are the **frontend track**, co-scheduled here only because Designer is
> waited-on in this window and the seeders + Image Phase 1 dispatch as one concurrent batch. The
> frontend-track steps are the only place `frontend`/template is read in this article.

**Pre-batch — frontend track (same message, before subagent dispatches):** run the project-prep script once (idempotent). Pass the scaffold template the orchestrator captured in Discovery (the `frontend` value, which in scaffold mode is `astro` or `react-vite`):

```bash
bash "<SKILL_ROOT>/scripts/seed-utilities.sh" --template <astro|react-vite — from orchestrator context>
```

Execute from the **project directory** (scaffold subdir after `cd`). Record `{ phase: "seed-utilities", seconds }` when composing `run.json`. (This is frontend-track project prep, not seeding — integrate-mode runs never reach this article, so the script has no `user-provided` case.)

### Wave 3 dispatch table

| Subagent                       | Mode                                                                                                     | Instruction file                                 | Scope                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| Per-pack seeders (Step 1 list) | bg                                                                                                       | wix-manage recipes (see seeder template)         | `seed` / recipe-driven     |
| Image Phase 1 Decorative       | bg                                                                                                       | `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` | `image-phase-1-decorative` |
| ~~Phase 2 Design System~~      | (already dispatched in DISCOVERY.md Step 2.6 as `designer_handle` — wait on it here, do not re-dispatch) |                                                  |                            |

- **Designer was dispatched in Discovery.** Wait on `designer_handle` in foreground. When it returns, run the bridge below (pipe tokens to `emit-design-tokens.mjs` + Layout-import verify).
- **Seed subagents do not wait for designer.** They return JSON inline per `references/shared/RETURN_CONTRACT.md`.
- **Critical path** = `max(longest seed subagent, remaining designer wall)` — Designer's earlier dispatch means its remaining wall here is typically 0–60 s, not its full 180–270 s.

### Image Phase 1 gate (imagery flag)

**Skip Image Phase 1 entirely when the orchestrator's `imagery` value is `"themed-blocks"`.** In themed-blocks mode the designer's `data-decorative-slot` placeholders already render as solid color blocks (`aspect-ratio` + `background-color` per `designer/INSTRUCTIONS.md` common rule #7) — no AI image generation, no Wix Media import, no patch step required. Dispatching the subagent regardless wastes ~140–175 s of wall + 0.3–0.5 Wix AI credits on imagery the user opted out of.

The orchestrator captured `imagery` in Discovery Step 2.5 and holds it in session scratch. Branch:

- **`imagery === "ai-generated"`** → include the Image Phase 1 Decorative subagent in the Wave 3 batch (as documented above).
- **`imagery === "themed-blocks"` (or unset — default)** → **do not dispatch**. Record a phase entry directly in session context for `run.json`:

  ```json
  {"phase": "image-phase-1-decorative", "status": "skipped",
   "notes": "themed-blocks mode — decorative slots render as color blocks per designer placeholder pattern"}
  ```

  And skip the post-seed `patch-decorative-slots.mjs` invocation in Step 4. Record `{phase: "decorative-slot-patch", status: "skipped", notes: "themed-blocks mode"}` in `run.json` to keep the skip explicit.

This gate is the implementation of the contract in `DISCOVERY.md` § 2.5.3 ("AI imagery fallback") — until that fallback is removed (AI imagery wired in end-to-end), `imagery: "ai-generated"` will be exceedingly rare and most runs go through the skipped path.

For each pack on the dispatch list, dispatch a seeder subagent (`Agent` tool with `subagent_type: "general-purpose"`) with the prompt template below. Use `run_in_background: true`.

### Subagent prompt template

```
You are seeding <pack> content into a Wix site as part of the wix-headless skill's Phase 3-Seed.

Inputs (do not re-derive these — every value is inlined here):
- brand: <brand JSON — inline from orchestrator scratch>
- pack: <pack name>
- intent.<pack>: <intent.<pack> JSON — inline from orchestrator scratch>
- recipe path(s): <absolute path(s) joined from <wix-manage-root>>
- siteId: <siteId — inline from orchestrator scratch>

Do NOT read .wix/site.json — every input you need is inlined above. The orchestrator is the sole reader/writer of site.json.

Steps:

1. **Open with one concurrent batch** (single assistant message, multiple tool calls):
   - One `Bash` to mint and capture the site-scoped REST token: `TOKEN=$(npx @wix/cli token --site "<siteId>")`. Use `npx @wix/cli token …` (not bare `wix token …`): `@wix/cli` may not be globally installed in every harness.
   - One `Read` per absolute recipe path you were given. If you have N recipe paths, issue N Reads as siblings — do not serialize them.
   No narration, no "Reading recipe and minting token:" preamble. Issue the batch.

   > **Mint the token EXACTLY ONCE. Never re-mint.** Inline the captured `$TOKEN` value into every subsequent `curl` and reuse it for the entire seed phase. `npx @wix/cli token --site "<siteId>"` returns a **byte-identical** string on every call within a run (the CLI caches it) **and** each call costs ~1.25 s of CLI startup — so re-minting is pure wasted wall that changes nothing. This holds on errors too: if a call fails, re-minting gives you the same token and the same failure. Do not re-mint to "get a fresh token," do not re-mint "to be safe," do not re-mint as a reaction to any error. One mint, reused everywhere.

2. Fire the recipe's REST calls via `curl` against `wixapis.com`. Every call carries the headers documented in `<skill-root>/references/shared/AUTHENTICATION.md` — `Authorization: Bearer $TOKEN` (the token from Step 1), `wix-site-id: <siteId>`, and `Content-Type: application/json` — plus the recipe's documented body. Construct request bodies from intent.<pack> + brand. **When the recipe documents N independent calls** (e.g., creating N categories, adding products to N categories), issue them as one parallel batch — not sequentially.

   **On any error (401/403/4xx), do NOT re-mint the token** — per the mint-once rule above, the re-minted token is byte-identical and will produce the same result. The token is not the cause. Retry the same call once as-is (covers a transient blip); if it still fails, return `status: "error"` with the response body. Do **not** spend turns debugging the auth call shape or cycling tokens — if the single retry fails, the issue is upstream (expired CLI session, missing app install, or a resource that requires a provisioning step the recipe didn't run), and neither re-minting nor header A/B-testing will recover it.

3. Text-only seeding only — do not call media-manager import or generate AI imagery. Use the placeholder image patterns the recipes document.

4. Collect the IDs the recipe returns and emit them in your return JSON (Return contract below).

Return contract (your sole output channel — end your message with this fenced JSON block, no trailing prose):
{
  "phase": "seed-<pack>",
  "status": "ok" | "error",
  "seeded": { <pack-specific keys per the SEED.md recipe map "Returns" column> },
  "recipeCalls": [{ "url": "<endpoint>", "status": <http-status> }, ...]
}

On error: status="error", include the failing recipe-call response verbatim under "error". Do not retry beyond what the recipe documents — orchestrator owns recovery.

Do NOT write coordination files (`.wix/seed-returns/`, sidecars, etc.). The JSON above is parsed directly from your message by the orchestrator.
```

The subagent decides per-call payloads from `intent.<pack>` + `brand`. The orchestrator does **not** pre-decompose the intent into per-call payloads; that defeats the point of having a subagent read the recipe.

`gift-cards` and `ecom` get their phase entries recorded directly by the orchestrator (no subagent dispatch). The orchestrator records `{phase: "seed-gift-cards", status: "skipped", notes: "no seed surface for this pack"}` etc. into session context, then includes them in the final `run.json`. No files involved.

### Designer — dispatched in Discovery, waited on here

The Design System subagent is **not** dispatched from this step. It was dispatched from `DISCOVERY.md` Step 2.6 as `designer_handle` (background), so its wall has been absorbing into Q3 + plan + approval + Setup + the seed-batch dispatch above. By the time you reach this point in SEED.md, Designer is typically partway through its work — sometimes already returned.

The orchestrator's foreground action here is:

1. **Wait on `designer_handle`.** Block until it returns. Run the seeders + Image Phase 1 dispatch (the bg batch above) BEFORE this wait so they run concurrent with Designer's tail.
2. **When `designer_handle` returns**, run the bridge below.

The Designer subagent's prompt was constructed in `DISCOVERY.md` Step 2.6 — see that step for the prompt template. The prompt does NOT depend on `.wix/site.json` (the file does not exist at dispatch time); every input is inlined.

### Image Phase 1 Decorative subagent prompt (background)

Always dispatch in the **same batch** (background). No Phase 1 Seed dependency.

```
Instruction file (absolute path): <SKILL_ROOT>/references/images/INSTRUCTIONS.md
Scope: image-phase-1-decorative
Project directory: <project dir>
site-root: <site-root>
siteId: <siteId>
Brand context: <same as designer prompt>
decorativeSlots: <string[] — REQUIRED; must match designer vocabulary exactly>
  Always: ["hero", "about"]
  Plus "productsHeader" if stores loaded
  Plus "cmsHeader" if cms loaded (optional page-header decorative)
```

### Bridge: when `designer_handle` returns (frontend track)

This bridge is **frontend-track** work (design tokens → CSS, Layout wiring) co-scheduled in the seed window — it shares nothing with the business-track seeders beyond timing.

Run **immediately** when the wait on `designer_handle` releases — **do not** wait for seed completion or Image Phase 1.

1. **Pipe `data.designTokens`** from the designer return directly into `emit-design-tokens.mjs` — no site.json round-trip:
   ```bash
   echo '<JSON.stringify(designerReturn.data.designTokens)>' \
     | node "<SKILL_ROOT>/scripts/emit-design-tokens.mjs" "<scaffold-dir>"
   ```
   `<scaffold-dir>` is the project root where `.wix/design-tokens.css` and `.wix/site.d.ts` will be written. Record `{ phase: "emit-design-tokens", seconds }`. Hold the `designTokens` JSON in orchestrator scratch — Phase 3 Components / Phase 4 Pages prompts may inline it.
2. **Layout CSS-import verification** (frontend-gated). The orchestrator already holds the `frontend` value in scratch:
   - `astro` — grep `src/layouts/Layout.astro`. For every loaded vertical whose pack declares `components`, there MUST be `import '../styles/components-<pack>.css'`. If any import is missing, inline-patch `Layout.astro` now.
   - `react-vite` — the equivalent layout check belongs in the react-vite template's `src/components/Layout.tsx` once that template is staged (see PLAN-beta-frontend-pluggability.md § "Inventory of Astro-only integration surface"). Until then, skip with a `{ phase: "verify-layout-imports", status: "skipped", notes: "react-vite layout-import check not yet authored" }` entry.
   - `user-provided` — should not reach this step (integrate mode skips Seed); if it does, skip with `{ phase: "verify-layout-imports", status: "skipped", notes: "frontend=user-provided" }`.

Seed subagents and Image Phase 1 may still be running — proceed to Step 3/4 gates without blocking on them.

---

## Step 3 — Subagent return contract

Every seeder ends its message with a fenced JSON block per `references/shared/RETURN_CONTRACT.md`:

```json
{
  "phase": "seed-<pack>",
  "status": "ok" | "skipped" | "error",
  "seeded": { /* pack-specific keys — see Step 1 "Recipe map" Returns column */ },
  "recipeCalls": [{ "url": "https://...", "status": 200 }]
}
```

**Strict on:** `phase` (must equal `seed-<pack>`), `status` (must be `ok`, `skipped`, or `error`).

**Permissive on:** `seeded` keys. Known keys (per the recipe map) pass through verbatim. Unknown keys are kept on `seeded[<pack>]` in orchestrator context so Phase 4 can surface them if needed.

**On error:** the subagent's return additionally carries `error: <failing recipe-call response verbatim>`. The orchestrator keeps that field on the entry it holds.

There are no seed-coordination files — agents return JSON inline. Do not write or read `.wix/seed-returns/<pack>.json`; the agent return *is* the contract.

---

## Step 4 — Wait on npm install, build seeded map

Three operations in order:

1. **Wait on every dispatched subagent.** (Implicit via the harness re-firing the orchestrator when each subagent returns; you don't proceed until all returns are in.)

2. **Wait on `npm_handle`** — the background `npm install` dispatched in SETUP.md Step 4c. It ran concurrent with the seed phase; by the time the longest-pole subagent returns, install is usually complete and this wait returns immediately. In the rare case it's still running, this wait is the gate before post-seed orchestration.

   On non-zero exit, read `<npm-tempfile>` (the stderr path captured alongside `npm_handle` in session scratch) and run the recovery ladder in `SETUP.md § npm install recovery`. Do not proceed to `ORCHESTRATION.md` until install completes — downstream build/release requires `node_modules`.

3. **Aggregate seeder returns in orchestrator context.** Each seeder's return JSON is already in your session context (the harness surfaces it when the subagent completes). Build a `seeded` map keyed by pack from those returns and hold it in scratch — Phase 3 Components, Phase 4 Pages, and Image Phase 2 prompts will inline the pack-specific slices.

   For each return:
   - `status: "ok"` — keep the `seeded` payload under `seeded[<pack>]`.
   - `status: "skipped"` — record `seeded[<pack>] = {status: "skipped"}`.
   - `status: "error"` — surface the `error` field verbatim. Do **not** autonomously retry; partial state for other packs is intact, so a targeted re-run is bounded.

   No script, no file. The orchestrator is the aggregator.

4. **Decorative slot patch (when Image Phase 1 has returned).** If the background `image-phase-1-decorative` subagent has already finished by the time the seed wait completes, pipe its slot→URL map into the patch script:

   ```bash
   echo '<JSON.stringify(imagePhase1Return.data.slots)>' \
     | node "<SKILL_ROOT>/scripts/patch-decorative-slots.mjs" "<scaffold-dir>"
   ```

   `<scaffold-dir>` is the dir containing `src/pages/`. If Image Phase 1 is still running, skip for now — ORCHESTRATION may run the same script when Image Phase 1 completes before Step 4.5, or re-run here if you receive the image return before opening ORCHESTRATION.

   - If Image Phase 1 returned `status: "failed"` or timed out, skip — `data-decorative-slot` placeholders use solid `background-color` and look complete without images.
   - The script self-skips when stdin is empty or has no slot→URL pairs (themed-blocks mode).
   - **On exit 2 (`status: "error"`)** — the script couldn't find `src/pages` at the passed dir or in any subdir. This almost always means the scaffold subdir got renamed or the path is wrong. Surface the error verbatim and check the project layout; do **not** retry with the same arg.
   - Record `{ phase: "decorative-slot-patch", seconds }` in `run.json`.

---

## Step 5 — Summary sentence, then continue

One short message in plain prose, naming what was seeded per pack:

> *"Seeded `<brand>`: `<N>` products in stores, `<M>` items across `<C>` CMS collections, `<P>` blog posts, `<F>` forms. Continuing with components and page build…"*

Adapt the sentence to whichever packs were loaded — drop the irrelevant clauses. Design system was dispatched in Discovery Step 2.6 and the bridge ran in Step 2 here — do not say "starting design system" or "merging tokens" in the summary.

Do **not** stop after this sentence. Open `<SKILL_ROOT>/references/ORCHESTRATION.md` at **Step 4.5** (Phase 3 Components + Image Phase 2). Phase 2 Design System (dispatched in Discovery, bridge ran in Step 2) already returned; Image Phase 1 was either dispatched in Step 2 and has already returned (ai-generated mode) or was skipped (themed-blocks mode) — either way, do **not** re-dispatch from Post-Seed. No transition narration between Seed and ORCHESTRATION — the summary sentence is the only user-facing bridge.

---

## Recovery

| Failure mode                                       | What the orchestrator does                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One subagent returns `error`                       | Surface the `error` payload verbatim; do not retry. Other packs' `seeded` data is intact in orchestrator scratch, so a re-run of the failing pack alone is bounded.                     |
| Subagent return has no fenced JSON block           | Per `RETURN_CONTRACT.md` § "Observed failure mode" — the harness falls back to narrative parsing, which is fragile. Surface the issue; retry the failing seeder once with the same prompt. |
| Recipe path drifted (Read fails inside a subagent) | The subagent should return `status: "error"` with the Read error in `error`. Surface it; the fix is to update seed-recipes.md, not retry.                                               |
| Bulk product create rate limit                     | The stores recipe documents the limit; the subagent fans out into batches of 5 internally. If it still hits a limit, returns `error`.                                                   |

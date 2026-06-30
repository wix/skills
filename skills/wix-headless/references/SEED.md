# Seed

This article seeds backend data. Every loaded pack with a seed recipe gets its own seeder subagent; the orchestrator collects each seeder's JSON return (per `references/shared/RETURN_CONTRACT.md`) into a `seeded` map keyed by pack. (For the business-vs-frontend track model, see `PLAN.md` § "Two tracks". For run flow — dispatch timing, waits, batching, transitions — see `BUILD.md`.)

---

## Step 1 — Build the dispatch list

The recipe map and per-pack input notes are inlined below — **do NOT separately `Read references/seed-recipes.md`**. The Step 1 table here is canonical for the run; `seed-recipes.md` exists only as a human-readable index of the same data, and reading it adds a turn and a thinking gap before the dispatch batch.

From the `verticals` list in orchestrator scratch (captured in Discovery), build the dispatch list. For each loaded pack:
- If the pack has a recipe in the table below (`stores`, `cms`, `blog`, `forms`, `bookings`, `events`) → add to the dispatch list.
- If the pack has no recipe (`gift-cards`, `ecom`) → record a phase entry as `{phase: "seed-<pack>", status: "skipped", notes: "no seed surface for this pack"}` directly. No subagent.

Resolve absolute recipe paths by joining `<wix-manage-root>` (already in scratch from Phase 2 Step 4 — do **not** re-invoke `Skill(name="wix-manage")` here) + the relative paths in this table.

### Recipe map

| Pack       | Recipes                                                                                                                                                                                                                                                                      | Returns                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| stores     | (relative to `<wix-manage-root>`) `references/stores/setup-online-store-catalog-v3.md` (idempotent catalog setup) + `references/stores/bulk-create-products-with-options.md` (single bulk call for N products)                                                              | `productIds[]`, `categoryIds[]` (when `intent.stores.categoriesNamed` is non-empty) |
| cms        | (relative to `<wix-manage-root>`) `references/cms/cms-schema-management.md` (collection create) + `references/cms/cms-data-items-crud.md` (item create per collection) + `references/cms/cms-references-and-relationships.md` (only when a collection's `intent.cms.collections[N]` declares cross-references) | `collectionIds{}`, `itemIds{<collection>: []}`                                      |
| blog       | (relative to `<wix-manage-root>`) `references/blog/how-to-create-blog-posts.md`                                                                                                                                                                                              | `postIds[]`, `categoryIds[]`                                                        |
| forms      | (relative to `<wix-manage-root>`) `references/forms/create-form.md`                                                                                                                                                                                                          | `formIds[]`                                                                         |
| bookings   | (within skill) `<SKILL_ROOT>/references/bookings/SERVICES_DATA.md` — service creation + optional staff. Recipe path uses `<SKILL_ROOT>`, NOT `<wix-manage-root>`.                                                                                                           | `services[{id, slug, name, type, durationMinutes, price, currency}]`, `staff[{id, resourceId, name}]` |
| events | (within skill) `<SKILL_ROOT>/references/events/EVENTS_DATA.md` — event create (`TICKETING` or `RSVP`) + ticket definitions (ticketed) + publish. Recipe path uses `<SKILL_ROOT>`, NOT `<wix-manage-root>`. | `events[{id, slug, title, type, ticketDefinitionIds[]}]` |
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

**bookings:**
- Recipe path is `<SKILL_ROOT>/references/bookings/SERVICES_DATA.md` — NOT under `<wix-manage-root>`. Resolve the path with `<SKILL_ROOT>` (same root as all other skill references).
- `intent.bookings.serviceCount` services (default 3). Names + descriptions from `brand`.
- `intent.bookings.serviceType` (`"APPOINTMENT"` or `"CLASS"`) determines the service `type` field. Default `"APPOINTMENT"`.
- `intent.bookings.hasStaff === true` → create 2 staff members (names from brand). Skip if false or absent.
- Wix Bookings app is pre-installed via Phase 2 (app ID `13d21c63-b5ec-5912-8397-c3a5ddb27a97`); don't reinstall.
- Return `seeded.bookings.services[{id, slug, name, ...}]` + `seeded.bookings.staff[{id, resourceId, name}]`.

**events:**
- Recipe path is `<SKILL_ROOT>/references/events/EVENTS_DATA.md` — NOT under `<wix-manage-root>`. Resolve with `<SKILL_ROOT>`.
- `intent.events.eventCount` events (default 1). Titles + descriptions + venue from `brand`/`intent.events`. **Use FUTURE start/end dates** — a past event isn't purchasable; `initialType` (`TICKETING`|`RSVP`) is immutable after create.
- `intent.events.eventType === "TICKETING"` → create the event with `registration.initialType: "TICKETING"`, then create one ticket definition per `intent.events.ticketTiers[]` (name + price; default a single "General Admission" tier if none given). `"RSVP"` → `registration.initialType: "RSVP"`; the registration form is built-in (name + email, can't be removed) so **seed no form fields** and **no ticket definitions**.
- **Publish** the draft event after creating tickets (publishing is one-way — seed published, not draft).
- **Paid-ticket precondition (note, don't block):** selling paid tickets requires a premium plan + a configured payment method (a dashboard step). Seeding still succeeds — the event and ticket definitions are created and live; only completing a *paid* purchase needs that setup. Free/RSVP events need neither. Surface this plainly in the run summary; never imply tickets are payable when no payment method is configured.
- Wix Events app is pre-installed via Phase 2 (app ID `140603ad-af8d-84a5-2c80-a0f60cb47351`); don't reinstall.
- Return `seeded.events.events[{id, slug, title, type, ticketDefinitionIds[]}]` (`ticketDefinitionIds` empty for RSVP events).

---

## Step 2 — Seed domain (recipes, inputs, prompt templates)

The seeders and Image Phase 1 below are launched as one concurrent background batch — that dispatch flow (timing, single-batch discipline, the two-dispatch trap) is owned by the conductor (`BUILD.md`, which routes to the active mode's seed step) / `PLAN.md` § "Batching discipline". This step defines only the seed domain: the pre-batch utilities script, the dispatch rows, the recipe map, the per-pack input notes, and the prompt templates.

**Pre-batch — `seed-utilities.sh` (project prep):** run the project-prep script once (idempotent). Astro is the only frontend built, so the template is always `astro`:

```bash
bash "<SKILL_ROOT>/scripts/seed-utilities.sh" --template astro
```

Execute from the **project directory** (== CWD — the scaffold was flattened in, no subdir). (This is frontend-track project prep, not seeding — custom frontends route to the stub and never reach this article.)

### Wave 3 dispatch table

| Subagent                       | Mode | Instruction file                                 | Scope                      |
| ------------------------------ | ---- | ------------------------------------------------ | -------------------------- |
| Per-pack seeders (Step 1 list) | bg   | wix-manage recipes (see seeder template)         | `seed` / recipe-driven     |
| Image Phase 1 Decorative       | bg   | `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` | `image-phase-1-decorative` |

### Image Phase 1 gate (imagery flag)

Whether the Image Phase 1 Decorative subagent is dispatched at all (the `ai-generated` vs `themed-blocks` branch) is owned by the conductor (`BUILD.md`). The decorative prompt template below is the seed-side domain for that subagent when it does run.

For each pack on the dispatch list, dispatch a seeder subagent (`Agent` tool with `subagent_type: "general-purpose"`) with the prompt template below. Use `run_in_background: true`.

### Subagent prompt template

```
You are seeding <pack> content into a Wix site as part of the wix-headless skill's Phase 1 Seed.

Inputs (do not re-derive these — every value is inlined here):
- brand: <brand JSON — inline from orchestrator scratch>
- pack: <pack name>
- intent.<pack>: <intent.<pack> JSON — inline from orchestrator scratch>
- recipe path(s): <absolute path(s) joined from <wix-manage-root>>
- siteId: <siteId — inline from orchestrator scratch>

Every input you need is inlined above — do not read any shared state file. Read **only** your own `seeded.json` slice (the one read-only exception, per `IMPLEMENTER.md`).

Steps:

1. **Open with one concurrent batch** (single assistant message, multiple tool calls):
   - One `Bash` to mint and capture the site-scoped REST token: `TOKEN=$(npx @wix/cli@latest token --site "<siteId>")`. Use `npx @wix/cli@latest token …` (not bare `wix token …`): `@wix/cli` may not be globally installed in every harness.
   - One `Read` per absolute recipe path you were given. If you have N recipe paths, issue N Reads as siblings — do not serialize them.
   No narration, no "Reading recipe and minting token:" preamble. Issue the batch.

   > **Mint the token EXACTLY ONCE. Never re-mint.** Inline the captured `$TOKEN` value into every subsequent `curl` and reuse it for the entire seed phase. `npx @wix/cli@latest token --site "<siteId>"` returns a **byte-identical** string on every call within a run (the CLI caches it) **and** each call costs ~1.25 s of CLI startup — so re-minting is pure wasted wall that changes nothing. This holds on errors too: if a call fails, re-minting gives you the same token and the same failure. Do not re-mint to "get a fresh token," do not re-mint "to be safe," do not re-mint as a reaction to any error. One mint, reused everywhere.

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

`gift-cards` and `ecom` have no seed surface, so the orchestrator dispatches no subagent for them and simply moves on. No files involved.

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

There are no seed-coordination files **between agents** — seeders return JSON inline, and no seeder writes or reads `.wix/seed-returns/<pack>.json`; the agent return *is* the contract. (This is distinct from `.wix/seeded.json`, which the **orchestrator** writes once at the seed gate from the aggregated returns — not a seeder-authored sidecar. Seeders never touch it; it's a read-only consumer handoff. See Step 4.)

---

## Step 4 — Aggregate the seeded map

The seed gate — waiting on seeders + `npm_handle`, and the decorative-slot patch — is owned by the conductor (`BUILD.md`). (`compose.mjs` writes the six design-system files synchronously in the Setup-window bridge; there is no Composer subagent to wait on.) (For npm install failures, see `SETUP.md § npm install recovery`.) This step defines only the aggregation shape.

**Aggregate seeder returns in orchestrator context.** Each seeder's return JSON is in your session context (the harness surfaces it when the subagent completes). Build a `seeded` map keyed by pack from those returns and hold it in scratch.

For each return:
- `status: "ok"` — keep the `seeded` payload under `seeded[<pack>]`.
- `status: "skipped"` — record `seeded[<pack>] = {status: "skipped"}`.
- `status: "error"` — surface the `error` field verbatim. Do **not** autonomously retry; partial state for other packs is intact, so a targeted re-run is bounded.

**Then write the aggregated map to `.wix/seeded.json` — once, at the gate (the conductor owns the timing; see `BUILD-astro.md` § "4. Seed gate" + § "The `.wix/seeded.json` handoff").** This is the producer→consumer handoff the per-vertical readers (astro Phase 4 Pages, own-build wiring) pull their slice from — the orchestrator no longer inlines `seeded.<vertical>` slices into those prompts. (Image Phase 2 is a single dispatch and keeps its inlined slice.) Exactly one writer, written before any reader is dispatched; it carries seeded entity IDs only. The orchestrator is the aggregator **and** the sole writer of this file.

---

## Step 5 — Summary sentence

Per `PLAN.md` § "User-facing output", emit one short plain-prose sentence naming what was seeded per pack — no tables, no machinery:

> *"Seeded `<brand>`: `<N>` products in stores, `<M>` items across `<C>` CMS collections, `<P>` blog posts, `<F>` forms. Continuing with components and page build…"*

Adapt the sentence to whichever packs were loaded — drop the irrelevant clauses.

---

## Recovery

| Failure mode                                       | What the orchestrator does                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One subagent returns `error`                       | Surface the `error` payload verbatim; do not retry. Other packs' `seeded` data is intact in orchestrator scratch, so a re-run of the failing pack alone is bounded.                     |
| Subagent return has no fenced JSON block           | Per `RETURN_CONTRACT.md` § "Observed failure mode" — the harness falls back to narrative parsing, which is fragile. Surface the issue; retry the failing seeder once with the same prompt. |
| Recipe path drifted (Read fails inside a subagent) | The subagent should return `status: "error"` with the Read error in `error`. Surface it; the fix is to correct the recipe path in the Step 1 table (and the wix-manage recipe), not retry.                                               |
| Bulk product create rate limit                     | The stores recipe documents the limit; the subagent fans out into batches of 5 internally. If it still hits a limit, returns `error`.                                                   |

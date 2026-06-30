# Build — astro framework class (`frontendBuild === "wix"`)

The post-approval conductor for the **astro-native** class (`create × astro` — the skill scaffolds and writes the site). Opened from `BUILD.md` when the run routes on `frontendBuild === "wix"`. Owns the astro flow: Setup → design-system bridge → Seed → build wave → Build → Release. Read top to bottom from approval.

This file hosts the astro-create **bootstrap cell** (run-step 0: `scaffold.sh` → `npm create @wix/new@latest headless`) and **wiring cell** (the build wave). Shared with the own-build class via `BUILD.md`: **Subagent rate / credit limits**, the **parallel-batch diagnostic**, the **Final Message** (summary + `AGENTS.md`), and the **Shared release tail**. Pre-approval flow + the **Two tracks** / **Batching discipline** / **User-facing output** rules live in `PLAN.md`.

## Phase axis

Each phase is one of the two tracks (`PLAN.md` § "Two tracks"); all are background.

| Phase | Track | Tier | What | When |
|---|---|---|---|---|
| **1 — Seed** | business | Fast | Per-pack seeders → orchestrator collects `seeded` map in scratch | Seed wave |
| **2 — Design System** | frontend | Default (Designer) | **Designer** returns tokens + brand-voice JSON (authors `DESIGN.md`, no other files); **`compose.mjs`** (script, no subagent) writes the 6 files from it | Designer: run-step 0 · compose.mjs: Setup-window bridge |
| **Image 1 — Decorative** | frontend | Fast | Hero/about/page-header decoratives | Seed wave (imagery-gated) |
| **3 + 4 — Components + Pages (merged)** | frontend | Default | One merged "build" agent per vertical writes its islands **then** the routes that mount them | Build wave (§ "Step 4.5") |
| **Image 2 — Entity** | business | Fast | Product/blog/CMS images PATCHed onto Wix entities | Build wave (imagery-gated) |

> **Set the model tier on every dispatch** (`SKILL.md` § "Subagent model tier", by table lookup). Tier is the dispatch primitive's model parameter, not the prompt — omit it and Default-tier roles silently run under-powered.

## The run from approval (Setup → Release)

The contract lives in scratch — no disk snapshot. Nothing is dispatched yet (the funnel presented the plan fast).

### 0. Dispatch scaffold + Designer (background, one concurrent batch on entry)

Independent — fire together (`PLAN.md` § "Batching discipline"):
- **Scaffold** — `scaffold.sh <folder-name> "<brand>" --frontend <value>` (background; capture `scaffold_handle` + its stderr tempfile). Folder-name + command shape: `DISCOVERY-create.md` § "After Q1". It **flattens the project into CWD** — one folder, one `.wix/`, no subdir to `cd` into (`SKILL.md` § "Path resolution"). `npm install` is **not** chained here (Setup Step 4c). The stderr tempfile is for post-hoc error inspection only — not a progress file to poll.
- **Designer** — background; capture `designer_handle`. Instruction file = `<SKILL_ROOT>/references/DESIGN_SYSTEM.md` (the subagent opens it — do **not** Read it in the orchestrator). Inline Discovery's aesthetic craft from scratch (brand, aesthetic direction, palette, type, mood, page color strategy). Pass `designMdPath` = `<cwd>/DESIGN.md`. The Designer **authors `DESIGN.md`** (frontmatter = the tokens) and returns only `data.shell` + `designMdPath` — tokens never round-trip through your output. Judgment-only (~10–15 s). Do **not** pass application inputs (packs, nav links) — those go to `compose.mjs`.

### 1. Setup Step 1 (foreground)

`SETUP.md` Step 1 only: wait `scaffold_handle` (load `wix-manage` in the same batch), then hold `siteId`/`appId` (from `wix.config.json`) in scratch. Do **not** run Setup Step 4 yet — it goes in run-step 2. **Wait = await the harness completion notification; never sleep-poll a handle**.

### 2. Setup window — bridge + platform batch as ONE concurrent message

The whole Setup window is a single message of sibling `Bash` calls — **emit them, don't plan them.** It is order-free; the only failure mode is spending a turn deciding an order it doesn't have. The moment Setup Step 1 returns and the Designer has returned, fire the bridge **and** the platform batch together. `designer_handle` authored `DESIGN.md`; the bridge scripts read it directly — never re-emit tokens in your output.

**Frontend bridge — one `Bash` call, two deterministic scripts (both read `DESIGN.md`):**

1. `emit-design-tokens.mjs <project-dir>` — projects `.wix/design-tokens.css` + `.wix/site.d.ts` from `DESIGN.md` frontmatter (format: `references/shared/DESIGN_MD.md`). Does not write `DESIGN.md`.
2. `compose.mjs` — app inputs on **stdin**, project dir as `argv[2]`. Reads `DESIGN.md` frontmatter (the single token source; roles map to the wix `--color-*` vocabulary) and substitutes into the six pinned skeletons — `global.css`, `astro.config.mjs` (anchored **merge**, not clobber), `Layout.astro`, `Navigation.astro`, `Footer.astro`, `index.astro`. Prints a `{status, phase:"compose", data, files}` manifest to **stdout** — parse it there. **astro-only** (defensive — non-astro classes never reach here); else record `{phase:"compose", status:"skipped"}`. Idempotent; derives any role the Designer omitted as a fail-safe.

   ```bash
   node <SKILL_ROOT>/scripts/emit-design-tokens.mjs "<project-dir>"

   node <SKILL_ROOT>/scripts/compose.mjs "<project-dir>" <<'COMPOSE'
   {
     "shell": { ...the Designer's data.shell... },
     "brand": { "name": "<brand>", "description": "<one-line context>" },
     "navLinks": [ { "href": "/", "label": "Home" }, ... ],
     "loadedPacks": ["stores", "cms", ...],
     "packsWithComponents": ["stores", "ecom", ...],
     "disabledPacks": ["gift-cards", ...],
     "navPath": ".wix/nav.astro",
     "footerPath": ".wix/footer.astro",
     "homePath": ".wix/home.astro"
   }
   COMPOSE
   ```

   The compose-input shape is documented in `scripts/compose.mjs`'s header.

   **The entire visible page is LLM-generated.** `compose.mjs` still writes the plumbing — `global.css`, `astro.config.mjs`, and `Layout.astro` (the `<html>`/`<head>` shell that imports the fonts, `global.css`, ClientRouter, and the `<Navigation/>`+`<Footer/>` components) — but the **header, footer, and home page are authored by an LLM**, not from templates (there are no `Navigation.astro` / `Footer.astro` / `index.astro` templates anymore). Between `emit-design-tokens.mjs` and `compose.mjs`, dispatch a **Default-tier** generator that reads the token vocabulary at `.wix/design-tokens.css` and authors three files, then pass their paths:
   - `.wix/nav.astro` → `Navigation.astro` (site header). Contract: one `<header class="site-nav" transition:persist="site-nav">` with brand mark + real nav links (`/`, `/about`, `/faq`), a `<!-- nav:links -->` + `<!-- nav:actions -->` marker and an empty `<div class="nav-actions">` for later vertical patches, and a no-JS mobile toggle.
   - `.wix/footer.astro` → `Footer.astro`. Contract: one `<footer class="site-footer">` with brand, a short tagline, and the nav links.
   - `.wix/home.astro` → `index.astro` (full home page). Contract: frontmatter importing `Layout` + a `<Layout>…</Layout>` wrapper; one `<!-- home:<pack> -->` marker per loaded home-contributing pack; and **two decorative-image slots** — `hero` + one section (e.g. `about`). **Each slot is a DEDICATED, EMPTY placeholder element that holds no copy** — e.g. `<div class="hero-image" data-decorative-slot="hero" style="aspect-ratio:4/5"></div>` sitting *beside* the hero text, NOT the `data-decorative-slot` attribute slapped on the content-bearing `<section>`. The image patcher injects an `<img>` only into an empty slot element; if the slot wraps real copy it is skipped (the image never lands). Any element type works (`<div>`/`<figure>`/…) as long as it is its own empty element.
   - **All three:** compose tokens as utility classes so they match the theme; write real copy (no `{{…}}`); keep `transition:persist` + the `site-nav`/`site-footer` classes (the View-Transitions + `global.css` styling target them). `compose.mjs` writes each verbatim and **errors if any path is missing** (`NO_NAV`/`NO_FOOTER`/`NO_HOME`). Manifest records `nav`/`footer`/`home` = `"llm-generated"`.

**In the SAME message — the business Setup Step 4 batch** (frontend-blind; `SETUP.md` owns recipes/package set). These overlap the bridge's `compose.mjs` (~20 s) so it adds no serial wall:

3. `Bash` × N — app installs, one curl per `pack.apps[*]` → `SETUP.md` § Step 4a. Packs with no `apps[*]` (`cms`, `ecom`, `gift-cards`) install nothing — skip them.
4. `Bash` — `npx @wix/cli@latest env pull --json` → `SETUP.md` § Step 4b (`--json` suppresses the spinner that bloats context).
5. `Bash` (background) — `npm install …`, capture `npm_handle` + stderr tempfile → package set in `SETUP.md` § Step 4c. Trust the exit code at the seed gate — do not probe `node_modules`.

### 3. Seed wave + 4. Seed gate

See § "Wave 3" below for the dispatch. The **seed gate**: wait on the seeders + `npm_handle`; aggregate seeder returns into the `seeded` scratch map. Run `patch-decorative-slots.mjs` only when `imagery === "ai-generated"` and Image Phase 1 returned; else skip + record `{phase:"decorative-slot-patch", status:"skipped"}`.

**Write `.wix/seeded.json` here — once, at the gate, before any reader dispatches** (one `Write`, conductor is sole writer). It is the producer→consumer handoff the build-wave readers pull from (§ "The `.wix/seeded.json` handoff"). The gate barriers all seeders before this write and the build wave dispatches only after it, so no reader sees a missing/partial file. Skipped packs → `{"<pack>": {"status":"skipped"}}` so a reader can tell "seeded nothing" from "not written yet" (the latter must never happen).

### 5. Continue → the build wave (§ "Step 4.5") → Build & Release → Final message.

## Imagery gates

`imagery` (`"ai-generated"` | `"themed-blocks"`, captured `DISCOVERY.md` Q2.5, default `"themed-blocks"`) gates **both** image phases. The conductor owns the gate.

- **Image Phase 1 — Decorative** (Wave-3 batch): dispatch the `image-phase-1-decorative` subagent (`<SKILL_ROOT>/references/images/INSTRUCTIONS.md`) **only on `ai-generated`**. On `themed-blocks`: don't dispatch (slots render as tokenised color blocks via compose-emitted CSS), record `{phase:"image-phase-1-decorative", status:"skipped", notes:"themed-blocks mode"}`, and skip `patch-decorative-slots.mjs`. Dispatching regardless wastes ~140–175 s + ~0.3–0.5 Wix AI credits.
- **Image Phase 2 — Entity** (build-wave batch): same gate — dispatch only on `ai-generated`; on `themed-blocks` skip + record `{phase:"image-phase-2-entity", status:"skipped"}`. Dispatch + build gate: § "Step 4.5" and § "Wait: build wave → Build".

---

## Wave 3 — Seed + frontend prep + Image Phase 1

One concurrent batch (`PLAN.md` § "Batching discipline"). No design-system work here — `compose.mjs` already wrote the six files in the bridge.

- `seed-utilities.sh --template astro` — frontend project prep (idempotent), from the project dir. `SEED.md` § "Pre-batch".
- Per-pack seed subagents (background) — `SEED.md` recipe map + seeder prompt template.
- Image Phase 1 Decorative (background) — only on `ai-generated` (§ "Imagery gates").

### Subagent dispatch

Base prompt fields: `SEED.md` § "Subagent prompt template". Each merged build agent is dispatched with *"read your `<vertical>` slice from `.wix/seeded.json`"* — the page side reads its slice itself (§ "The `.wix/seeded.json` handoff") — and *"read `.wix/design-tokens.css` for the token vocabulary"*; the orchestrator does **not** inline the token block (§ "Styling contract coordination"). (Image Phase 2's single slice stays inlined.) Subagents read no shared state except their own `.wix/seeded.json` slice and the on-disk design-token artifacts (read-only).

**`Instruction file` per loaded vertical** (one merged build agent each, writes components then pages in one dispatch):
- `stores/INSTRUCTIONS.md` — components + pages (private pages merge; `pages-home-and-nav` is the serialized shell agent)
- `ecom/INSTRUCTIONS.md` — components + cart/thank-you pages + CartBadge nav mount (shell chain; passive, required by stores)
- `cms/INSTRUCTIONS.md` — CMS pages (no components scope)
- `blog/INSTRUCTIONS.md` — components + pages (private — own `src/pages/blog/*`)
- `forms/INSTRUCTIONS.md` — components + pages (private)
- `bookings/INSTRUCTIONS.md` — components + pages (shell chain — patches `Navigation.astro` `<!-- nav:links -->` + `index.astro` `<!-- home:bookings -->`)
- `events/INSTRUCTIONS.md` — components + pages (shell chain — patches `Navigation.astro` `<!-- nav:links -->` + `index.astro` `<!-- home:events -->`)
- `gift-cards/INSTRUCTIONS.md` — components + pages (shell chain; passive/dashboard-gated)
- `images/INSTRUCTIONS.md` — `image-phase-1-decorative` + `image-phase-2-entity` (image subagents also get: page list, entity types to cover)
- `DESIGN_SYSTEM.md` — Phase 2 Designer (no Composer subagent — `compose.mjs` writes the six files)
- `astro/designer/INSTRUCTIONS.md` — page-design spec applied by the merged build agents while writing routes (not a separate dispatch)

Merged build agents **read `.wix/design-tokens.css` from disk** for the token vocabulary (gate-verified present at § "Step 4.5") — the orchestrator does **not** inline the styling-contract block (§ "Styling contract coordination").

**Every subagent ends with the return contract** (`references/shared/RETURN_CONTRACT.md`); the orchestrator parses each return as it arrives. Put the closing line in the dispatch prompt **verbatim** — it's the only copy a leaf agent is guaranteed to see:

```
Return contract (your sole output channel — end your message with this fenced JSON block; it MUST be the last content, no trailing prose, no "**What was done:**" recap after it):
{ ...the data shape for your scope, per references/shared/IMPLEMENTER.md § "Return contract"... }
```

---

## The `.wix/seeded.json` handoff

Seeded entity IDs reach the build-wave Page readers through a **write-once, read-only shared artifact** — not by re-inlining a slice into every prompt. The conductor writes it once at the seed gate; each reader reads its own `<vertical>` slice. (Image Phase 2 keeps its inlined slice; Phase 3 Components need no seeded IDs.) It is a safe exception to the "inputs inlined / don't read shared state" rule.

**Scope of the exception (all three must hold):**
- exactly one writer — the conductor at the seed gate, before any reader dispatch;
- readers read only their own `<vertical>` slice; no reader writes the file;
- it carries seeded entity IDs only, never observability fields.

**Location:** `.wix/` (outside the Astro/Vite bundler root, so it never ships to `dist/` — same as `.wix/design-tokens.css`). Readers `Read` it to author code (slugs, `getStaticPaths`, demo content); pages query the live SDK at request time and **must not `import` it** into route files.

**Schema** — one top-level key per loaded pack, mirroring the `seeded` scratch map:

```json
{
  "stores": { "products": [{ "id": "...", "name": "...", "slug": "...", "variantId": "...", "price": 0 }], "productIds": ["..."], "categoryIds": ["..."] },
  "cms":    { "collectionIds": { "about": "...", "faq": "..." }, "itemIds": { "about": ["..."], "faq": ["..."] } },
  "blog":   { "postIds": ["..."], "categoryIds": ["..."] },
  "forms":  { "formIds": ["..."] }
}
```

Packs that seeded nothing → `{"<pack>": {"status":"skipped"}}`. Exact per-pack keys = the seeders' `Returns` column in `SEED.md` § "Recipe map".

**Reader failure mode (fail loud):** a reader asserts its slice is present before using it. If the file or slice is absent → `status:"partial"`, `errors:[{code:"SEEDED_JSON_SLICE_MISSING", missing:"seeded.<vertical>"}]`. Do **not** render an empty page or fall back to re-querying via curl — a missing slice means an upstream phase didn't complete.

---

## Step 4.5 — the build wave (Components + Pages merged per vertical) + Image Phase 2

ONE wave of per-vertical "build" agents, each writing its **components first, then the pages that mount them** — the within-agent write-order replaces the old cross-agent barrier, so the orchestrator never re-enters between components and pages. Image Phase 2 rides this wave. All background.

**Gate (from the seed gate):** `seeded` populated, `.wix/seeded.json` written, bridge run. Verify **both** `.wix/design-tokens.css` **and** `.wix/site.d.ts` exist on disk, and `compose.mjs` wrote `src/layouts/Layout.astro` + `src/styles/global.css`. If a design-tokens file is missing, do not dispatch — surface the path and stop. (Each merged build agent reads `.wix/design-tokens.css` itself for the token vocabulary — the orchestrator does **not** read it or inline it into dispatch prompts, which would re-emit the full token block once per agent for no benefit; the cascade reaches components through `global.css`, not the prompt.)

### Pre-batch (same message, before dispatches) — ALL pre-copies up front

**1 · Per-pack component-CSS templates** (deterministic `cp`; static `var(--token)` CSS, no subagent). `compose.mjs`'s Layout imports `src/styles/components-<pack>.css` for every pack with `components`; **skip this and `astro build` fails with `Could not resolve "../styles/components-<pack>.css"`.** For each loaded pack with a `components` scope (today: `stores`, `ecom`, `blog`, `forms`, `gift-cards`, `bookings`, `events`):

```bash
for pack in <loaded packs with components>; do
  cp "<SKILL_ROOT>/references/astro/templates/$pack/components-$pack.css" \
     "src/styles/components-$pack.css"
done
```

Idempotent. Packs without a template (`cms` — SSR inline) are skipped silently.

**2 · Pre-copied utility templates** (both components- and pages-phase utils, since one agent imports both). Each vertical's INSTRUCTIONS lists files under "Pre-copied by the orchestrator (do NOT write these yourself)":

```bash
# stores (loaded)
cp "<SKILL_ROOT>/references/astro/templates/stores/back-in-stock.ts" "src/utils/back-in-stock.ts"
cp "<SKILL_ROOT>/references/astro/templates/stores/categories.ts"     "src/utils/categories.ts"
# ecom (loaded)
cp "<SKILL_ROOT>/references/astro/templates/ecom/discounts.ts"        "src/utils/discounts.ts"
# bookings (loaded) — the booking SDK module + SeoTags
cp "<SKILL_ROOT>/references/astro/templates/bookings/bookingDriver.ts" "src/components/bookingDriver.ts"
cp "<SKILL_ROOT>/references/astro/templates/bookings/SeoTags.astro"    "src/components/SeoTags.astro"
# events (loaded) — the reserve→redirect / RSVP SDK module
cp "<SKILL_ROOT>/references/astro/templates/events/eventsDriver.ts"    "src/components/eventsDriver.ts"
```

`categories.ts` is imported by `pages-categories`/`pages-products`/`pages-home-and-nav`; `back-in-stock.ts` by stores components; `discounts.ts` by ecom components + stores product pages; `bookingDriver.ts` (the ecom-Cart-V2 booking sequence — `book()`/`navigateToCheckout()`) by the bookings islands, and `SeoTags.astro` by `services/[slug].astro`; `eventsDriver.ts` (the reserve→redirect ticketing sequence + `rsvp()`) by the events islands. Static, brand-agnostic SDK wrappers — if not pre-copied, multiple scopes race to author them.

### Dispatch the wave — one concurrent batch (private agents) + a serialized shell chain alongside it

One merged "build" agent per loaded vertical (Instruction file = that vertical's `INSTRUCTIONS.md`), owning its `components` scope **and** its private `pages` scopes, written islands-first then pages. Split by whether the agent's scopes touch a **shared shell** (`src/components/Navigation.astro` or `src/pages/index.astro`):

**A · Concurrent batch — agents that own only private files:**
- **stores-build** — `components` (AddToCartButton, ProductPurchase, BackInStockForm, SeoTags) → `pages-categories` (`category/[slug].astro`, `CategoryRail.astro`) → `pages-products` (`products/index.astro`, `products/[slug].astro`, `ProductCard.astro`). **Write order matters: islands → `pages-categories` (writes `CategoryRail.astro`) → `pages-products` (mounts it)** — every import a later scope mounts is already on disk.
- **blog-build** — `components` (blog service module, RicosViewer, consts) → `pages` (listing, detail, RSS, BlogPost layout, all under `src/pages/blog/*`). No `home:` marker → no shared-shell patch, stays concurrent.
- **cms-build** — `pages` (About + FAQ wired to live `@wix/data`). No `components` scope.
- **forms-build** — `components` (ContactForm island) + `pages` (`contact.astro`, private).

**B · Serialized shell chain — agents that patch `Navigation.astro` / `index.astro`** (read-modify-write a shared file → concurrent dispatch trips the staleness guard `File has been modified since read`, **per-file, not per-marker**). **Launch one, wait for its return, launch the next** — each sees the previous one's insertion. Runs **alongside** batch A, not after it. The shell-patchers (today): **ecom, stores `pages-home-and-nav`, bookings, gift-cards** — exactly the packs with `nav:`/`home:` markers:
- **ecom-build** — `components` (CartView, CartBadge) → `pages` (`cart.astro`, `thank-you.astro` private, **+ CartBadge mount in `Navigation.astro` at `<!-- nav:actions -->`**).
- **stores-home-and-nav** — patch `index.astro` product grid at `<!-- home:stores -->` + `Navigation.astro` Shop submenu at `<!-- nav:links -->`. Writes no islands; pure shell-patcher.
- **bookings-build** — `components` (AvailabilityCalendar, BookingForm, ServiceBookingFlow islands; `bookingDriver.ts` + `SeoTags.astro` are pre-copied) → `pages` (`services/index.astro`, `services/[slug].astro`, `ServiceCard.astro`, `booking-confirmation.astro` private, **+ Services link in `Navigation.astro` at `<!-- nav:links -->` / services teaser in `index.astro` at `<!-- home:bookings -->`**).
- **events-build** — `components` (TicketPicker, RsvpForm islands; `eventsDriver.ts` is pre-copied) → `pages` (`events/index.astro`, `events/[slug].astro`, `EventCard.astro`, `event-confirmation.astro` private, **+ Events link in `Navigation.astro` at `<!-- nav:links -->` / events teaser in `index.astro` at `<!-- home:events -->`**).
- **gift-cards-build** — `components` (probe util, GiftCardPurchase island) → `pages` (gift-cards landing + `Navigation.astro` `<!-- nav:links -->` / `index.astro` `<!-- home:gift-cards -->`).

Cross-vertical imports (`stores-home-and-nav` importing `CategoryRail`/`ProductCard`/`utils/categories.ts`) resolve at **build time**, not write time, so they impose no write-ordering between the chain and batch A. The only ordering: (i) shell-patchers serialize against each other (per-file), (ii) everything is on disk before Build.

**C · Image Phase 2 Entity** (imagery-gated) — same batch, background. Not dispatched on `themed-blocks`. On `ai-generated` with entities in `seeded`, dispatch it; the prompt **inlines** the `seeded.<pack>` slice (entity IDs + names + descriptions) + brand context (`images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity"). It overlaps the whole wave, gated only at Build.

### Merged-agent prompt additions (per vertical)

```
Scopes (write in this order — islands/components FIRST, then pages, and a page-scope that writes a shared component before the page-scope that mounts it): <e.g. components, pages-categories, pages-products>
Files to own (absolute paths): <union of the scopes' files from the vertical's pack frontmatter>
Phase 1 Seed data: read your `seeded.<vertical>` slice from `.wix/seeded.json` (written once at the seed gate; do NOT import it into route files — use it to resolve slugs / getStaticPaths / demo content, then query the live SDK at request time). Fail loud (status: "partial", errors:[{code:"SEEDED_JSON_SLICE_MISSING", missing:"seeded.<vertical>"}]) if your slice is absent — do not render an empty page.
Styling contract: read .wix/design-tokens.css (on disk, gate-verified) for the token vocabulary — it is NOT inlined. Components do not write CSS (components-<pack>.css is already on disk, and global.css supplies the tokens to the build); use the token names only as the var(--token) / Tailwind utility vocabulary your markup references.
```

Merged agents MUST NOT:
- Modify files outside their declared scopes (the union in their prompt)
- Modify CSS (`global.css` owned by `compose.mjs`; `components-<pack>.css` is pre-copied — never authored)
- Patch a shared shell unless they are the chain agent assigned to it

---

## Wait: build wave → Build

Wait on **all** build-wave agents — batch A and the full serialized chain B — then:
- **`ai-generated`** (wave dispatched `image-phase-2-entity`): wait that handle, hard **120 s timeout** from when build agents finish; on timeout, note it and proceed. (It's been running since the wave opened, so the timeout rarely fires.) Skipping this ships previews with entity images still attaching.
- **`themed-blocks`**: no wait — proceed immediately.

Ensure the background `npm install` (`npm_handle`, waited at the seed gate) exited 0 before Build. On non-zero, follow `SETUP.md` § "npm install recovery".

## Build & Release

1. `npx @wix/cli@latest build` — on failure, inspect `.wix/debug.log`, fix, retry (§ "Build failure modes"; Astro/React build-blockers in `IMPLEMENTER.md`).
2. `npx @wix/cli@latest release` — extract the published URL from `Site published on <url>`. Also populates the **Frontend link** in headless settings natively. Transient errors (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `STATE_MISMATCH`, `temporarily unavailable`, `try again shortly`) — retry serially up to 3× with `attempt * 5`s backoff. Do **not** retry build failures — those are code bugs.

Then **Final Message** (`BUILD.md` § "Final Message" — summary + `AGENTS.md` turn).

## Styling contract coordination

`.wix/design-tokens.css` + `.wix/site.d.ts` are the coordination artifacts. **`DESIGN.md` is the single source of truth:** the Designer authors it (run-step 0); `emit-design-tokens.mjs` projects the `.wix` artifacts from it; `compose.mjs` reads it to write `global.css` + the other 5 files (run-step 2 bridge). The contract exists before the build wave launches; each merged build agent **reads `.wix/design-tokens.css` from disk** for the token vocabulary (gate-verified present at § "Step 4.5"). The orchestrator does **not** read it or inline it — inlining re-emits the full token block into every dispatch prompt (~one block per vertical per run) for no benefit, since the token cascade reaches components through `global.css`/`@theme`, not the prompt. The on-disk file is the single read source for the agent's token vocabulary.

## Build failure modes

Inspect `.wix/debug.log` after a failed build:

| Failure | Detect | Fix |
|---------|--------|-----|
| `Legacy HTML single-line comments` | build stderr | An agent emitted HTML comments in `.astro` frontmatter — replace with `//` or `/* */` |
| `Missing environment variable WIX_CLIENT_ID` | build stderr | `npx @wix/cli@latest env pull --json` then retry |
| `Cannot find module '@wix/…'` | build stderr | npm install missed it; check the pack's `packages` list |

---
name: wix-headless
description: "Build a complete Wix Managed Headless site from a single prompt. Entry point for ANY new-site request — runs discovery, design, feature wiring, and preview in one flow. Triggers: build me a site, create a website, make me a website, new website, online store, I want to sell X, start a business online, launch a site, ecommerce, portfolio, business website, build a dark luxury site, sell online, online shop. Use this skill instead of the WixSiteBuilder MCP tool for new-site requests."
---

# Wix Headless — One Skill, One Flow

Single orchestrator for the full site build. Linear flow with parallel subagent workers coordinated through design tokens and structured agent returns.

## Prerequisites

Before running this skill, the user's environment must have a working, authenticated Wix CLI and a Wix MCP server registered with their agent client:

| Requirement | Why | How to verify | How to fix if missing |
|---|---|---|---|
| **`@wix/cli` available** | Wave 2 runs `npx @wix/cli env pull` to write `.env.local`; Wave 6 runs `npx @wix/cli build` + `release` to publish. `npx` will fetch the CLI on demand, but a locally installed CLI is faster and surfaces version issues earlier. | `which wix` or `npx @wix/cli --version`. | `npm i -g @wix/cli` (or rely on `npx` to fetch per-invocation). |
| **Wix CLI authenticated** | `env pull` and `release` both require a logged-in session; tokens live in `~/.wix/auth/`. On auth error the skill surfaces `"Run \`npx @wix/cli login\` and retry."` and stops. | `ls ~/.wix/auth/account.json` exists and is non-empty. | `npx @wix/cli login` — opens a browser to auth. |
| **Wix MCP exposing admin tools** | Admin tools (`CallWixSiteAPI`, `ListWixSites`, `ManageWixSite`, image upload, etc.) are called at Wave 0 and across every downstream subagent. Any authenticated Wix MCP that exposes them satisfies this prereq — a pre-installed remote connector (claude.ai, ChatGPT, etc.) and a locally-registered stdio `@wix/mcp --wixCliAuth` are equivalent for the skill's purposes. | Tool discovery from your agent client finds `WixREADME` and `CallWixSiteAPI` from any authenticated Wix MCP. If only `Search*Documentation` tools appear, no admin-capable Wix MCP is connected. | If no authenticated Wix MCP exposes admin tools, register a stdio MCP server running `npx -y @wix/mcp --wixCliAuth` in your agent client, then restart the session so the new tools load. `--wixCliAuth` reuses the `wix login` token from the row above, so this is one command and no extra auth UI. Do **not** prompt the user to OAuth into a remote connector when this command-driven path is available. |

If any prerequisite is missing, surface the specific gap to the user and stop **before** any subagent dispatches — failing mid-flow leaves a partially scaffolded project.

### Authentication

`wix login` (and `npx @wix/cli login`) are **safe to run from a non-interactive AI-agent
environment**. When the CLI detects an AI agent it skips the interactive UI and emits
JSON events on stdout, one per line:

- `{"event":"awaiting_user","verificationUri":"...","userCode":"...","expiresInSeconds":...}`
   — surface the URL and code to the user; wait for them to complete login in their browser.
- `{"event":"success","email":"...","userId":"..."}` — login complete; resume the
   step that failed.
- `{"event":"logged_in","email":"...","userId":"..."}` — there was already a valid
   session, nothing to do.

### How to run it

Run `wix login` (or `npx @wix/cli login`) with `run_in_background: true` since it
blocks until the human finishes the browser step. Tail the output file to read the
`awaiting_user` event as soon as it appears; you'll be notified when the process
exits with the terminal event.

## Path resolution — read this first

Your CWD at runtime is the **project directory**, not the skill root. How you resolve `<SKILL_ROOT>/...` references depends on how you loaded the skill:

- **On-disk install** (`curl -O https://dev.wix.com/skills/wix-headless.tgz && tar xzf wix-headless.tgz`): this file is at `<SKILL_ROOT>/SKILL.md` on disk — strip the trailing `/SKILL.md` for the absolute path. Hold it in session scratch for the whole run. Run scripts as written: `bash <SKILL_ROOT>/scripts/X.sh` and `node "<SKILL_ROOT>/scripts/X.mjs" <args>`.
- **URL stream** (you see the agent-note preamble at the top of this file): `<SKILL_ROOT>` is `https://dev.wix.com/skills/wix-headless`. Execute scripts via process substitution:
  - `bash <SKILL_ROOT>/scripts/X.sh <args>` → `bash <(curl -s <SKILL_ROOT>/scripts/X.sh) <args>`
  - `node "<SKILL_ROOT>/scripts/X.mjs" <args>` → `curl -s <SKILL_ROOT>/scripts/X.mjs | node --input-type=module - <args>`

  Process substitution (`node <(curl ...)`) does **not** work for `.mjs` — Node sees the script as `/dev/fd/N` with no extension and refuses ESM syntax. Pipe via stdin with `--input-type=module` instead.

| What | Absolute path |
|---|---|
| Shared return contract | `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md` |
| Shared MCP prefix guide | `<SKILL_ROOT>/references/shared/MCP_PREFIX.md` |
| Production release / reserved root path sharp edges | `<SKILL_ROOT>/references/shared/PRODUCTION_SHARP_EDGES.md` |
| Per-vertical / per-scope subagent instructions | `<SKILL_ROOT>/references/<scope>/INSTRUCTIONS.md` (scopes: `stores`, `ecom`, `cms`, `blog`, `forms`, `gift-cards`, `images`, `designer`). Subagent-only — orchestrator never reads. |
| Vertical packs directory | `<SKILL_ROOT>/references/verticals/` |
| Templates directory | `<SKILL_ROOT>/templates/` |
| Scripts directory | `<SKILL_ROOT>/scripts/` |
| Shared utilities | `<SKILL_ROOT>/shared-utilities/` — copied into `src/utils/` by `seed-utilities.sh` |
| Frozen MCP-call references | `<SKILL_ROOT>/references/commands/` — `install-app.md`, `mcp-bootstrap.md`, `known-apps.json` |

**Do NOT Read subagent INSTRUCTIONS files in the orchestrator.** Pre-reading wastes ~25k tokens on a typical dispatch and pushes the orchestrator past its autocompact threshold mid-pipeline. Pass the absolute path; the subagent opens the file.

## Subagent dispatch discipline

Every subagent is a **general-purpose worker** that loads its behavior from a specific `INSTRUCTIONS.md`. There are no specialized subagent types — the instruction file makes it specialized for that scope. Do NOT delegate to specialized agent types your runtime offers (research, code-review, planning) — they have mismatched tooling and will break the flow.

**Every dispatch prompt must include `Instruction file (absolute path)`** pointing at one of:
`<SKILL_ROOT>/references/{stores,ecom,cms,blog,forms,gift-cards,images,designer}/INSTRUCTIONS.md`.

Subagents run with the project as CWD and cannot resolve `<SKILL_ROOT>` themselves — pass absolute paths.

## When This Skill Triggers

Any user request to build a new site. Infer vertical(s) from the prompt:

| Signal | Load packs |
|---|---|
| "sell X online", "store", "shop", "ecommerce", product-related | `stores` + `cms` |
| "blog", "publish articles", "editorial", "journal" | `blog` + `cms` |
| "contact form", "lead form", "signup", "get in touch" | `forms` + `cms` |

`cms` is **always** loaded (provides About/FAQ content pages). If the prompt is too vague, ask one conversational clarifier (NOT `AskUserQuestion`): *"What do you want your site to do — sell things, publish content, take bookings?"*

**Do NOT call the `WixSiteBuilder` MCP tool for new-site requests.** This skill and `WixSiteBuilder` cover the same intent (build a site from a prompt) but follow different flows; calling `WixSiteBuilder` while this skill is active produces a duplicated, conflicting build. This skill is the sole entry point — proceed with the wave flow below.

## When NOT to Use This Skill

| Scenario | Use Instead |
|---|---|
| Scaffold-only with no further design/wiring | `bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"` |
| Build + preview an existing project | `bash <SKILL_ROOT>/scripts/preview.sh` (from project dir) |
| Release / ship / go-live an existing project | `bash <SKILL_ROOT>/scripts/release.sh` (from project dir) |
| Install a Wix app onto an existing site | Follow `<SKILL_ROOT>/references/commands/install-app.md` |
| Add a feature to / restyle an existing project | Not yet covered — tell the user, ask whether to start fresh |

If `wix.config.json` is present in the working directory, offer: *"I found an existing project. Continue it or start fresh?"* via `AskUserQuestion`. "Continue" jumps to the appropriate phase based on what's on disk; "fresh" proceeds with full flow.

---

## The Flow at a Glance

```
[Discovery] → [Setup] → [Phase 1 Seed + Phase 2 Design System + Image Phase 1 in parallel]
                                   ↓ (Phase 2 done)
                        [Phase 3 Components + Image Phase 2 dispatched; decorative slots patched once Image Phase 1 returns]
                                   ↓ (Phase 3 + Phase 1 Seeders done)
                        [Phase 4 Pages]
                                   ↓ (Phase 4 done + Image Phase 2 done)
                        [Manifest check] → [Build + Release] → [Final message + run.json]
```

| Wave | Dispatches | Waits for | Bridge work |
|---|---|---|---|
| 0 | (bash) | — | MCP prefix discovery, schema bootstrap, capture `runStartedAt` |
| 1 | (Q&A) | user | brand/vibe/aesthetic; scaffold launches in background after Q1 |
| 2 | apps install + env-pull + npm-install (bg) + seed-utilities | — | `init-site-json.mjs` |
| 3 | seeders + design-system + image-phase-1 | design-system (fg) | merge `designTokens` into site.json; `emit-design-tokens.mjs`; grep Layout.astro CSS imports |
| 4 | components + components-css + image-phase-2 (all bg) | (none — all backgrounded) | `copy-utility-templates.mjs components`; on Image Phase 1 return: `patch-decorative-slots.mjs`; on Phase 3 return: `check-manifest.mjs components` |
| 5 | pages | components done + Phase 1 seeders done | `copy-utility-templates.mjs pages` |
| 6 | (bash) | pages done + image-phase-2 done | `check-manifest.mjs pages`; `release.sh`; `finalize-run-json.mjs` |

**Phase axis.** Core pipeline: `Phase 1 (Seed) → Phase 2 (Design System) → Phase 3 (Components) → Phase 4 (Pages)`. Image pipeline runs in parallel: Image Phase 1 (Decorative) alongside Phases 1–2; Image Phase 2 (Entity) alongside Phase 3 (depends only on Phase 1 Seed entity IDs + brand). Each Phase 4 agent writes its routes ONCE with both visual design and data queries — no placeholder-then-rewrite split.

**The orchestrator is the only writer of `.wix/site.json`** — it merges each Seeder's `data` block into `seeded.<vertical>` and the Designer's `data.designTokens` block into `designTokens` as subagent results arrive. Subagents never write `site.json` themselves.

### Batching compliance

Each parallel-dispatch step is **one concurrent batch** with **no narration between dispatches**. Interleaved status updates, file writes, or text like "Launching agents…" splits the batch into separate turns and adds 12–39s of inter-dispatch latency per gap. Make every subagent that doesn't block downstream work a **background subagent** (only Phase 2 Design System is foreground) — background dispatch alone gives ~2× compression by overlapping execution.

### Standard subagent prompt fields

Every dispatch prompt includes:
- `Instruction file (absolute path)` — `<SKILL_ROOT>/references/<scope>/INSTRUCTIONS.md`
- `Phase instruction` / `Scope` — exact scope string
- `MCP tool prefix` — from Wave 0, verbatim
- `Project directory (absolute path)` — project CWD
- `siteId` — from `wix.config.json`
- `Brand context` — name, vibe, aesthetic direction, colors, fonts

---

## Wave 0 — MCP bootstrap & run start

See `references/SETUP.md` § "MCP Prefix Discovery + Schema Bootstrap".

1. **Capture `runStartedAt`** via `date -u +%Y-%m-%dT%H:%M:%SZ` and hold in scratch (used at end-of-run for `run.totalSeconds`).
2. **Discover the MCP prefix** via your runtime's tool-discovery primitive: look up `WixREADME`, strip the trailing suffix from the returned name. Call `<prefix>WixREADME` to verify connectivity. On failure, stop and tell the user the Wix MCP server isn't connected.
3. **Pre-load Wix MCP tool schemas** — read `<SKILL_ROOT>/references/commands/mcp-bootstrap.md` and follow its single `ToolSearch` invocation. Capture `{ phase: "mcp-bootstrap", seconds: <duration> }` in `run.json.phases[]`.
4. Hold the prefix for the whole session. Pass it verbatim into every subagent prompt.

## Wave 1 — Discovery

See `references/DISCOVERY.md` for full mechanics.

- Infer vertical(s) from the user's opening message; if too vague, one conversational clarifier.
- **Q1** (`AskUserQuestion`): brand name. On answer, launch scaffold in background: `bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"`. Slug-derivation + timing capture rules in `references/DISCOVERY.md` § "Scaffold dispatch".
- **Q2** (`AskUserQuestion`): vibe.
- Craft a 2–3 sentence aesthetic direction in scratch (do not print standalone).
- Present the plan as markdown (Design Direction → Features → Pages → CMS Collections → Apps & SDK). **Pages, CMS Collections, and Apps & SDK MUST be markdown tables.**

  > **Before typing any table, open `references/DISCOVERY.md` § "Plan structure" and copy each section's header skeleton verbatim.** Do NOT type column headers from memory — root cause of every plan-format regression. DISCOVERY.md leads with the exact `| ... |` header to copy and a STOP cue listing wrong shapes.

- `AskUserQuestion` for approval.

## Wave 2 — Setup (one concurrent batch)

See `references/SETUP.md`. After approval, run **one concurrent batch** with no narration between operations.

1. **App install** for every entry in `apps[*]` of every loaded vertical. Follow `<SKILL_ROOT>/references/commands/install-app.md` — owns the `CallWixSiteAPI` body shape, `appName → appDefId` lookup, and recovery ladder. **An empty `apps: []` array means install nothing for that pack** — gift-cards, ecom, cms all ship `apps: []`. Do not invent an `appName` from the pack name or SDK packages. Capture `APP_INSTALL_START`/`END` via `date -u +%s` around the `CallWixSiteAPI` invocation; record `{ phase: "app-install-<appName>", seconds }`.
2. **`npx @wix/cli env pull`** (foreground, fast). Produces `.env.local` with `WIX_CLIENT_ID`. On auth error: surface `"Run \`npx @wix/cli login\` and retry."` and stop. Record `{ phase: "env-pull", seconds }`.
3. **`rm -f package-lock.json && npm install …`** as a **background shell** with the union of all loaded verticals' `packages` arrays plus the always-packages (`@wix/sdk tailwindcss @tailwindcss/vite`). Flags: `--no-fund --no-audit --legacy-peer-deps`. Bake `NPM_INSTALL_START=$(date -u +%s)` and `NPM_INSTALL_END=$(date -u +%s)` into the SAME background bash command so the values land in its output. Record `{ phase: "npm-install", seconds }` when the install finishes. **Do not add packages beyond this set** — see `SETUP.md` § anti-hallucination rule.
4. **`bash <SKILL_ROOT>/scripts/seed-utilities.sh`** — copies `<SKILL_ROOT>/shared-utilities/*.ts` (`wix-image.ts`, `analytics.ts`, `ricos.ts`) into `src/utils/` with `cp -n` and strips the Astro starter cruft. Record `{ phase: "seed-utilities", seconds }`.
5. **Memory writes** — `project` memory with brand/apps/pages/phase.
6. **User-facing roadmap × N** — emit a tracker entry per phase boundary. Target **6–8 entries**: "Install apps", "Seed data", "Design site", "Wire features", "Generate images", "Install dependencies", "Build and preview".

   > **No ampersands in roadmap titles.** Some progress trackers HTML-escape input — `"Build & preview"` renders as literal `Build &amp; preview`. Spell out "and"; same for `<`, `>`, `"`.

7. **`mkdir -p .wix`** — minimal. No `.wix/logs/`.
8. **`node "<SKILL_ROOT>/scripts/init-site-json.mjs" "$(pwd)" "<brand>" "<one-line aesthetic from Q2>" "<verticals-csv>"`** — wraps in `PHASE_START`/`PHASE_END`; record `{ phase: "init-site-json", seconds }`. Writes the canonical initial `.wix/site.json`:

   ```json
   {"brand": {"name": "...", "description": "..."}, "seeded": {}, "designTokens": {}, "verticals": ["..."]}
   ```

   `.wix/site.json` is the single source of truth that every downstream phase reads. Only the orchestrator writes — it merges Seeder `data` into `seeded.<vertical>` and Designer `data.designTokens` into `designTokens` as returns arrive.

## Wave 3 — Seed + Design System + Image Phase 1 (one concurrent batch)

Per loaded vertical:
- **Phase 1 Seeder subagent (background)**, per vertical's `seed` config. Returns its data via the standard return JSON; orchestrator merges into `.wix/site.json.seeded.<vertical>`.

Always:
- **Image Phase 1 Decorative subagent (background)**. Generates decorative images from brand context only — no Phase 1 Seed dependency. Prompt adds `Scope: image-phase-1-decorative` + page list + **`decorativeSlots: string[]`** (REQUIRED). Compose `decorativeSlots` from the canonical vocabulary in `references/designer/INSTRUCTIONS.md` § common rule #7: always `["hero", "about"]`, plus `"productsHeader"` if stores loaded, plus `"cmsHeader"` if you want a CMS page-header decorative. Designer is restricted to the same vocabulary; the two MUST match exactly.
- **Phase 2 Design System subagent (foreground)**, scope `design-system`, instruction file `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md`. Writes `global.css`, `Layout.astro`, `Navigation.astro`, `Footer.astro`, `astro.config.mjs`, `index.astro` shell, returns `designTokens` JSON.

The Designer prompt additionally requires:
- **`Navigation links: [...]`** — JSON array of `{href, label}` for top-level nav links the designer hardcodes. Compose by filtering loaded packs: include a route ONLY if its pack does not declare a `<!-- nav:links -->` entry in `contributes:`. With today's packs:
  - cms → `/about`, `/faq` are designer-owned.
  - stores → `/products` is NOT designer-owned (stores splices a Shop submenu at `<!-- nav:links -->` in Phase 4 `pages-home-and-nav`).
  - gift-cards → `/gift-cards` is NOT designer-owned (gift-cards splices a probe-gated link, AND it's `disabled: true`).
  - ecom → no nav-link routes; only `<!-- nav:actions -->` (CartBadge mount).
  - For a stores+cms+ecom+gift-cards run the list is `[{href:"/about",label:"About"},{href:"/faq",label:"FAQ"}]`. Including `/products` or `/gift-cards` produces duplicate Products+Shop links.
- **`Disabled packs: [...]`** — names of loaded packs with `disabled: true`. The designer must not add hero CTAs, footer links, or any other surfaces pointing at their routes. Without this, the designer composes a "Send a gift card" CTA pointing at `/gift-cards` even when the user hasn't enabled gift-cards.

### Bridge: post-Design System (foreground returns)

Phase 2 completes (~2–3 min). Inline orchestrator work, in this exact order:

1. **Merge `data.designTokens` into `.wix/site.json.designTokens`.**
2. **`node "<SKILL_ROOT>/scripts/emit-design-tokens.mjs" "$(pwd)"`** — deterministically projects `.wix/site.json.designTokens` → `.wix/design-tokens.css` + `.wix/site.d.ts`. Wrap in `PHASE_START`/`PHASE_END`; record `{ phase: "emit-design-tokens", seconds }`.
3. **Layout.astro CSS-import verification (mandatory).** Grep the generated `src/layouts/Layout.astro`. For every loaded vertical whose pack declares a `components` entry (stores, ecom, blog, forms), there MUST be a matching `import '../styles/components-<pack>.css'` in the frontmatter. If any is missing, **inline-patch Layout.astro now** — Phase 3 agents write `components-<pack>.css` expecting the designer to have imported it; if forgotten, every React island that uses scoped contract classes renders unstyled.

Phase 1 seeders are still running. Image Phase 1 is still running. Do not block on either — proceed to Wave 4.

## Wave 4 — Components + Image Phase 2 (one concurrent batch, all background)

Read `.wix/design-tokens.css` + `.wix/site.d.ts` once (orchestrator pastes them inline into Phase 3 prompts).

**Pre-dispatch bridge:** `node "<SKILL_ROOT>/scripts/copy-utility-templates.mjs" "$(pwd)" components` (sibling of the dispatch in the same orchestration step). Deterministically copies templated SDK-wrapper utility files for the `components` phase into `src/utils/` (today: `back-in-stock.ts` if stores loaded; `discounts.ts` if ecom loaded). Reads `.wix/site.json.verticals` to know which packs are loaded; uses `cp -n`. Wrap in `PHASE_START`/`PHASE_END`; record `{ phase: "copy-utility-templates-components", seconds }`. The hardcoded mapping (template → destination, per pack + phase) lives at the top of the script — single source of truth.

### Subagent batch

Per loaded vertical with a `components` entry:
- **Phase 3 Components subagent (background)**. Prompt includes the standard fields PLUS the **inline styling-contract JSON** (Phase 3 agents do NOT read the design-tokens contract from disk).

Per loaded vertical with a `componentsCss` entry (today: stores, ecom):
- **Phase 3 Components-CSS subagent (background)**. Same concurrent batch as the `components` sibling — TSX→CSS link is build-time via class names. Reading set is much smaller (see `<SKILL_ROOT>/references/<vertical>/COMPONENTS_CSS.md`). Skip silently for packs without this entry.

If any pack produces entities (stores products, CMS items, blog posts) AND the relevant Phase 1 Seeder has returned:
- **Image Phase 2 Entity subagent (background)**. Generates + PATCHes entity images. Prompt adds `Scope: image-phase-2-entity` + `Phase 1 Seed return data` (products, collections, blogPosts — same inline format used for Phase 4 scopes) + brand context.

  > **Gate.** If a Phase 1 Seeder is still running, hold Image Phase 2 until that seeder returns and merges. Phase 3 dispatch does not wait — Phase 3 agents don't need entity data.
  >
  > **Credit-exhaustion skip.** If Image Phase 1 returned `status: "failed"` AND any `errors[].code` matches `REQUEST_NOT_ELIGIBLE` / `INSUFFICIENT_CREDITS` / quota-exhaustion patterns (messages containing `not eligible for credits`, `quota exceeded`, `resets at`), DO NOT dispatch Image Phase 2 — both phases hit the same Wix AI credit pool. Record `{phase: "image-phase-2-entity", status: "skipped", seconds: 0, notes: "Phase 1 confirmed credit exhaustion via <code>"}` and surface in the final message ("No imagery shipped — you can upload images from the Wix dashboard"). Per-request transient errors (5xx, timeout) do NOT trigger this skip.

> **Do not enumerate files in the Phase 3 Components prompt.** The agent's INSTRUCTIONS.md and the vertical pack's `creates:` list (filtered by `phase: components`) own which files the agent writes. A hand-typed file list omits a file the pack declares, the agent skips it, downstream pages import it, build breaks.

### Bridge: post-Image-Phase-1 decorative slot patch

Phase 2 designer wrote `index.astro` with `data-decorative-slot="<key>"` placeholder `<div>`s. Once Image Phase 1 returns:

1. If Image Phase 1 returned `status: "failed"` or timed out, skip — placeholders look complete on their own. (You can also unconditionally invoke the script — it self-skips when `.wix/image-urls.md` is missing.)
2. **`node "<SKILL_ROOT>/scripts/patch-decorative-slots.mjs" "$(pwd)"`** — reads `.wix/image-urls.md`, walks `src/pages/**/*.astro`, injects `<img …class="decorative-slot-img" />` as the first child of each matching slot div. Idempotent + safe (won't clobber a div with non-`<img>` child content). JSON return: `{ status, imageUrls, filesScanned, patched, skipped, warnings }`.
3. If `warnings[]` is non-empty, append `{code: "DECORATIVE_SLOT_DIV_OCCUPIED", file, slot}` per warning to the Phase 2 Design System entry's `errors` in `run.json`. If `imageUrls[]` is non-empty but `patched[]` is empty AND `warnings[]` is empty, the designer emitted no `data-decorative-slot=` attributes at all — append `{code: "NO_DECORATIVE_SLOTS_FOUND"}`. Both non-fatal.

Wrap in `PHASE_START`/`PHASE_END`; record `{ phase: "decorative-slot-patch", seconds }`.

### Bridge: post-Phase-3 manifest check

When all Phase 3 sub-agents return: **`node "<SKILL_ROOT>/scripts/check-manifest.mjs" "$(pwd)" components "<packs-csv>"`**. Verifies every `creates:` entry tagged `phase: components` exists on disk and recovers missing files from canonical templates. JSON output: `present`, `recovered`, `missing` arrays. Exit 0 = happy or fully recoverable; exit 1 = unrecoverably missing.

For each `recovered` entry, append to `run.json.recoveries[]`. For each `missing` entry, surface the remediation hint to the user before Wave 5 dispatches — Phase 3 React islands that Phase 4 imports are critical-path; if any are unrecoverable, do NOT continue. Record `{ phase: "manifest-check-components", seconds }`.

## Wave 5 — Pages (one concurrent batch)

**Wait gate:** before dispatching, confirm:
- All Phase 1 Seeders done — data merged into `.wix/site.json.seeded.<vertical>`.
- All Phase 3 Components agents done — they've written `src/components/*` and `src/styles/components-<vertical>.css`.
- Phase 2 Design System done — `.wix/site.json.designTokens`, `.wix/design-tokens.css`, `.wix/site.d.ts` all exist.

If a Phase 1 Seeder returned without a parseable JSON block, re-request it (see `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md`) — do NOT dispatch with empty data and rely on subagents to re-query.

**Pre-dispatch bridge:** `node "<SKILL_ROOT>/scripts/copy-utility-templates.mjs" "$(pwd)" pages` — same script as Wave 4, invoked with `pages`. Today copies `templates/stores/categories.ts` → `src/utils/categories.ts` when stores loaded. Without it, `pages-products` and `pages-home-and-nav` start before `pages-categories` writes `categories.ts` and trigger spurious "missing import" recovery paths. Record `{ phase: "copy-utility-templates-pages", seconds }`.

### Subagent batch

Per loaded vertical's `pages`:
- Per-scope **Page subagent (background)**.

Example for stores + cms run:
- `product-pages` — `products/index.astro`, `products/[slug].astro`, `ProductCard.astro`
- `category-pages` — `category/[slug].astro`, `CategoryRail.astro`, `utils/categories.ts`
- `cart-checkout` — `cart.astro`, `thank-you.astro`
- `home-and-nav` — patch `index.astro` home product grid; patch `Navigation.astro` (CartBadge mount + Shop submenu insert)
- `cms-pages` — wire about + FAQ

Each prompt includes the standard fields PLUS:
- Scope string (names the files it owns)
- **`.wix/site.json` path reference (MANDATORY).** Agents read seeded data from `.wix/site.json.seeded.<vertical>`:
  - stores scopes → `.wix/site.json.seeded.stores.products` (id, name, slug, variantId, price, sku, inventory). `.wix/site.json.seeded.stores.categories` is always `[]` — categories are merchant-driven, live-queried by the frontend.
  - CMS scopes → `.wix/site.json.seeded.cms.collections`.
  - blog scopes → `.wix/site.json.seeded.blog.posts`.
  - Agents DO NOT re-query MCP — if `site.json` is missing a required key, return `status: "failed", errors: [{code: "SITE_JSON_INCOMPLETE", missing: "..."}]` rather than re-fetching. Re-querying would mask a seeder bug and adds 5–15 s per agent.
- Styling contract (full JSON inline — same pattern as Phase 3 Components).
- **ProductCard interface (for `product-pages` and `home-and-nav` only).** Both subagents touch `ProductCard.astro` — `product-pages` owns and rewrites it, `home-and-nav` reads it to wire the home grid. Tell both subagents the interface up front to eliminate the read-timing race:
  > `ProductCard.astro accepts a single prop: { product } where product is the full Wix product object from productsV3. Usage: <ProductCard product={p} />`

  Include verbatim in both prompts. Without this, `home-and-nav` reads the designer's placeholder ProductCard (which may have flat props) before `product-pages` rewrites it.

> **Image Phase 2 is NOT dispatched here.** It was launched in Wave 4; the Wave 6 hard gate waits for it before release.

## Wave 6 — Manifest check, build, release

> **HARD GATE: Do NOT invoke `release.sh` until `image-phase-2-entity` has completed or timed out (120s).** Skipping has shipped sites with no product images and `run.json` recording `image-phase-2-entity` as `"in_progress"`.

1. **Wait for ALL Phase 4 subagents AND `image-phase-2-entity`.** If Phase 4 finishes before Image Phase 2, wait up to 120s. With Image Phase 2 dispatched in Wave 4 this is usually a no-op.

   **Observability fallback.** Subagent return signals are not always reliable — silent gaps happen. If 3 minutes pass past the expected completion window with no signal, do NOT keep waiting indefinitely. Trigger the post-Phase-4 manifest check directly — if files exist, the subagents finished; if not, treat the gap as a failure and surface to the user.

   **Rate-limit recovery for `image-phase-2-entity`.** If the subagent returns `status: "failed"` with an error matching `/limit|quota|resets/i`, do NOT stall or retry the subagent. Run the inline recovery in the orchestrator: batched generate (one call) → concurrent imports (one batch) → concurrent product/CMS PATCHes (one batch). Procedure encoded in `references/shared/IMAGE_GENERATION.md`.

2. **Post-Phase-4 manifest check.** `node "<SKILL_ROOT>/scripts/check-manifest.mjs" "$(pwd)" pages "<packs-csv>"`. Same recovery rules as Phase 3 check. Surface any unrecoverable `missing[]` entries (exit code 1) before invoking release — those are page files Phase 4 didn't write that have no template fallback. Record `{ phase: "manifest-check-pages", seconds }`.

3. **Wait for npm install** — the background install from Wave 2. Wait on its handle; do not `sleep`-poll. On non-zero exit follow the recovery ladder in `references/SETUP.md` § "npm install recovery" (foreground retry with timeout, never delete the lockfile).

4. **`bash <SKILL_ROOT>/scripts/release.sh`** — runs `npx @wix/cli build` + `release`, extracts the URL from `Site published on <url>`, prints the URL on stdout. Capture build / release timings via `date -u` wrappers and record `{ phase: "build", seconds }` and `{ phase: "release", seconds }`. The script's stdout becomes `outcome.releaseUrl` in `run.json`. This populates the **Frontend link** in headless settings so transactional emails link to the deployed frontend. On build failure, surface the compiler error and stop — do NOT deploy a broken site. The script retries known transient release failures; see `<SKILL_ROOT>/references/shared/PRODUCTION_SHARP_EDGES.md` before adding custom release retry logic.

   Use `bash <SKILL_ROOT>/scripts/preview.sh` (not this step) only when the user is iterating on an existing site and explicitly asks for a fast preview without touching production.

   On non-fatal build warnings, see `<SKILL_ROOT>/references/shared/BUILD_NOISE.md` — read only if a warning surfaces.

   If the user asks for SEO root files (`robots.txt`, `llms.txt`), favicons, custom-domain verification, or batch release behavior, read `<SKILL_ROOT>/references/shared/PRODUCTION_SHARP_EDGES.md` before implementing. Wix may own these root paths at the edge, so static files and Astro routes are not always effective.

> **No standalone verify phase.** The post-phase manifest check catches missing files with auto-recovery; type/module/template errors surface from `astro build` a few seconds later.

### Post-phase manifest check — recovery rules

`<SKILL_ROOT>/scripts/check-manifest.mjs` is invoked from both Wave 4 (after Phase 3, with `phase: components`) and Wave 6 (after Phase 4, with `phase: pages`). Cost on the happy path: < 1 s per phase boundary. Recovery cost: ~10 ms per file copied from a template.

For every loaded pack, for every `creates:` entry where `phase == <given>`:
1. If the file exists → record as `present`.
2. If missing AND a template exists at `<SKILL_ROOT>/templates/<pack>/<tail>` → copy it; record as `recovered` with `{source: "template-copy", template}`.
3. Otherwise → record as `missing` with a `PHASE_FILE_MISSING` code and a remediation hint.

The script outputs JSON; the orchestrator appends `recovered[]` to `run.json.recoveries[]`, `missing[]` to `run.json.errors[]`. On any unrecoverable miss (exit 1), critical-path files (Phase 3 React islands that Phase 4 imports) → stop; optional ancillary files → log and continue.

The orchestrator never invents stub content for missing files — template-copy is the only recovery path. Stubs hide bugs (e.g. a no-op `discounts.ts` ships green builds with silently-broken discount rendering).

**Backward compat.** `PHASE4_FILE_MISSING` (used historically) remains as an alias for `{code: "PHASE_FILE_MISSING", phase: "pages"}`.

## Final message + run.json

> **No visual or browser-based verification.** After the build succeeds, do NOT open the URL in Playwright, take screenshots, or run smoke tests on your own initiative. Visual verification is opt-in only when the user explicitly requests it.

One concluding turn containing, in order:

1. **Release URL text first** — bold heading / link at the top so the user sees it immediately.
2. **Compose the draft `run.json` blob** in scratch. Aggregate every subagent return into `phases[]`, set `outcome.previewUrl`, fill `run.started` (from `runStartedAt`) / `run.ended` (capture now via `date -u`), compute `run.totalSeconds`, and compose `requiredPhases[]` — phases that MUST have a captured duration:
   - Always: `mcp-bootstrap`, `init-site-json`, `scaffold`, `env-pull`, `seed-utilities`, `emit-design-tokens`, `manifest-check-components`, `manifest-check-pages`, `decorative-slot-patch`, `npm-install`, `build`, `release` (or `preview` if `preview.sh` was used).
   - Per app installed in Wave 2: `app-install-<appName>`.
   - When `copy-utility-templates` ran: `copy-utility-templates-components` and/or `copy-utility-templates-pages`.
   - `image-phase-2-entity`'s duration arrives via its return; record from there if any pack produced entities.
3. **`echo "$RUN_JSON_DRAFT" | node "<SKILL_ROOT>/scripts/finalize-run-json.mjs" "$(pwd)"`** — applies the timing-completeness gate (any `requiredPhases` entry without a captured duration becomes `seconds: null` + `{code: "MISSING_TIMING"}` in `errors[]`), writes the canonical `.wix/run.json`, prints `{perfLine, missingTiming[]}` on stdout.
4. **Emit the perf one-liner** verbatim as the last line of the message body, from the script's `perfLine`:

   > `Built in <Nm Ss> — design-system <n>s · images (phase 1 + phase 2) <n>s · build+release <n>s`

   Three buckets only — don't dump every phase. Missing buckets render as `–` rather than fabricated. If `missingTiming[]` is non-empty, surface those names on a separate line below the perf one-liner.

Do not re-read anything from disk to compose `run.json`. Use the agent return data already in session context.

### Timing capture — required pattern

For phases the skill runs directly (`scaffold`, `app-install-*`, `env-pull`, `seed-utilities`, `npm-install`, scripts, `build`, `preview`):

```bash
PHASE_START=$(date -u +%s)
# … invoke …
PHASE_END=$(date -u +%s)
# record: { "phase": "<name>", "seconds": $((PHASE_END - PHASE_START)) }
```

For background subagents / shells, capture `PHASE_START` at dispatch time and `PHASE_END` when the result arrives — not when you check output. A missed capture = `MISSING_TIMING` in `run.json`.

For per-phase `seconds` from subagent returns: compute from the agent's `started`/`ended` fields (per `RETURN_CONTRACT.md`). If omitted, set `seconds: null` and add `{code: "MISSING_TIMING"}` rather than faking — null makes the omission visible.

### URL discipline — do not invent URLs

The final message emits **exactly two URLs**, copy-pasted verbatim:

- **Release URL** — extracted from `npx @wix/cli release` stdout, on the line `Site published on <url>`. Copy the exact string; do not retype, modify, or fill in digits from memory.
- **Dashboard URL** — `https://manage.wix.com/dashboard/<siteId>` where `<siteId>` comes from `wix.config.json`.

Do NOT emit any URL constructed by modifying the release URL (swapping subdomains, changing digits, removing path segments) or any URL not present verbatim in tool output / config. Prior failure: a run emitted `...alexp575.wix-host.com` next to the real `...alexp775.wix-host.com` — the second was typo-constructed and 404'd.

**On "going live":** the flow deploys via `release.sh`, a real production release that populates the **Frontend link** so transactional emails link to the deployed frontend. Accepting real payments still requires a paid plan + payment provider — mention if asked.

---

## Verticals

Verticals live in `references/verticals/` and declare how a vertical plugs into the flow: app installs, SDK packages, `seed`/`components`/`pages` agent configs, `creates:` and `contributes:` file-ownership.

Current verticals:
- `stores.md` — product catalog (requires `ecom`, `gift-cards`)
- `ecom.md` — vertical-agnostic cart/checkout (co-loaded via `requires`)
- `gift-cards.md` — passive pack: ships in storefront sites; lights up only when the dashboard's Wix Gift Card app is enabled
- `cms.md` — About/FAQ + use-case recipes (always loaded)
- `blog.md` — blog posts with Ricos rich content, RSS/sitemap
- `forms.md` — contact, lead, signup forms with CRM integration

`requires:` resolution: when a pack is loaded via discovery, every name in its `requires:` is also loaded transitively. Current chain: `stores → [ecom, gift-cards]` and `gift-cards → [ecom]`.

Schema: `references/verticals/_schema.md` (human-readable) and `_schema.json` (machine-validated at session start). Adding a vertical: create `references/verticals/<name>.md`, `references/<name>/INSTRUCTIONS.md`, and any per-vertical references / templates. No changes to this skill file are needed.

## Agent Return Contract

Agents return structured data in their completion message, not via sidecar files. The skill parses return JSON and merges seeders' `data` blocks into `.wix/site.json.seeded.<vertical>`. At end of run, the skill writes `.wix/run.json` — a single observability record. See `references/shared/RETURN_CONTRACT.md` for schema and aggregation rules.

## References

Skill-level:
- `references/DISCOVERY.md` — discovery flow, plan format, aesthetic direction crafting
- `references/SETUP.md` — MCP prefix, app install, env pull, npm install recovery
- `references/ORCHESTRATION.md` — phase-dispatch mechanics, wait conditions, data carry-forward
- `references/verticals/_schema.md` — vertical pack schema

Shared (with agents):
- `references/shared/RETURN_CONTRACT.md` — agent return JSON schema, run.json aggregation
- `references/shared/MCP_PREFIX.md` — prefix discovery + recovery
- `references/shared/IMAGE_GENERATION.md` — image agent contract
- `references/shared/STYLING.md` — three styling categories, ownership, decision rules
- `references/shared/IMPLEMENTER.md` — shared implementer behavior
- `references/shared/PRODUCTION_SHARP_EDGES.md` — release retries, reserved root paths, SEO files, favicons, verification

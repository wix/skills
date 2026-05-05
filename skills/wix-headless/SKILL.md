---
name: wix-headless
description: "Build a complete Wix Managed Headless site from a single prompt. Entry point for ANY new-site request — runs discovery, design, feature wiring, and preview in one flow. Triggers: build me a site, create a website, make me a website, new website, online store, I want to sell X, start a business online, launch a site, ecommerce, portfolio, business website, build a dark luxury site, sell online, online shop."
---

# Wix Headless — One Skill, One Flow

Single orchestrator for the full site build. Linear flow with parallel subagent workers coordinated through design tokens and structured agent returns.

## Path resolution — read this first

Your CWD at runtime is the **project directory** (e.g. `/Users/.../headless-projects/<brand>/`), not the skill root. Every reference this skill consumes (shared contracts, per-vertical instruction files, vertical packs, templates) lives **inside this skill**, not in your CWD.

**Compute `<SKILL_ROOT>` from this file's path.** This file is at `<SKILL_ROOT>/SKILL.md`. Strip the trailing `/SKILL.md` and you have the skill root as an absolute path. Hold it in session scratch for the whole run.

**Resolved paths you'll need** (substitute `<SKILL_ROOT>` once, use the absolute forms everywhere):

| What | Absolute path |
|---|---|
| Shared return contract | `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md` |
| Shared MCP prefix guide | `<SKILL_ROOT>/references/shared/MCP_PREFIX.md` |
| Image generation contract | `<SKILL_ROOT>/references/shared/IMAGE_GENERATION.md` |
| Stores instructions | `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` |
| Ecom instructions | `<SKILL_ROOT>/references/ecom/INSTRUCTIONS.md` |
| CMS instructions | `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md` |
| Blog instructions | `<SKILL_ROOT>/references/blog/INSTRUCTIONS.md` |
| Forms instructions | `<SKILL_ROOT>/references/forms/INSTRUCTIONS.md` |
| Gift-cards instructions | `<SKILL_ROOT>/references/gift-cards/INSTRUCTIONS.md` |
| Images instructions | `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` |
| Designer instructions | `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md` |
| Vertical packs directory | `<SKILL_ROOT>/references/verticals/` |
| Templates directory | `<SKILL_ROOT>/templates/` |
| Scripts directory | `<SKILL_ROOT>/scripts/` — bash + node helpers (`scaffold.sh`, `seed-utilities.sh`, `preview.sh`, `release.sh`, `emit-design-tokens.mjs`, `copy-utility-templates.mjs`, `patch-decorative-slots.mjs`, `init-site-json.mjs`, `check-manifest.mjs`, `finalize-run-json.mjs`) |
| Shared utilities | `<SKILL_ROOT>/shared-utilities/` — `analytics.ts`, `wix-image.ts`, `ricos.ts` — copied into `src/utils/` by `seed-utilities.sh` |
| Frozen MCP-call references | `<SKILL_ROOT>/references/commands/` — `install-app.md`, `mcp-bootstrap.md`, `known-apps.json`. These can't be bash (they invoke MCP tools) — they're frozen contracts the orchestrator reads and follows. |

**Every subagent prompt** must include `Instruction file (absolute path)` pointing at the right `INSTRUCTIONS.md` for the vertical/scope being dispatched (e.g. `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md`). Subagents run with the project as CWD too and cannot resolve `<SKILL_ROOT>` themselves.

## Subagent dispatch discipline

Every subagent in this flow is a **general-purpose worker** that loads its behavior by reading a specific `INSTRUCTIONS.md` from this skill. There are no specialized subagent types — the instruction file makes the subagent specialized for that scope.

Do NOT delegate build phases to specialized agent types your runtime offers for unrelated purposes (e.g. read-only research agents, code-review agents, planning agents). Those have restricted or mismatched tooling and WILL break the flow.

**How to avoid this:** always include `Instruction file (absolute path)` in every dispatch prompt, pointing at one of these:
- `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` — stores implementer
- `<SKILL_ROOT>/references/ecom/INSTRUCTIONS.md` — ecom implementer
- `<SKILL_ROOT>/references/cms/INSTRUCTIONS.md` — cms implementer
- `<SKILL_ROOT>/references/blog/INSTRUCTIONS.md` — blog implementer
- `<SKILL_ROOT>/references/forms/INSTRUCTIONS.md` — forms implementer
- `<SKILL_ROOT>/references/gift-cards/INSTRUCTIONS.md` — gift-cards implementer
- `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` — images agent
- `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md` — site designer (foundation + all page designers)

**Scope:** Ecommerce stores, blog, and forms (always includes CMS for content pages). Events and bookings are future verticals — the skill loads them through the same pack mechanism (`references/verticals/`) but they are not yet implemented.

## When This Skill Triggers

Any user request to build a new site. Infer the vertical(s) from the user's prompt:

| Signal in prompt | Load packs |
|------------------|-----------|
| "sell X online", "store", "shop", "ecommerce", product-related | `stores` + `cms` |
| "blog", "publish articles", "editorial", "journal" | `blog` + `cms` |
| "contact form", "lead form", "signup", "get in touch" | `forms` + `cms` |
| (future) "events", "tickets" | `events` + `cms` |
| (future) "bookings", "appointments" | `bookings` + `cms` |

`cms` is **always** loaded (provides About/FAQ content pages).

If the user's prompt is too vague to infer a vertical, ask one conversational clarifier (NOT `AskUserQuestion`): *"What do you want your site to do — sell things, publish content, take bookings?"* Keep it natural.

## When NOT to Use This Skill

| Scenario | Use Instead |
|----------|-------------|
| User asks to scaffold-only with no further design/wiring | `bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"` |
| User asks for build + preview of an existing project | `bash <SKILL_ROOT>/scripts/preview.sh` (from project dir) |
| User asks to release / ship / go-live an existing project | `bash <SKILL_ROOT>/scripts/release.sh` (from project dir) |
| User asks to install a Wix app onto an existing site | Follow `<SKILL_ROOT>/references/commands/install-app.md` |

**Not yet covered by this flow (trial scope is new-site builds):**
- Adding a feature to an existing project
- Restyling an existing site without rebuilding

For these, tell the user the workflow doesn't support it yet and ask what they want to do: start fresh with a rebuild, or wait for the feature to land. Do NOT attempt to partially handle these inside the new-site flow — that silently breaks the trial's scope.

If an existing `wix.config.json` is present in the working directory, offer: *"I found an existing project. Continue it or start fresh?"* Use `AskUserQuestion`. "Continue" resumes from the right phase based on what's already on disk; "fresh" proceeds with full flow.

---

## The Flow at a Glance

```
[Discovery] → [Setup] → [Phase 1 Seed + Phase 2 Design System + Image Phase 1 in parallel]
                                   ↓ (Phase 2 done + Phase 1 Seed done)
                        [Phase 3 Components + Image Phase 2 dispatched; orchestrator patches decorative slots once Image Phase 1 returns]
                                   ↓ (Phase 3 done)
                        [Phase 4 Pages]
                                   ↓ (Phase 4 done + Image Phase 2 done)
                        [Verify] → [Publish] → [Summary]
```

**One numbered phase axis.** The core pipeline is `Phase 1 (Seed) → Phase 2 (Design System) → Phase 3 (Components) → Phase 4 (Pages)`. The image pipeline runs in parallel: `Image Phase 1 (Decorative)` alongside Phases 1–2, `Image Phase 2 (Entity)` alongside Phase 3 (it only depends on Phase 1 Seed entity IDs + brand context, neither of which Phase 3 produces). The merged Design+Wire model eliminated the old page-designer+page-rewrite split — each vertical's Phase 4 agent now writes its routes ONCE with both visual design and data queries. No placeholder-then-rewrite pattern.

Each parallel-dispatch step is **one concurrent batch** — N subagents launched together, no narration between them. No skill-to-skill handoffs. Subagents return structured data; **the orchestrator is the only writer of `.wix/site.json`** — it merges each Seeder's `data` block into `seeded.<vertical>` and the Designer's `data.designTokens` block into `designTokens` as subagent results arrive. Subagents never write `site.json` themselves. The orchestrator also writes `.wix/run.json` at the end (see `references/shared/RETURN_CONTRACT.md`).

### Batching compliance — the biggest per-phase speedup available

If your runtime supports launching N subagents in a single concurrent step, do that. Measured runs that fail to batch — emitting subagent invocations one at a time across multiple turns — accumulate 12–39s gaps between dispatches, eating ~25–30% of each phase's window.

When sibling-batching is unavailable or unreliable, **background dispatch alone gives ~2× wall-time compression** by overlapping execution. Make every subagent that doesn't block downstream work a background subagent (only Phase 2 Design System is foreground).

**Before launching a parallel dispatch, check:**
- [ ] All N subagent invocations go in the same orchestration step.
- [ ] No status-tracker updates, file writes, or narration interleaved between them — interleaved work splits the batch into separate turns.
- [ ] No narrative text like "Launching agents…" or "Now starting Phase 4…" before or between the dispatches.

Any of those splits the batch. If you notice yourself writing narration mid-dispatch, stop, discard, and re-emit the whole batch as one step.

---

## Step 0 — MCP Prefix Discovery + Schema Bootstrap (Once per Session)

See `references/SETUP.md` § "MCP Prefix Discovery + Schema Bootstrap".

1. **Discover the MCP prefix** using your runtime's tool-discovery primitive. Look up `WixREADME`, take the returned tool name, and strip the trailing `WixREADME` — the remainder is the **MCP prefix**.
2. Call `<prefix>WixREADME` once to verify connectivity.
3. If discovery fails, stop and tell the user to ensure the Wix MCP server is connected.
4. **Pre-load Wix MCP tool schemas** — read `<SKILL_ROOT>/references/commands/mcp-bootstrap.md` and follow its single `ToolSearch` invocation. Loads every Wix MCP tool schema the build will use so the first `CallWixSiteAPI` doesn't fail on a schema-validation error. Capture timing into `.wix/run.json.phases[]` as `{ phase: "mcp-bootstrap", seconds: <duration> }`.
5. Hold the prefix for the whole session. Pass it verbatim into every subagent prompt.

## Step 1 — Discovery

See `references/DISCOVERY.md` for full mechanics. In summary:

- Infer vertical(s) from the user's opening message. If too vague, one conversational clarifier.
- **Q1** (`AskUserQuestion`): brand name. On answer, launch scaffold in background.
- **Q2** (`AskUserQuestion`): vibe.
- Craft a 2–3 sentence **aesthetic direction** in session scratch (do not print standalone).
- Present the plan as markdown (Design Direction → Features → Pages → CMS Collections → Apps & SDK). Composed from loaded verticals. **Pages, CMS Collections, and Apps & SDK MUST be markdown tables** — see `references/DISCOVERY.md` § "Plan structure".
  > **Before typing any table, open `references/DISCOVERY.md` § "Plan structure" and copy each section's header skeleton verbatim.** Do NOT type column headers from memory — that's the root cause of every plan-format regression. Each table section in DISCOVERY.md leads with the exact `| ... |` header to copy and a STOP cue listing the known wrong shapes.
- `AskUserQuestion` for approval.

Background actions kicked off during Discovery:
- Scaffold via **`bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"`** as a background shell — starts right after Q1. The orchestrator derives the slug from the brand and passes both as positional args; the script runs the pre-flight validation + `npm create @wix/new` invocation. Full slug-derivation procedure and timing capture live in `references/DISCOVERY.md` § "Scaffold dispatch".

## Step 2 — Setup

See `references/SETUP.md`. After approval, run **one concurrent batch** containing every operation below. Do not narrate between operations.

Contents (order within the batch does not matter — they are concurrent siblings):

1. **App install** for every entry in `apps[*]` of every loaded vertical. Follow `<SKILL_ROOT>/references/commands/install-app.md` — it specifies the `CallWixSiteAPI` body shape, the `appName → appDefId` lookup against `<SKILL_ROOT>/references/commands/known-apps.json`, and the strict-then-recover ladder. Don't reconstruct the endpoint or body; the reference doc owns the contract. **An empty `apps: []` array means install nothing for that pack** — the standard for passive packs (gift-cards) and SDK-only packs (ecom, cms). Do not invent an `appName` from the pack name, the `requires:` chain, or the SDK packages.

   > **Example.** Loaded packs `[stores, ecom, gift-cards, cms]`: `stores.apps = [{name: "Wix Stores"}]`, `ecom.apps = []`, `gift-cards.apps = []`, `cms.apps = []`. Total app installs: **one**, not four. Gift Cards lights up only when the user enables it from the Wix dashboard — gift-cards.md says `apps: []  # do NOT auto-install`. Installing it without user opt-in is a privacy violation, not just an inconvenience.

   > **Timing capture (mandatory).** App install is an MCP call (not bash), so the orchestrator captures timing on its side: capture `APP_INSTALL_START` via `date -u +%s` immediately before the `CallWixSiteAPI` invocation (same orchestration step / concurrent batch), then `APP_INSTALL_END` as soon as the call returns. Record into `run.json.phases[]` as `{ phase: "app-install-<appName>", seconds: <duration> }`. Without this, the timing-completeness gate in Step 9 logs a `MISSING_TIMING` error.
2. **Pull `.env.local`** — `npx @wix/cli env pull` (foreground, fast). Produces `.env.local` with `WIX_CLIENT_ID`. Append `{ phase: "env-pull", seconds: <duration> }` to `run.json.phases[]`. On auth error: surface `"Run \`npx @wix/cli login\` and retry."` and stop.
3. **`rm -f package-lock.json && npm install …`** as a **background shell** — with the union of all loaded verticals' `packages` arrays, plus the always-packages (`@wix/sdk tailwindcss @tailwindcss/vite`). Flags: `--no-fund --no-audit --legacy-peer-deps`. The scaffold runs with `--skip-install`, so delete the stale lockfile before installing.

   > **Do not add any package beyond this set.** See SETUP.md for the full anti-hallucination rule. Don't invent packages from pack names — `@wix/gift-cards` doesn't exist on npm; gift-cards is runtime-detected via REST.

   > **Timing capture (mandatory).** Bake `NPM_INSTALL_START=$(date -u +%s)` into the bash command itself, before the install, and capture `NPM_INSTALL_END=$(date -u +%s)` after — both lines inside the SAME background bash command so the values land in its output. When the install finishes, parse the END-START delta and record `{ phase: "npm-install", seconds: <duration> }`. An earlier run forgot this and emitted `MISSING_TIMING` for the install phase.
4. **`bash <SKILL_ROOT>/scripts/seed-utilities.sh`** — copies the skill's `<SKILL_ROOT>/shared-utilities/*.ts` (`wix-image.ts`, `analytics.ts`, `ricos.ts`) into `src/utils/` with `cp -n` (never overwrites) and strips the Astro starter cruft (`Welcome.astro` + marketing SVGs). Needed regardless of which verticals load. Append `{ phase: "seed-utilities", seconds: <duration> }` to `run.json.phases[]`.
5. **Memory writes** — `project` memory with brand/apps/pages/phase.
6. **User-facing roadmap × N** — emit a tracker entry for each phase boundary. Target **6–8 entries**, not 13. Map to the phase boundaries:
   - "Install apps" (completed immediately)
   - "Seed data" (Seed phase)
   - "Design site" (Design System phase)
   - "Wire features" (Components + Pages phases)
   - "Generate images"
   - "Install dependencies"
   - "Build and preview"

   > **No ampersands in roadmap titles.** Some progress trackers HTML-escape the input — `"Build & preview"` renders as literal `Build &amp; preview`. Spell out "and" or restructure to avoid `&` entirely. Same applies to any `<`, `>`, `"` or other HTML-meaningful characters.
7. **`mkdir -p .wix`** — minimal. No `.wix/logs/`.
8. **Run the init-site-json helper** to write the canonical initial shape of `.wix/site.json`:

   ```bash
   PHASE_START=$(date -u +%s)
   node "<SKILL_ROOT>/scripts/init-site-json.mjs" "$(pwd)" "<brand>" "<one-line aesthetic description from Q2>" "<verticals-csv>"
   PHASE_END=$(date -u +%s)
   ```

   `<verticals-csv>` is the comma-separated loaded-pack list (e.g. `stores,ecom,cms,gift-cards`). The script encodes the shape (brand + seeded + designTokens + verticals) once; the orchestrator no longer composes JSON inline. Append `{ phase: "init-site-json", seconds: $((PHASE_END - PHASE_START)) }` to `run.json.phases[]`.

   The resulting file:

   ```json
   {
     "brand": { "name": "<brand>", "description": "<...>" },
     "seeded": {},
     "designTokens": {},
     "verticals": ["<name>", ...]
   }
   ```

   `.wix/site.json` is the single source of truth that every downstream phase reads. **Only the orchestrator writes** — agent merges happen here, not in agents. Later phases extend this file via the orchestrator: when a Seeder returns, the orchestrator merges its return `data` into `seeded.<vertical>`; when the Designer returns, the orchestrator merges its return `data.designTokens` into `designTokens`. Downstream phases read paths under this file instead of receiving data inline.

## Step 3 — Launch Phase 1 (Seed) + Phase 2 (Design System) + Image Phase 1 (Decorative)

One concurrent batch. Launch all subagents below in a single dispatch step, no narration between them.

For each loaded vertical:
- **Phase 1 Seeder subagent** (background), per vertical's `seed` config. When it returns, merge its `data` block into `.wix/site.json` under `seeded.<vertical>` — downstream phases read from there instead of re-receiving the data inline.

Always:
- **Image Phase 1 Decorative subagent** (background). Generates decorative images with brand context only; no Phase 1 Seed dependency. Prompt includes standard fields + `Scope: image-phase-1-decorative` + brand context + page list + **`decorativeSlots: string[]`** (REQUIRED — the exact slot keys the image agent must produce). Compose `decorativeSlots` from the canonical vocabulary in `references/designer/INSTRUCTIONS.md` § common rule #7: always `["hero", "about"]`, plus `"productsHeader"` if the stores pack loaded, plus `"cmsHeader"` if you want a CMS page-header decorative. Do NOT pass invented keys — the designer is restricted to the same vocabulary; the two must match exactly. See `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` § "Scope: image-phase-1-decorative".
- **Phase 2 Design System subagent** (foreground), **scope `design-system`**. Instruction file: `<SKILL_ROOT>/references/designer/INSTRUCTIONS.md`. Writes `global.css`, `Layout.astro`, `Navigation.astro`, `Footer.astro`, `astro.config.mjs`, `index.astro` shell, and returns its `designTokens` in the standard return `data` block. When it returns, the orchestrator merges `designTokens` into `.wix/site.json.designTokens` AND runs `node "<SKILL_ROOT>/scripts/emit-design-tokens.mjs"` to deterministically project the JSON into `.wix/design-tokens.css` + `.wix/site.d.ts` (the agent does not write those two files — see Step 4).

  > **`.wix/site.json` write contract.** Only the orchestrator writes `site.json`. Each Phase 1 Seeder returns its data via the standard return JSON block; the Designer returns its `designTokens` the same way. As subagent results arrive, the orchestrator merges the return `data` into the appropriate slot (`seeded.<vertical>` for seeders, `designTokens` for the designer). No subagent writes `site.json` directly — this eliminates parallel-write races between seeders and the designer.

**Image Phase 2 (entity images) is NOT dispatched here.** It's dispatched in Step 4.5 (alongside Phase 3 Components, after Phase 2 Design System and the relevant Phase 1 Seeders return) with Phase 1 Seed return data inline — see `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity". It does not depend on Phase 3 or Phase 4 outputs (only on Phase 1 Seed entity IDs + brand context), so launching it in Step 4.5 lets it overlap entirely with Phase 3 Components instead of becoming a post-Phase-4 tail blocker.

**Phase 3 Components is NOT dispatched here.** It's dispatched in Step 4.5 (after Phase 2 Design System completes) with the design tokens pasted inline — see § "Styling contract coordination" in `references/ORCHESTRATION.md` for rationale.

Every agent prompt must include:
- `Phase instruction` — exact phase/scope string
- `Instruction file (absolute path)` — resolved absolute path to `<SKILL_ROOT>/references/<vertical>/INSTRUCTIONS.md` (per "Path resolution" at the top of this file). The subagent reads this file in full before doing anything else. Never leave as a `<skill>/…` placeholder — the subagent cannot resolve it.
- `MCP tool prefix` — from Step 0, verbatim
- `Project directory (absolute path)` — the project CWD absolute path
- `siteId` — from `wix.config.json`
- `Brand context` — name, vibe, aesthetic direction, colors, fonts

The Designer prompt (`scope: design-system`) additionally requires:

- `Navigation links: [...]` — JSON array of `{href, label}` for the top-level nav links the designer hardcodes. **Compose by filtering loaded packs:** include a route ONLY if its pack does not declare a `<!-- nav:links -->` entry in `contributes:`. Concretely with today's packs:
  - cms → `/about`, `/faq` are designer-owned (cms `contributes: []` for nav).
  - stores → `/products` is NOT designer-owned (stores splices a Shop submenu at `<!-- nav:links -->` in Phase 4 `pages-home-and-nav`).
  - gift-cards → `/gift-cards` is NOT designer-owned (gift-cards splices a probe-gated link at `<!-- nav:links -->`, AND it's `disabled: true`).
  - ecom → no nav-link routes; ecom only contributes at `<!-- nav:actions -->` (CartBadge mount).
  - For a stores+cms+ecom+gift-cards run the list is `[{href:"/about",label:"About"},{href:"/faq",label:"FAQ"}]` only. Do NOT include `/products` or `/gift-cards` — passing them to the designer AND letting stores splice at `<!-- nav:links -->` produces duplicate Products+Shop links.
- `Disabled packs: [...]` — names of loaded packs with `disabled: true`. The designer must not add hero CTAs, footer links, or any other surfaces pointing at their routes. For a stores-loaded run this is `["gift-cards"]` (transitive via stores' `requires:`). Without this, the designer composes a "Send a gift card" CTA pointing at `/gift-cards` even when the user hasn't enabled the gift-cards app.

## Step 4 — Wait for Phase 2 (Design System), Merge Tokens, Emit Derived Files

Phase 2 completes (~2–3 min). It writes `global.css`, `astro.config.mjs`, `Layout.astro`, `Navigation.astro`, `Footer.astro`, `index.astro`, AND returns its `designTokens` JSON in the standard return block.

**Inline orchestrator work (in this exact order — do NOT skip a step):**

1. **Merge `data.designTokens` into `.wix/site.json.designTokens`.** The designer never writes `site.json` itself; the orchestrator owns the merge.
2. **Run the emit-design-tokens helper:**

   ```bash
   PHASE_START=$(date -u +%s)
   node "<SKILL_ROOT>/scripts/emit-design-tokens.mjs" "$(pwd)"
   PHASE_END=$(date -u +%s)
   ```

   Deterministically projects `.wix/site.json.designTokens` → `.wix/design-tokens.css` (CSS custom properties, one rule per token) and `.wix/site.d.ts` (TypeScript types). No LLM in the loop — same JSON in, same files out, every time. Append `{ phase: "emit-design-tokens", seconds: $((PHASE_END - PHASE_START)) }` to `run.json.phases[]`.

   > **Why this stopped being agent work.** Both files are pure projections of `designTokens` JSON — no judgment, no brand-context-dependence — so an LLM emitting them is wasted tokens AND a drift risk (malformed `:root` blocks, missing token groups, divergent .d.ts skeletons).

Phase 1 seeders are still running. The image agent is still running. Do not block on either — proceed directly to Step 4.5.

### Layout.astro CSS-import verification (mandatory)

Before launching Step 4.5, **grep the generated `src/layouts/Layout.astro`** to confirm every required component CSS file is imported. For every loaded vertical whose pack declares a `components` entry (stores, ecom, blog, forms — anything in `components:` of the vertical pack), there MUST be a matching `import '../styles/components-<pack>.css'` in the Layout frontmatter.

If any is missing, **inline-patch Layout.astro now** — do not rely on Phase 3 Components agents to notice, and do not proceed to Step 4.5 with a broken Layout. Phase 3 agents write `components-<pack>.css` to disk expecting the Phase 2 designer to have imported it; if the designer forgot, every React island that uses scoped contract classes (quantity selectors, variant pills, cart badges, cart line items) renders unstyled in production.

## Step 4.5 — Launch Phase 3 (Components) + Image Phase 2 (Entity) — background, contract-in-prompt

Immediately after Phase 2 returns, read `.wix/design-tokens.css` + `.wix/site.d.ts` once.

### Pre-dispatch: deterministic utility-template copies

Before dispatching Phase 3 subagents, run the copy-utility-templates helper for the `components` phase:

```bash
PHASE_START=$(date -u +%s)
node "<SKILL_ROOT>/scripts/copy-utility-templates.mjs" "$(pwd)" components
PHASE_END=$(date -u +%s)
```

This deterministically copies the templated SDK-wrapper utility files for the `components` phase into `src/utils/` (today: `back-in-stock.ts` if stores loaded; `discounts.ts` if ecom loaded). The script reads `.wix/site.json.verticals` to know which packs are loaded and uses `cp -n` semantics (never overwrites existing files).

These utilities are **mechanical SDK wrappers** with the same shape regardless of brand — having an LLM regenerate them costs tokens and risks drift (e.g. shipping a no-op stub that breaks downstream features silently). Pre-copying removes them from the agent's writes list entirely; the agent imports the helpers at known paths. The hardcoded mapping (template → destination, per pack + phase) lives at the top of `<SKILL_ROOT>/scripts/copy-utility-templates.mjs` — that file is the single source of truth.

`utils/categories.ts` is also a templated utility but belongs to `phase: pages` — it gets pre-copied in Step 7 via `node <SKILL_ROOT>/scripts/copy-utility-templates.mjs "$(pwd)" pages`, not here.

Run the helper as a sibling of the Phase 3 dispatch in the same orchestration step (the `cp` is fast and can't conflict with subagents that haven't started yet). Append `{ phase: "copy-utility-templates-components", seconds: $((PHASE_END - PHASE_START)) }` to `run.json.phases[]`.

The post-Phase-3 manifest check still runs and still uses `cp -n` recovery as a safety net for any template that wasn't pre-copied (e.g. when a future vertical adds a templated file but the script's mapping hasn't been updated yet).

### Subagent batch

For each loaded vertical with a `components` entry:
- **Phase 3 Components subagent** (background), per vertical's `components` config. Prompt includes all standard fields (see Step 3) PLUS the inline styling-contract JSON. Phase 3 agents do NOT read the design-tokens contract from disk — pass the **full contract contents pasted inline**.

If any pack produces entities (stores products, CMS items, blog posts) AND the relevant Phase 1 Seeder has returned:
- **Image Phase 2 Entity subagent** (background). Generates + PATCHes entity images. Prompt includes standard fields + `Scope: image-phase-2-entity` + `Phase 1 Seed return data` (products, collections, blogPosts — same inline format used for Phase 4 scopes) + brand context. See `<SKILL_ROOT>/references/images/INSTRUCTIONS.md` § "Scope: image-phase-2-entity".

  > **DO NOT paste a PATCH/Update body template into the image subagent's prompt.** The subagent's INSTRUCTIONS.md owns the recipe per entity type (Products, Blog Posts, CMS Items) — it knows the exact write-shape (`media.itemsInfo.items[].url` + echoed `options`/`variantsInfo` + `revision`, no `fieldMask`) and the failure-mode mappings. Pasting an inline template causes drift; the wrong shape (e.g. `media.main.image` + `fieldMask`) returns `400 "Expected an object"` on every product. Trust the subagent — pass `Phase 1 Seed return data` and `Brand context` only.

  > **Gate.** If a Phase 1 Seeder is still running when this batch is dispatched, hold Image Phase 2 back until that seeder returns and merges into `.wix/site.json.seeded.<vertical>`. Phase 3 dispatch does not wait — Phase 3 agents don't need entity data. Image Phase 2 needs entity IDs, names, descriptions; without them the prompt has nothing to do. Phase 1 Seeders typically finish well before Phase 2 DS, so this gate rarely fires — but state it explicitly to keep the contract honest.

> **Do not enumerate files in the Phase 3 Components prompt.** The agent's INSTRUCTIONS.md and the vertical pack's `creates:` list (filtered by `phase: components`) are the source of truth for which files the agent must write. Pass brand context, design tokens, and the inline styling-contract — let the agent decide which files to write.
>
> Why: a hand-typed file list can omit a file the pack's `creates:` declares. The agent then follows the prompt, skips the file, downstream pages import it, build breaks. Trust the pack's own declaration over a hand-typed file list in the prompt.
>
> **Wrong:**
> > Files to write: src/components/CartBadge.tsx, src/components/CartLine.tsx, src/styles/components-ecom.css
>
> **Right:** (no file list — let the agent's INSTRUCTIONS.md own it)
> > Brand context: ...
> > Design tokens (inline JSON): ...
> > Styling contract: ...

This dispatch can share its batch with any progress-tracker updates marking Phase 1 items in progress — keep narration out so the batch stays intact. By launching here (not concurrently with Phase 2), we eliminate the contract-race failure mode without adding to the critical path (Phase 4 already gates on Phase 2).

### Post-Phase-3 manifest check

When all Phase 3 sub-agents return, run the manifest-check helper:

```bash
PHASE_START=$(date -u +%s)
node "<SKILL_ROOT>/scripts/check-manifest.mjs" "$(pwd)" components "<packs-csv>"
PHASE_END=$(date -u +%s)
```

The script verifies every `creates:` entry tagged `phase: components` exists on disk and recovers missing files from canonical templates. JSON output: `present`, `recovered`, `missing` arrays. Exit code: 0 if happy or fully recoverable, 1 if any file is unrecoverably missing.

For each `recovered` entry, append to `run.json.recoveries[]` (the orchestrator merges these into the final `.wix/run.json`). For each `missing` entry (exit 1), surface the remediation hint to the user before Phase 4 dispatches — Phase 3 React islands that Phase 4 imports are critical-path; if any are unrecoverable, do NOT continue. Append `{ phase: "manifest-check-components", seconds: $((PHASE_END - PHASE_START)) }` to `run.json.phases[]`.

## Step 4.6 — Post-Phase-2 Decorative Slot Patch

Phase 2 Design System and Image Phase 1 run concurrently from Step 3. The Phase 2 designer writes `index.astro` with `data-decorative-slot="<key>"` placeholder `<div>`s (see `references/designer/INSTRUCTIONS.md` § common rule #7) instead of trying to race-read `.wix/image-urls.md`. This step injects the resolved decorative images once Image Phase 1 returns — deterministic, scripted, no LLM, no extra subagent dispatch.

**Order:**
1. Dispatch Step 4.5 (Phase 3 Components) first — those subagents don't need images, so they start running in the background while this step proceeds.
2. Wait for the Image Phase 1 result. If it returned `status: "failed"` or timed out at 120s, skip the injection and continue — slot placeholders already look complete on their own. (You can also unconditionally invoke the script in step 3 — it self-skips when `.wix/image-urls.md` is missing.)
3. Run the patch-decorative-slots helper:

   ```bash
   PHASE_START=$(date -u +%s)
   node "<SKILL_ROOT>/scripts/patch-decorative-slots.mjs" "$(pwd)"
   PHASE_END=$(date -u +%s)
   ```

   The script reads `.wix/image-urls.md`, walks `src/pages/**/*.astro`, and injects `<img src="<url>" alt="" loading="lazy" decoding="async" class="decorative-slot-img" />` as the first child of each matching slot div. It is fully idempotent (re-running a patched file is a no-op) and safe (won't clobber a div that already has child content other than `<img>`). JSON return shape: `{ status, imageUrls, filesScanned, patched, skipped, warnings }`.

4. **Read the script's JSON output.** If `warnings[]` is non-empty (some divs had child content the script refused to clobber), append `{code: "DECORATIVE_SLOT_DIV_OCCUPIED", file, slot}` per warning to the Phase 2 Design System entry's `errors` array in `run.json` — designer drift, but doesn't fail the run. If `imageUrls[]` is non-empty but `patched[]` is empty AND `warnings[]` is empty, the designer emitted no `data-decorative-slot=` attributes at all — append `{code: "NO_DECORATIVE_SLOTS_FOUND"}` instead (also non-fatal; placeholders still render).

**Budget:** O(slots) edits — typically 3–5 per site, < 1 s of script time. Append timing to `.wix/run.json.phases[]` as `{ phase: "decorative-slot-patch", seconds: <duration> }`.

**Why a script and not a subagent.** Injecting an `<img>` into a known attribute is deterministic: no LLM. A subagent adds a dispatch gap (12–39 s), re-reads the file from disk, and creates another coordination contract. The slot mechanism was designed to be patched mechanically; the script encodes that mechanism canonically.

## Step 5 — (removed — Design+Wire merged into Phase 4)

Earlier flow had a separate page-designer dispatch that wrote `.astro` files with placeholder data, followed by a page-rewrite dispatch that swapped placeholders for live queries. That double-write is gone: each vertical's Phase 4 agent now writes its routes ONCE with both visual design and data queries, going straight from Phase 3 Components to Phase 4 Pages.

## Step 6 — Wait for Phase 3 (Components) + Phase 1 (Seed)

Before Phase 4 (Pages), confirm:
- **All Phase 1 Seeders done** — their data has been merged into `.wix/site.json.seeded.<vertical>`. Phase 4 agents read from there.
- **Phase 3 Components agents done** — they've written `src/components/*` and `src/styles/components-<vertical>.css`. Phase 4 files will import them.
- **Phase 2 Design System agent done** — `.wix/site.json.designTokens`, `.wix/design-tokens.css`, `.wix/site.d.ts` all exist. Phase 4 agents reference them.

If any of these is still running, wait for its result. Do NOT proceed to Phase 4 until all three are in hand.

## Step 7 — Launch Phase 4 (Pages)

One concurrent batch. Launch all per-scope page subagents below in a single dispatch step, no narration between them.

> **Image Phase 2 is NOT dispatched here.** It was launched earlier in Step 4.5, alongside Phase 3 Components, because it only depends on Phase 1 Seed entity IDs + brand context — not on Phase 3 outputs and not on Phase 4 outputs. By the time this step runs, Image Phase 2 is typically already done or in its tail. The hard gate in Step 8 still waits for it (in the rare case it isn't done yet) before invoking the release script.

### Pre-dispatch: deterministic utility-template copies

Before dispatching Phase 4 subagents, run the copy-utility-templates helper for the `pages` phase:

```bash
PHASE_START=$(date -u +%s)
node "<SKILL_ROOT>/scripts/copy-utility-templates.mjs" "$(pwd)" pages
PHASE_END=$(date -u +%s)
```

Same script as Step 4.5, just invoked with the `pages` phase — today it copies `templates/stores/categories.ts` → `src/utils/categories.ts` when the stores pack is loaded. Append `{ phase: "copy-utility-templates-pages", seconds: $((PHASE_END - PHASE_START)) }` to `run.json.phases[]`.

Pre-copying eliminates a cross-pack file race: without it, `pages-products` and `pages-home-and-nav` start before `pages-categories` writes `categories.ts` and trigger spurious "missing import" recovery paths. With the orchestrator pre-copying, all three stores Phase 4 subagents see the helper from the first second.

Capture timing into `.wix/run.json.phases[]` as `{ phase: "copy-utility-templates-pages", seconds: <duration> }`. The post-Phase-4 manifest check still runs and still treats template-copy as a recovery path for any pack-declared file that wasn't pre-copied.

### Subagent batch

For each loaded vertical's `pages`:
- Per-scope **Page subagent** (background).

Example for stores + cms run:
- `product-pages` — `products/index.astro`, `products/[slug].astro`, `ProductCard.astro`
- `category-pages` — `category/[slug].astro`, `CategoryRail.astro`, `utils/categories.ts`
- `cart-checkout` — `cart.astro`, `thank-you.astro`
- `home-and-nav` — patch `index.astro` home product grid, patch `Navigation.astro` (CartBadge mount + Shop submenu insert)
- `cms-pages` — wire about + FAQ

Each subagent prompt includes:
- Scope string (names the files it owns)
- **`.wix/site.json` path reference (MANDATORY — never omit).** Agents read seeded data from `.wix/site.json.seeded.<vertical>`:
  - For stores scopes (`pages-products`, `pages-categories`, `pages-cart-checkout`, `pages-home-and-nav`): read `.wix/site.json.seeded.stores.products` — the list the stores seeder wrote in Step 3 (id, name, slug, variantId, price, sku, inventory). `.wix/site.json.seeded.stores.categories` is always `[]` — the stores seeder no longer creates categories; they're merchant-driven, and the Phase 4 frontend live-queries the API for them. The empty key is retained for shape stability.
  - For CMS scopes (`pages`): read `.wix/site.json.seeded.cms.collections` — the collection map the CMS seeder wrote.
  - For blog scopes (`pages`): read `.wix/site.json.seeded.blog.posts`.
  - Agents DO NOT re-query MCP for this data. If `site.json` is missing a required key, fail fast (`status: "failed"`, `errors: [{code: "SITE_JSON_INCOMPLETE", missing: "seeded.stores.products"}]`) rather than re-fetching — it means the seeder didn't return correctly and re-querying would mask the real bug.
  - Agents **do not re-query MCP for this data** — they read it from `.wix/site.json`. Re-querying adds 5–15s per agent and risks stale reads.
- Styling contract (full JSON inline — same pattern used in Step 4.5 Phase 3 Components).
- **ProductCard interface (for `product-pages` and `home-and-nav` only).** Both subagents touch `ProductCard.astro` — `product-pages` owns and rewrites it, `home-and-nav` reads it to wire the home grid. Since they run concurrently, tell both subagents the interface up front to eliminate the read-timing race:
  > `ProductCard.astro accepts a single prop: { product } where product is the full Wix product object from productsV3. Usage: <ProductCard product={p} />`
  
  Include this verbatim in both prompts. This prevents the observed failure where `home-and-nav` reads the designer's placeholder ProductCard (which may have flat props) before `product-pages` rewrites it to the object interface.
- Project directory (absolute path)

**Do not dispatch Phase 4 if you don't have Phase 1 Seed returns parsed.** If a Phase 1 Seeder is still running at Step 6, wait. If a Phase 1 Seeder returned without a parseable JSON block, re-request it (see `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md`) — do not dispatch Phase 4 with empty data and rely on subagents to re-query.

## Step 8 — Wait for Phase 4 + Image Phase 2 → Manifest Check → Release

> **HARD GATE: Do NOT invoke `release.sh` until `image-phase-2-entity` has completed or timed out (120s).** Image Phase 2 is dispatched in Step 4.5, so by Step 8 it's typically already done. The gate stays in place anyway: skipping it has shipped sites with no product images and `run.json` recording `image-phase-2-entity` as `"in_progress"`.

0. **Wait for ALL Phase 4 subagents AND `image-phase-2-entity`.** If Phase 4 finishes before Image Phase 2, wait up to 120s. Without this wait, the deployed site shows empty image placeholders on products. See `references/ORCHESTRATION.md` § "Wait: Phase 4 → Release". This wait is usually a no-op since Image Phase 2 starts in Step 4.5; it still fires correctly when Phase 1 Seed was unusually fast and Image Phase 2 ran longer than usual.

   **Observability fallback.** Subagent return signals are not always reliable — silent gaps happen. If 3 minutes pass past the expected completion window (use the longest Phase 4 subagent's p95 as the baseline) with no signal, do NOT keep waiting indefinitely. Trigger the post-Phase-4 manifest check directly — if the files exist, the subagents finished; if they don't, treat the gap as a failure and surface it to the user.

   **Rate-limit recovery for `image-phase-2-entity`.** If the image-phase-2 subagent returns `status: "failed"` with an error matching `/limit|quota|resets/i` (e.g. "You've hit your limit · resets 1pm"), do NOT stall or retry the subagent. Run the inline recovery path in the orchestrator: batched generate (one call) → concurrent imports (one batch) → concurrent product/CMS PATCHes (one batch). The full procedure is encoded in `references/shared/IMAGE_GENERATION.md`; the same shape works when the orchestrator runs it directly.

1. **Post-Phase-4 manifest check.** Run:

   ```bash
   PHASE_START=$(date -u +%s)
   node "<SKILL_ROOT>/scripts/check-manifest.mjs" "$(pwd)" pages "<packs-csv>"
   PHASE_END=$(date -u +%s)
   ```

   Same script and recovery rules as the post-Phase-3 check above, but with `phase: pages`. Append `recovered[]` entries to `run.json.recoveries[]`; surface any `missing[]` entries (exit code 1) to the user before invoking the release script — these are page files Phase 4 didn't write that have no template fallback, which means the build will break. Append `{ phase: "manifest-check-pages", seconds: $((PHASE_END - PHASE_START)) }` to `run.json.phases[]`.

2. **Wait for npm install** — the background install from Step 2 should be done or nearly done. Wait on the background process's handle (or whatever long-running-task signal your runtime provides); do not `sleep`-poll. On non-zero exit, follow the recovery ladder in `references/SETUP.md` § "npm install recovery" (foreground retry with timeout, never delete the lockfile).

3. **Run `bash <SKILL_ROOT>/scripts/release.sh`** — runs `npx @wix/cli build` + `release`, extracts the released URL from `Site published on <url>`, prints the URL on stdout. The orchestrator captures build / release timings via `date -u` wrappers and records them as `{ phase: "build", seconds: ... }` and `{ phase: "release", seconds: ... }`. The script's stdout becomes `outcome.releaseUrl` in `run.json`. This populates the **Frontend link** in headless settings so transactional emails link to the deployed frontend out of the box. `astro build` is the catch-all for type/template/Tailwind/missing-module errors that the post-phase manifest checks couldn't catch (those checks cover only pack-declared files). On build failure, surface the underlying compiler error to the user and stop — do NOT deploy a broken site.

   Use `bash <SKILL_ROOT>/scripts/preview.sh` (not this step) only when the user is iterating on an existing site and explicitly asks for a fast preview without touching production.

   > **Known build-output noise — do not chase these.** A clean build emits a few warnings that are NOT real failures and don't need investigation:
   > - **`Astro.request.headers used on prerendered page`** — emitted by the `@wix/astro` integration's middleware on every prerendered route. The warning is internal to the integration, not from skill-emitted code. Ignore.
   > - **`Failed to resolve dependency: @wix/stores, present in client 'optimizeDeps.include'`** — Vite warning. The integration speculatively lists `@wix/stores` in `optimizeDeps` regardless of whether the project depends on it. Harmless.
   >
   > Do NOT add filters, edit config, or attempt to silence these — they're upstream and stable. Surface to the user only if a real build failure needs context.

> **No standalone verify phase.** The post-phase manifest check (§ below) catches the missing-file class with auto-recovery; everything else (type errors, missing modules, template errors) is caught by `astro build` a few seconds later. Trade-off accepted: typo'd internal links and missing env vars surface at first runtime hit rather than pre-deploy — both produce reasonably clear errors (404 / SDK exception).

## Post-phase manifest check

Implemented as `<SKILL_ROOT>/scripts/check-manifest.mjs`, invoked from both Step 4.5 (after Phase 3 Components, with `phase: components`) and Step 8 (after Phase 4 Pages, with `phase: pages`). Cost on the happy path: < 1 s per phase boundary. Recovery cost: ~10 ms per file copied from a template.

Invocation:

```bash
node "<SKILL_ROOT>/scripts/check-manifest.mjs" "$(pwd)" "<phase>" "<packs-csv>"
```

The recovery rules in summary:

For every loaded pack, for every `creates:` entry where `phase == <given>`:
1. If the file exists → record as `present`.
2. If missing AND a template exists at `<SKILL_ROOT>/templates/<pack>/<tail>` (where `<tail>` is the path under `src/pages/` for page files, basename for everything else) → copy it; record as `recovered` with `{source: "template-copy", template}`.
3. Otherwise → record as `missing` with a `PHASE_FILE_MISSING` code and a remediation hint.

The script outputs JSON; the orchestrator reads it and:
- Appends each `recovered[]` entry to `run.json.recoveries[]`.
- Appends each `missing[]` entry to `run.json.errors[]`.
- On any unrecoverable miss (script exit 1), surfaces the remediation to the user. Critical-path files (Phase 3 React islands that Phase 4 imports) → stop. Optional ancillary files → log and continue.

**Backward compatibility.** The error code `PHASE4_FILE_MISSING` (used historically for the post-Phase-4 check) remains as an alias for `{code: "PHASE_FILE_MISSING", phase: "pages"}` so existing `run.json` consumers continue working.

**Why a script (not inline orchestrator work).**
- Recovery rules (path mapping for `src/pages/` vs everything else, template-copy semantics, exit-code contract) are canonical and testable independently of the skill prose.
- Locks in the structural invariant that the orchestrator never invents stub content for missing files — template-copy is the only recovery path. Stubs hide bugs (e.g. a no-op `discounts.ts` ships green builds with silently-broken discount rendering).
- Removes the `creates:` frontmatter parser from the orchestrator's hot path.

## Step 9 — Final Message + run.json

> **No visual or browser-based verification.** After the build succeeds and the release URL is in hand, **do NOT** open the URL in Playwright, take screenshots, run console-error checks, or do any other browser-based smoke testing on your own initiative. The user gets the URL and decides when (and whether) to inspect the live site. If they ask for visual verification explicitly ("can you check the site looks right?", "screenshot the home page", "run a smoke test"), then do it — but never as an automatic step. Each browser action costs tokens and ~5–15s; multiplied across pages and viewports it adds minutes to the user-perceived build time without producing anything they asked for. The build is the source of truth for correctness; visual judgment is the user's job.

One concluding turn containing, in order:

1. **Release URL text first** — bold heading / link at the top of the message so the user sees it immediately.
2. **Compose the draft `run.json` blob** in session scratch. Aggregate every subagent return from the session into `phases[]`, set `outcome.previewUrl` from the release-URL extraction, fill `run.started` / `run.ended` (already captured at skill entry / now), and compose the run-specific `requiredPhases[]` array — the skill-invoked phases that MUST have a captured duration:
   - Always: `init-site-json`, `scaffold`, `env-pull`, `seed-utilities`, `emit-design-tokens`, `manifest-check-components`, `manifest-check-pages`, `decorative-slot-patch`, `npm-install`, `build`, `release` (or `preview` if `preview.sh` was used instead of `release.sh`).
   - Per app installed in Step 2: `app-install-<appName>` (one per entry).
   - When `copy-utility-templates` ran (any pack with templated utility files loaded): `copy-utility-templates-components` and/or `copy-utility-templates-pages`.
   - The `image-phase-2-entity` subagent's own duration arrives via its return; record as `{ phase: "image-phase-2-entity", seconds: <from agent return> }` if any pack produced entities.
3. **Run the finalize-run-json helper** with the draft piped to stdin:

   ```bash
   echo "$RUN_JSON_DRAFT" | node "<SKILL_ROOT>/scripts/finalize-run-json.mjs" "$(pwd)"
   ```

   The script applies the timing-completeness gate (any `requiredPhases` entry without a captured duration becomes `seconds: null` + `{code: "MISSING_TIMING"}` in `errors[]`), derives `run.totalSeconds` from `started`/`ended`, writes the canonical `.wix/run.json`, and prints a JSON object on stdout containing `perfLine` (the line you emit verbatim in step 4 below) and `missingTiming[]` (phases without captured duration — surface them to the user if non-empty).
4. **Emit the perf one-liner** verbatim as the last line of the message body. Format (from the script's `perfLine` field):

   > `Built in <totalSeconds formatted as Nm Ss> — design-system <n>s · images (phase 1 + phase 2) <n>s · build+release <n>s`

   Example: `Built in 18m 23s — design-system 320s · images (phase 1 + phase 2) 450s · build+release 32s`

   Three phase buckets only — don't dump every phase. The point is making each run's speed legible at a glance so regressions and wins show up without opening `run.json`. If any of the three buckets is missing (phase `seconds: null`), the script renders it as `–` rather than fabricating a value.

   If the script's output `missingTiming[]` is non-empty, surface those phase names on a separate line below the perf one-liner so the next run's orchestrator has visible regression signal.

### Timing — required in run.json

Timing fields are mandatory in `run.json` — they are the only way to answer "was this slower than last run?" without parsing the raw session log.

**At skill entry (before Discovery Step 0),** capture `runStartedAt` via a shell `date -u +%Y-%m-%dT%H:%M:%SZ` and hold it in session scratch.

**When emitting `run.json`,** capture `runEndedAt` the same way. Include all three timing fields on the `run` object:

```json
"run": {
  "brand": "...",
  "prompt": "...",
  "started": "<runStartedAt>",
  "ended": "<runEndedAt>",
  "totalSeconds": <ended - started in seconds, integer>,
  "verticals": [...],
  "packs": [...]
}
```

**Per-phase `seconds`** — every phase entry also gets a `seconds` field. Compute from the agent's own `started`/`ended` fields in its return JSON (per `references/shared/RETURN_CONTRACT.md`). If an agent omitted timing in its return, set `seconds: null` and add `{code: "MISSING_TIMING"}` to that phase's `errors` array rather than faking a value — null makes the omission visible and tunable.

For phases the skill runs directly (scaffold, app-install-*, env-pull, seed-utilities, npm-install, build, preview): **capture timing yourself — do not rely on a sub-Command to emit it.** An orchestrator that invokes scaffold/install/env-pull/seed-utilities + `npm install` without `date -u` wraps emits `MISSING_TIMING` for every one of them.

**Enforced pattern for every skill-invocation phase** (scaffold, app-install-*, env-pull, seed-utilities, npm-install, build, preview):

```bash
PHASE_START=$(date -u +%s)
# … invoke the sub-skill / run the Bash …
PHASE_END=$(date -u +%s)
# record: { "phase": "<name>", "seconds": $((PHASE_END - PHASE_START)) }
```

When a phase runs as a background subagent or background shell, capture `PHASE_START` at dispatch time and `PHASE_END` when its result arrives — not when you check output. A missed capture = a `MISSING_TIMING` entry in `run.json`, which is a process regression.

### URL discipline — do not invent URLs

The final message emits **exactly two URLs**, copy-pasted verbatim from their source:

- **Release URL** — extracted from `npx @wix/cli release` stdout, on the line `Site published on <url>`. Copy the exact string; do not retype it, modify it, or fill in digits from memory.
- **Dashboard URL** — `https://manage.wix.com/dashboard/<siteId>` where `<siteId>` comes from `wix.config.json`.

**Do NOT emit:**
- Any URL constructed by modifying the release URL (e.g., swapping subdomains, changing digits, removing path segments).
- Any URL not present verbatim in tool output or config files.

**Prior failure:** a run emitted `...alexp575.wix-host.com` next to the real URL `...alexp775.wix-host.com` — the second URL was typo-constructed and 404'd. Users lose trust when a URL claimed to work doesn't.

**On "going live" vs what this flow produces:** the flow deploys via `release.sh`, which is a real production release and populates the **Frontend link** in headless settings so transactional emails (order confirmations, password resets, member invites) link to the deployed frontend. Accepting real payments still requires a paid plan + payment provider — mention that if the user asks.

Do not re-read anything from disk to compose `run.json`. Use the agent return data already in session context.

---

## Verticals

Verticals live in `references/verticals/` and declare how a vertical plugs into the flow: app installs, SDK packages, `seed`/`components`/`pages` agent configs, `creates:` and `contributes:` file-ownership declarations.

Current verticals:
- `stores.md` — product catalog (requires `ecom`, `gift-cards`)
- `ecom.md` — vertical-agnostic cart/checkout (co-loaded via `requires`)
- `gift-cards.md` — passive pack: ships in storefront sites; lights up only when the dashboard's Wix Gift Card app is enabled (co-loaded via `requires`)
- `cms.md` — About/FAQ + use-case recipes (always loaded)
- `blog.md` — blog posts with Ricos rich content, RSS/sitemap
- `forms.md` — contact, lead, signup forms with CRM integration

`requires:` resolution: when a pack is loaded via discovery, every name in its `requires:` is also loaded (and any of *those* packs' `requires:`, transitively). The current chain is `stores → [ecom, gift-cards]` and `gift-cards → [ecom]`; ecom loads either way. Picking up gift-cards from stores means a gift-card buy page only ships on sites that already have a storefront — a pure-blog or pure-forms site never carries gift-card code.

Schema: see `references/verticals/_schema.md` (human-readable) and `_schema.json` (machine-validated at session start).

Adding a vertical: create `references/verticals/<name>.md` (validated against `_schema.json`), `references/<name>/INSTRUCTIONS.md`, and any per-vertical references and templates. No changes to this skill file are needed.

## Agent Return Contract

Agents return structured data in their completion message, not via sidecar files. The skill parses return JSON and merges seeders' `data` blocks into `.wix/site.json.seeded.<vertical>`. Downstream agents read `.wix/site.json` from disk rather than receiving data inline.

At end of run, the skill writes `.wix/run.json` — a single observability record.

See `references/shared/RETURN_CONTRACT.md` for schema and aggregation rules.

## Flow Enforcement

If the user arrives with an existing project (`wix.config.json` present in the working directory):
- Offer "continue existing project" vs "start fresh" via `AskUserQuestion`.
- Continue → jump to the appropriate phase based on what's already on disk (e.g., if Design System wrote shells but Pages hasn't run, jump to Pages).
- Start fresh → proceed with full flow.

## Non-Matching Intents

| User Wants | Redirect To |
|-----------|-------------|
| Scaffold with a specific template only | `bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"` |
| Build + preview an existing project | `bash <SKILL_ROOT>/scripts/preview.sh` (from project dir) |
| Release / ship / go-live an existing project | `bash <SKILL_ROOT>/scripts/release.sh` (from project dir) |
| Install a Wix app onto an existing site | Follow `<SKILL_ROOT>/references/commands/install-app.md` |
| Add a feature to an existing project | Not yet covered — tell the user |
| Restyle / change design on an existing site | Not yet covered — tell the user |

---

## References

Skill-level:
- `references/DISCOVERY.md` — discovery flow, plan format, aesthetic direction crafting
- `references/SETUP.md` — MCP prefix, app install, env pull, npm install recovery
- `references/ORCHESTRATION.md` — phase-dispatch mechanics, wait conditions, data carry-forward
- `references/verticals/_schema.md` — vertical pack schema
- `references/verticals/stores.md`, `cms.md`, `blog.md`, `forms.md`

Shared (with agents):
- (removed — see design-tokens pattern) — class-name manifest schema, producer/consumer rules
- `references/shared/RETURN_CONTRACT.md` — agent return JSON schema, run.json aggregation
- `references/shared/MCP_PREFIX.md` — prefix discovery + recovery
- `references/shared/IMAGE_GENERATION.md` — image agent contract

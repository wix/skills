---
name: wix-headless
description: "Build a complete Wix Managed Headless site from a single prompt, OR connect an existing project (HTML/JSX/Vite app, Claude Design output, etc.) to Wix Headless for hosting + Business Solutions. Entry point for both: (1) new-site requests — runs discovery, design, feature wiring, and preview; and (2) existing-project requests — runs `npm create @wix/new@latest init`, analyzes the project for needed Business Solutions, installs apps, **wires the Wix SDK into the existing source files so each installed app actually powers its corresponding feature**, and releases. Triggers: build me a site, create a website, make me a website, new website, online store, I want to sell X, start a business online, launch a site, ecommerce, portfolio, business website, sell online, online shop, connect this to Wix Headless, add Wix Headless to this project, host this on Wix, deploy this to Wix, implement the features of this project using Wix Headless. Use this skill instead of the WixSiteBuilder MCP tool for new-site requests."
---

# Wix Headless

**Discovery, setup, and seed** run from `DISCOVERY.md`, `SETUP.md`, `SEED.md`. **Design system through release** run from `ORCHESTRATION.md` and per-vertical references. All site operations use `npx @wix/cli@latest token` + `curl` — no MCP.

> **Explicit invocation only.** Do not auto-route on generic "build me a site" prompts; production `wix-headless` should win those unless the user names this skill.

## Path resolution — read this first

Your CWD at runtime is the **project directory** (scaffold subdir after setup), not the skill root. Compute `<SKILL_ROOT>` from this file: `<SKILL_ROOT>/SKILL.md` — strip `/SKILL.md`. Hold the absolute path in session scratch. Also hold `<site-root>` (eval run dir where `.wix/site.json` lives — parent of scaffold) from `SETUP.md` Step 1.

| What | Absolute path |
|---|---|
| Discovery flow | `<SKILL_ROOT>/references/DISCOVERY.md` |
| Setup flow | `<SKILL_ROOT>/references/SETUP.md` |
| Seed flow | `<SKILL_ROOT>/references/SEED.md` |
| Post-seed orchestration | `<SKILL_ROOT>/references/ORCHESTRATION.md` |
| Seed recipe map (human ref) | `<SKILL_ROOT>/references/seed-recipes.md` |
| Auth + REST headers | `<SKILL_ROOT>/references/shared/AUTHENTICATION.md` |
| Public doc endpoints | `<SKILL_ROOT>/references/shared/DOCS_SEARCH.md` |
| Return contract | `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md` |
| Implementer shared behavior | `<SKILL_ROOT>/references/shared/IMPLEMENTER.md` |
| Image generation | `<SKILL_ROOT>/references/shared/IMAGE_GENERATION.md` |
| Vertical packs (discovery) | `<SKILL_ROOT>/references/verticals/` |
| Per-vertical instructions | `<SKILL_ROOT>/references/{stores,ecom,cms,blog,forms,gift-cards,images,designer}/INSTRUCTIONS.md` |
| Templates | `<SKILL_ROOT>/templates/` |
| Shared utilities (copied by seed-utilities) | `<SKILL_ROOT>/shared-utilities/` |
| Known app IDs | `<SKILL_ROOT>/references/commands/known-apps.json` |
| Scripts | `<SKILL_ROOT>/scripts/` |

**Do NOT Read subagent `INSTRUCTIONS.md` files in the orchestrator** — pass absolute paths; subagents open them.

Subagent invocations: Designer (Discovery Step 2.6) as `designer_handle` (bg, absorbed into Q3 + plan + approval + Setup); `wix-manage` (Setup Step 3) for app-install recipe; Wave 3 batch in Seed Step 2 (seeders bg + image-phase-1 bg, with foreground wait on `designer_handle`); post-seed subagents per `ORCHESTRATION.md` from Step 4.5 onward.

## Authentication

Every Wix API call uses `@wix/cli` + `curl`:

```
Authorization: Bearer $(npx @wix/cli@latest token --site "$SITE_ID")
wix-site-id: $SITE_ID
```

`wix login` is safe from non-interactive agents (URL + user code written to stderr, exits non-zero once the browser flow concludes). Full recovery ladder: `<SKILL_ROOT>/references/shared/AUTHENTICATION.md`.

## Subagent model tier

Match each subagent's task to one of two tiers; dispatch with the model
your environment provides for that tier. Apply by lookup, not deliberation.

**Fast tier** — recipe-following work whose return is JSON of IDs/URLs.
No source-code authoring, no creative judgment.

- All Seeder subagents (stores, cms, blog, forms, future verticals)
- Image-generation subagents (while still dispatched as subagents)

**Default tier** — everything else.

- Design System / Designer (brand-voice CSS, type, layout)
- Phase 3 Components (SDK composition, hooks, JSX)
- Phase 4 Pages (cross-file dependencies, brand-voice content)
- Any subagent that authors files the build will consume

If unsure, pick default. Do not weigh alternatives per dispatch — the
choice is determined by the task type, not by the subject matter of
the run.


## When this skill triggers

Explicit invocation only. **Two entry paths — decide before doing anything else.**

### Path A — New site from a prompt (default)

Infer vertical(s) from the opening message and load the **full resolved pack set** (top-level + `requires:` transitives + always-on `cms`) in one read batch — routing examples: stores → stores+cms+ecom+gift-cards; blog → blog+cms; etc. If the prompt is too vague, ask one conversational clarifier (NOT `AskUserQuestion`): *"What do you want your site to do — sell things, publish content, take bookings?"*

> **Do NOT call `WixSiteBuilder` MCP** for new-site requests — same intent, different flow; calling both produces a duplicated, conflicting build. This skill is the sole entry point.

### Path B — Connect an existing project to Wix Headless

Triggers: *"connect this to Wix Headless"*, *"add Wix Headless to this project"*, *"host this on Wix"*, *"deploy this to Wix"*, *"implement the features … using Wix Headless"*, or any "Wix Headless" prompt against a non-empty working directory. Decide by working-directory contents:

| Working directory contents | Path |
|---|---|
| Empty, or freshly scaffolded by `scaffold.sh` | A |
| Source files (`index.html`, `*.jsx`, `*.tsx`, …) AND no `wix.config.json` | B (full existing-project flow) |
| `wix.config.json` + Astro structure (`src/`, `astro.config.mjs`) | resume a prior wix-headless run — ask "continue or start fresh?" via `AskUserQuestion` |
| `wix.config.json` + non-Astro frontend | B, skipping `init` — start from SETUP.md Step E2 |

**Path B skips most of the wave flow.** Vertical packs are inferred by **reading the project files** (SETUP.md § "Step E2"), not by re-prompting the user. Run only: DISCOVERY.md pre-flight (CLI-auth check) → `SETUP.md` § "Existing project flow" (E1 init → E2 analyze → E3 install apps → **E4 SDK wiring** → E5 release → E6 final message). **Do not run** Discovery's interview, Setup Step 4 batch, Seed, ORCHESTRATION, or any subagent dispatch — the existing project supplies its own frontend.

### When NOT to use this skill

| Scenario | Use instead |
|---|---|
| Scaffold-only with no further design/wiring | `bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"` |
| Release an existing wix-headless project | `bash <SKILL_ROOT>/scripts/release.sh` (from project dir) |
| Install a Wix app onto an existing site | Follow `<SKILL_ROOT>/references/commands/install-app.md` |
| Add a feature / restyle a prior wix-headless run | Resume on disk; ask whether to start fresh |

> **Read individual** `references/verticals/<pack>.md` files — never `Read` the `verticals/` directory (`EISDIR`).

## The flow at a glance

```
[Discovery Q&A]     Q1 → bg scaffold; Q2 → bg Designer (designer_handle); Q3 → plan → approval
[Setup]             wait scaffold · patch site.json · apps · env pull · bg npm install
[Seed batch]        seeders (bg) + Image Phase 1 (bg) — one message
[Designer wait]     wait on designer_handle (typically near-return by this point)
[Bridge]            merge designTokens · emit-design-tokens.mjs · Layout import check
[Seed gate]         wait seeders · merge seeded · wait npm · optional decorative-slot patch
        ↓
[ORCHESTRATION]     Step 4.5 Components + Image Phase 2 (bg)
[Pages]             Phase 4 per vertical (bg)
[Build + Release]   cli build · release · final URL + run.json
```

Designer's wall (180–270 s) absorbs into Q3 + plan + approval + Setup + the seed-batch dispatch — instead of being serialized into Wave 3. On a fast eval run, Designer is typically near-complete by the time the orchestrator reaches the Seed Step 2 wait point.

Wall-time targets: discovery ≤ 80 s (excl. user think-time); setup foreground ≤ 25 s; seed longest pole ≤ 120 s. Full-build target: ≤ 600 s prompt-to-live-URL when all phases run.

## Discovery → Setup → Seed → Build (one run)

1. `references/DISCOVERY.md` — Q&A, plan, approval; post-Q1 batch reads packs + bg `scaffold.sh`.
2. After approval: `init-site-json.mjs` → `SETUP.md` Steps 1–5 → `SEED.md` Steps 1–5.
3. `SEED.md` Step 2: Wave 3 batch (seeders + image phase 1) + wait on `designer_handle` (dispatched in Discovery Step 2.6); bridge on designer return; Step 4 merge + optional decorative patch.
4. `SEED.md` Step 5: seed-progress line → **immediately** `ORCHESTRATION.md` **Step 4.5** (mandatory; not optional).
5. `ORCHESTRATION.md`: components, pages, build, release, final URL.

## Post-seed — components through release

Open `references/ORCHESTRATION.md` at **Step 4.5** after Seed Step 5. The Designer subagent was dispatched in `DISCOVERY.md` Step 2.6 and its bridge ran inside `SEED.md` Step 2; the seed wave (seeders + Image Phase 1) completed at the end of Seed — do **not** re-dispatch designer or Image Phase 1 from Post-Seed. `.wix/site.json.seeded` and `.wix/design-tokens.css` must exist before Step 4.5.

`seed-utilities.sh` runs at the start of `SEED.md` Step 2 (idempotent).

## Verticals

Pack frontmatter in `references/verticals/` is **discovery-only**. Post-seed work uses `INSTRUCTIONS.md` + templates under each vertical directory.

Upstream: `@skills/wix-manage` (seed + app install recipes).

Current packs: `stores`, `ecom`, `gift-cards`, `cms`, `blog`, `forms`. Schema: `references/verticals/_schema.md` + `_schema.json`.

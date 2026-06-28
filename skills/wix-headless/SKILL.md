---
name: wix-headless
description: "Build a complete Wix Managed Headless site from a single prompt, OR connect an existing project (HTML/JSX/Vite app, Claude Design output, etc.) to Wix Headless for hosting + Business Solutions. Entry point for both: (1) new-site requests — runs discovery, design, feature wiring, and preview; and (2) existing-project requests — runs `npm create @wix/new@latest init`, analyzes the project for needed Business Solutions, installs apps, **wires the Wix SDK into the existing source files so each installed app actually powers its corresponding feature**, and releases. Triggers: build me a site, create a website, make me a website, new website, online store, I want to sell X, start a business online, launch a site, ecommerce, portfolio, business website, sell online, online shop, take bookings, book appointments, appointment scheduling, let clients book online, site for my salon/spa/clinic/studio, sign up for classes or sessions, connect this to Wix Headless, add Wix Headless to this project, host this on Wix, deploy this to Wix, implement the features of this project using Wix Headless, set up my machine for Wix Headless, get my environment ready for Wix Headless, install the Wix CLI, what do I need to build a headless site. Use this skill instead of the WixSiteBuilder MCP tool for new-site requests."
allowed-tools:
  - Bash(cd *)
  - Bash(npx @wix/cli@latest *)
  - Bash(npx @wix/cli *)
  - Bash(npm create @wix/new@latest *)
  - Bash(npm install *)
  - Bash(npm run *)
  - Bash(node *)
  - Bash(bash *)
  - Bash(powershell *)
  - Bash(pwsh *)
  - Bash(uname *)
  - Bash(git *)
  - Bash(xcode-select *)
  - Bash(brew install *)
  - Bash(winget install *)
  - Bash(curl *)
  - Bash(ls *)
  - Bash(grep *)
  - Bash(find *)
  - Bash(cat *)
  - Bash(head *)
  - Bash(wc *)
  - Bash(mkdir *)
  - Bash(cp *)
  - Read
  - Write
  - Edit
  - Skill
  - Agent
---

# Wix Headless

**Run flow is owned by the conductor, split at the approval gate: `references/PLAN.md`** (pre-approval — routes on **operation** (create/connect), the Discovery questions, the plan + approval gate, the latency-hiding background dispatches) **then `references/BUILD.md`** (post-approval — routes on **framework** (`frontendBuild`); Setup → Seed → the build wave (merged Components + Pages per vertical) → Build → Release). The domain/step files (`DISCOVERY.md`, `SETUP.md`, `SEED.md`, `DESIGN_SYSTEM.md`, the per-vertical references) describe only *what* each step does; they do not name the sequence. **Start a run by opening `PLAN.md`**; open `BUILD.md` when the user approves the plan. All site operations use `npx @wix/cli@latest token` + `curl` — no MCP.

> **Explicit invocation only.** Do not auto-route on generic "build me a site" prompts; production `wix-headless` should win those unless the user names this skill.

## Path resolution — read this first

Your CWD at runtime is the **project directory, which is also the site-root** — `scaffold.sh` flattens the scaffolded project into the current directory, so the run is a **single folder with a single `.wix/`** (no nested project, no parent/child split). `<site-root>` and `<project-dir>` are the **same path**: the run's CWD. The end-of-run `AGENTS.md` (project root) and the project's own files (`package.json`, `src/`, `wix.config.json`, `.wix/design-tokens.css`, …) all live there — **never `cd` into a subdir, never look in a parent for `.wix`**. Compute `<SKILL_ROOT>` from this file: `<SKILL_ROOT>/SKILL.md` — strip `/SKILL.md`; hold the absolute path in session scratch. (Hold `<site-root>` from `SETUP.md` Step 1; the connect/`init` path is likewise single-folder in CWD.)

| What | Absolute path |
|---|---|
| Discovery flow (router on OPERATION → operation files) | `<SKILL_ROOT>/references/DISCOVERY.md` → `DISCOVERY-create.md` (create) / `DISCOVERY-connect.md` (connect) |
| Setup flow | `<SKILL_ROOT>/references/SETUP.md` |
| Seed flow | `<SKILL_ROOT>/references/SEED.md` |
| Pre-approval funnel (plan; router on OPERATION → operation files) | `<SKILL_ROOT>/references/PLAN.md` → `PLAN-create.md` (create) / `PLAN-connect.md` (connect) |
| Post-approval build (router on FRAMEWORK → framework files) | `<SKILL_ROOT>/references/BUILD.md` → `BUILD-astro.md` (`frontendBuild: wix`) / `BUILD-own-build.md` (`frontendBuild: none`/`own`) |
| Seed recipe map (human ref) | `<SKILL_ROOT>/references/seed-recipes.md` |
| Environment readiness (audit → install → auth) | `<SKILL_ROOT>/references/shared/ENVIRONMENT.md` (scripts: `scripts/audit-env.sh`, `scripts/audit-env.ps1`) |
| Auth + REST headers | `<SKILL_ROOT>/references/shared/AUTHENTICATION.md` |
| Public doc endpoints | `<SKILL_ROOT>/references/shared/DOCS_SEARCH.md` |
| Return contract | `<SKILL_ROOT>/references/shared/RETURN_CONTRACT.md` |
| Implementer shared behavior | `<SKILL_ROOT>/references/shared/IMPLEMENTER.md` |
| Image generation | `<SKILL_ROOT>/references/shared/IMAGE_GENERATION.md` |
| Design-system Designer (authors the DESIGN.md) | `<SKILL_ROOT>/references/DESIGN_SYSTEM.md` |
| DESIGN.md format spec (vendored; Designer self-loads) | `<SKILL_ROOT>/references/shared/DESIGN_MD.md` |
| Design-system Composer — deterministic script (writes the 6 files) | `<SKILL_ROOT>/scripts/compose.mjs` (self-documenting — its header is the spec) |
| Composer astro skeletons | `<SKILL_ROOT>/references/astro/templates/` |
| Vertical packs (discovery) | `<SKILL_ROOT>/references/verticals/` |
| Per-vertical instructions | `<SKILL_ROOT>/references/{stores,ecom,cms,blog,forms,gift-cards,bookings,images}/INSTRUCTIONS.md` |
| Phase 4 page-designer scopes | `<SKILL_ROOT>/references/astro/designer/INSTRUCTIONS.md` |
| Templates | `<SKILL_ROOT>/references/astro/templates/` |
| Shared utilities (copied by seed-utilities) | `<SKILL_ROOT>/shared-utilities/` |
| Known app IDs | `<SKILL_ROOT>/references/commands/known-apps.json` |
| Scripts | `<SKILL_ROOT>/scripts/` |

**Do NOT Read subagent role/instruction docs in the orchestrator** — pass the absolute path; the subagent opens it. Reading a role doc to "prepare a dispatch" pulls 5–14 KB of subagent-only how-to into the orchestrator's context, which it then has to reason over on the dispatch turn — measurably inflating bridge turns; the orchestrator only needs to know **which inputs to inline** for each dispatch, and that list lives in `BUILD.md`'s dispatch steps, not in the role doc.

This covers **every** doc whose body is written *for a subagent to follow*, not just files literally named `INSTRUCTIONS.md`: `DESIGN_SYSTEM.md` (Designer), `astro/designer/INSTRUCTIONS.md` (page designers), the per-vertical `INSTRUCTIONS.md` routers, and the per-vertical guides under `references/astro/`. (There is no Composer doc — the Composer is the deterministic script `scripts/compose.mjs`, self-documenting in its header; the orchestrator never reads compose internals.)

The orchestrator's own reading set is the conductor/domain docs only:

- `PLAN.md` (+ the one operation funnel it routes to — `PLAN-create.md` *or* `PLAN-connect.md`)
- `BUILD.md` (+ the one framework build file — `BUILD-astro.md` *or* `BUILD-own-build.md`)
- `DISCOVERY.md` (+ the one operation discovery file — `DISCOVERY-create.md` *or* `DISCOVERY-connect.md`)
- `SETUP.md`
- `SEED.md`
- `references/verticals/*.md`

When and how each subagent is dispatched (Designer, seeders, image phases, vertical Components/Pages) — and the deterministic scripts in between (`emit-design-tokens.mjs`, `compose.mjs`) — is owned by the conductor (`references/PLAN.md` pre-approval, `references/BUILD.md` post-approval), not listed here.

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

**Decide by intent first, directory second.** An empty directory does **not** by itself mean Path A — read what the prompt is asking for. (See `DISCOVERY.md` § "Wave 0" for the authoritative rule.)

### Path A — New site from a prompt (default)

The user asks to **create a new site from scratch** ("build me a store", "I want to sell tables online", "make a blog") with **no design to connect**, in an empty directory. Infer vertical(s) from the opening message and load the **full resolved pack set** (top-level + `requires:` transitives + always-on `cms`) in one read batch — routing examples: stores → stores+cms+ecom+gift-cards; blog → blog+cms; bookings → bookings+cms; etc. If the prompt is too vague, ask one conversational clarifier (NOT `AskUserQuestion`): *"What do you want your site to do — sell things, publish content, take bookings?"*

> **Framework keyword → scaffold that framework, not astro.** A create prompt that **explicitly names a client-build framework** (*"create a bakery site using vite and wix"*, react/vue/svelte/SPA) stays Path A (`operation: create`) but resolves `frontendBuild: own` — the skill scaffolds *that* framework and connects it via the SPA spine (companion case). A **bare** "create a bakery site" with no framework named stays **astro** (the default). Only an explicit keyword flips it — never infer a framework the user didn't ask for. (`DISCOVERY.md` § "Wave 0".)

> **Do NOT call `WixSiteBuilder` MCP** for new-site requests — same intent, different flow; calling both produces a duplicated, conflicting build. This skill is the sole entry point.

### Path B — Connect an existing/brought design to Wix (`operation: connect`)

Triggers: *"connect this to Wix Headless"*, *"implement this design … connecting to wix"*, *"add Wix Headless to this project"*, *"host this on Wix"*, *"deploy this to Wix"*, *"implement the features … using Wix Headless"*, or a **design-file URL to fetch + implement** (Claude Design / v0 / Lovable / any tool). **These route to B even when the working directory is empty** — the design arrives by fetch, so emptiness at trigger time does not make it Path A.

| Signal | Path |
|---|---|
| Prompt asks to **connect / implement / host an existing or fetched design** (incl. a design-file URL), **even if the CWD is empty** | **B (`operation: connect`)** |
| A working frontend already on disk (`index.html`, `*.html`/`*.jsx`/`*.tsx`/`*.vue`, a design bundle) | **B (`operation: connect`)** |
| Empty CWD **and** a create-a-new-site prompt, nothing to connect | A (`operation: create`) |
| `wix.config.json` present (an existing wix-headless project) | resume/extend |

**The connect operation wires a brought-in design to Wix.** When the working directory holds a brought-in site, the run **connects it to a live Wix backend** — parse the site (`DISCOVERY-connect.md`), init + shared Setup/Seed, wire existing dynamic regions to `@wix/sdk` and augment static designs with the connected feature their purpose implies, then no-build release. The frontend-track playbook is `<SKILL_ROOT>/references/custom/INSTRUCTIONS.md`; routing is owned by `PLAN-connect.md`.

### Two routing axes: operation (Discovery/Plan) + framework (Build)

The skill routes each phase on its own axis — they only *happen* to coincide while there are exactly two modes:

- **Operation** (Discovery + Plan route on this) — *create* (scaffold a new site from a prompt) vs *connect* (integrate a brought-in design).
- **Framework-build-class** (Build routes on this) — `frontendBuild`: `wix` (astro-native, `wix build`) vs `none` (static HTML, no build) vs `own` (own-build SPA, the project's own `npm run build`).

These plus `frontend`, `verticals[]`, `designSource`, and `brand` form the **Plan→Build contract** (`PLAN.md` § "The Plan→Build contract"), held in orchestrator scratch and threaded into dispatch prompts. The axes are **orthogonal** — `frontendBuild` is derived inside the operation, not implied by it:

| `operation` | `frontend` | `frontendBuild` | What runs |
|---|---|---|---|
| `create` (default) | `astro` | `wix` | the skill writes the site, then `wix build` + release (`references/astro/`) |
| `create` + explicit framework keyword (*"…using vite"*) | `custom` | `own` | scaffold the named framework (vite/vue/svelte) → minimal app → connect via the SPA spine → the project's own `npm run build` + release (companion case) |
| `connect` (brought static HTML) | `custom` | `none` | connect a brought-in HTML+CSS/JS site; init + Setup/Seed + connect/augment + **no-build** release (`references/custom/`) |
| `connect` (brought framework SPA) | `custom` | `own` | connect a brought-in Vite/React/Vue/Svelte SPA; bundled `@wix/sdk` + source-edit wiring (persistence swap) + the project's own build + release |

`DISCOVERY.md` § "Wave 0" resolves `operation` first, then derives `frontend`/`frontendBuild` (connect's build-class from disk — `DISCOVERY-connect.md` § 1.5; create's from an explicit framework keyword). `frontend`/`operation`/`frontendBuild` all live in **orchestrator scratch** and are **not** written to disk (on scratch loss, recover them from `package.json`: `@wix/astro` present ⇒ `frontend: astro`/`frontendBuild: wix`, else `frontend: custom` with `frontendBuild` re-derived from `scripts.build` + a bundler dep). **Operation routing is owned by `PLAN.md` § "Operation routing"; framework routing by `BUILD.md`.** Framework SPAs carry **no per-framework instruction files** — one agnostic playbook; only SSR frameworks (Next.js/Nuxt) are deferred.

### Two tracks (business vs frontend)

The skill runs two semi-independent tracks (business = frontend-blind site/app/seed work; frontend = scaffold/design/components/pages/build) that the orchestrator interleaves for wall-time. **The track model and interleaving are owned by `PLAN.md` § "Two tracks".**

### When NOT to use this skill

| Scenario | Use instead |
|---|---|
| Scaffold-only with no further design/wiring | `bash <SKILL_ROOT>/scripts/scaffold.sh <folder-name> "<Brand>"` |
| Release an existing wix-headless project | from the project dir: `npx @wix/cli@latest build` then `release` (astro); `release` only (custom — no build) |
| Install a Wix app onto an existing site | Follow `SETUP.md` Step 3 (delegates to the `wix-manage` skill) |
| Add a feature / restyle a prior wix-headless run | Resume on disk; ask whether to start fresh |

> Read individual `.md` files under `references/verticals/`; `Read` on the directory returns `EISDIR`.

## The run

The whole run — Discovery → Setup → design-system bridge → Seed → the build wave (merged Components + Pages per vertical) → Build → Release, with every dispatch, handle, wait, and transition — is owned by the conductor: **`references/PLAN.md`** (pre-approval) then **`references/BUILD.md`** (post-approval). Open `PLAN.md` to start a run. This file does not duplicate the sequence.

Wall-time targets: discovery ≤ 80 s (excl. user think-time); setup foreground ≤ 25 s; seed longest pole ≤ 120 s. Full-build target: ≤ 600 s prompt-to-live-URL when all phases run.

## Verticals

Pack frontmatter in `references/verticals/` is **discovery-only**. Post-seed work uses `INSTRUCTIONS.md` + templates under each vertical directory.

Upstream: `@skills/wix-manage` (seed + app install recipes).

Current packs: `stores`, `ecom`, `gift-cards`, `cms`, `blog`, `forms`, `bookings`. Schema: `references/verticals/_schema.md` + `_schema.json`.

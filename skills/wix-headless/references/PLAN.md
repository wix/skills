# Plan — the pre-approval funnel

This file owns the run **from the first Discovery question to the user's approval of the plan** — operation routing, the questions, the background dispatches that hide latency, and the plan/approval gate. Its job is to get the user to the commitment moment **fast**, so keep it lean.

**This file is the funnel router, and it routes on OPERATION.** It holds the shared funnel rules (concurrency vocabulary, the two-track model, operation routing, the Plan→Build contract, user-facing output, batching). The operation-specific funnel — how input is processed and how the plan looks — lives in `PLAN-create.md` (create a new site) and `PLAN-connect.md` (connect a brought-in design). **Read `operation` (set by `DISCOVERY.md` § Wave 0), then open the matching one and read only that:** `create` → `PLAN-create.md`, `connect` → `PLAN-connect.md`. (Today `create` coincides with `frontend: astro` and `connect` with `frontend: custom` — but the funnel branches on the *operation*, not the frontend; that is the seam the framework-SPA and extend plans build on.)

**On approval, open `BUILD.md`** — the post-approval conductor that owns execution (Setup → design-system bridge → Seed → Components → Pages → Build → Release). Everything past the approval gate lives there, so it is not read until the user has committed.

**The contract with the other files.** The domain/step files answer *what each step does* (the questions Discovery asks, the recipes, the prompt templates). This file + the operation funnels + `BUILD.md` answer *when, in what order, in parallel with what, gated on what*. The step files do not name the sequence or chain to each other; the conductor names when to apply each one. Neither prescribes a tool API — map each step to whatever subagent / parallel-execution primitive your runtime offers.

## Concurrency vocabulary

The terms below appear throughout this skill. They describe the *shape* of work; the runtime decides how to implement them:

- **Subagent** — an isolated worker with its own context. The orchestrator sends it a prompt (an `Instruction file` path + inputs); the subagent reads the instruction file, performs the scope, and returns a structured result.
- **Concurrent batch** — N subagents (or N tool calls) launched together so they execute in parallel rather than serially.
- **Background subagent** — a subagent the orchestrator does not block on; it runs while the orchestrator continues with downstream work and reports its result asynchronously.
- **Foreground subagent** — a subagent the orchestrator blocks on before continuing.
- **Wait (gate)** — the orchestrator pauses until specified background work (subagents or background `Bash` jobs like the scaffold) finishes. **Waiting means awaiting the harness's background-task completion notification — never a `sleep`/poll loop against an output file.** A poll loop burns the whole wait as blocked orchestrator time and delays everything gated behind it (e.g. sleep-polling the scaffold lands the Composer late). The completion notification is the only signal you need; the same rule covers the `wix login` wait (`shared/AUTHENTICATION.md`) and the no-sidecar-poll rule for image phases (`images/INSTRUCTIONS.md`).
- **Result** — the structured JSON block each subagent returns at the end of its run, per `references/shared/RETURN_CONTRACT.md`.

## Two tracks (business vs frontend)

The run is two semi-independent tracks that the orchestrator interleaves for wall-time:

- **Business track** (frontend-blind) — create/connect the site, **install Wix apps**, **seed backend data**. Inputs: `siteId`, `verticals`, `intent`, `brand`. It never reads `frontend`/template — a product (or collection, post, form) is the same regardless of what renders it. Its domain content lives in `SETUP.md` (app installs) + `SEED.md` (seeders).
- **Frontend track** (frontend-aware) — scaffold/prep the local project, Designer + design tokens, `compose.mjs` (the Composer script), components, pages, SDK wiring, build. Every `frontend`/template branch lives here. Its domain content lives in `scaffold.sh` + `seed-utilities.sh` + `DESIGN_SYSTEM.md` + `scripts/compose.mjs` (self-documenting) + the per-vertical references (frontend guides under `references/astro/`).

The only cross-track data flow is **one-way, business → frontend**: seeders produce entity IDs which the orchestrator inlines into the frontend track's Page-subagent prompts. There is no frontend → business dependency.

## Operation routing

The Plan phase routes on **operation** — *create* (scaffold a new site from a prompt) vs *connect* (integrate a brought-in design). `operation` is captured by `DISCOVERY.md` § "Wave 0", held by the orchestrator in scratch, and selects the funnel:

| `operation` | What it is | Funnel → Build |
|---|---|---|
| `create` | The user asks for a new site; the skill writes it | **`PLAN-create.md`** → on approval → `BUILD.md` routes Build on **framework**. The full astro playbook lives under `<SKILL_ROOT>/references/astro/`. |
| `connect` | The user brings a finished design to wire to Wix | **`PLAN-connect.md`** → on approval → `BUILD.md` routes Build on **framework**. The frontend-track playbook is `<SKILL_ROOT>/references/custom/INSTRUCTIONS.md`. No scaffold, no Designer/Composer; init + shared Setup/Seed + connect/augment/persistence-swap; release is no-build (`none`) or the project's own build (`own` SPA). |

> **Operation ≠ frontend.** The funnel branches on the *operation* (what the user is doing), not the frontend (what renders it). The two are orthogonal: *create* spans `frontendBuild` `wix` (astro default) and `own` (a named framework); *connect* spans `none` (static HTML), `own` (a brought SPA), and could span `wix` (a brought astro project) — none of which forks the operation router. Keeping operation and framework distinct is what lets these combinations be independently expressible without a new phase fork — see the framework-SPA plan and the extend plan.

This is the **operation-selection routing layer**: `SETUP.md`'s steps assume the routing already happened; the conductor owns the branch. **Build does NOT route on operation** — it routes on framework (`BUILD.md`); operation feeds Build only through the contract below (specifically the bootstrap/wiring cells).

## The Plan→Build contract

Plan resolves a small, explicit contract that Build consumes. It is carried **in the orchestrator's in-context session scratch** and threaded into each subagent's dispatch prompt — it is **not persisted to disk** (nothing in this contract lands on disk). The orchestrator already resolves these fields in Wave 0 and holds them for the whole run, so a disk round-trip buys nothing; on scratch loss, `frontend`/`frontendBuild` are recovered from `package.json` (`@wix/astro` ⇒ astro/wix, else custom + re-derive from `scripts.build`).

**Core (every operation resolves these identically; Build's install/build/release spine reads only these):**

| Field | Today's values | Meaning |
|---|---|---|
| `operation` | `create` \| `connect` | what the user is doing (*extend* added later by its own plan) |
| `frontend` | `astro` \| `custom` | what renders the site (held in scratch; recovered from `package.json` on scratch loss) |
| `frontendBuild` | `wix` \| `none` \| `own` | the build-class Build routes on: `wix` (astro, `wix build`), `none` (brought static HTML, no build), `own` (framework SPA — the project's own `npm run build`; brought-in *or* scaffolded from a named framework) |
| `verticals[]` | e.g. `["stores","ecom","cms"]` | loaded packs (top-level + transitive) |
| `designSource` | `generate-fresh` \| `derive-from-brought` | create generates; connect derives from the brought design's own tokens |
| `brand` | `{ name, description }` | brand metadata |

`frontendBuild` is **derived inside the operation, not implied by it** (the axes are orthogonal): connect resolves it from the brought-in project on disk (`none` static HTML vs `own` framework SPA — `DISCOVERY-connect.md` § 1.5); create resolves it from an explicit framework keyword (`wix` astro default vs `own` named framework — `DISCOVERY.md` § "Wave 0"). Resolve it in Wave 0 alongside `frontend` and hold it in scratch (on scratch loss, recover from `package.json`). Build branches its install/build/release **purely off `frontendBuild`** — never off `operation`.

**Operation section (feeds ONLY the bootstrap + wiring cells, never the build/release spine):**
- `connect` carries the **connection plan** (binding-map / augmentation spec) inferred in Discovery.
- `create` carries nothing extra.
- *(extend will carry existing-state + delta — added by the extend plan.)*

That is the precise sense in which the contract stays uniform across operations: the build/release spine is contract-uniform (it reads only the core), and **only** the bootstrap/wiring cells read the operation-specific payload. A *fresh session over an existing project* (extend) reconstructs the equivalent core from durable disk artifacts (`@wix/astro` dep, `package.json`, on-disk pages) rather than from scratch — same contract, sourced differently by lifecycle.

## User-facing output (keep the machinery invisible)

This rule governs the **whole run**, both modes. The user should see **milestones in plain language, never the orchestration machinery.** Between the Discovery approval and the final summary the run is largely silent — the orchestrator is dispatching, waiting, and gating, none of which is the user's concern.

**Never put internal orchestration vocabulary in a user-facing message.** That includes: background-handle names (`*_handle`), dispatch markers ("→ dispatch:", "dispatching X", "launching Wave 3"), subagent START/END, "seed gate" / "all handles complete", wave/step numbers ("Wave 3", "Step 4.5"), in-flight **subagent/handle status tables** (especially any "Handle" column), and internal paths (`wix-manage-root`, the scaffold subdir). These describe *how the conductor works*, not *what the user is getting*.

**The only user-facing messages in a run are:**
1. **Discovery** — the questions, the plan, and the approval gate (the mode discovery file's domain).
2. **One brief seed-progress sentence** (`SEED.md` Step 5) — plain prose naming what was seeded, no tables.
3. **The final summary** (`BUILD.md` § "Final Message").

Everything else is silent. If a long phase (Components, Pages) would otherwise look stalled, at most **one short plain-language line** ("Building your product and category pages…") — never a status table, handle list, or wave number. The in-flight subagent tables that runs have emitted ("Phase 3 Components running: | Subagent | Handle |…", "🎉 Seed gate open! All handles complete") are the anti-pattern this rule removes.

## Batching discipline

This rule governs **every** concurrent batch in the run, in both modes — the Wave-0 pack reads (mode funnel), and the post-approval dispatch batches owned by the conductor (`BUILD.md` and its mode files): the astro BUILD-entry scaffold + Designer dispatch, the Setup app-installs, the Wave-3 seed batch, the integration connection-plan + init batch. The step files describe *what* is in each batch; the rule that they go out as one batch lives here.

Historical runs lost 1–2 minutes per phase to serialized dispatch — N operations emitted one-per-turn instead of in a single concurrent batch. Even when each ran fast, the inter-dispatch gaps accumulated to significant overhead per phase.

Two mitigations; use both:

1. **Fire the whole batch as one assistant message** — N `Agent`/`Bash` tool_uses as siblings. **No narration between dispatches** ("Now installing apps:", "Dispatching seeders:"). Any text adjacent to a dispatch closes the batch and forces the rest into separate turns, adding seconds per dispatch. This holds even for a 2-item batch.
2. **Use background-on-dispatch for anything that doesn't block downstream work.** Even if the runtime serializes the launch turns, background dispatch lets the work overlap in execution, compressing wall-time substantially versus serial.

If your runtime forces serialization across turns, make every subagent that can run in the background a background subagent — the Designer, seeders, and image phases all dispatch background so the foreground never blocks on them. (The Composer is no longer a subagent — it is the deterministic `compose.mjs` Bash step, sub-second and synchronous.)

# Plan — the pre-approval funnel

This file owns the run **from the first Discovery question to the user's approval of the plan** — mode routing, the questions, the background dispatches that hide latency, and the plan/approval gate. Its job is to get the user to the commitment moment **fast**, so keep it lean.

**This file is the funnel router.** It holds the shared funnel rules (concurrency vocabulary, the two-track model, frontend-mode routing, user-facing output, batching). The mode-specific funnel — how input is processed and how the plan looks — lives in `PLAN-regular.md` (astro) and `PLAN-integration.md` (custom). **Read `frontend` (set by `DISCOVERY.md` § Wave 0), then open the matching one and read only that:** `astro` → `PLAN-regular.md`, `custom` → `PLAN-integration.md`.

**On approval, open `BUILD.md`** — the post-approval conductor that owns execution (Setup → design-system bridge → Seed → Components → Pages → Build → Release). Everything past the approval gate lives there, so it is not read until the user has committed.

**The contract with the other files.** The domain/step files answer *what each step does* (the questions Discovery asks, the recipes, the prompt templates). This file + the mode funnels + `BUILD.md` answer *when, in what order, in parallel with what, gated on what*. The step files do not name the sequence or chain to each other; the conductor names when to apply each one. Neither prescribes a tool API — map each step to whatever subagent / parallel-execution primitive your runtime offers.

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
- **Frontend track** (frontend-aware) — scaffold/prep the local project, Designer + design tokens, Composer, components, pages, SDK wiring, build. Every `frontend`/template branch lives here. Its domain content lives in `scaffold.sh` + `seed-utilities.sh` + `DESIGN_SYSTEM.md` / `astro/COMPOSE.md` + the per-vertical references (frontend guides under `references/astro/`).

The only cross-track data flow is **one-way, business → frontend**: seeders produce entity IDs which the orchestrator inlines into the frontend track's Page-subagent prompts. There is no frontend → business dependency.

## Frontend-mode routing

`frontend` (captured by `DISCOVERY.md` § "Wave 0 — Mode detection") is the axis the frontend track branches on. The orchestrator holds it in scratch and uses it in two ways: it branches inline in the PLAN/BUILD orchestration on the scratch value, and it passes `--frontend <value>` to `init-site-json.mjs` (and, astro only, to `scaffold.sh` + `--template astro` to `seed-utilities.sh`). The axis is binary — **astro (scaffold mode: the skill writes the site) vs custom (integration mode: connect a brought-in site)**:

| `frontend` | Mode | Funnel |
|---|---|---|
| `astro` | Scaffold | **`PLAN-regular.md`** → on approval → `BUILD-regular.md`. The full playbook lives under `<SKILL_ROOT>/references/astro/`. |
| `custom` | Integration | **`PLAN-integration.md`** → on approval → `BUILD-integration.md`. The frontend-track playbook is `<SKILL_ROOT>/references/custom/INSTRUCTIONS.md`. No scaffold, no Designer/Composer; init + shared Setup/Seed + connect/augment + no-build release. |

> **Astro is the one Wix-preferred frontend the skill *builds*; custom is the frontend the user *brings*.** Integration mode connects any working HTML+CSS/JS site to a live Wix backend — wiring existing dynamic regions and augmenting static designs with the connected feature their purpose implies. See `references/custom/INSTRUCTIONS.md`.

This is the **track-selection routing layer**: `SETUP.md`'s steps assume the routing already happened; the conductor owns the branch.

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

Historical runs lost 1–2 minutes per phase to serialized dispatch — N operations emitted one-per-turn instead of in a single concurrent batch. Even when each ran fast, the inter-dispatch gaps (12–39s in measured runs) accumulated to >25% overhead per phase.

Two mitigations; use both:

1. **Fire the whole batch as one assistant message** — N `Agent`/`Bash` tool_uses as siblings. **No narration between dispatches** ("Now installing apps:", "Dispatching seeders:"). Any text adjacent to a dispatch closes the batch and forces the rest into separate turns, adding seconds per dispatch. This holds even for a 2-item batch (a measured 2-seeder run lost 12 s to one interstitial sentence).
2. **Use background-on-dispatch for anything that doesn't block downstream work.** Even if the runtime serializes the launch turns, background dispatch lets the work overlap in execution. Measured compression on a sequential-launch / background-execute model: ~2× wall-time vs. serial.

If your runtime forces serialization across turns, make every subagent that can run in the background a background subagent — the Designer, Composer, seeders, and image phases all dispatch background so the foreground never blocks on them.

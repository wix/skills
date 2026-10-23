---
name: wix-replatform
description: >-
  Routes RePlatform source-to-Wix migrations to the next required workflow module by
  inspecting authoritative migration artifacts. Use when starting, resuming, or recovering
  a migration run.
---

# wix-replatform

`wix-replatform` is the compact supervisor for a resumable source-to-Wix migration. It
selects one internal module for the active stage; it does not carry every stage procedure
in its own context.

## Always-active contract

- Resolve the active project under `migrations/<project>/` (or `REPLATFORM_MIGRATIONS_DIR`)
  before inspecting or creating anything. Only that project's artifacts are authoritative.
- Preserve `EXPECTATIONS.md` at that project root. It is the user's free-form record of
  how they expected the run to behave; initialization creates it once and never overwrites it.
- Start/resume `resources/rp-telemetry/` at the beginning of every run and finalize it at
  a terminal state. Never hand-write telemetry events.
- Use orchestration JSON plus validated stage artifacts as resume authority. Logs and chat
  history are diagnostic context only.
- Preserve user data: write idempotently, dedupe by source identity, resume rather than
  restart, and never create a second destination site for a migration.
- Never print secrets, secret-bearing config contents, tokens, or credentials. Report only
  key names and present/blank/missing status.
- Do not declare a migration complete from prose or a single artifact. The deterministic
  router and aggregate completion artifact own terminal completion.

## CLI-launched runs and human actions

When a migration is started through `replatform`, the terminal is deliberately
non-interactive: do not use an agent question UI, ask for stdin, or wait for a person in the
current agent turn. The runner owns process lifecycle and emits only observed events; it does
not replace this skill's router or completion receipts.

When a human choice, review, approval, or manual prerequisite is needed, create a durable
request with `node skills/wix-replatform/scripts/user-action.js create --project <projectDir>
--request-file <request.json>`, then end the turn. Put only reviewed artifact paths in the
request. The person can later use `replatform requests`, `replatform show`, and
`replatform answer`; a resumed agent reads the answered request from
`orchestration/user-actions/`, never from reconstructed chat context.

Cancellation is not completion. If the runner has recorded `cancel_requested`, `canceled`, or
`interrupted`, preserve partial/recovery artifacts and let a later explicit `replatform resume`
route recovery. Never create aggregate migration completion from an aborted execution report.

## Pipeline

```text
intake → destination → source inputs → preflight → (standard: discovery → mapping → codegen;
quick: adapter preflight → quick plan) → setup discovery → website handoff
→ safety review/approval → setup → import
→ storefront continuation (website only) → aggregate finalization
```

Delivery modes are `management` (backend only), `website` (frontend only), and
`management_and_website` (the integrated flow above). Accept user input `both` as
`management_and_website` and persist the canonical value.

For `deliveryMode=management`, aggregate finalization requires valid backend import
accounting. For `deliveryMode=management_and_website`, it additionally requires a current
`website/completion.json` with completed screenshot review, no unresolved critical/high
gaps, and release evidence. `execution/completion-report.json` is backend accounting,
never website-migration completion by itself.

## Route before acting

On every new or resumed turn:

1. Resolve the project and initialize/load its orchestration artifacts.
2. Run `node skills/wix-replatform/scripts/orchestration-route.js <projectDir>`.
3. Dispatch the `nextResource` to a Developer subagent instead of loading and following it
   yourself. Give it the project directory and the resource to run; it follows that
   resource's contract exactly as written, unchanged. Read back only its result — never its
   transcript, tool output, or logs.
   - A Developer subagent may fan out to its own sub-subagents, only when it is certain
     doing so is harmless — read-only work with no shared state and no write to anything
     durable — and only if the host agent happens to support it. It must never fan out for
     anything that writes shared state; that stays one write at a time, exactly as each
     resource's own contract already does today. If the host agent doesn't support nested
     dispatch, the Developer just does the work itself, sequentially.
4. Dispatch a QA subagent to check the Developer's result against that resource's own
   stated required outputs (its own "artifacts to create or update" or "## Output"
   section, and any review/gap documents it defines). QA is read-only — it never writes or
   calls Wix. If something's missing, dispatch a new Developer for the same resource with
   QA's findings; otherwise the stage is done.
5. At the end of each pipeline phase (discovery, mapping, setup discovery, import, and so
   on — see the pipeline above; a phase spans several resource-level stages), dispatch a QA
   subagent to review that phase's documents as a whole (for example
   `mapping/review/mapping-summary.md` and `mapping-gaps.json`, or
   `execution/completion-report.json`) before routing to the next phase. This catches
   anything a single per-task check could miss. For the import phase specifically, this
   review must be entity-by-entity against the accepted mapping plan, not a skim of the
   top-level status string — see `rp-execute-import`'s "Entity-by-entity QA" section. Any
   run-fixing dispatch mid-phase (a crash fix, a slowness fix, a resumed pass) does not
   itself satisfy this; run the phase-level QA again once the fix lands, since fixing one
   entity's defect certifies nothing about its neighbors.
6. Route again after every stage boundary. Never decide the next stage from memory.

The router (`lib/orchestration-router.js`) is the only routing and resume authority. It
recomputes the route from decisions, approvals, preflight, `run.json` `status` and the phase
outputs on every call; `run.json.currentState` is diagnostic only, never a routing input.

- A recorded rejection stops the route in every mode, one-click included:
  `execution_approval_rejected` is `blocked` before any setup or import write, and
  `mapping_approval_rejected` returns to `rp-mapper` for a new plan.
- A gated output that exists but is unusable (`source_schema_invalid`, `mapping_plan_invalid`,
  `setup_plan_invalid`, `setup_requirements_invalid`, `execution_manifest_invalid`) is
  `blocked` with `errors` and the producer as `nextResource`. Do not re-run the producer
  automatically; report the errors to the Import Operator and stop.
- The import routes (`missing_completion_report`, `quick_mode_import_required`) carry
  `importProgress`. `interrupted` lists `recoveryArtifacts`: resume that import, which
  reconciles before any create. Never start a second import.

If an artifact is malformed, partial, stale, or fails its validator, treat its producing
stage as incomplete and route to the producer. Do not make parallel replacement artifacts.

A user action whose reviewed artifacts changed after it was created is refused with
`user_action_stale` and stays pending. Create a new request from the current artifacts.

**Catching up a finished migration is a rerun, not a new project.** When the user asks to pull
in records that arrived or changed since the import — "the source kept selling", "these orders
are missing", "re-run it" — reuse the same project, destination, mapping, generated importer
and crosswalk, and route to `rp-execute-import` → "Rerunning an import for new and modified
records". Do not scaffold a second project or re-approve an unchanged mapping; a
mapping or scope *change* does go back through the existing gates. A rerun's revision conflicts
are user decisions even in 1-click mode.

## Demand-loaded module map

| Router situation | Dispatch |
|---|---|
| project, delivery mode, source mode, or grouped intake is unresolved | `resources/rp-project-intake/` |
| destination is absent, conflicting, or needs creation/adoption | `resources/rp-destination/` |
| source URL/files/config/acquisition mode/credentials are required, including source credentials said to exist already on another site | `resources/rp-source-inputs/` |
| deterministic preflight is missing or blocked | `resources/rp-preflight/` |
| quick mode needs platform resolution, endpoint preflight, plan, extraction, or import | selected `resources/rp-quick-<platform>/` |
| source schema is missing | `resources/rp-discovery/` and its selected source adapter |
| mapping is missing or needs review | `resources/rp-mapper/` |
| Wix requirements are missing | `resources/rp-setup-discovery/` |
| import code/review is missing or stale | `resources/rp-import-codegen/` |
| setup verification is missing | `resources/rp-execute-setup/` |
| backend completion report is missing | `resources/rp-execute-import/` |
| frontend-only work, or integrated website handoff/build/gap loop/release receipt is incomplete | `resources/rp-website-continuation/` |
| aggregate completion is missing | `resources/rp-execution-policy/` |

The resource named by the route is the complete stage contract, dispatched as described in
"Route before acting" — the main session itself never loads it directly. Only the
dispatched Developer loads source-file, secret, scaffolding, or storefront procedures, and
only for the stage that actually needs them; nothing about a stage where they're irrelevant
is loaded, by the main session or the Developer.

## Interaction policy

Normal mode asks only for a missing required input, a genuinely ambiguous active project,
or a mandatory write approval. Ask one question at a time unless a module says otherwise.

When the user says `add to expectations: <note>` (or an unambiguous natural-language
equivalent), append the note to the active project's `EXPECTATIONS.md` before continuing.
Use `scripts/expectations-ledger.js` so the entry retains the supplied statement plus safe
current context (stage/state, relevant project-relative artifacts, and known entity/field
labels). Do not treat this as approval or silently change a mapping. Never record secrets,
tokens, raw customer data, or raw source records; redact them if supplied and say so.

Before writes, preserve the mandatory execution-plan approval gate. Read-only discovery,
mapping, setup verification, code generation, and review happen before it.

## Quick management import mode

When `managementImportMode=quick`, select the platform adapter only after the deterministic
source probe identifies a compatible platform. Quick mode is a bounded public-data import:
the adapter's versioned `quick-mode.json` owns its source routes, entity graph, field matrix,
and exclusions. Do not run agentic discovery, mapping, or project-specific code generation for
the quick backend branch. Still run destination setup, application installation, Catalog-V3 and
notification safety checks, execution approval, shared write runtime, crosswalks, and completion
accounting. If no adapter qualifies, persist the unsupported-mode result and ask the user to
select standard mode; never silently fall back.

Halt only for missing/invalid required input, a manual action with no API, or a systemic
failure/data-loss risk. A halt must persist the code, evidence, owner, and exact unblock
action; never silently stop.

## 1-click mode

When explicitly requested by the user, record `automationMode=one_click` with
`source=user` and apply the following. A missing mode or a `one_click` value recorded as
`deterministic_inference`/`prior_artifact` is normal interactive mode and must not skip a
checkpoint:

- collect all still-missing intake values in one grouped request; then do not pause for
  routine approvals;
- record mapping and execution approvals as `approved`, `decidedBy=agent`; skipping a
  pause without state is invalid;
- for CSV/file-only runs, validate and accept the required sample preview as the agent;
  without explicit user-authored one-click, pause for the normal mapping review, sample
  preview validation, and execution approval;
- default to a new isolated site unless an existing destination is explicitly supplied or
  already pinned, but never default the new site's type (Headless, Studio or Harmony): ask it
  in the grouped intake; choose website scope deterministically from discovered route families;
- retry PATH/tool-resolution failures under the operator's compatible interactive login shell;
  request required browser/network sandbox escalation and retry before calling it blocked;
- retry the obvious recovery before stopping: aligned shell first for PATH/tool failures,
  then the required escalation retry for sandboxed browser or network/API failures;
- continue through the complete selected deliverable. In `management_and_website` mode that includes
  frontend build, post-build gap analysis, bounded fix loop, and release receipt; when the
  user selected facelift at intake, it also includes the separate post-clone facelift review;
- before yielding, re-route. A 1-click run is only `completed` with
  `completion/migration-completion.json`, or `blocked` with a typed durable blocker.

Use the operator's compatible local Node/Yarn shell when recovering from a PATH or tool
resolution failure. Machine-specific shell paths belong only in local, git-excluded agent
instructions.

**Repo-local interactive shell contract:** a PATH/tool-resolution failure on first attempt may
mean the command ran under a plain, non-interactive shell that never sourced the operator's
Node/Yarn profile. Resolve the operator's compatible login shell from the local environment or
git-excluded agent instructions, verify that it is executable, and retry the exact same command
through that shell in interactive login mode so the profile that resolves `node`/`yarn`/`npx`
loads. Do not hardcode a machine-specific shell path in this public skill. Only escalate to a
durable blocker if the compatible-shell retry itself fails.

## Guardrails

- Never bypass a validator, approval-state update, verified notification mute, or
  Catalog-V3 gate to make a stage appear finished.
- `website` means frontend only; `management_and_website` means the integrated backend and
  frontend migration. Never hand the integrated migration destination to the frontend skill
  or create a second frontend site in that mode.
- A Studio or Harmony destination (`targetSiteType`) is created and verified by
  `rp-destination`'s coordinator and is never published, unpublished or handed to
  `wix-headless-replatform`; its website and publication remain operator handoff items.
- Do not implement a storefront manually when `wix-headless-replatform` is unavailable;
  persist a blocker with the exact required runtime capability.
- In management mode, still generate `website/handoff.*` after setup discovery so a later
  storefront can start without repeating backend discovery.

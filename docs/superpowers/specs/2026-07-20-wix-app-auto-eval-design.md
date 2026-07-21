# Automatic Eval on Codegen Skills — Design

- **Ticket:** [CODEAI-497](https://wix.atlassian.net/browse/CODEAI-497) — *Automatic eval on codegen skills*
- **Date:** 2026-07-20
- **Status:** Draft (design under review)

## Summary

Add an automatic evaluation flow for codegen skills, running on each pull request that
changes a skill. The **first target is the wix-app skill** (EvalForge **App Builder**
project), but the flow is designed to be **generic** so it can later serve other skills
and EvalForge projects (Studio2, headless) with minimal change.

It mirrors the intent of the existing wix-manage EvalForge flow but adapts to how these
evals actually work: scenarios are authored in the EvalForge UI, runs use a fixed preset
configuration, and the only variable per run is the **skill version** (the PR's version
vs. the version without the diff).

The flow gates merges on eval results, protects against toothless evals with a quality
guard, and (in later phases) reports on and helps fix failures.

## Goal & acceptance criteria (from the ticket)

- Automatic evaluation implemented for codegen skills (starting with **wix-app**).
- Evaluation runs on **each pull request**.
- Ability to test a run **with vs. without the change** to understand whether the change
  is needed / whether it regresses anything.

## Design principles

- **Generic first.** Build for "a codegen skill in an EvalForge project," not for wix-app
  specifically. Everything skill- or project-specific (project id, skill path root, tag
  convention) is an input/parameter, not a constant.
- **DRY.** Share one implementation across skills/projects/flows. Prefer a single
  reusable unit — potentially an **extractable package** (or reusable action) — over
  copy-paste per skill. Future flows should plug in, not re-implement.
- **Reuse the existing core.** Take the skill-agnostic pieces from
  `evalforge-yaml-gate` (auth, EvalForge client, run, comparison, comment, gate,
  cleanup) rather than rebuilding them.

## Scope

**In scope (now):** the **wix-app** skill, running against the EvalForge **App Builder**
project only. (Confirm the wix-app → App Builder project mapping.)

**Out of scope now, planned as later phases:** rules/tools and other
codegen-configuration change coverage; **Studio2** skills; **headless** skills.
The design must not hard-code anything that makes adding these a rewrite.

## The run model (key facts that shape everything)

1. **Scenarios come from the EvalForge UI and from repo YAML.** The UI is the primary
   source; repo-YAML authoring is delivered **as part of Phase 1** (formerly a later
   phase). "Scenario source" sits behind a clean seam so either can feed the gate.
2. **Every run uses a fixed preset configuration** (agent, model, tools).
3. **The only variable is the skill version.** EvalForge **already supports skill
   versions** — the work is to **auto-create a version when a PR is opened** and point the
   preset run at it. The comparison is **PR version vs. the version without the diff**.
   **Preferred direction:** make this a native **EvalForge feature** — any artifact
   *linked to git* (skill / rule / tool / any codegen config) automatically gets a new
   version when a PR is opened. This generalizes across every artifact type and project
   (feeds Phases 5–7) and keeps the GitHub Action thin — it just references "the version
   for this PR." **Bootstrap fallback:** until that feature exists, the flow creates the
   version itself via the EvalForge API; migrate to the platform feature when it lands
   (same seam, thinner action).
4. **No MCP lifecycle.** The versioned artifact is the **skill**, not an MCP capability.
5. **Scenarios are selected by tag** — a changed reference file maps to a tag, and the
   gate fetches the matching scenarios from EvalForge.
6. **EvalForge has three projects** we use — **App Builder**, **Studio2**, **headless**.
   The flow is parameterized by project; for now it runs only **App Builder**.

### Relative to the existing wix-manage action

`.github/actions/evalforge-yaml-gate` is hardcoded to wix-manage and to a repo-YAML +
documentation-coverage model. We **drop**: scenario-YAML authoring, repo→EvalForge sync,
YAML-tag `promote`, draft-scenario lifecycle, repo doc-URL coverage, and the MCP-version
lifecycle.

We **reuse** the skill-agnostic core: auth, the EvalForge API client (it already models
scenarios as `{ id, name, tags[] }` and supports a `filter: { tag }` query), triggering a
run, fetching results, the eval-pipeline **comparison**, PR **commenting**, the
**gate/blocking** behavior, and the per-PR **cleanup** pattern (repurposed to delete per-PR
*skill* versions instead of MCP versions).

Whether this ships as a parameterized version of the existing action, a shared core with
thin adapters, or an extracted package is an implementation-planning decision — but the
DRY/generic principles above point toward a single shared unit.

## Phases

### Phase 0 — Foundations (prerequisites)

- **Tag convention** — a documented mapping from a changed reference file/area to the
  EvalForge tag(s) whose scenarios must run (e.g. `references/DASHBOARD_PAGE.md` →
  `dashboard-page`). **This is many-to-many, not 1:1** — and it must include *negative*
  dependencies: a scenario can depend on a reference file even when it exercises the
  **opposite** behavior. Example: a flow that must **not** create a dashboard page still
  has to re-run when `DASHBOARD_PAGE.md` changes, to prove the edit didn't break the
  "don't create it" path. So a file resolves to a **set** of tags, scenarios carry
  multiple tags, and selection must pull in these related/negative scenarios — a naive
  filename→tag map is insufficient. Because tagging is done **by hand in the UI**, this is
  a human process; the Phase 1 guard is its safety net.
- **First scenario batch** — author an initial set of wix-app scenarios in the EvalForge
  UI, tagged per the convention.
- **Preset run configuration** — a fixed run config (agent, model, tools) that references a
  **skill version**, used by every run.
- **Auto-create a skill version per PR** — skill versions already exist in EvalForge; add
  automation to create one from the PR branch's skill on PR open/update (as an EvalForge
  feature or inside the flow). No new versioning platform work is required.
- **Project targeting** — target the **App Builder** project only for now; confirm the
  wix-app → App Builder mapping.

### Phase 1 — PR eval gate (core loop)

**Trigger:** a PR that touches the skill under test (for wix-app: `skills/wix-app/**` —
`SKILL.md` or `references/**`).

**Precondition — author check:** only run for PRs whose author is a Wix employee
(`@wix.com` email / internal account); skip external-fork PRs. Reuses the existing
`author-gate` from `evalforge-yaml-gate`.

**Scenario authoring:** scenarios can be authored in **repo YAML** (synced into EvalForge)
as well as in the UI — folded in from the former Phase 5. Both sources feed selection by
tag.

Steps within one gate run (guard runs *before* the run):

1. **Create PR skill version** — from the PR branch's skill. Preferably provided natively
   by EvalForge (git-linked auto-versioning); until then, created by the flow via the API.
   See run-model note 3.
2. **Derive tags** — map the changed reference files to tag(s).
3. **Quality guard** — for each tag, query EvalForge and require:
   - at least **X** scenarios,
   - each scenario with at least **Y** assertions,
   - at least **one LLM-judge** assertion,
   - a **new** reference file with **zero** scenarios **blocks**.

   Guard failure **blocks and skips the run** — this protects against evals that pass
   trivially.
4. **Run** — trigger the preset run using the **PR skill version**, on the tagged scenario
   subset.
5. **Gate** — failures **block the merge** (aggregation across repeats is an open decision;
   see flakiness below).
6. **Comment** — post results to the PR.
7. **Cleanup** — delete the PR's skill version on PR **close or merge**.

**Re-run path:** manual `workflow_dispatch` and/or a `/re-eval` PR comment (evals depend on
live systems, so results can change without a new commit).

**Not included:** a scheduled **run-all** for full coverage — EvalForge already provides
this in the system, so we don't duplicate it in the PR flow.

### Phase 2 — Change-impact comparison

Answers "is this change needed, and does it regress anything?"

- Compare **preset + PR skill version** vs. **preset + the skill version without the diff**
  (the base). We do **not** compare against "no skill at all."
- Produce a per-scenario delta classified as:
  `fixed` / `newly-broken` / `still-passing` / `still-failing`.
- **Rules:**
  - **Block on any `newly-broken`** (regression).
  - `still-failing` does **not** block (a scenario already hard-failing may still justify
    the change even if this PR doesn't fix it).
  - Surface net effect (fixed vs. newly-broken) as the **necessity signal**.

### Phase 3 — Reporting & investigation

- Summarize failures and categorize root causes: wrong MCP tool called, MCP output error,
  docs error, skill misguidance, etc.
- Leverage (and potentially extend) EvalForge's **"investigate with AI"** feature.

### Phase 4 — Auto-fix

- Propose and/or apply fixes based on Phase 2/3 output. Expected to be easier once the
  comparison and investigation signals exist.

### Later phases (post-core)

- **Phase 5 — Rules / tools / codegen-config coverage.** Track new **rules** created or
  **tools** that codegen will use, and any other codegen-configuration change, so those are
  evaluated too — not just skill reference `.md` changes.
- **Phase 6 — Studio2 skills.** Point the generic flow at the **Studio2** project.
- **Phase 7 — Headless skills.** Point the generic flow at the **headless** project.

## Cross-cutting concerns

- **Non-determinism / flakiness.** The run definition already lets us set **how many times
  each scenario runs**; use that. Remaining decision: how to aggregate repeats into a
  pass/fail (threshold / majority) at the gate.
- **Genericity & DRY.** Enforced by the design principles above; every new skill/project
  should be configuration, not new code.
- **Tag-convention enforcement.** Human process; the Phase 1 guard is the safety net.
- **Scenario-source seam.** Keep "where scenarios come from" abstracted so the UI and
  repo-YAML sources (both delivered in Phase 1) stay interchangeable and new sources can be
  added without a rewrite.

## Open decisions

1. **Guard thresholds** — concrete values for X (min scenarios/tag) and Y (min
   assertions/scenario).
2. **Repeat aggregation** — how many repeats per scenario, and the pass criterion
   (all-pass / majority / threshold) used at the gate.
3. **wix-app → App Builder** project mapping — confirm.
4. **Packaging** — parameterized action vs. shared core + adapters vs. extracted package
   (deferred to implementation planning; DRY/generic principles favor a single shared unit).
5. **Where version-creation lives** — native EvalForge git-linked auto-versioning
   (preferred, generalizes to all artifacts/projects) vs. flow-created via API (bootstrap).
   Decide the target and whether to start on the bootstrap while the platform feature is
   built in parallel.
6. **Tag model** — how to express the many-to-many mapping, including **negative**
   dependencies (a scenario that must keep working when a file changes even though it
   exercises the opposite behavior). Filename→tag is insufficient; likely scenarios carry
   multiple tags and each changed file resolves to a *set* of tags.

## Reuse map (from `evalforge-yaml-gate`)

| Concern | wix-manage today | this flow |
|---|---|---|
| Scenario source | repo YAML, synced to EvalForge | EvalForge UI + repo YAML (Phase 1), selected by tag |
| Artifact under test | per-PR MCP version | per-PR **skill version** (already supported) |
| Coverage / selection | doc-URL from `documentation.yaml` | **tag** → scenario query |
| Run + results | reuse | reuse |
| With/without comparison | eval-pipeline comparison (reuse) | PR skill version vs. version without the diff |
| PR comment / gate / blocking | reuse | reuse |
| Cleanup | delete MCP version on close | delete **skill version** on close/merge |
| Promote on merge | apply YAML tags | **not needed** (UI-authored) |
| Scheduled run-all | separate mode | **not in this flow** (system already provides it) |

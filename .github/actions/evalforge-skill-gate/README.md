# `evalforge-skill-gate`

EvalForge flows for file-based skills — the skill's own files become the capability
content, so an eval run can evaluate *this PR's* version of a skill.

Three modes, in one action so they share one committed bundle:

| Mode | Trigger | What it does |
|---|---|---|
| `gate` | `pull_request` opened / synchronize / reopened / ready_for_review | Derives which eval tags the PR affects, enforces coverage, creates a PR skill version, runs the covering scenarios against it, comments the result |
| `cleanup` | `pull_request` closed | Deletes the PR's capability versions and restores or removes its draft scenarios |
| `sync` | `pull_request` closed **and merged** | Reconciles the repo's scenario YAML into EvalForge, so EvalForge mirrors `main` |

All decision-making lives in [`packages/evalforge-core`](../../../packages/evalforge-core).
This action reads inputs, calls core, comments, and sets the check status.

## `gate` flow

```mermaid
flowchart TD
    PR([PR touches the skill dir<br/>or the scenario glob]) --> AUTH{First-commit<br/>author @wix.com?}
    AUTH -->|no| SKIP([exit 0 — external fork])
    AUTH -->|yes| LOAD[loadScenarios head YAML]
    LOAD --> YAMLOK{YAML valid?}
    YAMLOK -->|no| FAILYAML[comment errors] --> GATEFAIL
    YAMLOK -->|yes| DERIVE[changed files → deriveTags<br/>tags · broadImpact · unmapped]
    DERIVE --> ANY{Any gated<br/>changes?}
    ANY -->|no| NOOP([comment no-op, exit 0])
    ANY -->|yes| GUARD["guardScenarios<br/>coverage: every tag has ≥1 scenario meeting the bar<br/>no weakening: every touched scenario meets the bar<br/>bar = ≥3 assertions + ≥1 llm_judge"]
    GUARD --> GUARDOK{Violations?}
    GUARDOK -->|yes| FAILGUARD[comment violations<br/>run is skipped entirely] --> GATEFAIL
    GUARDOK -->|"no — warnings carried forward"| VER[collectSkillFiles whole skill dir<br/>→ createOrReuseSkillVersion, label pr-N-mergesha7]
    VER --> SYNC[loadScenarios base + remote lookup<br/>diffSyncPlan — semantic tags + draft tag]
    SYNC --> APPLY[apply CREATE · UPDATE · DELETE · DEFER_DELETE]
    APPLY --> SELECT[selectScenarios<br/>synced ids ∪ tag query, dedup, cap at max-scenarios]
    SELECT --> RUN[createAndRunEvalRun<br/>agentId · scenarioIds · capabilityVersions]
    RUN --> POLL[pollUntilDone]
    POLL --> TIMEOUT{Timed out?}
    TIMEOUT -->|yes| FAILTO[comment timeout] --> GATEFAIL
    TIMEOUT -->|no| EVAL["evaluateRunResult<br/>failed + errors == 0, and any assertions at all?"]
    EVAL --> VERDICT{Passed?}
    VERDICT -->|yes| PASS([comment results ✓ check passes])
    VERDICT -->|no| FAILEVAL[comment failing assertions] --> GATEFAIL
    GATEFAIL{{"blocking input?"}}
    GATEFAIL -->|true| BLOCK([setFailed — merge blocked])
    GATEFAIL -->|false| WARN([warning + comment — check passes<br/>soak period])
```

The author gate and the coverage guard both come **before** any EvalForge write, so a fork
PR or a missing scenario costs no run.

**What gets uploaded, and how it's labelled.** The capability version carries the **whole
`skill-dir`**, minus `node_modules` and `dist`. The directory is the deployed unit: reference
docs point the agent at sibling paths like `<SKILL_ROOT>/scripts/generate-auto-patterns.js`
and tell it to run them, so uploading only the docs would break those capabilities at run
time — and the resulting eval failure would read as a skill regression rather than a gate bug.
Note this is a *different* question from `ignore-globs`, which only decides what **triggers** a
run. The version is labelled
`pr-<number>-<evaluated-sha7>`, where the evaluated SHA is `GITHUB_SHA`: on `pull_request`
that is the **merge** commit the workflow checked out, not the PR head. Labelling by head
would not uniquely identify the content, since the same head yields different merge results
as base advances — and `createOrReuseSkillVersion` would then reuse a version built from stale
content. The `pr-<number>-` prefix is what PR-close cleanup sweeps.

Two paths deliberately fail rather than reporting green, because each would otherwise be a
silent false pass:

- a scenario selection that resolves to **zero** ids — nothing would be verified;
- a completed run with **zero assertions** — no assertion failed, but none ran either.

## Change-impact comparison — what blocks

> **Design, not current behaviour.** Nothing in this section is wired into the gate yet. The
> classification logic exists (`classifyChangeImpact` in `evalforge-core`), but the gate still
> runs exactly one eval and the comment carries no impact table.

The gate will run the selected scenarios **twice**: once with the PR's content pinned, once
with the base content — the same thing without this diff. Same preset agent, same scenario ids,
same repeat count. The pinned versions are the only variable, which is what makes the
difference attributable to the diff.

Only the **PR arm** decides the verdict. The base arm exists to say *who broke it* and
*whether the change moved anything* — it can never turn a green PR red, or a red PR green.

```mermaid
flowchart TD
    VERS[["one job, two run variants:<br/>pr-N-sha7 per changed entity<br/>pr-N-base-sha7 per changed entity"]]
    VERS --> PRRUN[PR arm]
    VERS --> BASERUN[base arm]

    PRRUN --> USABLE{completed, with<br/>≥1 assertion?}
    USABLE -->|"no — timed out · cancelled · nothing verified"| DECIDE
    USABLE -->|yes| RED{any assertion<br/>failed or errored?}
    RED -->|no| PASS([✓ check passes])
    RED -->|yes| DECIDE{{"blocking input?"}}
    DECIDE -->|true| BLOCK([setFailed — merge blocked])
    DECIDE -->|false| WARN([warning + comment — passes, soak period])

    BASERUN -.-> BUSABLE{base arm<br/>usable?}
    BUSABLE -.->|no| NOATTR[attribution unavailable]
    BUSABLE -.->|yes| CLASS["classify every scenario<br/>fixed · newly-broken<br/>still-passing · still-failing"]
    CLASS -.-> COMMENT
    NOATTR -.-> COMMENT[["PR comment — wording and the<br/>necessity signal, never the verdict"]]
```

Dotted edges inform the comment. Nothing on the dotted path reaches `blocking input?`, so a
base arm that times out or errors degrades the report to "attribution unavailable" and leaves
the gate exactly as strict as it was.

| Base | PR | Class | Effect on the check |
|---|---|---|---|
| pass | pass | `still-passing` | silent |
| fail | pass | `fixed` | **passes** — reported as the necessity signal |
| pass | fail | `newly-broken` | **blocks** — this PR caused it |
| fail | fail | `still-failing` | **blocks** — labelled pre-existing |
| unusable | pass | — | **passes**, attribution unavailable |
| unusable | fail | — | **blocks**, attribution unavailable |

**Why `still-failing` blocks.** A scenario red on both sides tells you nothing about the
change — it is absence of signal, not evidence of safety, and this is the one rule
[`evalforge-yaml-gate`](../evalforge-yaml-gate) already enforces for wix-manage
(`comparisonHasNoWinner` fails when the `llm_judge` failed in *both* runs). Blocking on it
also keeps the gate's strictness identical to the pre-comparison behaviour: the block
condition remains "the PR run is fully green", so adding the comparison can only add
information, never permission to merge something that used to be rejected. The delta's
payoff is attribution and necessity, not a looser bar.

**Every scenario has a base result.** Both runs are given the same scenario ids, so a
scenario this PR *authored* still runs against the base skill version. That is exactly the
signal a new reference file wants: the base version has no such doc and fails, the PR version
passes, and the scenario reports `fixed`. There is no "no counterpart in base" case to
special-case.

**A wholly `still-passing` PR is the strongest necessity signal available.** Every scenario
green on both sides means the measured behaviour did not move — either the change is a no-op
against the current suite, or the suite does not cover it. Neither blocks; both are worth
saying out loud in the comment.

The base version is labelled `pr-<number>-base-<base-sha7>`, sharing the `pr-<number>-` prefix
so PR-close cleanup sweeps it with no extra code. A shared `base-<sha7>` label reused across
PRs would store fewer versions, but then cleanup for one PR could delete a version another PR
is still running against — capability versions are cheaper than that ownership problem.

**Nothing in the comparison knows it is comparing skills.** `EvalRunInput.capabilityVersions`
is a `Record<capabilityId, versionId>`, so an arm is just a map: one entry per **changed**
entity, at head for the PR arm and at the base ref for the base arm. An entity the PR did not
touch appears in neither map, so both arms resolve it to the same default version — which is
the "hold everything else constant" property the delta depends on.

Only two things are entity-typed: the per-entity path conventions used to derive tags, and the
mapping from content to a version body (`skillContent` for a skill, `mcpContent` for an MCP,
one case per future kind). Selection, the guard, the gate decision, classification and cleanup
are all entity-blind.

The **inputs** are still single-entity, though — `skill-dir` and `capability-id` are scalars,
and the entity list is built from them internally with one element. Generalising the input
surface so a rule needs no workflow change is follow-up work; what the comparison buys now is
that none of the *logic* will have to change. Whether a rule is even expressible as a
capability version is itself open — rules may live in agent config instead.

A PR that changes two entities produces one arm pinning both, so the delta attributes to *the
PR*, not to either entity — separating them would need one arm per subset. The comment names
which entities an arm pinned, so the ambiguity is visible rather than implied.

**Why it stops here.** `getEvalRun` returns only `aggregateMetrics` — totals, no per-scenario
breakdown — so the classification above has no data source yet. The two candidate routes
(extend the client, or go through the eval-pipeline service the wix-manage gate uses) differ in
*architecture*, not just in one adapter: the pipeline resolves both arms itself from a commit
SHA, which would mean no base version and no second run of our own. That is why the orchestration
is unbuilt rather than merely unwired.

## `cleanup` flow

```mermaid
flowchart TD
    CLOSE([PR closed or merged]) --> CV[deletePrCapabilityVersions<br/>every pr-N-* version]
    CV --> CS[planCleanup over the PR's<br/>draft-tagged scenarios]
    CS --> PRE{Present in<br/>base YAML?}
    PRE -->|yes| RESTORE[RESTORE — write back<br/>the pre-PR state]
    PRE -->|no| DEL[DELETE — it was PR-only]
    RESTORE --> DONE([warnings only,<br/>never fails the workflow])
    DEL --> DONE
```

Cleanup never fails the workflow. The PR is already closed, so a red check would not be
actionable; the next run sweeps whatever was left behind.

## How tags are derived

Changed paths are classified in a **fixed precedence, first match wins**:

| # | Changed path | Result |
|---|---|---|
| 1 | matches `ignore-globs` | ignored, silently |
| 2 | matches `broad-impact-globs` | **broad impact** → the whole suite is in play |
| 3 | `<reference-dir>/DASHBOARD_PAGE.md` | tag `dashboard-page` — lowercase, `_` → `-`, drop `.md` |
| 4 | `<reference-dir>/dashboard-page/API_SPEC.md` | tag `dashboard-page` — the directory name is already the tag |
| 5 | any other file under `skill-dir` | **unmapped** — warned about, triggers nothing |
| — | the scenario glob | no tag; changed scenarios are included in the run directly |
| — | anything else | ignored |

The ordering matters. A broad-impact file living inside `reference-dir` has to be
classified broad-impact *before* rule 3 sees it, or `references/CODE_QUALITY.md` would
derive a `code-quality` tag and the coverage guard would demand a scenario carrying a tag
no scenario will ever carry. A broad-impact path therefore derives **no tag** and is never
coverage-checked — its guarantee comes from running the whole suite instead.

`scripts/**` is ignored rather than treated as broad impact because ignoring it loses no
signal: a generator script emits reference files, so a script change that affects behaviour
arrives with the regenerated `.md` files in the same PR, and those trigger their own tags.

## The quality guard

The bar is **at least 3 assertions including one `llm_judge`**. Below it, a scenario would
run, pass, and have verified nothing — so the bar is folded into the coverage question
rather than checked separately.

| Situation | Result |
|---|---|
| A derived tag has no scenario at all | **blocks** |
| The tag's only scenarios are below the bar, PR touched neither | **blocks** |
| The tag has a good scenario and a weak one, PR touched neither | **passes**, warns on the weak one |
| The PR added or edited a scenario below the bar | **blocks**, even with a good sibling |

The third row is deliberately non-blocking: stopping a PR because of a two-assertion
scenario someone else wrote punishes the wrong author, and the predictable result is that
the threshold gets lowered or the gate gets bypassed.

The guard runs on repo YAML plus the changed-file list alone — no EvalForge calls, no
capability version, no run — so a coverage failure reports in seconds and costs nothing.

## Inputs

| Input | Modes | Default | Notes |
|---|---|---|---|
| `mode` | all | `sync` | `gate` · `cleanup` · `sync` |
| `github-token` | all | — | Author gate, changed files, PR comment |
| `evalforge-url` | all | — | Upgraded to HTTPS with a warning if it is not |
| `evalforge-project-id` | all | — | |
| `evalforge-app-id` / `evalforge-app-secret` | all | — | OAuth client credentials; both registered for log masking |
| `evals-glob` | all | — | e.g. `yaml/wix-app-evals/**/*.{yml,yaml}` |
| `capability-id` | `gate`, `cleanup` | — | The capability the PR skill version is created under |
| `agent-id` | `gate` | — | Preset agent the run uses |
| `skill-dir` | `gate` | — | e.g. `skills/wix-app` |
| `reference-dir` | `gate` | `references` | Relative to `skill-dir` |
| `ignore-globs` | `gate` | `scripts/**` | Newline-separated, relative to `skill-dir` |
| `broad-impact-globs` | `gate` | `SKILL.md` + the six cross-cutting references | Newline-separated, relative to `skill-dir` |
| `max-scenarios` | `gate` | `25` | Touched scenarios kept first; anything cut is named in the comment |
| `blocking` | `gate` | `false` | `true` fails the check; anything else warns and passes |

`capability-id`, `agent-id` and `skill-dir` are optional at the action level because `sync`
mode does not use them. The gate marks them required where it reads them, so a
misconfigured gate workflow fails at the first step rather than running with empty ids.

`gate` and `cleanup` modes need the base SHA checked out into `.action-src` alongside the
head checkout — the sync and cleanup plans compare against the base YAML to tell "PR-only"
from "pre-existing". See
[`evalforge-wix-app-gate.yml`](../../workflows/evalforge-wix-app-gate.yml).

## Using this from another repo

`wix/skills` is public, so reference the action directly rather than vendoring it. The
committed `ncc` bundle inlines `evalforge-core`, so the consuming repo takes **no
dependency on the package**.

```yaml
- uses: wix/skills/.github/actions/evalforge-skill-gate@<sha>
  with:
    mode: gate
    skill-dir: packages/my-skill
    reference-dir: docs
    broad-impact-globs: 'README.md'
    ignore-globs: 'tools/**'
    evals-glob: 'evals/**/*.{yml,yaml}'
    capability-id: 'your-evalforge-capability-id'   # plain ids, inline —
    agent-id: 'your-evalforge-agent-id'             # not secrets, reviewable in the diff
    github-token: ${{ secrets.GITHUB_TOKEN }}
    evalforge-url: ${{ vars.EVALFORGE_URL }}
    evalforge-project-id: 'your-evalforge-project-id'
    evalforge-app-id: ${{ secrets.YOUR_APP_ID }}
    evalforge-app-secret: ${{ secrets.YOUR_APP_SECRET }}
```

Your org policy has to permit actions from `wix/skills`. The real cost of adoption is not
code: it is the EvalForge-side setup (project, capability, preset agent, file template) and
authoring scenarios with tags.

## Working on this action

The bundle in `dist/` is what CI runs, and a required check fails if it is stale. After any
change here **or in `evalforge-core`**:

```bash
(cd packages/evalforge-core && yarn build)
(cd .github/actions/evalforge-skill-gate && yarn build)
```

Use the `(cd DIR && yarn SCRIPT)` subshell form, not `yarn --cwd DIR SCRIPT` — under
Corepack, `--cwd` resolves the yarn *version* from the real process cwd, so invoking it
from the repo root can silently run the wrong yarn.

Adding a dependency to `evalforge-core` also changes both consuming actions' lockfiles
through the `portal:` link. CI runs `yarn install --immutable`, so run a plain
`yarn install` in `evalforge-core` **and** in both actions, then commit all three
`yarn.lock` files.

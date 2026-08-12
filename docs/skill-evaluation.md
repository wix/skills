# Skill evaluation

How the automated checks work, what a failing one means, and how to work on the workflows
themselves. For the scenario format, see [eval-scenarios.md](eval-scenarios.md).

## The wix-manage gate

The automated skill evaluation runs on every PR (against `main`) that touches:

- `skills/wix-manage/references/**`
- `yaml/wix-manage/**`
- `yaml/wix-manage-evals/**`

What it checks, in order:

1. **Coverage.** Every changed `.md` under `skills/wix-manage/references/<area>/` must have at least one scenario under `yaml/wix-manage-evals/<area>/` asserting on its doc URL. PRs missing coverage fail with a comment pointing at the file and the expected URL.
2. **Schema.** Every scenario YAML under `evals/` must parse against the schema (valid `name`, `triggerPrompt`, `tags`, and a non-empty `assertions` array).
3. **Execution.** For the covering scenarios, the workflow runs the agent against the PR-version docs and reports pass/fail in a PR comment.

When the workflow runs, it creates an EvalForge MCP capability version that points at the PR:

```text
https://mcp.wix.com/mcp?skillsRepo=wix/skills&skillsPr=<headSha>
```

That PR override makes the Wix MCP load skill content from the pull request instead of from `main`, so eval scenarios test the proposed skill content.

Use evaluation as a loop, not a one-time check. Review the failures, tighten the skill or the scenario, and rerun until performance is good enough for the target scenarios.

## wix-app scenarios: the PR eval gate

Every PR touching `skills/wix-app/**` or `yaml/wix-app-evals/**` runs
[`.github/workflows/evalforge-wix-app-gate.yml`](../.github/workflows/evalforge-wix-app-gate.yml),
which evaluates the scenarios covering what you changed against **your PR's** version of
the skill. The action's own docs —
[`.github/actions/evalforge-skill-gate/README.md`](../.github/actions/evalforge-skill-gate/README.md) —
carry the full flow diagram.

**What triggers a run**

Editing a reference file runs the scenarios tagged for it — `references/DASHBOARD_PAGE.md`
→ `dashboard-page`, and a sub-doc under `references/dashboard-page/` maps to the same tag.
`SKILL.md` and the cross-cutting references run the whole suite instead. `scripts/**` is
ignored, since a generator change arrives with its regenerated `.md` files anyway. A changed
scenario YAML is always included. Anything else under `skills/wix-app/` is reported as
**unmapped** — it triggers nothing, but stays visible so a new kind of file gets a
deliberate decision rather than being silently dropped.

The exact rules, their precedence, and which files count as cross-cutting live in
[the action's README](../.github/actions/evalforge-skill-gate/README.md#how-tags-are-derived) —
one copy, next to the code that implements them.

**Two checks that can block**

The quality bar is **at least 3 assertions including one `llm_judge`**. Below it, a scenario
would run, pass, and have verified nothing.

1. **Coverage.** Every tag your PR derives needs at least one scenario carrying it *that
   meets the bar*. Edit `references/BACKEND_API.md` with no scenario tagged `backend-api`
   and the gate tells you to add one.
2. **No weakening.** Every scenario you add or edit must meet the bar — even when a strong
   sibling already covers the same tag.

A weak scenario you **did not touch**, on a tag already covered by a stronger one, is a
**warning** rather than a failure. Blocking there would hold your PR hostage to someone
else's old scenario. The full outcome table is in
[the README](../.github/actions/evalforge-skill-gate/README.md#the-quality-guard).

Both checks run on the repo YAML alone, before any eval run starts, so a coverage failure
reports in seconds and costs nothing.

**What a failing check means**

The PR comment names the reason. The common ones:

| Comment says | Do this |
|---|---|
| `<tag>` has no eval scenario | Add one under `yaml/wix-app-evals/` tagged `<tag>`, or add that tag to a scenario that already exercises the area |
| `<tag>` is carried only by scenarios below the quality bar | Strengthen one of the named scenarios |
| a scenario you edited is below the bar | Add assertions until it has 3 including an `llm_judge` |
| assertions failed | Read the linked run. Either the skill change regressed behaviour, or the scenario's expectations need updating — decide which |
| scenario locked by another PR | Another open PR holds a draft of that scenario. Wait for it, or coordinate with its author |
| capped at `max-scenarios` | Informational. The named scenarios did not run this time |
| no scenarios could be resolved to run | The gate refuses to report green having verified nothing. Usually a sync gap — check the named scenarios exist in EvalForge |

**When the gate verified nothing at all** — it timed out, the polling failed mid-run, or the
run never started — the comment ends with `Comment /re-eval to run the gate again`. That is
not a PR problem: evals depend on live systems, so a run can end without a verdict for
reasons that have nothing to do with your change.

Commenting `/re-eval` on the PR re-runs **the gate's existing run**, so the check updates in
place. It deliberately does not evaluate in the comment's own workflow run: an
`issue_comment` run is associated with the default branch's commit, while required checks
are evaluated on the PR head, so a verdict published there would land somewhere the PR
cannot see. See [`.github/workflows/evalforge-re-eval.yml`](../.github/workflows/evalforge-re-eval.yml).

- The command must be the **first thing in the comment** — mentioning it mid-sentence does
  nothing, so discussing it or quoting someone who used it cannot start a paid run.
- The **PR author**, or a collaborator with **write access**, may use it. Each scenario is a
  live agent build, and this repo is public, so it is a spend gate.
- It covers the **wix-app gate only** for now. On a wix-manage PR it refuses and says so.
- It cannot help where a re-run would change nothing: a draft or closed PR, a fork branch, a
  commit the gate never ran for, or a gate job that was skipped. Push a commit instead.

**During the soak period** the gate posts its comment but does not block: it runs with
`blocking: false` until there is enough real-PR signal to turn it on. Read the comment
anyway — it is telling you what will block once it flips.

## wix-app scenarios: sync on merge

`wix-app` scenarios follow a different model. The repo YAML under
`yaml/wix-app-evals/` is the **source of truth**, and a workflow keeps the
EvalForge **App Builder** project aligned with it: when a PR that touches
`yaml/wix-app-evals/**` is merged into `main`,
`.github/workflows/evalforge-wix-app-sync.yml` runs the `evalforge-skill-gate`
action in **`sync` mode** and reconciles the YAML into EvalForge.

- **One-way** (repo → EvalForge). The sync writes scenarios to EvalForge; it
  never reads results back into the YAML.
- **CREATE / UPDATE / DELETE, matched by `name`.** A YAML scenario with no
  match in EvalForge is created; a matching one is updated; a scenario that
  was previously synced from the repo and whose YAML file was removed is
  deleted.
- **Deletes are scoped to what the repo manages.** Only scenarios carrying
  this repo's managed tag (`repo:wix/skills`) are ever deleted. Scenarios
  authored directly in the EvalForge UI (or by another repo) are left
  untouched — so removing a YAML file only removes *its own* previously-synced
  scenario, never a hand-made one.
- **Gated to `@wix.com` authors.** If the merged PR's author is not a
  `@wix.com` address, the sync is skipped (logged, not failed).
- **Applies on merge.** There is no per-PR run and no dry-run — the merge to
  `main` is what applies the plan.

## Working on the EvalForge actions themselves

The `.github/actions/evalforge-yaml-gate` (wix-manage flows) and
`.github/actions/evalforge-skill-gate` (wix-app flows) actions depend on the shared
`packages/evalforge-core` package (scenario schema, EvalForge API client,
YAML↔EvalForge mapper, auth) via a local `portal:` dependency, bundled into the
action's committed `dist/index.js` by `ncc`. CI runs that committed
bundle directly — there's no `yarn install`/build step in CI — so if you change
code in `packages/evalforge-core`, build the package first, then rebuild and
commit the consuming action's `dist`:

```bash
(cd packages/evalforge-core && yarn build)
(cd .github/actions/evalforge-yaml-gate && yarn build)
(cd .github/actions/evalforge-skill-gate && yarn build)
```

Use the `(cd DIR && yarn SCRIPT)` subshell form, not `yarn --cwd DIR SCRIPT` —
under Corepack, `--cwd` resolves the yarn version from the real process cwd, so
invoking it from the repo root can silently run the wrong yarn. See
[`packages/evalforge-core/README.md`](../packages/evalforge-core/README.md) for details.

Adding a dependency to `evalforge-core` also changes both consuming actions' lockfiles
through the `portal:` link, and CI runs `yarn install --immutable`. Run a plain
`yarn install` in `evalforge-core` **and** in both actions, then commit all three
`yarn.lock` files.

**The workflow YAML is tested too.** `evalforge-skill-gate/tests/workflow-config.test.ts`
asserts the wiring of the gate, cleanup and re-eval workflows, and
`tests/re-eval-script.test.ts` runs the re-eval `github-script` body the way the action
does — it compiles that exact string with stubbed `github`/`context`/`core`, so the guards
that decide whether money is spent have real tests despite living inside a YAML string.
That is why `ci.yml`'s change detection counts `.github/workflows/evalforge-*` as an
evalforge change: editing only a workflow must still run the tests written to cover it.

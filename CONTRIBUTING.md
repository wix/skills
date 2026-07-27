# Contributing to Skills

Thank you for your interest in contributing to skills. This document provides Wix-specific guidelines for adding and updating skill content in this repository.

> **Note:** For general Agent Skills format requirements, see the [Agent Skills specification](https://agentskills.io/home).

## Skill Placement

Do not add a new top-level folder under `skills/` by default.

Most new content should fit into one of the existing skill folders:

- `skills/wix-manage/` — REST API skills for managing Wix business solutions, sites, account-level resources, and administrative workflows.
- `skills/wix-app/` — building Wix app extensions, service plugins, dashboard pages, site widgets, backend code, and CLI-based app development.
- `skills/wix-design-system/` — Wix Design System component, API, and reference guidance.
- `skills/wix-headless/` — one-prompt headless site builds, templates, orchestration, and vertical-specific implementation guidance.

In this repo, many requests to add a "new skill" should actually be added as a new skill reference inside an existing skill. New top-level skills should only be added by repository admins.

## Adding a Wix Manage Skill

Use `wix-manage` for REST API operations that configure, set up, or manage Wix business entities and account/site resources.

If you are adding or changing `wix-manage` skills, do not open the PR from a fork. The automated evaluation bot verifies the PR branch against eval scenarios, and fork-based PRs cannot be used for that workflow.

If you do not have write permissions for this repository, please read [bo.wix.com/github-assist](https://bo.wix.com/github-assist) for the approved contribution path.

When adding a `wix-manage` skill:

1. Add the skill markdown under `skills/wix-manage/references/<area>/<skill>.md`.
2. Add a short entry to the relevant section in `skills/wix-manage/SKILL.md`.
3. Add the skill to `yaml/wix-manage/<area>/documentation.yaml`.
4. **Add at least one eval scenario** for the skill under `yaml/wix-manage-evals/<area>/<skill>.yml`. See [Adding a Wix Manage Eval Scenario](#adding-a-wix-manage-eval-scenario) below.
5. Include at least one valid EvalForge tag, for example `domains`, `stores`, `bookings`, or another existing tag that matches the skill.
6. Keep the skill focused on public Wix REST APIs or documented SDK APIs. Do not translate internal gRPC names or internal-only APIs into public skills.
7. Keep the skill's `description` to at most 1024 characters.

## Adding a Wix Manage Eval Scenario

Every `wix-manage` skill should have at least one **eval scenario** — a YAML file that describes a realistic user request and how to verify the agent handled it correctly. PRs that modify a skill `.md` without a covering scenario will fail the automated evaluation check.

### Where to put it

Put the scenario under `yaml/wix-manage-evals/<area>/` matching the skill's area in `skills/wix-manage/references/<area>/`. Subfolders are fine.

Each scenario's `name` must be unique across the whole `yaml/wix-manage-evals/` tree, lowercase, and may contain `/`, `_`, `-`.

### Required fields

On top of the [common fields](#common-scenario-fields):

| Field | What it is |
|---|---|
| `tags` | An array of one or more tags. Must include a production tag for the area (e.g. `[domains]`, `[stores]`, `[bookings]`). |
| `siteSetup` | Optional. Provisions a fresh isolated Wix site for the run — see [Site provisioning](#site-provisioning-optional). |

### Assertions to include

Include **both**: a tool-call assertion is what makes a scenario cover its doc, and the `llm_judge` checks the response is correct.

**1. A tool-call assertion on `ReadFullDocsArticle` with the skill's doc URL** — proves the agent actually loaded the skill's content. You write it with a `tool:` field naming the doc-reading tool call (its schema type is `tool_called_with_param`; the `type` key is optional and normally omitted):

```yaml
- tool: ReadFullDocsArticle
  params:
    articleUrl: https://dev.wix.com/docs/api-reference/<...>/skills/<skill-name>
```

The `articleUrl` must match the doc URL for the skill — built as `<docsEntry>/skills/<slug>`, where `<docsEntry>` and the skill's `title` come from its entry in `yaml/wix-manage/<area>/documentation.yaml`, and `<slug>` is that `title` slugified (lowercased, spaces/punctuation → `-`). For example `title: "Abandoned Carts"` → `…/skills/abandoned-carts`.

**2. An `llm_judge` assertion** — proves the agent's response was substantively correct, not just that it loaded the docs.

```yaml
- type: llm_judge
  minScore: 7
  prompt: |
    <Pass/fail criteria specific to this scenario>
```

Without the `llm_judge`, a scenario passes whenever the agent reads the doc, even if the response is wrong or unhelpful. Without the tool-call assertion, the judge can pass on a fabricated response that never touched the skill at all — and the scenario won't cover its doc. That's why you include both.

Beyond these two, you can add other assertions (`api_call`, `cost`, `time_limit`) — see [Assertion Types](#assertion-types) for the full catalog.

### Example

```yaml
name: domains/domain-search-and-purchase
description: Verifies the agent reads the domain-search-and-purchase docs when asked about searching for and purchasing a domain via the Wix API.
triggerPrompt: How do I programmatically search for an available domain on Wix and then purchase it? Please reference the relevant API methods.
tags: [domains]
maxTokens: 25000
assertions:
  - tool: ReadFullDocsArticle
    params:
      articleUrl: https://dev.wix.com/docs/api-reference/account-level/domains/skills/domain-search-and-purchase
  - type: llm_judge
    minScore: 7
    maxTokens: 2048
    prompt: |
      The user's request: "How do I programmatically search for an available domain on Wix and then purchase it? Please reference the relevant API methods."
      Intent: surface Wix Domains Management API methods/endpoints for searching availability and purchasing a domain.

      Pass if the response:
      - mentions specific Wix API endpoints, method names, or REST paths from the Wix Domains Management API for search and/or purchase, AND
      - describes the high-level flow (search → check availability → purchase) using terminology consistent with the docs.

      Fail if the response:
      - is generic with no specific endpoints or method names, OR
      - hallucinates endpoints not in the Wix Domains Management API, OR
      - describes a different Wix feature (e.g. domain connection rather than purchase).
```

Top-level `maxTokens` is enforced by this repository's GitHub Actions gate after the PR-vs-production eval comparison finishes. It applies to the PR run's total tokens for the whole scenario. This is different from `llm_judge.maxTokens`, which is passed to the judge model as an output/config limit for that assertion only.

### Site provisioning (optional)

By default a scenario runs against a shared test site. To run against a **fresh, isolated site** instead, add a `siteSetup` block (a **site template**). The site is provisioned before the run, its ID is made available to the agent, and it is torn down afterward.

```yaml
siteSetup:
  mode: template                 # optional — 'template' is the only mode, and the default
  templateId: stores-v3-editor   # Wix template alias or template GUID
  bootstrap:                     # optional — seed data into the fresh site
    steps:
      - label: seed a product
        method: post             # get | post | put | patch | delete
        url: https://www.wixapis.com/stores/v3/products
        body:
          product:
            name: Demo Product
            productType: PHYSICAL
            physicalProperties: {}
            variantsInfo:
              variants:
                - price: { actualPrice: { amount: "42.50" } }
                  physicalProperties: {}
                  visible: true
```

- `siteSetup.templateId` — a Wix template alias (e.g. `stores-v3-editor`, `blank-editor`, `bookings-editor`) or a template GUID.
- `bootstrap.steps` — ordered HTTP calls run against the new site before the agent runs. They are fail-fast: a non-2xx step fails the run.
- Do **not** use a `{{site-id}}` run variable in `triggerPrompt` together with `siteSetup` — the provisioned site supplies the id.

## Updating a Wix App Reference

When updating `wix-app` skill content:

1. Add or update the content under `skills/wix-app/SKILL.md` or `skills/wix-app/references/<name>.md`.
2. Update the relevant index entry in `skills/wix-app/SKILL.md`.
3. **Every change must be covered by an eval scenario** under `yaml/wix-app-evals/`, tagged for the area(s) you changed — reuse an existing one if it fits, otherwise add a new one. See [Adding a Wix App Eval Scenario](#adding-a-wix-app-eval-scenario) below.
4. Keep the skill's `description` to at most 1024 characters.

## Adding a Wix App Eval Scenario

Every `wix-app` skill change should be covered by an **eval scenario** — a YAML file describing a realistic build request and how to verify the agent handled it. `wix-app` scenarios are the **source of truth** in the repo and sync to EvalForge on merge (see [wix-app scenarios: sync on merge](#wix-app-scenarios-sync-on-merge)); they're selected by **tag**.

### Where to put it

Put the scenario under `yaml/wix-app-evals/` — flat, or grouped into area subfolders. Each scenario's `name` must be unique across the tree, lowercase, and may contain `/`, `_`, `-`.

### Required fields

On top of the [common fields](#common-scenario-fields):

| Field | What it is |
|---|---|
| `tags` | An array of one or more tags for the reference files / areas the scenario depends on (e.g. `[dashboard-page]`, `[dashboard-plugin]`, `[service-plugin]`, `[editor-react-component]`, `[data-collection]`). Tags drive which scenarios re-run when a reference file changes — see [Tagging](#tagging). |
| `templateId` | Optional **file template** — scaffolds the run's starter project/app from an EvalForge template (id or alias). See [File templates](#file-templates). |

### Tagging

Tags aren't just for grouping — they drive **coverage**. When a reference file under `skills/wix-app/references/**` changes, the eval gate re-runs every scenario carrying that file's tag. Tagging is therefore how the repo knows *which scenarios must run for a given change*.

The convention:

- **One tag per reference file, derived from its filename** — lowercase, `_` → `-`, drop the `.md`. So `references/DASHBOARD_PAGE.md` → `dashboard-page`, `references/SERVICE_PLUGIN.md` → `service-plugin`. Broader area tags (e.g. `data-collection`) are fine on top when a scenario exercises a cross-cutting capability.
- **Tag every reference file the scenario depends on — including files whose behavior it deliberately *avoids*.** This is **many-to-many**: a file maps to many scenarios (all carrying its tag), and a scenario carries many tags. A scenario that must **not** create a dashboard page still tags `[dashboard-page]`, so it re-runs when `DASHBOARD_PAGE.md` changes and proves the "don't create it" path still holds. That's a **negative dependency** — and it's why a plain "the scenario builds X → tag X" rule isn't enough.
- **Whether the file *should* or *shouldn't* be used lives in the assertions, not the tag.** The tag decides *when a scenario runs*; the assertions decide *what passing means*. Require a file was read with `skill_was_called` + `referenceFiles`; require it was **not** read with `negate: true`; and prove the actual behavior with the `llm_judge`.

**Positive dependency** — must build a dashboard page (must use `DASHBOARD_PAGE.md`):

```yaml
tags: [dashboard-page]
assertions:
  - type: skill_was_called
    skillNames: [wix-app]
    referenceFiles: { wix-app: [references/DASHBOARD_PAGE.md] }
  - type: llm_judge
    minScore: 7
    prompt: |
      The app must include a working dashboard page. ...
```

**Negative dependency** — must **not** create a dashboard page, but still re-runs when `DASHBOARD_PAGE.md` changes:

```yaml
tags: [dashboard-page]        # same tag → re-runs on DASHBOARD_PAGE.md changes
assertions:
  - type: skill_was_called    # the skill is still used (for whatever it does build)
    skillNames: [wix-app]
  - type: skill_was_called    # ...but the dashboard-page reference must NOT be used
    skillNames: [wix-app]
    referenceFiles: { wix-app: [references/DASHBOARD_PAGE.md] }
    negate: true
  - type: llm_judge           # the behavioral proof: no dashboard page was created
    minScore: 7
    prompt: |
      The app must NOT contain a dashboard page. ...
```

### Assertions to include

Include **both**: `skill_was_called` is what ties the scenario to the skill, and the `llm_judge` checks the output is correct.

**1. A `type: skill_was_called` assertion** — proves the agent actually invoked the skill:

```yaml
- type: skill_was_called
  skillNames: [wix-app]
  # optionally require specific reference files were read:
  # referenceFiles: { wix-app: [references/DASHBOARD_PAGE.md] }
```

**2. An `llm_judge` assertion** — proves the agent's output was substantively correct, not just that it loaded the skill.

```yaml
- type: llm_judge
  minScore: 7
  prompt: |
    <Pass/fail criteria specific to this scenario>
```

Beyond these two, `wix-app` scenarios often add `build_passed`, and you can use `token_count`, `cost`, or `time_limit` — see [Assertion Types](#assertion-types) for the full catalog.

### File templates

A `wix-app` scenario usually scaffolds its starter project from a **file template** — the top-level `templateId`, an EvalForge template (id or alias). It maps to `templateId` on the EvalForge run:

```yaml
templateId: 8116ffa2-e212-4a74-a9f0-1738c9cbb6b1
```

This is the **default template all wix-app runs start from**.

(Distinct from the wix-manage **site template**, `siteSetup`, which provisions a live Wix site — see [Site provisioning](#site-provisioning-optional). The current `wix-app` scenarios use only the file template.)

### Example

See [`yaml/wix-app-evals/employee-shift-dashboard.yml`](yaml/wix-app-evals/employee-shift-dashboard.yml) for a real scenario — it also demonstrates the negative-dependency pattern from [Tagging](#tagging) above (asserting `AUTO_PATTERNS_DASHBOARD.md` and `DATA_COLLECTION.md` were used, and `DASHBOARD_PAGE.md` was not).

## Common Scenario Fields

Every eval scenario — `wix-manage` or `wix-app` — has these fields. Each skill's *Required fields* adds its own `tags` and template rows on top.

| Field | What it is |
|---|---|
| `name` | A stable identifier, conventionally `<area>/<name>`. Must be unique within its evals tree, lowercase, and may contain `/`, `_`, `-`. |
| `description` | One or two sentences describing what the scenario verifies. |
| `triggerPrompt` | The natural-language request you'd expect a real user to make. Minimum 10 characters. |
| `maxTokens` | Optional top-level PR-run token budget for this scenario. If the PR eval run exceeds this total token count, the GitHub Actions gate fails. |
| `assertions` | A non-empty array of assertions that decide whether the scenario passed (schema requires at least one). Pair a coverage assertion with an `llm_judge` — see [Assertion Types](#assertion-types). |

## Assertion Types

Assertions decide whether a scenario passed; the schema requires at least one, and you should pair a coverage assertion with an `llm_judge`. You can mix any of these in a single scenario:

| Assertion | Skill | What it does |
|---|---|---|
| tool-call (`tool:` field, type `tool_called_with_param`) | `wix-manage` | **Coverage** — asserts the agent invoked the skill via the specific tool call that loads its doc (e.g. `ReadFullDocsArticle`). Substring matching on string values. |
| `type: skill_was_called` | `wix-app` | **Coverage** — proves a skill was invoked by name (`skillNames`); optional `referenceFiles` requires specific reference docs were read. |
| `type: llm_judge` | both | An LLM rubric that scores the agent's final response 0–10 against your `prompt`. Set `browserTools: true` to let the judge drive a provisioned site's published URL. |
| `type: build_passed` | `wix-app` | Runs a build command (`command`, default `npm run build`) and checks the exit code; use when the scenario generates a buildable app. |
| `type: token_count` | `wix-app` | Fails if total LLM token usage exceeds `maxTokens`. |
| `type: api_call` | both | Makes an HTTP request after the scenario runs and validates the response (end-to-end state checks). |
| `type: cost` | both | Fails if the run exceeded a USD cost ceiling. |
| `type: time_limit` | both | Fails if the run exceeded a duration ceiling. |

## Writing Wix API Skills

Connect an agent to the Wix MCP and use official docs, examples, and method schemas to verify any API skill. Do not rely on memory, copied internal service names, or old examples.

The best source for a skill is often a real agent conversation where the agent successfully completed the task. After the task works, ask the agent to distill the happy path, the API details it had to discover, and the missing context it needed to know up front.

Before adding skill guidance, first ask whether the fix belongs in the public API, docs, examples, or MCP docs surface. Add a skill only when those sources are correct but still do not connect the dots for an agent. Keep the skill minimal: document the decision flow, the verified API details, and the sharp edges needed to complete the task.

For mutating flows, ask for user confirmation before changing site or account data unless the surrounding skill already makes the mutation an explicit user-confirmed action.

## Skill Evaluation

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

### wix-app scenarios: sync on merge

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

### Working on the EvalForge actions themselves

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
`packages/evalforge-core/README.md` for details.

## PR Checklist

Before opening a PR, confirm:

- The content is in the right existing skill. New top-level skills are admin-only.
- Each skill's `description` is at most 1024 characters.
- The relevant `SKILL.md` index is updated.
- Any new `wix-manage` skill is listed in the relevant `yaml/wix-manage/<area>/documentation.yaml`.
- Any new or modified `wix-manage` skill has at least one covering eval scenario under `yaml/wix-manage-evals/<area>/`, with a tool-call assertion (`tool:`) plus an `llm_judge`.
- Any new or modified `wix-app` skill content (`skills/wix-app/SKILL.md` or `skills/wix-app/references/**`) is covered by a scenario under `yaml/wix-app-evals/`, with a `skill_was_called` assertion plus an `llm_judge`.
- Wix API details were checked against official docs through the Wix MCP docs tools, or distilled from a successful agent run.
- Mutating flows ask for user confirmation before changing site or account data.
- The skill evaluation workflow is expected to run for the changed files, if applicable.

## Questions

If you're unsure about where to place new content or how to structure it:

- Review existing skills for patterns.
- Ask a repository admin if you think a new top-level skill is required.
- Refer to the [Agent Skills specification](https://agentskills.io/home) for base format requirements.

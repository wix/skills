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

When adding a `wix-manage` skill:

1. Add the skill markdown under `skills/wix-manage/references/<area>/<skill>.md`.
2. Add a short entry to the relevant section in `skills/wix-manage/SKILL.md`.
3. Add the skill to `yaml/wix-manage/<area>/documentation.yaml`.
4. **Add at least one eval scenario** for the skill under `yaml/wix-manage-evals/<area>/<skill>.yml`. See [Adding an Eval Scenario](#adding-an-eval-scenario) below.
5. Include at least one valid EvalForge tag, for example `domains`, `stores`, `bookings`, or another existing tag that matches the skill.
6. Keep the skill focused on public Wix REST APIs or documented SDK APIs. Do not translate internal gRPC names or internal-only APIs into public skills.

## Adding an Eval Scenario

Every `wix-manage` skill should have at least one **eval scenario** — a YAML file that describes a realistic user request and how to verify the agent handled it correctly. PRs that modify a skill `.md` without a covering scenario will fail the automated evaluation check.

### Where to put it

Put the scenario under `yaml/wix-manage-evals/<area>/` matching the skill's area in `skills/wix-manage/references/<area>/`. Subfolders are fine.

Each scenario's `name` field must be unique across the whole `yaml/wix-manage-evals/` tree.

### Required fields

| Field | What it is |
|---|---|
| `name` | A stable identifier, conventionally `<area>/<skill-name>` (must be lowercase, may contain `/`, `_`, `-`). |
| `description` | One or two sentences describing what the scenario verifies. |
| `triggerPrompt` | The natural-language request you'd expect a real user to make. Minimum 10 characters. |
| `tags` | An array of one or more tags. Must include a production tag for the area (e.g. `[domains]`, `[stores]`, `[bookings]`). |
| `maxTokens` | Optional top-level PR-run token budget for this scenario. If the PR eval run exceeds this total token count, the GitHub Actions gate fails. |
| `assertions` | A non-empty array of assertions that decide whether the scenario passed. The schema requires at least one; you should include both a `tool` assertion (proves the skill was invoked) and an `llm_judge` assertion (proves the response was correct) — see below. |

### Assertions to include

Include **both** of the following — the `tool` assertion is what makes a scenario cover its doc, and the `llm_judge` checks the response is correct:

**1. A `tool` assertion on `ReadFullDocsArticle` with the skill's doc URL** — proves the agent actually loaded the skill's content.

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

Without the `llm_judge`, a scenario passes whenever the agent reads the doc, even if the response is wrong or unhelpful. Without the `tool` assertion, the judge can pass on a fabricated response that never touched the skill at all — and the scenario won't cover its doc. That's why you should include both.

### Assertion types

You can mix these in a single scenario:

- **`tool`** (required for doc coverage) — proves the agent actually invoked the skill by asserting on the specific tool call that loads the skill's content. Substring matching on string values, so a partial value is OK.
- **`type: llm_judge`** (recommended) — an LLM rubric that scores the agent's final response on a 0–10 scale. You write the pass/fail criteria in the `prompt` field.
- **`type: api_call`** — makes an HTTP request after the scenario runs and validates the response (use for end-to-end checks of state changes).
- **`type: cost`** — fails if the run exceeded a USD cost ceiling.
- **`type: time_limit`** — fails if the run exceeded a duration ceiling.

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

By default a scenario runs against a shared test site. To run against a **fresh, isolated site** instead, add a `siteSetup` block. The site is provisioned before the run, its ID is made available to the agent, and it is torn down afterward.

```yaml
siteSetup:
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

- `templateId` — a Wix template alias (e.g. `stores-v3-editor`, `blank-editor`, `bookings-editor`) or a template GUID.
- `bootstrap.steps` — ordered HTTP calls run against the new site before the agent runs. They are fail-fast: a non-2xx step fails the run.
- Do **not** use a `{{site-id}}` run variable in `triggerPrompt` together with `siteSetup` — the provisioned site supplies the id.

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

## PR Checklist

Before opening a PR, confirm:

- The content is in the right existing skill. New top-level skills are admin-only.
- The relevant `SKILL.md` index is updated.
- Any new `wix-manage` skill is listed in the relevant `yaml/wix-manage/<area>/documentation.yaml`.
- Any new or modified `wix-manage` skill has at least one covering eval scenario under `yaml/wix-manage-evals/<area>/`.
- Every eval scenario includes both a `tool` assertion (skill was invoked) and an `llm_judge` assertion (response was substantively correct).
- Wix API details were checked against official docs through the Wix MCP docs tools, or distilled from a successful agent run.
- Mutating flows ask for user confirmation before changing site or account data.
- The skill evaluation workflow is expected to run for the changed files, if applicable.

## Questions

If you're unsure about where to place new content or how to structure it:

- Review existing skills for patterns.
- Ask a repository admin if you think a new top-level skill is required.
- Refer to the [Agent Skills specification](https://agentskills.io/home) for base format requirements.

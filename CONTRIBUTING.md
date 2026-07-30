# Contributing to Skills

Thank you for your interest in contributing to skills. This document provides Wix-specific guidelines for adding and updating skill content in this repository.

> **Note:** For general Agent Skills format requirements, see the [Agent Skills specification](https://agentskills.io/home).

Two companion documents carry the detail, so this one stays the entry point:

| Document | When you need it |
|---|---|
| [docs/eval-scenarios.md](docs/eval-scenarios.md) | Writing or editing an eval scenario — required fields, tagging, assertion types, examples |
| [docs/skill-evaluation.md](docs/skill-evaluation.md) | Understanding a failing check, or working on the eval workflows themselves |

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
4. **Add at least one eval scenario** for the skill under `yaml/wix-manage-evals/<area>/<skill>.yml`. See [Adding a Wix Manage Eval Scenario](docs/eval-scenarios.md#adding-a-wix-manage-eval-scenario).
5. Include at least one valid EvalForge tag, for example `domains`, `stores`, `bookings`, or another existing tag that matches the skill.
6. Keep the skill focused on public Wix REST APIs or documented SDK APIs. Do not translate internal gRPC names or internal-only APIs into public skills.
7. Keep the skill's `description` to at most 1024 characters.

## Updating a Wix App Reference

When updating `wix-app` skill content:

1. Add or update the content under `skills/wix-app/SKILL.md` or `skills/wix-app/references/<name>.md`.
2. Update the relevant index entry in `skills/wix-app/SKILL.md`.
3. **Every change must be covered by an eval scenario** under `yaml/wix-app-evals/`, tagged for the area(s) you changed — reuse an existing one if it fits, otherwise add a new one. See [Adding a Wix App Eval Scenario](docs/eval-scenarios.md#adding-a-wix-app-eval-scenario).
4. Keep the skill's `description` to at most 1024 characters.

## Writing Wix API Skills

Connect an agent to the Wix MCP and use official docs, examples, and method schemas to verify any API skill. Do not rely on memory, copied internal service names, or old examples.

The best source for a skill is often a real agent conversation where the agent successfully completed the task. After the task works, ask the agent to distill the happy path, the API details it had to discover, and the missing context it needed to know up front.

Before adding skill guidance, first ask whether the fix belongs in the public API, docs, examples, or MCP docs surface. Add a skill only when those sources are correct but still do not connect the dots for an agent. Keep the skill minimal: document the decision flow, the verified API details, and the sharp edges needed to complete the task.

For mutating flows, ask for user confirmation before changing site or account data unless the surrounding skill already makes the mutation an explicit user-confirmed action.

## PR Checklist

Before opening a PR, confirm:

- The content is in the right existing skill. New top-level skills are admin-only.
- Each skill's `description` is at most 1024 characters.
- The relevant `SKILL.md` index is updated.
- Any new `wix-manage` skill is listed in the relevant `yaml/wix-manage/<area>/documentation.yaml`.
- Any new or modified `wix-manage` skill has at least one covering eval scenario under `yaml/wix-manage-evals/<area>/`, with a tool-call assertion (`tool:`) plus an `llm_judge`.
- Any new or modified `wix-app` skill content (`skills/wix-app/SKILL.md` or `skills/wix-app/references/**`) is covered by a scenario under `yaml/wix-app-evals/`, with a `skill_was_called` assertion plus an `llm_judge`.
- The [wix-app eval gate](docs/skill-evaluation.md#wix-app-scenarios-the-pr-eval-gate) comment has been read: no uncovered tags, and any scenario you added or edited has at least 3 assertions including an `llm_judge`.
- Wix API details were checked against official docs through the Wix MCP docs tools, or distilled from a successful agent run.
- Mutating flows ask for user confirmation before changing site or account data.
- The skill evaluation workflow is expected to run for the changed files, if applicable.

## Questions

If you're unsure about where to place new content or how to structure it:

- Review existing skills for patterns.
- Ask a repository admin if you think a new top-level skill is required.
- Refer to the [Agent Skills specification](https://agentskills.io/home) for base format requirements.

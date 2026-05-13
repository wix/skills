# Contributing to Skills

Thank you for your interest in contributing to skills. This document provides Wix-specific guidelines for adding and updating skill content in this repository.

> **Note:** For general Agent Skills format requirements, see the [Agent Skills specification](https://agentskills.io/home).

## Skill Placement

Do not add a new top-level folder under `skills/` by default.

Most new content should fit into one of the existing skill folders:

- `skills/wix-manage/` — REST API recipes for managing Wix business solutions, sites, account-level resources, and administrative workflows.
- `skills/wix-app/` — building Wix app extensions, service plugins, dashboard pages, site widgets, backend code, and CLI-based app development.
- `skills/wix-design-system/` — Wix Design System component, API, and reference guidance.
- `skills/wix-headless/` — one-prompt headless site builds, templates, orchestration, and vertical-specific implementation guidance.

In this repo, many requests to add a "new skill" should actually be added as a new skill reference or recipe inside an existing skill. Add a new top-level skill only when the content cannot reasonably belong to an existing skill and a maintainer has agreed to that structure.

## Adding a Wix Manage Recipe

Use `wix-manage` for REST API operations that configure, set up, or manage Wix business entities and account/site resources.

When adding a `wix-manage` recipe:

1. Add the recipe markdown under `skills/wix-manage/references/<area>/<recipe>.md`.
2. Add a short entry to the relevant section in `skills/wix-manage/SKILL.md`.
3. Add the recipe to `yaml/wix-manage/<area>/documentation.yaml`.
4. Include at least one valid EvalForge tag, for example `domains`, `stores`, `bookings`, or another existing tag that matches the recipe.
5. Keep the recipe focused on public Wix REST APIs or documented SDK APIs. Do not translate internal gRPC names or internal-only APIs into public recipes.

## Writing Wix API Recipes

Connect an agent to the Wix MCP and use official docs, examples, and method schemas to verify any API recipe. Do not rely on memory, copied internal service names, or old examples.

The best source for a recipe is often a real agent conversation where the agent successfully completed the task. After the task works, ask the agent to distill the happy path, the API details it had to discover, and the missing context it needed to know up front.

Before adding skill guidance, first ask whether the fix belongs in the public API, docs, examples, or MCP docs surface. Add a skill recipe only when those sources are correct but still do not connect the dots for an agent. Keep that recipe minimal: document the decision flow, the verified API details, and the sharp edges needed to complete the task.

For mutating flows, ask for user confirmation before changing site or account data unless the surrounding recipe already makes the mutation an explicit user-confirmed action.

## Skill Evaluation

The automated skill evaluation currently runs for PR changes under:

- `skills/wix-manage/references/**`
- `yaml/wix-manage/**`

The YAML entry is how a changed recipe maps to EvalForge tags and scenarios. If a `wix-manage` recipe is not added to `yaml/wix-manage/<area>/documentation.yaml`, it may not be evaluated.

When the workflow runs, it creates an EvalForge MCP capability version that points at the PR:

```text
https://mcp.wix.com/mcp?skillsRepo=wix/skills&skillsPr=<headSha>
```

That PR override makes the Wix MCP load skill content from the pull request instead of from `main`, so eval scenarios test the proposed recipe content.

## PR Checklist

Before opening a PR, confirm:

- The content is in the right existing skill, or a maintainer approved a new top-level skill.
- The relevant `SKILL.md` index is updated.
- Any new `wix-manage` recipe is listed in the relevant `yaml/wix-manage/<area>/documentation.yaml`.
- Wix API details were checked against official docs through the Wix MCP docs tools, or distilled from a successful agent run.
- Mutating flows ask for user confirmation before changing site or account data.
- The skill evaluation workflow is expected to run for the changed files, if applicable.

## Questions

If you're unsure about where to place new content or how to structure it:

- Review existing skills for patterns.
- Open an issue or ask a maintainer before adding a new top-level skill.
- Refer to the [Agent Skills specification](https://agentskills.io/home) for base format requirements.

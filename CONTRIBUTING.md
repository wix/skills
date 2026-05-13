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

Validate API recipes against the Wix MCP docs tools before opening a PR. Do not rely on memory, copied internal service names, or old examples.

Recommended workflow:

1. Use `WixREADME` to find existing recipes and the right category.
2. Use `SearchWixRESTDocumentation` to find the relevant REST method.
3. Use `ReadFullDocsArticle` for method behavior and examples.
4. Use `ReadFullDocsMethodSchema` for exact endpoint paths, request fields, response fields, enum values, and permissions.

Verify every API detail the recipe depends on:

- HTTP method and full endpoint path.
- Whether the API is account-level or site-level, and which headers are required.
- Required permissions/scopes.
- Request body shape and required fields.
- Response fields used by the recipe.
- Enum values such as statuses, types, and modes.
- Documented error codes and failure cases.

Prefer method schemas over examples when they disagree. Examples can be incomplete or stale; the method schema is the source of truth for field names, required fields, and enum values. If a recipe depends on a field that appears in examples or sample flows but not in the method schema, call that out in the recipe or verify it with the API owner before relying on it.

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
- Wix API endpoints, schemas, permissions, request bodies, response fields, and enum values were checked against the Wix MCP docs tools.
- Mutating flows ask for user confirmation before changing site or account data.
- The skill evaluation workflow is expected to run for the changed files, if applicable.

## Questions

If you're unsure about where to place new content or how to structure it:

- Review existing skills for patterns.
- Open an issue or ask a maintainer before adding a new top-level skill.
- Refer to the [Agent Skills specification](https://agentskills.io/home) for base format requirements.

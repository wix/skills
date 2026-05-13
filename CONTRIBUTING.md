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
4. Include at least one valid EvalForge tag, for example `domains`, `stores`, `bookings`, or another existing tag that matches the skill.
5. Keep the skill focused on public Wix REST APIs or documented SDK APIs. Do not translate internal gRPC names or internal-only APIs into public skills.

## Writing Wix API Skills

Connect an agent to the Wix MCP and use official docs, examples, and method schemas to verify any API skill. Do not rely on memory, copied internal service names, or old examples.

The best source for a skill is often a real agent conversation where the agent successfully completed the task. After the task works, ask the agent to distill the happy path, the API details it had to discover, and the missing context it needed to know up front.

Before adding skill guidance, first ask whether the fix belongs in the public API, docs, examples, or MCP docs surface. Add a skill only when those sources are correct but still do not connect the dots for an agent. Keep the skill minimal: document the decision flow, the verified API details, and the sharp edges needed to complete the task.

For mutating flows, ask for user confirmation before changing site or account data unless the surrounding skill already makes the mutation an explicit user-confirmed action.

## Skill Evaluation

The automated skill evaluation currently runs for PR changes under:

- `skills/wix-manage/references/**`
- `yaml/wix-manage/**`

The YAML entry is how a changed skill maps to EvalForge tags and scenarios. If a `wix-manage` skill is not added to `yaml/wix-manage/<area>/documentation.yaml`, it may not be evaluated.

When the workflow runs, it creates an EvalForge MCP capability version that points at the PR:

```text
https://mcp.wix.com/mcp?skillsRepo=wix/skills&skillsPr=<headSha>
```

That PR override makes the Wix MCP load skill content from the pull request instead of from `main`, so eval scenarios test the proposed skill content.

Use evaluation as a loop, not a one-time check. Review the failures, tighten the skill, and rerun until performance is good enough for the target scenarios.

## PR Checklist

Before opening a PR, confirm:

- The content is in the right existing skill. New top-level skills are admin-only.
- The relevant `SKILL.md` index is updated.
- Any new `wix-manage` skill is listed in the relevant `yaml/wix-manage/<area>/documentation.yaml`.
- Wix API details were checked against official docs through the Wix MCP docs tools, or distilled from a successful agent run.
- Mutating flows ask for user confirmation before changing site or account data.
- The skill evaluation workflow is expected to run for the changed files, if applicable.

## Questions

If you're unsure about where to place new content or how to structure it:

- Review existing skills for patterns.
- Ask a repository admin if you think a new top-level skill is required.
- Refer to the [Agent Skills specification](https://agentskills.io/home) for base format requirements.

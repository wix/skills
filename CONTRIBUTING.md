# Contributing to Skills

Thank you for your interest in improving these skills.

## How to contribute

[Open an issue](https://github.com/wix/skills/issues/new) describing the problem or the change
you'd like. Pull requests are not merged in this repository: a pull request is read as a
proposal, and the maintainers make the change if it is accepted.

## What makes a useful report

Name the skill and the file, and say what an agent got wrong or could not do. The most useful
reports include:

- **The request.** What the user asked the agent to do.
- **What happened.** The call the agent made, or the step it got stuck on, and the error or
  wrong result.
- **The correct behavior.** What the skill should have said instead, with a link to the
  official [Wix API reference](https://dev.wix.com/docs/rest) that confirms it. A plausible but
  unverified fix is worse than none, because an agent will trust it.

## What a skill change should look like

If you propose wording, it is held to the same standard as every skill here:

- It covers public Wix REST APIs or documented SDK APIs only.
- It shows each call an agent needs: the full URL with host, the HTTP method, and a minimal
  request body, with the reference page linked for the full contract.
- It gives orders, not suggestions, where the agent has to decide, and keeps steps whose order
  matters in that order.
- It names no specific agent, client, MCP tool, model or editor — it describes the capability
  it needs instead.
- It asks the user to confirm before changing site or account data.

For the base file format, see the [Agent Skills specification](https://agentskills.io/home).

<!-- automations-sync-maintenance -->
## Synced skill areas

**Files under `skills/wix-manage/references/automations/` and `yaml/wix-manage/automations/`
(and the marked Automations section of `skills/wix-manage/SKILL.md`) are generated from a
source maintained by the Wix Automations team. The next sync replaces any file that differs
from the generated output, so an accepted edit persists only once the maintainer ports it to
that source.**

Public fixes remain welcome. The Automations maintainer ports accepted changes back before
syncing again, so they survive regeneration.
<!-- /automations-sync-maintenance -->

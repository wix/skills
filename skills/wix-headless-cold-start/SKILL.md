---
name: wix-headless-cold-start
description: "The fetch-and-follow entry pages for Wix Headless, addressable by URL in a prompt. headless-kit.md starts a wix-headless-kit run and headless.md a wix-headless run: each takes a cold machine through the Wix CLI check and login, installs the skill it belongs to, and hands off to that skill's SKILL.md. This folder holds the pages and nothing else."
---

# Wix Headless cold starts

Two pages, one per skill. Each is given to an agent as a URL inside a prompt, for example
"build an online store using: https://www.wix.com/skills/headless-cold-start/headless-kit.md",
and does the same three things: run the bootstrap script that checks the Wix CLI and logs the
user in, install the skill it belongs to and its companions, then open that skill's `SKILL.md`,
which owns the rest of the run.

| Page | Starts | Same page inside the skill |
|---|---|---|
| `headless-kit.md` | `wix-headless-kit` (shipped, verified per-solution code) | `wix-headless-kit/cold-start/cold-start.md` |
| `headless.md` | `wix-headless` (recipes and the SDK guide) | `wix-headless/entry/skill.md` |

The copies here are byte-identical to the pages inside the skills; a change lands in both.

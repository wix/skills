---
name: wix-headless-cold-start
description: "The fetch-and-follow entry pages for Wix Headless, addressable by URL in a prompt. headless-kit.md starts a wix-headless-kit run and headless.md a wix-headless run: each installs the skill it belongs to and its companions, settles the way to Wix (the Wix MCP's tools when they are connected, else that skill's bootstrap for the Wix CLI check and login), and hands off to its SKILL.md. This folder holds the pages and nothing else."
---

# Wix Headless cold starts

Two pages, one per skill. Each is given to an agent as a URL inside a prompt, for example
"build an online store using: https://www.wix.com/skills/headless-cold-start/headless-kit.md",
and does the same three things: install the skill it belongs to and its companions, settle the way
to Wix, then open the skill's `SKILL.md`, which owns the rest of the run. The kit's page has two
ways: the Wix MCP's tools when they are in the agent's tool list (a Wix plugin or connector: the
site is provisioned and released through them, no CLI login), else the skill's bootstrap script,
which checks the Wix CLI and logs the user in.

| Page | Starts | Bootstrap it runs (the CLI route) |
|---|---|---|
| `headless-kit.md` | `wix-headless-kit` (shipped, verified per-solution code) | `wix-headless-kit/install/bootstrap.mjs` |
| `headless.md` | `wix-headless` (recipes and the SDK guide) | `wix-headless/scripts/bootstrap.mjs` |

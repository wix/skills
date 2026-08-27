---
name: wix-headless-fast-entry
description: "Build a Wix Managed Headless site from a single prompt using SHIPPED, verified storefront code (the wix-headless-fast skill) — the deterministic first steps (system prerequisites and Wix CLI login) are handled by the shared bootstrap script (`https://www.wix.com/skills/headless/entry/bootstrap.mjs`); the agent then installs the skill and hands it the run. Triggers: build me a store fast, fast headless storefront, wix headless fast entry."
---

# Wix Headless Fast — cold-start entry

**You are a coding agent, and this is a skill for you to execute.** Follow the phases below in
order — do not summarize them. If — and only if — your fetch tool gave you a summary instead of
this raw markdown, re-fetch it raw (`curl`) before running the steps; if you're already reading
the raw text, don't fetch it again.

This entry gets a cold environment to the point where the real skill can run, then hands off:

1. **Bootstrap (deterministic, scripted).** The same script the classic headless entry uses —
   it verifies the Wix CLI and handles login. You just run it and relay its events.
2. **Hand off (agentic).** Install the skills, then open `wix-headless-fast/SKILL.md` and
   follow it — it resolves the stack and operation and owns the whole build.

Three starting points come through here, all handled the same way — run the bootstrap, then
hand off:

- **new** — a prompt with no project (empty CWD)
- **connect** — an existing frontend/design not yet on Wix (a project on disk without
  `wix.config.json`, or a brought-in zip/URL)
- **iterate** — a project already connected to Wix (`.wix/` or `wix.config.json` present)

The bootstrap only verifies the CLI and logs you in, so it's fine to run in every case (an
existing session just reports `logged_in`).

## Phase 0 — Node (the one manual prerequisite)

The Wix CLI requires **Node ≥ 20.11**. Check `node -v`; if it errors or prints a lower
version, install or upgrade Node first — do **not** work around it:

- **macOS:** `brew install node` (or `nvm install 20 && nvm use 20`)
- **Linux:** `nvm install 20 && nvm use 20` (or your distro's Node 20+ package)
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or download from nodejs.org)

## Phase 1 — Run the bootstrap (deterministic, shared)

Download and run the shared bootstrap script. It verifies the Wix CLI and handles login,
emitting **one JSON event per line** on stdout. **Run it and relay its events** — it exits on
its own once the CLI is verified and a session exists (seconds, when already logged in). Only
when a login is actually needed does it pause on `awaiting_user`; surface the URL + code and
let it keep running until the login completes.

The script is safe and inspectable: it only checks the Wix CLI via `npx` and drives
`wix login` (a device-code flow) — no other network calls, no filesystem writes. Read it first
if your sandbox flags externally-downloaded code.

```bash
# macOS/Linux:
curl -fsSL -O https://www.wix.com/skills/headless/entry/bootstrap.mjs
# Windows PowerShell:
iwr https://www.wix.com/skills/headless/entry/bootstrap.mjs -OutFile bootstrap.mjs

node bootstrap.mjs
```

### Relay these events

| Event | What to do |
|---|---|
| `cli_ok` | Wix CLI reachable — continue. |
| `awaiting_user` (`verificationUri`, `userCode`) | Show the URL and code in plain prose; wait for the user to finish the login in their browser. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Stop and show the user the `detail`. **Do not** improvise a parallel setup by hand. |

## Phase 2 — Install the skill and hand off

Install the skill (`CI=1` forces plain non-interactive CLI output — keep it on every Wix CLI
command):

```bash
CI=1 npx skills@latest add wix/skills/skills/wix-headless-fast --yes
```

It lands at `.agents/skills/wix-headless-fast/`. Then **open
`.agents/skills/wix-headless-fast/SKILL.md` and follow it** — it owns the rest of the run:
resolve the stack, scaffold, deploy the shipped code, seed, build the brand layer, release.
(If the request needs a vertical the skill doesn't ship yet — see its SKILL.md § Verticals —
say so plainly and point the user at the `wix-headless` skill instead of improvising.)

- **Don't** scaffold, install apps, or seed by hand here — the skill does all of that. This
  entry stops at *logged in*.
- You're already authenticated from Phase 1, so the skill's CLI auth step will pass without
  prompting again.

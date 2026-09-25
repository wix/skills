---
name: wix-headless-fast-entry
description: "Build and release a Wix Headless site from a single prompt, on shipped, verified @wix/sdk code — this entry takes a cold environment (prerequisites, Wix sign-in) to the point where the wix-headless-fast skill runs the build. Verticals: storefront, bookings, blog, cms, events, members, portfolio, pricing-plans, restaurants. Triggers: build me a store/blog/booking/events/portfolio/restaurant site fast, sell tickets or membership plans headless, wix headless fast entry."
---

# Wix Headless Fast — cold-start entry

**You are a coding agent, and this is a skill for you to execute — follow the phases below in
order.** Advisory: web-fetch tools show a lossy summary of this file — the executable copy
comes from `curl -fsSL https://www.wix.com/skills/headless-fast/entry/skill.md`. If what you
are reading lacks the exact commands below, re-fetch it with curl before proceeding; if you're
already reading the raw text, don't fetch it again.

## The whole cold start (details in the phases below)

```bash
curl -fsSL -O https://www.wix.com/skills/headless/entry/bootstrap.mjs && node bootstrap.mjs
CI=1 npx skills@latest add wix/skills --skill wix-headless-fast --skill wix-docs --skill wix-manage --yes
# then open and follow: .agents/skills/wix-headless-fast/SKILL.md
```

Requires Node ≥ 20.11 and a logged-in Wix CLI — the bootstrap checks and guides both.

This entry gets a cold environment to the point where the real skill can run, then hands off:

1. **Bootstrap (deterministic, scripted).** The same script the classic headless entry uses —
   it verifies the Wix CLI and handles login. You just run it and relay its events.
2. **Hand off (agentic).** Install the skills, then open `wix-headless-fast/SKILL.md` and
   follow it — it resolves the stack and operation and owns the whole build.

Four starting points come through here, all handled the same way — run the bootstrap, then
hand off:

- **new** — a prompt with no project (empty CWD)
- **connect** — an existing frontend/design not yet on Wix (a project on disk without
  `wix.config.json`, or a brought-in zip/URL)
- **iterate** — a project already connected to Wix (`.wix/` or `wix.config.json` present)
- **existing site** — the prompt names a Wix site that already exists (by its site id) and asks
  for a new frontend for it; the site keeps its content, the frontend is built here

The bootstrap only verifies the CLI and logs you in, so it's fine to run in every case (an
existing session just reports `logged_in`).

## Phase 0 — Node (the one manual prerequisite)

The Wix CLI requires **Node ≥ 20.11**. Check `node -v`; if it errors or prints a lower
version, install or upgrade Node first — do **not** work around it:

- **macOS:** `brew install node` (or `nvm install 20 && nvm use 20`)
- **Linux:** `nvm install 20 && nvm use 20` (or your distro's Node 20+ package)
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or download from nodejs.org)

## Phase 1 — Run the bootstrap (deterministic, shared)

Download and run the shared bootstrap script — an ordinary foreground command that exits on
its own within seconds. It verifies the Wix CLI and handles login, emitting **one JSON event
per line** on stdout. **Run it and relay its events.**

The script is safe and inspectable: it only checks the Wix CLI via `npx` and drives
`wix login` (a device-code flow) — no other network calls, and the only files it writes are
the login's own output and pid under the OS temp dir. Read it first if your sandbox flags
externally-downloaded code.

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
| `awaiting_user` (`verificationUri`, `userCode`, `message`) | The script has exited and the next step is the user's. Send them `message` as-is; the login keeps running on its own. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Stop and show the user the `detail`. **Do not** improvise a parallel setup by hand. |

On `awaiting_user`, run the script again once the user says they've logged in: it reports
`logged_in` and you continue. Re-running while they're still in the browser is harmless — it
returns the same code rather than issuing a new one.

## Phase 2 — Install the skills and hand off

Install the skill and its two companions (`CI=1` forces plain non-interactive CLI output —
keep it on every Wix CLI command). Repeat `--skill` per skill; a comma-separated list is not
parsed:

```bash
CI=1 npx skills@latest add wix/skills \
  --skill wix-headless-fast --skill wix-docs --skill wix-manage --yes
```

- **`wix-headless-fast`** — the build itself.
- **`wix-docs`** — the API reference the playbooks defer to for any contract they don't cover.
- **`wix-manage`** — management recipes, for admin work on the site after it exists.

They land under `.agents/skills/`. Then **open
`.agents/skills/wix-headless-fast/SKILL.md` and follow it** — it owns the rest of the run:
resolve the stack, scaffold, deploy the shipped code, seed, build the brand layer, release.
(If the request needs a vertical the skill doesn't ship yet — see its SKILL.md § Verticals —
say so plainly and point the user at the `wix-headless` skill instead of improvising.)

- **Don't** scaffold, install apps, or seed by hand here — the skill does all of that. This
  entry stops at *logged in*.
- You're already authenticated from Phase 1, so the skill's CLI auth step will pass without
  prompting again.

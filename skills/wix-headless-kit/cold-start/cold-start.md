---
name: wix-headless-kit-cold-start
description: "Build and release a Wix Headless site from a single prompt, on shipped, verified @wix/sdk code — this entry takes a cold environment (prerequisites, Wix sign-in) to the point where the wix-headless-kit skill runs the build. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site fast, sell tickets or membership plans headless, collect donations headless, wix headless kit entry."
---

# Wix Headless Kit — cold start

**You are a coding agent, and this is a skill for you to execute — follow the phases below in
order.** Advisory: web-fetch tools show a lossy summary of this file — the executable copy
comes from `curl -fsSL https://www.wix.com/skills/headless-kit/cold-start/cold-start.md`. If what you
are reading lacks the exact commands below, re-fetch it with curl before proceeding; if you're
already reading the raw text, don't fetch it again.

## The whole cold start (details in the phases below)

```bash
curl -fsSL -O https://www.wix.com/skills/headless-kit/cold-start/bootstrap.mjs && node bootstrap.mjs
CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
# then open and follow: .agents/skills/wix-headless-kit/SKILL.md
```

Requires Node ≥ 20.11 and a logged-in Wix CLI — the bootstrap checks and guides both.

This page gets a cold environment to the point where the real skill can run, then hands off:

1. **Bootstrap (deterministic, scripted).** A script that verifies the Wix CLI and handles login. You just run it and relay its events.
2. **Hand off (agentic).** Install the skills, then open `wix-headless-kit/SKILL.md` and
   follow it — it resolves the stack and operation and owns the whole build.

Every starting point comes through here the same way — run the bootstrap, then hand off. What
the folder holds and what the brief hands over decide the rest, and SKILL.md step 3 owns that
decision; this page does not interpret either. The bootstrap only verifies the CLI and logs you
in, so it's fine to run in every case (an existing session just reports `logged_in`).

## Phase 0 — The project's folder, and Node

**Work from the folder that holds the project, or that will.** An empty folder is the project for
a new build; if the current folder holds unrelated things, make one named for the business and `cd`
into it. A project already on disk is its own folder — its root, where the `package.json`,
`index.html` or `wix.config.json` is. **Whatever the brief hands over as files goes into that folder
first**, before Phase 1: a zip is extracted there, a URL is downloaded and extracted there, so that
anything it carries — a `wix.config.json` included — sits at the root. Do not interpret what is
there: the skill reads the folder and knows what it is. Everything below — the bootstrap, the
skills, the scaffold — lands in this folder too, so a later session opened in the project finds all
of it.

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
curl -fsSL -O https://www.wix.com/skills/headless-kit/cold-start/bootstrap.mjs
# Windows PowerShell:
iwr https://www.wix.com/skills/headless-kit/cold-start/bootstrap.mjs -OutFile bootstrap.mjs

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
  --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
```

- **`wix-headless-kit`** — the build itself.
- **`wix-docs`** — the API reference the playbooks defer to for any contract they don't cover.
- **`wix-manage`** — management recipes, for admin work on the site after it exists.

They land under `.agents/skills/`. Then **open
`.agents/skills/wix-headless-kit/SKILL.md` and follow it** — it owns the rest of the run:
resolve the stack, scaffold, deploy the shipped code, seed, build the brand layer, release.
(A request outside the shipped verticals — see its SKILL.md § Verticals — is built from the Wix
API reference through `wix-docs`, on the same project; SKILL.md says how.)

- **Don't** scaffold, install apps, or seed by hand here — the skill does all of that. This
  page stops at *logged in*.
- You're already authenticated from Phase 1, so the skill's CLI auth step will pass without
  prompting again.

---
name: wix-headless-kit-cold-start
description: "Build and release a Wix Headless site from a single prompt, on shipped, verified @wix/sdk code — this entry takes a cold environment (prerequisites, Wix sign-in) to the point where the wix-headless-kit skill runs the build. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site fast, sell tickets or membership plans headless, collect donations headless, wix headless kit entry. An agent without a shell, Node or network learns here what to hand over instead, so the request still ends with a built site or an honest answer."
---

# Wix Headless Kit — cold start

**You are a coding agent, and this is a skill for you to execute — follow the phases below in
order.** Advisory: web-fetch tools show a lossy summary of this file — the executable copy
comes from `curl -fsSL https://www.wix.com/skills/headless-cold-start/headless-kit.md`. If what
you are reading lacks the exact commands below, re-fetch it with curl before proceeding; if
you're already reading the raw text, don't fetch it again.

## The whole cold start (details in the phases below)

```bash
CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
node .agents/skills/wix-headless-kit/install/bootstrap.mjs
# then open and follow: .agents/skills/wix-headless-kit/SKILL.md
```

Requires a shell, Node ≥ 22.12 and a logged-in Wix CLI — the bootstrap checks the CLI and
guides the login. If you can't run this — no shell, no file system, no machine for the CLI, a
sandbox that blocks the install, the CLI or the login — see
[When you can't run this](#when-you-cant-run-this) at the end.

This page gets a cold environment to the point where the real skill can run, then hands off:

1. **Install (deterministic).** The skill and its two companions land under `.agents/skills/`.
2. **Bootstrap (deterministic, scripted).** The installed script verifies the Wix CLI and
   handles login. You just run it and relay its events.
3. **Hand off (agentic).** Open `wix-headless-kit/SKILL.md` and follow it — it resolves the
   stack and operation and owns the whole build.

Every starting point comes through here the same way — install, run the bootstrap, then hand
off. What the folder holds and what the brief hands over decide the rest, and SKILL.md step 3
owns that decision; this page does not interpret either. The bootstrap only verifies the CLI
and logs you in, so it's fine to run in every case (an existing session just reports
`logged_in`).

## Phase 0 — The project's folder, and Node

**Work from the folder that holds the project, or that will.** An empty folder is the project for
a new build; if the current folder holds unrelated things, make one named for the business and `cd`
into it. A project already on disk is its own folder — its root, where the `package.json`,
`index.html` or `wix.config.json` is. **Whatever the brief hands over as files goes into that folder
first**, before Phase 1: a zip is extracted there, a URL is downloaded and extracted there, so that
anything it carries — a `wix.config.json` included — sits at the root. Do not interpret what is
there: the skill reads the folder and knows what it is. Everything below — the skills, the
bootstrap, the scaffold — lands in this folder too, so a later session opened in the project finds
all of it.

The Astro stack requires **Node ≥ 22.12** (Astro 7). Check `node -v`; if it errors or prints a
lower version, install or upgrade Node first — do **not** work around it:

- **macOS:** `brew install node` (or `nvm install 22 && nvm use 22`)
- **Linux:** `nvm install 22 && nvm use 22` (or your distro's Node 22+ package)
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or download from nodejs.org)

## Phase 1 — Install the skills

**Already installed? Skip this phase.** If your host lists `wix-headless-kit` as an installed
skill (the Wix plugin for Claude Code, Codex, Cursor or VS Code ships it with its companions and
the shipped code), or `.agents/skills/wix-headless-kit/SKILL.md` exists in the folder, use that
copy: wherever the phases below say `.agents/skills/wix-headless-kit/…`, read the path from where
your copy lives. Nothing needs to be downloaded.

Otherwise install the skill and its two companions (`CI=1` forces plain non-interactive CLI
output — keep it on every Wix CLI command). Repeat `--skill` per skill; a comma-separated list is
not parsed:

```bash
CI=1 npx skills@latest add wix/skills \
  --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes
```

Windows, PowerShell: `$env:CI = "1"; npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes`.
Windows, cmd: `set CI=1 && npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-docs --skill wix-manage --yes`.

- **`wix-headless-kit`** — the build itself.
- **`wix-docs`** — the API reference the playbooks defer to for any contract they don't cover.
- **`wix-manage`** — management recipes, for admin work on the site after it exists.

They land under `.agents/skills/`.

## Phase 2 — Run the bootstrap (deterministic, shared)

Run the skill's bootstrap script — an ordinary foreground command that exits on its own
within seconds. It verifies the Wix CLI and handles login, emitting **one JSON event per
line** on stdout. **Run it and relay its events.**

The script is inspectable: it only checks the Wix CLI via `npx` and drives `wix login` (a
device-code flow) — no other network calls, and the only files it writes are the login's own
output and pid under the OS temp dir.

```bash
node .agents/skills/wix-headless-kit/install/bootstrap.mjs
```

### Relay these events

| Event | What to do |
|---|---|
| `cli_ok` | Wix CLI reachable — continue. |
| `awaiting_user` (`verificationUri`, `userCode`, `message`) | The script has exited and the next step is the user's. Send them `message` as-is; the login keeps running on its own. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Stop and show the user the `detail`. **Do not** improvise a parallel setup by hand; if it can't be fixed where you are, [hand it off](#when-you-cant-run-this). |

On `awaiting_user`, run the script again once the user says they've logged in: it reports
`logged_in` and you continue. Re-running while they're still in the browser is harmless — it
returns the same code rather than issuing a new one.

The login does not depend on your tool keeping a process alive: the script exits at once and
the device-code login finishes in the user's browser on its own. If your tool kills background
processes or times out long commands, nothing is lost — re-run the script after the user says
they're in, and it reports `logged_in`. If the user has no browser where they are, they can open
`verificationUri` on any device; the code is what binds it.

## Phase 3 — Hand off

**Open `.agents/skills/wix-headless-kit/SKILL.md` and follow it** — it owns the rest of the run:
resolve the stack, scaffold, deploy the shipped code, seed, build the brand layer, release.
(A request outside the shipped verticals — see its SKILL.md § Verticals — is built from the Wix
API reference through `wix-docs`, on the same project; SKILL.md says how.)

- **Don't** scaffold, install apps, or seed by hand here — the skill does all of that. This
  page stops at *logged in*.
- You're already authenticated from Phase 2, so the skill's CLI auth step will pass without
  prompting again.

## When you can't run this

Everything above needs a machine you can run commands on, with a file system, Node, npm reach and a
Wix CLI login. If you have none of that (a chat agent, an MCP-only host), or you have it but
something blocks a phase (sandbox rules, a blocked install, a CLI that won't run, a login that
can't complete), the build still happens: not by you, and not by hand-writing a Wix integration in
its place. Tell the user this build needs a coding agent that can run commands, and give them this
to paste into one (Claude Code, Codex, Cursor, or any agent with a terminal), opened in an empty
folder named for the business:

```
<the user's brief, in their words>

Fetch and follow this skill: curl -fsSL https://www.wix.com/skills/headless-cold-start/headless-kit.md
Follow it exactly. It installs these skills from https://www.wix.com/skills/ and builds from them:
- wix-headless-kit: the build itself, from a brief to a released Wix Headless site
- wix-headless-templates: the shipped, verified code per Wix Business Solution the kit deploys and seeds
- wix-docs: the Wix API reference, for any contract the templates don't cover
- wix-manage: recipes for managing the site once it exists
```

Tell them what will happen: that agent installs the skills, asks them once to sign in to Wix in
the browser, builds and releases the site, and ends with the live URL and the dashboard link. The
site is theirs; they can bring it back to you afterwards for anything you do on a live site.

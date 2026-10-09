---
name: wix-headless-kit-cold-start
description: "Build and release a Wix Headless site from a single prompt, on shipped, verified @wix/sdk code — this entry takes a cold environment (prerequisites, Wix sign-in) to the point where the wix-headless-kit skill runs the build. Verticals: storefront, bookings, rentals, blog, cms, events, forms, members, portfolio, pricing-plans, restaurants, faq, donations. Triggers: build me a store/blog/booking/events/portfolio/restaurant/FAQ/donation site fast, sell tickets or membership plans headless, collect donations headless, wix headless kit entry. An agent whose shell can't reach Wix, or that has no shell, does the same run through the Wix MCP, from the kit's API-call guide."
---

# Wix Headless Kit — cold start

**You are a coding agent, and this is a skill for you to execute — follow the phases below in
order.** Read this page, and every skill page it names, whole: a fetch that summarizes drops the
commands.

## The whole cold start (details in the phases below)

```bash
CI=1 npx skills@latest add wix/skills --skill wix-headless-kit --skill wix-headless-templates --skill wix-docs --skill wix-manage --yes
node .agents/skills/wix-headless-kit/install/bootstrap.mjs
# then open and follow: .agents/skills/wix-headless-kit/SKILL.md
```

Requires a shell whose network reaches Wix, Node ≥ 22.12 and a logged-in Wix CLI; the bootstrap
checks the CLI and guides the login. **Check the network first:** `curl -sI https://www.wixapis.com`
answers with an HTTP status line when your shell reaches Wix. When it doesn't, or you have no shell,
the three commands can't work where you are: skip them, and do the run through the Wix MCP from the
kit's API-call guide (the last row below).

| your situation | go to |
|---|---|
| the bootstrap reports `logged_in` | Phase 3: open `.agents/skills/wix-headless-kit/SKILL.md` and follow it |
| the install ran, the bootstrap reports `cli_unreachable` or `login_failed` | show the user the `detail`, then the guide on disk: `.agents/skills/wix-headless-kit/guides/api-run.md` |
| your shell can't reach Wix, or there is no shell, and the Wix MCP is connected | the guide: from the installed skills when you have them (a plugin, an earlier install), online at `https://www.wix.com/skills/wix-headless-kit/guides/api-run.md` otherwise |

The guide is the same run as Wix API calls, step by step, with the file that carries each
contract; the [last section](#the-guide-the-kits-run-as-wix-api-calls) says how its paths resolve.

This page gets a cold environment to the point where the real skill can run, then hands off:

1. **Install (deterministic).** The skill and its three companions land under `.agents/skills/`.
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

Install the skill and its three companions (`CI=1` forces plain non-interactive CLI output —
keep it on every Wix CLI command). Repeat `--skill` per skill; a comma-separated list is not
parsed:

```bash
CI=1 npx skills@latest add wix/skills \
  --skill wix-headless-kit --skill wix-headless-templates --skill wix-docs --skill wix-manage --yes
```

- **`wix-headless-kit`** — the build itself.
- **`wix-headless-templates`** — the shipped, verified code per Wix Business Solution the build deploys.
- **`wix-docs`** — the API reference the playbooks defer to for any contract they don't cover.
- **`wix-manage`** — management recipes, for admin work on the site after it exists.

They land under `.agents/skills/`. When the skills are already installed, by a plugin or an
earlier install, skip this phase and use them where they are.

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
| `cli_unreachable` / `login_failed` (with `detail`) | Show the user the `detail`. **Do not** improvise a parallel setup by hand; if it can't be fixed where you are, the run continues from the guide on disk: `.agents/skills/wix-headless-kit/guides/api-run.md` (the table at the top). |

On `awaiting_user`, run the script again once the user says they've logged in: it reports
`logged_in` and you continue. Re-running while they're still in the browser is harmless — it
returns the same code rather than issuing a new one.

## Phase 3 — Hand off

**Open `.agents/skills/wix-headless-kit/SKILL.md` and follow it** — it owns the rest of the run:
resolve the stack, scaffold, deploy the shipped code, seed, build the brand layer, release.
(A request outside the shipped verticals — see its SKILL.md § Verticals — is built from the Wix
API reference through `wix-docs`, on the same project; SKILL.md says how.)

- **Don't** scaffold, install apps, or seed by hand here — the skill does all of that. This
  page stops at *logged in*.
- You're already authenticated from Phase 2, so the skill's CLI auth step will pass without
  prompting again.

## The guide: the kit's run as Wix API calls

`wix-headless-kit/guides/api-run.md` walks the kit's run step by step as the Wix API calls the
scripts make, and names the file beside the skill that carries each contract. It is read from the
installed skills when they are there, or online when nothing is installed (the table at the top).

The files it names are skill paths. On disk a path resolves under `.agents/skills/{skill}/`; on the
registry as `https://www.wix.com/skills/{skill}/{path}`: `{SKILL_ROOT}` is `wix-headless-kit`,
`{TEMPLATES}` is `wix-headless-templates`, `{MANAGE}` is `wix-manage`. Every file of a skill, with
its URL, is listed in `https://www.wix.com/skills/{skill}.manifest.json`. The same files are in
`https://github.com/wix/skills` under `skills/{skill}/`; a sandbox that reaches GitHub has the whole
set from a clone, on disk.

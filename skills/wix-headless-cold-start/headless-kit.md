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
[No machine, no shell, no CLI, or blocked](#no-machine-no-shell-no-cli-or-blocked-the-skills-as-a-reference) at the end.

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
| `cli_unreachable` / `login_failed` (with `detail`) | Stop and show the user the `detail`. **Do not** improvise a parallel setup by hand; if it can't be fixed where you are, [read the skills as a reference](#no-machine-no-shell-no-cli-or-blocked-the-skills-as-a-reference). |

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

## No machine, no shell, no CLI, or blocked: the skills as a reference

Everything above needs a machine you can run commands on, with a file system, Node, npm reach and a
Wix CLI login. Without that (a chat agent, an MCP-only host, a sandbox that blocks the install, the
CLI or the login), the skills are still yours to read: fetch them from the registry and follow them
as a **reference**, not as steps to execute. They say what a build does, decides and calls, and the
shipped code is readable in place.

```
Fetch and follow these as a reference:
- https://www.wix.com/skills/wix-headless-kit/SKILL.md — the build, from a brief to a released Wix Headless site. It picks the Wix Business Solutions the brief needs (a store, bookings, rentals, a blog, CMS collections, forms, members, events, a restaurant, donations, pricing plans, a portfolio, an FAQ), scaffolds the project with the Wix CLI, deploys each solution's shipped code (a typed data layer, stores, React hooks, Astro pages with SEO, a cart and checkout where there is one), fills the site from a plan with the seed scripts, has the agent design the brand, layout and copy on those hooks, and releases to Wix hosting with the live URL and the dashboard links. It runs on Wix-managed Astro and any React project; its guides/reference-mode.md is the same build for a stack that can't run the shipped code, over the REST layer
- https://www.wix.com/skills/wix-headless-templates/SKILL.md — the shipped, verified code per Wix Business Solution: each <solution>/INSTRUCTIONS.md is the contract, each <solution>/rest/ the data layer over plain fetch, each <solution>/seed/ what fills the site
- https://www.wix.com/skills/wix-docs/SKILL.md — how to look up the Wix API and SDK docs: find the right page, read it as markdown, and confirm an endpoint, body, field or enum before writing code; the kit's playbooks defer to it for any contract they don't cover
- https://www.wix.com/skills/wix-manage/SKILL.md — REST recipes to configure and manage a site's business solutions (stores, bookings, payments, CMS and more), one recipe per operation with the exact endpoint and payload
```

Every file of a skill, with its URL, is listed in `https://www.wix.com/skills/<skill>.manifest.json`
(`wix-headless-kit`, `wix-headless-templates`, `wix-docs`, `wix-manage`); fetch a manifest to find a file before
reading it.

Calls on the user's site run as the site owner: installing an app, creating content, changing a
setting, reading anything a visitor can't see. That takes the user's authentication, the Wix MCP
when it is connected, or a token they hand you (a site token from the Wix CLI, an API key or an
OAuth app from their account, per the wix-manage skill); a visitor token covers only what a
visitor may see.

A site that already exists as files (hand-written HTML, a static build, a zip, the output of an
AI site builder) goes live through
`https://www.wix.com/skills/wix-manage/references/sites/upload-static-site.md`: into the user's
account when you hold their identity, anonymously with a save link when you don't (the one flow
with no identity at all), or by the drop page the user uploads to. The same recipe updates a site
published this way on its URL, reads its files back, and moves it to a Wix Headless project when a
backend is needed.

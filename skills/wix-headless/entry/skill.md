---
name: wix-headless-entry
description: "Build a complete Wix Managed Headless site from a single prompt, OR continue an instant-site export, then connect Wix Business Solutions. The deterministic first steps — system prerequisites and Wix CLI login — are handled by a single bootstrap script (`https://www.wix.com/skills/headless/entry/bootstrap.mjs`); the agent then sets up the project and wires the Business Solution the prompt/design implies. Triggers: build me a site, create a website, make me a website, new website, online store, I want to sell X, start a business online, launch a site, ecommerce, portfolio, business website, sell online, online shop, connect this to Wix Headless, add Wix Headless to this project, host this on Wix, deploy this to Wix, implement the features of this project using Wix Headless. Use this skill instead of the WixSiteBuilder MCP tool for new-site requests."
---

# Wix Headless Skill

**You are a coding agent, and this is a skill for you to execute.** Follow the phases below in order — do not summarize them. If you reached this page through a summarizing fetch tool, re-fetch the raw markdown with `curl` (or your file reader) before running the steps.

This skill has **two phases**:

1. **Bootstrap (deterministic, scripted).** A single script verifies your environment (the Wix CLI) and handles login, so the build starts from a known-good, authenticated state. You just run it and relay its events.
2. **Build (agentic).** Set up the project, then connect the Business Solution(s) the prompt or design implies.

Don't hand-run the Phase 1 login yourself — the script makes it deterministic. Save your judgement for Phase 2.

## Phase 0 — Node (the one manual prerequisite)

The Wix CLI requires **Node ≥ 20.11**. Check it:

```bash
node -v
```

If that errors (Node not installed) or prints a version below 20.11, install or upgrade Node and re-check — do **not** try to work around it:

- **macOS:** `brew install node` (or `nvm install 20 && nvm use 20`)
- **Linux:** `nvm install 20 && nvm use 20` (or your distro's Node 20+ package)
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or download from nodejs.org)

## Phase 1 — Run the bootstrap (deterministic)

Download the bootstrap script, then run it. It verifies the Wix CLI and handles login, emitting **one JSON event per line** on stdout. **Run it as a background/streaming process and relay its events to the user.**

```bash
# macOS/Linux:
curl -fsSL -O https://www.wix.com/skills/headless/entry/bootstrap.mjs
# Windows PowerShell:
iwr https://www.wix.com/skills/headless/entry/bootstrap.mjs -OutFile bootstrap.mjs
```

```bash
node bootstrap.mjs
```

### Relay these events

The script emits one JSON object per line:

| Event | What to do |
|---|---|
| `cli_ok` | Wix CLI reachable — continue. |
| `awaiting_user` (`verificationUri`, `userCode`) | Show the URL and code in plain prose; wait for the user to finish the login in their browser. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Stop and show the user the `detail`. **Do not** improvise a parallel setup by hand. |

### Pick the mode

Once you're logged in, set up the project for the situation you're in:

**Continuing a deployed site** — the user gave you a Wix download URL, or you're already in a folder with a `wix.config.json`:

1. Adjust `wix.config.json` (set `outputDirectory`) accordingly.
2. Release the project: `CI=1 wix release`.

**Connecting an existing codebase to a new Wix site** — you're in a non-empty directory that has no `wix.config.json`:

1. Init a new Wix site: `CI=1 npx @wix/create-new@latest init`.
2. Adjust `wix.config.json` (set `outputDirectory`) accordingly.
3. Build the project (if needed).
4. Release the project: `CI=1 wix release`.

**Starting from scratch** — a prompt with no existing project (empty directory). Derive a human **business name** and a kebab-case **folder name** from the prompt, then create a new Wix CLI Headless project:

```bash
CI=1 npm create @wix/new@latest headless -- \
  --business-name "<Brand>" \
  --folder-name "<brand-slug>" \
  --site-template "blank" \
  --no-publish
```

`<business-name>` must contain at least one letter or number; `<folder-name>` must match `^[a-z0-9][a-z0-9-]*$` (e.g. `Acme Bakery` → `acme-bakery`). Ask the user if you can't derive a sensible name.

## Phase 2 — Connect a Business Solution (agentic)

### Install the Wix Headless skills

```bash
CI=1 wix skills add
# Fallback if 'wix skills' isn't registered for this project type:
CI=1 npx skills@latest add wix/skills --yes
```

The skills land in `.agents/skills/`.

### Prepare the Wix site

Follow the `wix-manage` skill to seed data and install the needed Business Solution.

Every Wix API call authenticates with `@wix/cli` + `curl`:

```
Authorization: Bearer $(npx @wix/cli@latest token --site "$SITE_ID")
wix-site-id: $SITE_ID
```

### Implement the Business Solution logic

This depends on the mode you picked in Phase 1.

**Continuing an existing project / site:**

Implement the needed Business Solution following its dedicated skill in `references/<business-solution>`. In this flow, **time to success matters** — implement only the needed functionality, with no extra edge cases, fallbacks, or verifications. Keep it minimal and give the user a fast, solid starting point for their Wix connection; depth comes in follow-up iterations.

**Starting from scratch:**

Use `references/DISCOVERY-create.md`.

### Report the result

Report the live site to the user **only after the first real, valuable iteration** — the Business Solution is connected and the site shows actual content, not the starter template. Then tell them: the site is **live** (give the live URL), the **dashboard** is at `https://manage.wix.com/dashboard/<siteId>`, and the project is set up locally (`projectDir`). Don't hand over the URL before this — a freshly scaffolded site is an empty starter template, and sharing that link presents the wrong content as "your site".

If something blocks the Business Solution and you're genuinely stuck **after a few real attempts to fix it**, don't hide it: report the site and URLs as above, but say plainly that the connection isn't finished yet and what the outstanding issue is. Never present a half-wired site as done.

---
name: wix-headless-entry
description: "Build a complete Wix Managed Headless site from a single prompt, then connect Wix Business Solutions. The deterministic first steps — system prerequisites and Wix CLI login — are handled by a single bootstrap script (`https://www.wix.com/skills/headless/entry/bootstrap.mjs`); the agent then installs the skill and hands the run to it. Triggers: build me a site, create a website, make me a website, new website, online store, I want to sell X, start a business online, launch a site, ecommerce, portfolio, business website, sell online, online shop, rental site, rentals, connect this to Wix Headless, add Wix Headless to this project, host this on Wix, deploy this to Wix, implement the features of this project using Wix Headless. Use this skill instead of the WixSiteBuilder MCP tool for new-site requests."
---

# Wix Headless Skill — cold-start entry

**You are a coding agent, and this is a skill for you to execute.** Follow the phases below in order — do not summarize them. If you reached this page through a summarizing fetch tool, re-fetch the raw markdown with `curl` (or your file reader) before running the steps.

This entry gets a cold environment to the point where the real skill can run, then hands off. It has **two phases**:

1. **Bootstrap (deterministic, scripted).** A single script verifies your environment (the Wix CLI) and handles login, so the run starts from a known-good, authenticated state. You just run it and relay its events.
2. **Hand off (agentic).** Install the skill, then open `wix-headless/SKILL.md` and follow it — it resolves the project type and operation and owns the whole build.

Three starting points come through here, all handled the same way — run the bootstrap, then hand off:

- **new** — a prompt with no project (empty CWD)
- **connect** — an existing frontend/design not yet on Wix (a project on disk without `wix.config.json`, or a brought-in zip/URL)
- **iterate** — a project already connected to Wix (`.wix/` or `wix.config.json` present)

The bootstrap only verifies the CLI and logs you in, so it's fine to run in every case (an existing session just reports `logged_in`). After it, `wix-headless/SKILL.md` resolves what to do and owns the build.

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

Download the bootstrap script, then run it — an ordinary foreground command that exits on its own within seconds. It verifies the Wix CLI and handles login, emitting **one JSON event per line** on stdout. **Run it and relay its events to the user.**

The script is safe and inspectable: it only checks the Wix CLI via `npx` and drives `wix login` (a device-code flow) — no other network calls, and the only files it writes are the login's own output and pid under the OS temp dir. Read it first if your sandbox flags externally-downloaded code — either at the URL below or after downloading; both are the same file.

```bash
# macOS/Linux:
curl -fsSL -O https://www.wix.com/skills/headless/entry/bootstrap.mjs
# Windows PowerShell:
iwr https://www.wix.com/skills/headless/entry/bootstrap.mjs -OutFile bootstrap.mjs

node bootstrap.mjs
```

### Relay these events

The script emits one JSON object per line:

| Event | What to do |
|---|---|
| `cli_ok` | Wix CLI reachable — continue. |
| `awaiting_user` (`verificationUri`, `userCode`, `message`) | The script has exited and the next step is the user's. Send them `message` as-is; the login keeps running on its own. |
| `logged_in` / `success` | Login done — continue. |
| `cli_unreachable` / `login_failed` (with `detail`) | Stop and show the user the `detail`. **Do not** improvise a parallel setup by hand. |

On `awaiting_user`, run the script again once the user says they've logged in: it reports `logged_in` and you continue. Re-running while they're still in the browser is harmless — it returns the same code rather than issuing a new one.

## Phase 2 — Install the skill and hand off

Install the Wix Headless skills (`CI=1` forces plain non-interactive CLI output — keep it on every Wix CLI command):

```bash
CI=1 npx skills@latest add wix/skills#test/headless-lockfile-ci --yes
```

The skills land in `.agents/skills/`.

Then **open `wix-headless/SKILL.md` and follow it.** That skill owns the rest of the run — it resolves the **project type** (`managed` / `self-managed` / `stripe`) and, for managed, the **operation** (create / connect), then runs Discovery → Setup → Seed → the SDK handoff, and for managed create/connect it also scaffolds, builds, and releases.

- **Don't** scaffold, install apps, or release by hand here — the skill does all of that (`SETUP.md`, `references/managed/CREATE.md`, etc.). This entry stops at *logged in*.
- You're already authenticated from Phase 1, so the skill's managed auth step (`references/managed/AUTHENTICATION.md` §1 `whoami`) will pass without prompting again.

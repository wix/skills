---
name: wix-cli
description: "Quick reference for Wix CLI commands: creating app/headless projects, local dev, building, previewing, releasing, env vars, and account auth. Use when running or choosing Wix CLI commands."
---

# Wix CLI

The Wix CLI develops, tests, and deploys Wix projects from the terminal. Run project commands as `npx wix <command>` from the project root. Full reference: [dev.wix.com/docs/wix-cli.md](https://dev.wix.com/docs/wix-cli.md) (append `.md` to any docs URL for markdown).

See also: [Wix Skills Registry](https://github.com/wix/skills) · [Wix Headless docs](https://dev.wix.com/docs/go-headless.md)

## Project creation

Run in the parent directory where the project folder should be created. Without flags these run interactively.

| Command | What it does |
|---|---|
| `npm create @wix/new@latest -- app [--app-name <name> -t <template-id>]` | Creates a Wix app project: registers a new app in your account (or extends one via `--extend-app-id`) and scaffolds from a template. |
| `npm create @wix/new@latest -- headless [--folder-name <f> --business-name <b> --site-template <commerce\|scheduler\|registration\|blank>]` | Creates a Wix-managed headless project: provisions a business and site, scaffolds, and publishes (skip with `--no-publish`). |
| `npm create @wix/new@latest -- headless link [--business-name <b>]` | Links an **existing Astro project** (run from its root) to Wix as a managed headless project. Requires Astro 5 (Astro 6 unsupported) and an `astro.config.*` file. |
| `npm create @wix/new@latest init` | Connects the **current folder** (existing code) as a Wix-managed headless project; writes `wix.config.json`. No prompts, no flags. |

## Project commands (run inside a project)

| Command | What it does |
|---|---|
| `wix dev` | Local dev server with hot reload (default port 4321; `--port`, `--https` for apps). |
| `wix generate` | Adds an extension to the project. `--type <TYPE>` (e.g. `DASHBOARD_PAGE`, `EMBEDDED_SCRIPT`, `EVENT`, `SERVICE_PLUGIN`); apps also support `--params '<json>'` for non-interactive scaffolding. |
| `wix build` | Builds the project. Required before `preview` and `release`. |
| `wix preview` | Uploads the built project and prints a shareable preview URL. Note: some extensions (embedded scripts, site plugins) only work after `release`. |
| `wix release` | Publishes the project. For apps, creates a new app version and registers extensions. Releasing a headless site also clears its cache. Flags: `-c <comment>`, `-t major\|minor`. |
| `wix env pull` / `env set` / `env remove` | Sync environment variables with Wix's servers; `pull` merges into `.env.local` (includes collaborator-shared vars and headless secrets). |
| `wix translation pull` / `translation push` | Headless only — sync translations with the Multilingual dashboard. |
| `wix generate manifest` | Apps only — generates the manifest for an Editor React Component extension (build first). |

## Commands loaded in Astro (headless) projects

In an Astro headless project (`projectType: "Site"` in `wix.config.json`), `npx wix --help` loads this command set. `wix build` and `wix dev` wrap the Astro build/dev process and forward extra command-line arguments to it.

| Command | What it does |
|---|---|
| `wix dev` / `wix build` / `wix preview` / `wix release` / `wix generate` / `wix env` | As described above; `build` invokes the Astro build, forwarding all CLI args. |
| `wix connect` | Connects the project to GitHub to enable Wix Vibe editing. |
| `wix token` | Prints the current access token, refreshing if needed. Useful for calling Wix APIs from scripts. |
| `wix schema` | Prints machine-readable schemas for CLI commands (e.g. `wix schema generate --type <TYPE>`). |

## Global commands

| Command | What it does |
|---|---|
| `wix login` | Logs in to your Wix account. `--api-key <token>` for CI/automation. |
| `wix logout` | Logs out. |
| `wix whoami` | Shows the logged-in user's email. |
| `wix skills add` / `skills update` | Installs or updates [Wix skills](https://dev.wix.com/docs/wix-cli/guides/development/about-wix-skills.md) in the project. |
| `wix account domain suggest <query>` | Suggests available domains for a keyword, brand, or business idea. Flags: `-l <1-20>` limit, `-t <tld...>` filter by up to 10 TLDs, `--json`. |
| `wix account domain buy <domain>` | Buys a domain (including TLD, e.g. `example.com`) for your Wix account. `--json` for JSON output; `wix account --site-id <id> domain buy` to scope to a site. |
| `wix telemetry on\|off` | Toggles usage telemetry. |

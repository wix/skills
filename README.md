# Wix Skills

> ⚠️ **EXPERIMENTAL**: This project is in early development. APIs, skill definitions, and behavior may change without notice. Use at your own risk.

Agent skills for building Wix app extensions, managing Wix business solutions, developing headless sites, and using the Wix Design System with AI agents.

> **Note**: These skills are designed for the **new Wix CLI**. See [About the Wix CLI](https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli) to learn more. For an overview of how skills work with AI tools, see [About Wix Skills](https://dev.wix.com/docs/api-reference/articles/ai-tools/about-wix-skills).

## Installation

### Claude Code Plugin

In [Claude Code](https://docs.anthropic.com/en/docs/claude-code), run:

```bash
/plugin marketplace add wix/skills
/plugin install wix@wix
```

### Codex

**Codex App** — [Install the Wix plugin](https://chatgpt.com/plugins/share/b15215ad8e954c96a1108d176d53f572).

**Codex CLI** — run `/plugins`, select **Wix**, and choose **Install Plugin**.

### VS Code Plugin

In VS Code, open the Command Palette (`CMD+SHIFT+P`), select **Chat: Install Plugin From Source**, and enter `https://github.com/wix/skills`.

### Cursor Plugin

Go to **Settings > Rules > New Rule > Add from Github** with `https://github.com/wix/skills.git`.

### Gemini CLI

Install using [Gemini CLI](https://geminicli.com):

```bash
gemini extensions install https://github.com/wix/skills
```

### Antigravity Plugin

In [Antigravity](https://antigravity.google), open **Customizations → Plugins**, click **+ Install from URL**, and enter `https://github.com/wix/skills/tree/main/antigravity/wix`. Or, from a terminal:

```bash
agy plugin install https://github.com/wix/skills/tree/main/antigravity/wix
```

The Wix MCP server signs you in to your Wix account the first time a Wix tool is used.

### Skills CLI

Install using [skills CLI](https://github.com/vercel-labs/skills):

```bash
# Install all skills
npx skills add wix/skills

# Install globally
npx skills add wix/skills -g
```

## Available Skills

| Skill                                    | Purpose                          | When to Use                                                                                                                         |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [wix-app](skills/wix-app/SKILL.md)       | Build Wix app extensions         | Adding any extension — dashboard pages, site widgets, backend events, service plugins, embedded scripts, data collections, and more |
| [wix-design-system](skills/wix-design-system/SKILL.md) | Wix Design System reference      | Looking up WDS component props, examples, icons                                                                                     |
| [wix-manage](skills/wix-manage/SKILL.md) | Wix business solution management | REST API operations for configuring and managing Wix business solutions                                                             |
| [wix-headless-kit](skills/wix-headless-kit/SKILL.md) | Build and release a Wix Headless site on shipped, verified per-solution code | Building a new headless site for a business from a brief — store, bookings, blog, events, restaurants, members, donations and more — fast, with the integration code already written |
| [wix-headless-templates](skills/wix-headless-templates/SKILL.md) | The shipped per-solution code wix-headless-kit builds from | Reading what a solution's data layer, hooks, pages and seed do, or seeding a site by hand; the kit fetches and deploys it for you |
| [wix-headless](skills/wix-headless/SKILL.md) | Connect Wix business services to a headless frontend (SDK + Wix CLI), and optionally build & host the site | Setting up a Wix Headless backend or adding Wix business features (Stores, Bookings, CMS, Blog, Events, Forms, Members, Restaurants, Portfolio, Pricing Plans) — install apps, seed content, and produce an SDK-integration guide; for managed projects also scaffold a new site (create) or wire an existing design (connect), then build and release. Works across managed, self-managed, and stripe project types |
| [wix-vibe-headless](skills/wix-vibe-headless/SKILL.md) | Connect an existing front end to Wix over client-only REST | Wiring a vibe-coded / HTML / Vite app to a live Wix site (storefront, bookings, blog, events, portfolio, restaurants, CMS, pricing plans) from the browser with a public `WIX_CLIENT_ID` — no SDK, no backend |
| [wix-docs](skills/wix-docs/SKILL.md) | Look up the Wix API/SDK docs (shared fallback) | Confirming an exact Wix endpoint, method schema, field, or enum before writing code — `curl` doc-search + the `.md`-twin trick, or the Wix MCP tools. Referenced by the other skills as their docs-lookup fallback |
| [wix-export](skills/wix-export/SKILL.md) | Export or create a Wix Studio 2 site | Exporting an existing Studio 2 site or creating a new one into its own folder, installing or signing in to the origami CLI only when that is missing, and continuing straight into the change the user asked for. Not for Wix Editor or Studio 1 sites, or for content and business changes (use wix-manage) |
| [wix-import](skills/wix-import/SKILL.md) | Import local site code into a Wix Studio 2 site | Saving an exported Origami site back to Wix, or bringing code from any other project into an existing or new Studio 2 site — sets up the origami CLI when missing, validates the files, and confirms what the import replaces before uploading images or saving. Not for Wix Editor or Studio 1 sites, or for content and business changes (use wix-manage) |
| [wix-replatform](wix-replatform/README.md) | Migrate sites from WordPress and other platforms into Wix | Migrating an existing business from another platform into Wix. Both backend data and website. `npx skills add wix/skills/wix-replatform` |

## Supported Agents

These skills work with any agent that supports the [Agent Skills specification](https://github.com/vercel-labs/add-skill):

- Cursor
- Claude Code
- Gemini CLI
- Codex CLI
- GitHub Copilot
- Windsurf
- And [many more](https://github.com/vercel-labs/add-skill#available-agents)

## Versioning

`@wix/agent-skills` follows semver. Bumps target **AI-generated-code stability** — i.e., whether a change could cause an agent using these skills to produce broken code on the previous-major `wix-cli`:

| Bump | Examples |
| --- | --- |
| **patch** | Wording fix, typo, link update, clarification of existing guidance |
| **minor** | New skill added, new section in an existing skill, additive guidance for a non-breaking `wix-cli` feature |
| **major** | Skill rename/removal, rewrite of guidance for a deprecated `wix-cli` API, anything that would cause AI-generated code to fail on the previous-major `wix-cli` |

When a major bump is required (a breaking change in the underlying `wix-cli`), the previous major continues on a `release/<N>.x` maintenance branch and receives backports for genuine bugs only — no new features.

## Serving (`www.wix.com/skills`)

Besides the npm package, skills are served as raw markdown / `.tgz` at `https://www.wix.com/skills/<name>` (also `dev.wix.com/skills`), directly from the `main` branch of `wix/skills` with no build step. Responses are cached, so a change reflects there within a few minutes of reaching that branch.

## Privacy and telemetry

Only `wix-replatform` collects telemetry. The other skills send nothing of their own; calls they make to Wix APIs and the Wix MCP are covered by the [Wix Privacy Policy](https://www.wix.com/about/privacy).

During a migration run, `wix-replatform`:

- **Sends run telemetry to Wix** (`https://frog.wix.com/migration-data-validator`): stage timings and outcomes, migrated record counts, errors and gaps by type (never record contents), the source platform and site URL, the destination site ID and the operator's Wix user ID. Turn it off with `RP_TELEMETRY_BI_DISABLED=1`.
- **Reads the agent's Claude Code session transcripts** (`~/.claude/projects/`) at the end of the run, copies them compressed into the migration project's `telemetry/transcripts/` folder on your machine, and adds a summary (token cost, turn counts, tool failures, retry loops) to the run telemetry. The transcripts themselves stay local. Turn it off with `RP_TELEMETRY_TRANSCRIPT_DISABLED=1`.

Set the variables in the environment the agent runs in. See [wix-replatform/README.md](wix-replatform/README.md).

## Contributing

To report a problem with a skill or suggest a change, [open an issue](https://github.com/wix/skills/issues/new). Pull requests are not merged in this repository; accepted changes are made by the maintainers. See [CONTRIBUTING.md](CONTRIBUTING.md) for what makes a useful report.

## License

MIT

# Wix Skills

> ⚠️ **EXPERIMENTAL**: This project is in early development. APIs, skill definitions, and behavior may change without notice. Use at your own risk.

Agent skills for building Wix applications with AI coding assistants.

> **Note**: These skills are designed for the **new Wix CLI**. See [About the Wix CLI](https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli) to learn more.

## Installation

### Claude Code Plugin

In [Claude Code](https://docs.anthropic.com/en/docs/claude-code), run:

```bash
/plugin marketplace add wix/skills
/plugin install wix@wix
```

### Codex Plugin

In a terminal, register the marketplace:

```bash
codex plugin marketplace add wix/skills
```

Then in Codex CLI, run `/plugins`, select **Wix**, and choose **Install Plugin**.

### VS Code Plugin

In VS Code, open the Command Palette (`CMD+SHIFT+P`), select **Chat: Install Plugin From Source**, and enter `https://github.com/wix/skills`.

### Cursor Plugin

Go to **Settings > Rules > New Rule > Add from Github** with `https://github.com/wix/skills.git`.

### Gemini CLI

Install using [Gemini CLI](https://geminicli.com):

```bash
gemini extensions install https://github.com/wix/skills
```

### Skills CLI

Install using [skills CLI](https://github.com/vercel-labs/skills):

```bash
# Install all skills
npx skills add wix/skills

# Install globally
npx skills add wix/skills -g
```

### npm Package (versioned distribution)

For Wix-internal infrastructure that needs a pinned, versioned skills snapshot (e.g., App Builder, Studio 2, `@wix/cli`), `@wix/agent-skills` is also published to npm:

```bash
npm install @wix/agent-skills
```

The npm package contains the same skill bodies as the GitHub repo but pinned to a specific version. Consumers typically install it as a transitive dependency of `@wix/cli` rather than directly. See [CODEAI-505](https://wix.atlassian.net/browse/CODEAI-505) for context.

## Available Skills

| Skill                                    | Purpose                          | When to Use                                                                                                                         |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [wix-app](skills/wix-app/SKILL.md)       | Build Wix app extensions         | Adding any extension — dashboard pages, site widgets, backend events, service plugins, embedded scripts, data collections, and more |
| [wix-design-system](skills/wix-design-system/SKILL.md) | Wix Design System reference      | Looking up WDS component props, examples, icons                                                                                     |
| [wix-manage](skills/wix-manage/SKILL.md) | Wix business solution management | REST API operations for configuring and managing Wix business solutions                                                             |
| [wix-headless](skills/wix-headless/SKILL.md) | Build a complete Wix Managed Headless site | Building a new site end-to-end from a single prompt — discovery, design, feature wiring, and preview |

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

## Releasing

Releases run via the [`release` GitHub Actions workflow](.github/workflows/release.yml) using npm Trusted Publishing (no stored tokens). Triggered manually from the **Actions** tab: pick `version_strategy` and optionally `dry_run`. Modeled on [`wix/interact`](https://github.com/wix/interact/blob/master/.github/workflows/release-interact.yml)'s setup.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new skills.

## License

MIT

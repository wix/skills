# Wix Skills

> ⚠️ **EXPERIMENTAL**: This project is in early development. APIs, skill definitions, and behavior may change without notice. Use at your own risk.

Agent skills for building Wix applications with AI coding assistants.

## Installation

### Plugin
Install the plugin via the Wix marketplace:

```bash
# Add the marketplace
/plugin marketplace add wix/skills

# Install wix-cli plugin
/plugin install wix-cli@wix
```

### Skills

Install these skills using [skills](https://github.com/vercel-labs/add-skill):

```bash
# Install all skills
npx skills add wix/skills

# Install globally
npx skills add wix/skills -g
```

## Available Skills

### Wix CLI

See [wix-cli/skills/README.md](wix-cli/skills/README.md) for the full list of available skills and their capabilities.

## Supported Agents

These skills work with any agent that supports the [Agent Skills specification](https://github.com/vercel-labs/add-skill):

- Cursor
- Claude Code
- Codex
- GitHub Copilot
- Windsurf
- And [many more](https://github.com/vercel-labs/add-skill#available-agents)

## License

MIT

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

### Cursor Plugin

Go to **Settings > Rules > New Rule > Add from Github** with `https://github.com/wix/skills.git`.

### Skills CLI

Install using [skills CLI](https://github.com/vercel-labs/skills):

```bash
# Install all skills
npx skills add wix/skills

# Install globally
npx skills add wix/skills -g
```

## Available Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| [wds-docs](skills/wds-docs/SKILL.md) | Wix Design System reference | Looking up WDS component props, examples, icons |
| [wix-cli-app-validation](skills/wix-cli-app-validation/SKILL.md) | Test and validate Wix apps | Testing app readiness, e2e validation, TypeScript checks |
| [wix-cli-auto-patterns-dashboard](skills/wix-cli-auto-patterns-dashboard/SKILL.md) | Simple CRUD dashboard pages | Single-collection management with standard table/grid views and forms |
| [wix-cli-backend-api](skills/wix-cli-backend-api/SKILL.md) | Create REST API endpoints | Backend HTTP handlers, server-side data processing |
| [wix-cli-backend-event](skills/wix-cli-backend-event/SKILL.md) | Respond to Wix webhooks/events | Run custom backend logic when platform events occur |
| [wix-cli-dashboard-modal](skills/wix-cli-dashboard-modal/SKILL.md) | Build dashboard modals | Popup forms, confirmations, detail views in dashboards |
| [wix-cli-dashboard-page](skills/wix-cli-dashboard-page/SKILL.md) | Build admin interfaces | Dashboard pages, data management, settings UIs |
| [wix-cli-dashboard-plugin](skills/wix-cli-dashboard-plugin/SKILL.md) | Extend Wix app dashboards | Widgets for slots on Wix Stores, Bookings, Blog, eCommerce dashboard pages |
| [wix-cli-dashboard-menu-plugin](skills/wix-cli-dashboard-menu-plugin/SKILL.md) | Add menu items to Wix app dashboards | Menu items in more-actions/bulk-actions menus on Wix dashboard pages |
| [wix-cli-data-collection](skills/wix-cli-data-collection/SKILL.md) | Create CMS data collections | Database schemas, structured data storage, collection fields & permissions |
| [wix-cli-embedded-script](skills/wix-cli-embedded-script/SKILL.md) | Inject client-side code | Tracking pixels, popups, third-party integrations |
| [wix-cli-extension-registration](skills/wix-cli-extension-registration/SKILL.md) | Extension registration patterns | Registering new or existing extensions, UUID generation, app registration |
| [wix-cli-orchestrator](skills/wix-cli-orchestrator/SKILL.md) | Select extension type & orchestrate builds | **First skill to invoke** when adding/building any Wix feature |
| [wix-cli-service-plugin](skills/wix-cli-service-plugin/SKILL.md) | Extend Wix business solution flows | Shipping, fees, taxes, validations, gift cards, custom triggers |
| [wix-cli-site-component](skills/wix-cli-site-component/SKILL.md) | Create site components | React components with editor manifests for visual customization |
| [wix-cli-site-plugin](skills/wix-cli-site-plugin/SKILL.md) | Extend Wix app slots | Components for predefined slots in Wix business solutions |
| [wix-cli-site-widget](skills/wix-cli-site-widget/SKILL.md) | Create standalone widgets | Countdown timers, calculators, configurable components |
| [wix-stores-versioning](skills/wix-stores-versioning/SKILL.md) | Handle Stores V1/V3 APIs | Building integrations supporting both catalog versions |

## Supported Agents

These skills work with any agent that supports the [Agent Skills specification](https://github.com/vercel-labs/add-skill):

- Cursor
- Claude Code
- Codex
- GitHub Copilot
- Windsurf
- And [many more](https://github.com/vercel-labs/add-skill#available-agents)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new skills.

## License

MIT

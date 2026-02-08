# Wix CLI Skills

Agent skills for building Wix CLI applications. Each skill provides domain-specific guidance for creating different types of Wix extensions.

## Available Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| [wix-cli-orchestrator](wix-cli-orchestrator/SKILL.md) | Select extension type & orchestrate builds | **First skill to invoke** when adding/building any Wix feature |
| [wds-docs](wds-docs/SKILL.md) | Wix Design System reference | Looking up WDS component props, examples, icons |
| [wix-cli-app-validation](wix-cli-app-validation/SKILL.md) | Test and validate Wix apps | Testing app readiness, e2e validation, TypeScript checks |
| [wix-cli-backend-api](wix-cli-backend-api/SKILL.md) | Create REST API endpoints | Backend HTTP handlers, server-side data processing |
| [wix-cli-backend-event](wix-cli-backend-event/SKILL.md) | Respond to Wix webhooks/events | Run custom backend logic when platform events occur |
| [wix-cli-dashboard-modal](wix-cli-dashboard-modal/SKILL.md) | Build dashboard modals | Popup forms, confirmations, detail views in dashboards |
| [wix-cli-dashboard-page](wix-cli-dashboard-page/SKILL.md) | Build admin interfaces | Dashboard pages, data management, settings UIs |
| [wix-cli-data-collection](wix-cli-data-collection/SKILL.md) | Create CMS data collections | Database schemas, structured data storage, collection fields & permissions |
| [wix-cli-embedded-script](wix-cli-embedded-script/SKILL.md) | Inject client-side code | Tracking pixels, popups, third-party integrations |
| [wix-cli-extension-registration](wix-cli-extension-registration/SKILL.md) | Extension registration patterns | Registering new or existing extensions, UUID generation, app registration |
| [wix-cli-service-plugin](wix-cli-service-plugin/SKILL.md) | Extend Wix business solution flows | Shipping, fees, taxes, validations, gift cards, custom triggers |
| [wix-cli-site-component](wix-cli-site-component/SKILL.md) | Create site components | React components with editor manifests for visual customization |
| [wix-cli-site-plugin](wix-cli-site-plugin/SKILL.md) | Extend Wix app slots | Components for predefined slots in Wix business solutions |
| [wix-cli-site-widget](wix-cli-site-widget/SKILL.md) | Create standalone widgets | Countdown timers, calculators, configurable components |

## Quick Reference: Site Plugin vs Site Widget

| Feature | Site Widget | Site Plugin |
|---------|-------------|-------------|
| **Location** | Anywhere on site | Predefined slots in Wix business solutions |
| **Component** | React → Web Component | Native HTMLElement |
| **Use case** | Standalone widgets | Extend Wix business solutions |

## Skill Capabilities

### Planner
- Extension type selection based on use case (dashboard, backend, site)
- Orchestrates discovery and implementation sub-agents
- MCP-based SDK documentation discovery
- Parallel sub-agent execution for independent extensions
- Mandatory validation before completion

### WDS Docs
- Staged discovery flow for efficient component lookups
- Props reference for all Wix Design System components
- Example code extraction by feature (Size, Skin, Loading, etc.)
- Icon search functionality
- Spacing token reference (SP1-SP6)

### Dashboard Page
- Wix Design System (WDS) components: Tables, Forms, Cards, Modals, and more
- Wix Data SDK integration for CRUD operations
- Dashboard APIs for navigation, toasts, and state management
- Embedded script configuration support

### Dashboard Modal
- Popup dialogs triggered from dashboard pages
- Data passing between parent and modal
- Wix Design System styling
- Configurable dimensions

### Site Widget
- React components converted to web components
- Built-in settings panel for the Wix Editor
- Wix Data API integration with editor environment handling
- Font and color customization support

### Site Component
- React components with editor manifests for Wix Editor/Harmony
- CSS properties for visual styling customization
- Data configuration for dynamic content
- Sub-component architecture with removal state handling
- Responsive design with flexbox/grid

### Site Plugin
- Extend Wix business solutions (Bookings, Stores, Events, etc.)
- Components for predefined slots in Wix apps
- Native HTMLElement-based implementation

### Backend API
- Astro server endpoints with automatic route discovery
- Full HTTP method support (GET, POST, PUT, DELETE, PATCH)
- Dynamic route parameters
- Wix Data SDK integration

### Backend Event
- Event extensions for Wix webhooks (CRM, eCommerce, Bookings, Blog)
- One handler per event, SDK event imports, permissions configuration
- Builder + handler file pattern, extension registration

### Embedded Script
- Consent-aware script types (Essential, Functional, Analytics, Advertising)
- Configurable placement (HEAD, BODY_START, BODY_END)
- Dynamic parameters via dashboard configuration
- Template variable syntax for customization

### Service Plugin
- Shipping rates calculation
- Additional fees (handling, rush delivery)
- Cart/checkout validations
- Tax calculation
- Gift card integration
- Product recommendations

### App Validation
- TypeScript compilation checks
- Build verification
- Preview deployment

## Skill Structure

Each skill follows a consistent structure:

```
skill-name/
├── SKILL.md              # Main instructions (< 500 lines)
├── assets/               # Templates and static files (optional)
└── references/           # Detailed documentation (optional)
    ├── EXAMPLES.md
    └── OTHER_REFS.md
```

## Frontmatter Format

All skills use consistent YAML frontmatter:

```yaml
---
name: skill-name
description: Third-person description with trigger terms and use cases.
compatibility: Requires Wix CLI development environment.
---
```

## Skill Features

Each skill includes:

- **Quick Start Checklist** - Step-by-step implementation workflow
- **Verification** - Reference to [wix-cli-app-validation](wix-cli-app-validation/SKILL.md) for validation
- **Non-Matching Intents** - Guardrails for when NOT to use the skill
- **Extension Registration** - Two-step registration requirements

## Contributing

When adding or modifying skills:

1. Keep SKILL.md under 500 lines
2. Use progressive disclosure - link to reference files for details
3. Include "Non-Matching Intents" section (guardrails)
4. Include "Quick Start Checklist" for complex skills
5. Reference `wix-cli-app-validation` for verification (don't duplicate)
6. Document extension registration requirements
7. Follow consistent frontmatter format

# RePlatform

Agent skills for migrating a business from another platform into Wix — discovery, mapping,
setup, code generation, and import execution.

An agent runs these skills on the user's machine (local today; remote per submission later).
They are the product runtime: not a separate build step, but step-by-step instructions the
agent follows end to end.

## Install

From any host project where you want to run migrations:

```bash
npx skills add wix/skills/replatform
```

Install the **full skill set** in one go. Several skills reference siblings (for example
`rp-import-codegen` vendors `rp-target-wix/lib/wix-writers.js`).

Global install (available across all projects on the machine):

```bash
npx skills add wix/skills/replatform -g
```

After install, skills land in the agent's skills directory (for example
`.cursor/skills/rp-orchestration/`). See [CONVENTIONS.md](./CONVENTIONS.md) for path
rules and migration project layout.

Bundle version: [VERSION](./VERSION) (currently `0.1.0`).

## Prerequisites

- **Wix MCP** configured in your agent client — required for mapping, setup discovery,
  and provisioning steps that call live Wix APIs.
- **Source credentials** — for WordPress, a site URL and Application Password (and
  WooCommerce keys when needed). The workflow collects these into project-local config
  files; see below.
- **Wix site access** — OAuth token with write scopes and Wix Data enabled on the target
  site.

## Quick start

1. Install the skills (above).
2. In your agent, invoke **`rp-orchestration`** (or ask to "start a RePlatform migration").
3. Provide the source site URL, target Wix site, and credentials when prompted.
4. Follow the routed steps — orchestration inspects artifacts on disk and sends you to the
   next skill (discovery → mapping → setup → codegen → import).

Migration output stays on your machine under a project directory (default
`migrations/<project>/`). It is never committed to the skills package.

## Workflow

```
rp-orchestration
    → rp-discovery          (source schema)
    → rp-mapper             (source → Wix mapping)
    → rp-setup-discovery    (Wix prerequisites)
    → rp-import-codegen     (readers / writers / transforms)
    → rp-execute-setup      (provision & verify)
    → rp-execute-import     (run extract + import)
```

Platform-specific details live in **adapter** skills consulted by the workflow stages:

| Adapter | Used by | Purpose |
| --- | --- | --- |
| `rp-source-wordpress` | `rp-discovery`, `rp-import-codegen` | WordPress / WooCommerce capture and read contract |
| `rp-target-wix` | `rp-import-codegen`, `rp-setup-discovery`, `rp-execute-setup` | Verified Wix write primitives (`lib/wix-writers.js`) |

## Skills

| Skill | Role |
| --- | --- |
| `rp-orchestration` | Inspect the migration project and route to the next step |
| `rp-discovery` | Platform-agnostic discovery process and output contract |
| `rp-mapper` | Map source entities and fields into Wix |
| `rp-setup-discovery` | Derive Wix-side setup requirements before import |
| `rp-import-codegen` | Generate reader and writer code from approved artifacts |
| `rp-execute-setup` | Verify or execute required Wix-side setup |
| `rp-execute-import` | Run the generated import pipeline |

## Migration project layout

Artifacts live under `<migrations-root>/<project>/` on the host machine.

| Setting | Default |
| --- | --- |
| `<migrations-root>` | `migrations/` (relative to cwd) |
| Override | set `REPLATFORM_MIGRATIONS_DIR` to an absolute or relative path |

Typical files and directories:

```
migrations/<project>/
  config/
    wix.env
    source.wordpress.env
  data/
    wp-discovery/          # raw capture (evidence)
    source-extract/        # bulk extract output
  src/
    readers/ writers/ transforms/
    run-import.js
  source-profile.md
  source-schema.json
  mapping-plan.md
  mapping-summary.md
  setup-requirements.md
  setup-verification.md
  import-plan.md
  execution-log.md
```

Path rules, skill-relative script locations, and cross-skill references are documented in
[CONVENTIONS.md](./CONVENTIONS.md).

## Bundled scripts

| Skill | Script | Purpose |
| --- | --- | --- |
| `rp-source-wordpress` | `scripts/wp-discovery.js` | REST index walk + per-entity sampling |
| `rp-target-wix` | `scripts/contract-test.js` | Offline shape checks + optional live Wix API validation |

Run scripts from the owning skill's directory (the folder containing that skill's
`SKILL.md`).

## Contributing

Product skills live in this directory and publish to `wix/skills/replatform/`. Internal
developer workflow (`rp-dev`) is maintained in the RePlatform development monorepo under
`.agents/skills/rp-dev/` and is not part of this package.

When changing adapter code, edit the copies bundled inside each skill folder
(`rp-*/scripts/`, `rp-*/lib/`).

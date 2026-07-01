# RePlatform skill conventions

These rules apply when the `rp-*` skills are installed in any host project (for example via
`npx skills add wix/skills/replatform`). They keep scripts, cross-skill references, and
migration artifacts resolvable without assuming the old monorepo layout.

## Skill install layout

Each skill is a directory with a `SKILL.md` at its root:

```
<skills-root>/
  rp-orchestration/SKILL.md
  rp-discovery/SKILL.md
  rp-source-wordpress/
    SKILL.md
    scripts/
    lib/
  rp-target-wix/
    SKILL.md
    scripts/
    lib/
  ...
```

`<skills-root>` is wherever the agent loads skills from (for example `.cursor/skills/`,
`.agents/skills/`, or a global skills directory). Skills must not assume they live under a
repo path named `skills/` or `replatform/`.

## Paths inside a skill

Resolve paths **relative to the skill directory that owns the file** — the folder
containing that skill's `SKILL.md`.

- Run bundled scripts from that directory, for example:
  `node scripts/wp-discovery.js ...`
- Vendor or read bundled libs from that directory, for example:
  `lib/wp-http.js`, `lib/wix-writers.js`

Use absolute paths for migration **output** directories when the working directory may
differ from the skill directory.

## Cross-skill references

When one skill points at another skill's bundled file (for example
`rp-import-codegen` vendoring `rp-target-wix/lib/wix-writers.js`), resolve
`rp-<name>/...` relative to `<skills-root>` — the parent directory that contains all
installed `rp-*` skill folders. If a sibling skill is missing, tell the user to install
the full RePlatform skill set.

## Migration project (host project)

Migration artifacts live on the **host machine**, not inside the skills package.

Default layout:

```
<migrations-root>/<project>/
  config/
  data/
  src/
  source-profile.md
  source-schema.json
  ...
```

- **Default `<migrations-root>`:** `migrations` relative to the host project's current
  working directory.
- **Override:** set `REPLATFORM_MIGRATIONS_DIR` to an absolute path or a path relative to
  cwd (for example `client-migrations` or `/var/replatform/acme`).
- **`<project>`:** a single migration run (site/customer). Resolve it per `rp-orchestration`
  (explicit name, cwd context, or ask when ambiguous).

In skill text, `migrations/<project>/...` means `<migrations-root>/<project>/...` using the
resolved root above.

## Runnable code generation target

Generated readers/writers always live under the active migration project
(`<migrations-root>/<project>/src/`), not inside skill directories. Skills vendor **library**
copies (transport, Wix writers) into that project; they do not execute migration imports
from the skill install path.

## Secret-bearing config

Project config files (`config/*.env`) may contain credentials. Check existence and key
presence only; never echo values into logs or tool output.

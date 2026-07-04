# Wix Skills Registry

The Wix Skills Registry provides self-contained context packages — instructions, schemas, and rules that let human developers and AI agents (Claude Code, Cursor, custom LLM workflows) build, manage, and extend projects across the Wix ecosystem.

> **System constraint:** all skills target the current Wix CLI framework. Do not generate legacy Corvid or Velo backend code.

## Usage

- **`GET /skills/{name}`** — the skill's `SKILL.md` (top-level instructions + routing), without bundled references. Lightweight.
- **`GET /skills/{name}-full`** — every file in the skill flattened into one markdown doc (`SKILL.md` + all `references/*`, scripts, etc.). One-shot ingestion.
- **`GET /skills/{name}/{path}`** — a single raw file from the bundle (e.g. `references/X.md`).
- **`GET /skills/{name}.tgz`** — the whole skill as a tarball, for installing locally.

### Endpoints

| Endpoint | Returns | Best for |
|---|---|---|
| `GET /skills/{name}` | `SKILL.md` only | Routing, intent checks, on-demand reference reads |
| `GET /skills/{name}-full` | `SKILL.md` + all `references/*` and scripts, flattened | One-shot ingestion of the whole skill |
| `GET /skills/{name}/{path}` | Raw file at path | Targeted reads of a single reference, script, or schema |
| `GET /skills/{name}.tgz` | Compressed archive | Downloading the skill locally |

> The list of available skills below is generated live from the [`wix/skills`](https://github.com/wix/skills) repository.

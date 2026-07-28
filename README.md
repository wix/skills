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
| [wix-headless](skills/wix-headless/SKILL.md) | Connect Wix business services to a headless frontend (SDK + Wix CLI), and optionally build & host the site | Setting up a Wix Headless backend or adding Wix business features (Stores, Bookings, CMS, Blog, Events, Forms, Members, Restaurants, Portfolio, Pricing Plans) — install apps, seed content, and produce an SDK-integration guide; for managed projects also scaffold a new site (create) or wire an existing design (connect), then build and release. Works across managed, self-managed, and stripe project types |
| [wix-vibe-headless](skills/wix-vibe-headless/SKILL.md) | Connect an existing front end to Wix over client-only REST | Wiring a vibe-coded / HTML / Vite app to a live Wix site (storefront, bookings, blog, events, portfolio, restaurants, CMS, pricing plans) from the browser with a public `WIX_CLIENT_ID` — no SDK, no backend |
| [wix-docs](skills/wix-docs/SKILL.md) | Look up the Wix API/SDK docs (shared fallback) | Confirming an exact Wix endpoint, method schema, field, or enum before writing code — `curl` doc-search + the `.md`-twin trick, or the Wix MCP tools. Referenced by the other skills as their docs-lookup fallback |
| [replatform](replatform/README.md) | Migrate sites from WordPress and other platforms into Wix | Migrating an exiting business from another platform into Wix. Both backend data and website. `npx skills add wix/skills/replatform` |

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

Run the [`release-bump`](.github/workflows/release-bump.yml) workflow from the **Actions** tab and pick a `version_strategy`. The rest is automatic — the bump PR auto-merges once checks pass and [`release.yml`](.github/workflows/release.yml) publishes to npm via Trusted Publishing.

## Serving & caching (`www.wix.com/skills`)

Besides the npm package, skills are served as raw markdown / `.tgz` at `https://www.wix.com/skills/<name>` (also `dev.wix.com/skills`). That registry is **not** in this repo — it's an Express service in [`wix-private/docs`](https://github.com/wix-private/docs) (`docs-web-app`) that serves this repo's `main` branch directly, with no build step.

Responses are cached at the Wix edge (Pepyaka, tag `skills`) plus a ~5-min per-pod tarball cache. A push to `main` touching `skills/**` **auto-invalidates** the edge tag (via `md-resolver`'s GitHub-push consumer), so a merge reflects within a few minutes. To force it immediately, hit the manual flush (`POST /api/v1/invalidate-ssr-cache/skills`, BO staff) or the Fire Console `invalidateCache` call.

Full details — endpoints, `wix-` prefix stripping, host-relative links, invalidation — are in the [docs-web-app skills README](https://github.com/wix-private/docs/blob/main/packages/docs-web-app/express/skills/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new skills.

### Eval Token Budgets

Eval scenarios under `yaml/wix-manage-evals/` may define a top-level `maxTokens` value. The GitHub Actions eval gate compares that budget against the PR run's total tokens for the scenario and fails the PR check when the budget is exceeded. This gate-owned field is separate from `llm_judge.maxTokens`, which only configures the judge assertion.

## License

MIT

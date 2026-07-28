# AGENTS.md

Read and follow `CONTRIBUTING.md` before editing this repository. What it covers, one line each:

- **Skill placement** — no new top-level skills (admin-only); new content goes into an existing skill (`wix-manage`, `wix-app`, `wix-design-system`, `wix-headless`), usually as a new reference.
- **Adding a wix-manage skill** — a change is FOUR files, not one: the reference `.md` + the `SKILL.md` index entry + a `yaml/wix-manage/<area>/documentation.yaml` entry + an eval scenario under `yaml/wix-manage-evals/<area>/`.
- **wix-manage eval scenarios** — every skill `.md` change needs a covering scenario (the PR gate fails without one): a `ReadFullDocsArticle` tool-call assertion on `<docsEntry>/skills/<slugified-title>` plus an `llm_judge`.
- **Updating wix-app content** — same rule, different mechanics: change + `SKILL.md` index + a covering scenario under `yaml/wix-app-evals/` (`skill_was_called` + `llm_judge`), selected by tags derived from reference filenames — including negative dependencies.
- **Writing API skills** — verify every API detail against official docs via the Wix MCP (or distill from a successful agent run); public APIs only, no internal service names; mutating flows ask the user first.
- **Skill evaluation** — PRs touching wix-manage references or yaml run the automated eval gate: coverage → schema → execution; treat it as a loop, not a one-time check.
- **PR checklist** — the pre-open checklist; walk it before every PR.

No fork PRs for `wix-manage` changes (the eval bot can't run on forks). Descriptions ≤ 1024 chars.

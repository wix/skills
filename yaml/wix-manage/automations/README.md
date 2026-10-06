# Maintaining the Automations recipes

These recipes are maintained in the Automations team's source repository and
published here through an explicit, reviewed sync. There is no scheduled sync:
a maintainer runs the exporter when preparing or updating a publication PR.

The generated surfaces are:

- `skills/wix-manage/references/automations/*.md`: the orchestrator and its references.
- The marked Automations section of `skills/wix-manage/SKILL.md`, plus the
  Automations entry in its frontmatter routing list (other routes are preserved).
- `yaml/wix-manage/automations/documentation.yaml` and this README.
- `yaml/wix-manage-evals/automations/*.yml`: public evaluation scenarios.

The index exposes one entry point, **Build and Manage Wix Automations**. Its
reference table selects the supporting pages on demand. Those pages stay registered
in the documentation YAML so their article URLs remain available.

## Contributing a correction

Contributors can propose a normal PR against these files. Explain the correction
and update applicable scenarios following this repository's
[contribution guide](../../../CONTRIBUTING.md). Before the next sync, the Automations
maintainer must port accepted public edits into the canonical source, publication
manifest or scenario definitions. A direct public edit is not automatically imported:
running the exporter with `--write` without reconciling it would overwrite it.

Maintainers compare the public branch head and diff before exporting, use `--check`
to detect drift without writing, and preserve accepted corrections in both PRs.
Stale generated files require explicit review and removal; the exporter refuses
unknown files rather than deleting them.

## Maintainer workflow

The following source links require Wix repository access:

- [Canonical Markdown](https://github.com/wix-private/crm-automations-client/tree/master/serverless/create-automation-with-ai/utils/automations-skills/skill/wix-automations-builder).
- [Sync runbook](https://github.com/wix-private/crm-automations-client/blob/master/serverless/create-automation-with-ai/.claude/skills/develop-wix-automations-builder-skill/references/publication-sync.md).
- [Exporter and tests](https://github.com/wix-private/crm-automations-client/tree/master/serverless/create-automation-with-ai/.claude/skills/develop-wix-automations-builder-skill/tools).

From the source repository, run the exporter with the absolute path of this checkout:

```sh
node serverless/create-automation-with-ai/.claude/skills/develop-wix-automations-builder-skill/tools/sync-public-skill.cjs /path/to/wix-skills --dry-run
node serverless/create-automation-with-ai/.claude/skills/develop-wix-automations-builder-skill/tools/sync-public-skill.cjs /path/to/wix-skills --write
node serverless/create-automation-with-ai/.claude/skills/develop-wix-automations-builder-skill/tools/sync-public-skill.cjs /path/to/wix-skills --check
```

Run the exporter tests, inspect the generated diff, and follow
[evaluation guidance](../../../docs/skill-evaluation.md). Commit source and public
changes in linked PRs. The YAML content hash is a source-drift aid, not an execution
result. Local structural checks do not establish that live evaluations passed.

# Maintaining the Automations recipes

The Automations recipes are maintained by the Wix Automations team in an internal source,
where the same skill is also served to Wix's own agents and tested against the automations
builder. The files here are a generated copy of that source, so the public and internal
versions stay identical. There is no scheduled sync: a maintainer runs the exporter when
preparing or updating a publication PR.

The generated files are:

- `skills/wix-manage/references/automations/*.md`: the orchestrator and its references.
- The marked Automations section of `skills/wix-manage/SKILL.md`, plus the
  Automations entry in its frontmatter routing list (other routes are preserved).
- `yaml/wix-manage/automations/documentation.yaml` and this README.
- `yaml/wix-manage-evals/automations/*.yml`: public evaluation scenarios.

The skill is published in stages. `build-and-manage-automations.md` keeps the same filename
throughout, so the entry point stays stable while its scope grows from inspection to
building and managing automations.

## Contributing a correction

Contributors can propose a normal PR against these files. Explain the correction
and update applicable scenarios following this repository's
[contribution guide](../../../CONTRIBUTING.md). Before the next
sync, the Automations maintainer must port accepted public edits into the internal source;
otherwise the next sync regenerates the files and overwrites them. The exporter's `--check`
mode lists files that differ from the generated output, so an unported edit is visible before
it is overwritten.

## Evaluation rubric maintenance

The generated evaluation files intentionally repeat quality and persistence judge rubrics:
each scenario is standalone, so cross-file YAML anchors are not available. Maintainers must
update the corresponding canonical rubrics together and regenerate every affected publication
stage. Before merging a rubric change, search all sibling scenarios in the canonical
`publication/scenarios.json` for the old wording and verify that every applicable copy was
updated. Do not hand-edit one generated scenario and leave its siblings on an older rubric.

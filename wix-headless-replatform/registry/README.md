# Approved component registry

This folder is the runtime registry shipped with the skill. It contains only
human-approved immutable items. Candidate research, source snapshots, reviews,
test reports, and pending approvals must never be placed here.

## Agent read boundary

Do not scan this folder while creating a site.

1. Deterministic scripts read `registry.json`, approvals, capability manifests,
   and source hashes to produce `docs/site-clone/build/component-selection.json`.
2. The site-building agent reads that generated selection artifact.
3. If an item was selected, the agent may read only that item's `contract.md`
   for concise binding and adaptation guidance.
4. The agent does not read approval records, licenses, component source,
   capability JSON, or developer review/provenance material for reasoning.

The installer reads source and metadata mechanically. When no approved item
qualifies, the bounded custom path remains available.

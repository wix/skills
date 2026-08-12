# Wix Domain Entity Suitability

This directory is the compact, machine-readable knowledge base for Wix target entity
suitability. Domain and entity files are the source of truth. `index.json` is generated
from those files and checked in so mapper/codegen lookups stay token-cheap.

## Maintenance

- Edit only the affected `domains/<domain>/` subtree when changing domain-owned facts.
- Keep long analysis in `research/import-api-suitability/`; entity files should contain
  compact guidance and evidence links.
- Use `preferredWrite.writerId` only for exported functions from
  `rp-target-wix/lib/wix-writers.js`. Use `null` for direct REST plans, setup work, or
  unsupported native gaps.
- Mark entity-level native import gaps with `IMPORT_UNRELIABLE` in
  `reliability.flags[]`. Field-level lossiness belongs in `pitfalls[]`.
- Regenerate and validate the index after edits:

```bash
node skills/replatform/resources/rp-target-wix/scripts/domain-knowledge-validate.js --write-index
```

# Wix Domain Entity Suitability

This directory is the compact, machine-readable knowledge base for Wix target entity
suitability. Domain and entity files are the source of truth. `index.json` is generated
from those files and checked in so mapper/codegen lookups stay token-cheap.

## Docs reading contract

Authoring or materially editing entities in a domain starts with the domain's full docs menu,
never a keyword hit:

1. Declare the domain's docs menu roots in `domain.json` `docsRoots[]`
   (paths under `https://dev.wix.com/docs/`, e.g. `api-reference/business-solutions/events`).
   A domain may span several roots (stores also owns the Coupons and Business Management → Tags
   trees).
2. Run `node scripts/docs-survey-sync.js <domain>` — it fetches each root's `.md` menu page and
   writes the surface list into `domains/<domain>/docs-survey.json`. New surfaces arrive as
   `unreviewed`, which fails validation.
3. Triage every surface to one verdict: `claimed` (with `refs[]` that must resolve),
   `not-importable` (reason required), `not-relevant` (reason required), or `gap`
   (reason + tracking required). Every verdict carries `reviewedOn`.
4. Any entity classified `native` / `native-plus-cms` must cite its `…-object` docs page in
   `evidence[]` — the field-level facts live on the object, not the method list. A surface with
   no object page anywhere (e.g. Comments, which has no REST reference) declares
   `objectPageException` with the reason.

The validator enforces all of it; a domain with entities and no survey fails the build.

### Service-plugin surfaces are not import paths — but they are not noise either

Every `Service Plugins` surface triages to `not-relevant`, because Wix calls *us*, so it can never
carry historical records. That verdict is right and it is also the easiest thing in this knowledge
base to misread: a service plugin cannot import data, but it **can supply a capability the
destination lacks**, which is exactly the category of gap that otherwise gets written up as "Wix
cannot do this."

That misreading has already cost this project a wrong answer twice on `ecom/discount-rule.json`.
Before writing a capability gap into a report, check **`SERVICE-PLUGINS.md`** in this directory: it
holds the escalation rule (native primitive first, always), the honest cost of a plugin, a complete
worked example, and a catalog of all 25 Wix service plugins with a per-plugin judgment on whether it
could close a migration gap.

## Maintenance

- Edit only the affected `domains/<domain>/` subtree when changing domain-owned facts.
- Keep long analysis separate from the entity files; entity files should contain
  compact guidance and evidence links.
- Use `preferredWrite.writerId` only for exported functions from
  `rp-target-wix/lib/wix-writers.js`. Use `null` for direct REST plans, setup work, or
  unsupported native gaps.
- Mark entity-level native import gaps with `IMPORT_UNRELIABLE` in
  `reliability.flags[]`. Field-level lossiness belongs in `pitfalls[]`.
- Regenerate and validate the index after edits:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/domain-knowledge-validate.js --write-index
```

---
name: cms-implementer
description: "Implements structured content pages (About, FAQ, portfolios, team directories, resource libraries) via Wix CMS and @wix/data. Scopes: seed, pages. Extends references/shared/IMPLEMENTER.md."
---

# CMS Implementer

Extends `references/shared/IMPLEMENTER.md`. Read that file first for phase routing, MCP prefix, site.json read pattern, return contract, style conventions, and common failure modes.

## Scope routing

| Scope | Phase | Reference |
|-------|-------|-----------|
| `seed` | Seed (create collections + seed items via MCP) | `./CMS_FOUNDATIONS.md` (§ seeding) + use-case ref |
| `pages` | Pages (About + FAQ pages read CMS via @wix/data inline) | `./CMS_FOUNDATIONS.md` (§ code patterns) + use-case ref |

No `components` scope — CMS pages SSR content inline via `@wix/data`; no React islands.

## Use-case references

Pick based on the business type (the orchestrator names one in your prompt):

- `./FAQ_KNOWLEDGE_BASE.md` — Q&A accordions, category sections, search
- `./PORTFOLIO.md` — project grid, category filter tabs, project detail
- `./TEAM_DIRECTORY.md` — department-grouped directory, staff cards
- `./RESOURCE_LIBRARY.md` — file listings, download buttons, file type badges

## Files this vertical creates / contributes

See `<SKILL_ROOT>/references/verticals/cms.md` frontmatter.

## CMS-specific failure modes

| Wrong | Right |
|---|---|
| `items.queryDataItems(...)` / `items.query({ dataCollectionId })` | `items.query("CollectionId").find()` — queryDataItems doesn't exist |
| React islands for static content pages | SSR inline with `@wix/data`; no islands needed |
| Return `status: "complete"` without re-querying the collection | Always run the verify-after-insert query (see CMS_FOUNDATIONS.md § "Verify inserts with a live query"); fail fast if any field is missing |
| Report `fields: [...]` guessed from the insert body | Report `storedFields: [...]` matching the actual keys in the query response's `data` object — pages agents compare against these |
| Assume text fields survive downstream image PATCHes | Seeder's job is to verify content is present; images agent must preserve via read-merge-PUT (images INSTRUCTIONS.md § "CMS Items") |

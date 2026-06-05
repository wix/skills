---
name: "Stores — Skill Audit"
description: Per-skill audit table for the stores L1 domain. Tracks API-doc verification, Claude redundancy assessment, and migration status. NOT a runtime skill — author/maintainer reference only.
---

# Stores — Skill Audit

## Files

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `add-store-pages-to-site.md` | Site pages / Sites API | Likely Yes (production legacy) | TBD | Adds missing checkout/cart pages after migration or setup issues | 📦 Legacy flat — Catalog L2 |
| `bulk-create-products-with-options.md` | Stores Catalog V3 (`bulk/products`) | Likely Yes (production legacy) | TBD | Bulk product creation with variant generation from options; media format requirements; partial-failure handling | 📦 Legacy flat — Catalog L2 |
| `create-product-catalog-v1.md` | Stores Catalog V1 (Products API) | Likely Yes (production legacy) | TBD | V1-specific create flow; key V1↔V3 request shape differences | 📦 Legacy flat — Catalog L2 |
| `create-product-with-options-catalog-v3.md` | Stores Catalog V3 (Products + Variants) | Likely Yes (production legacy) | TBD | Single-product creation with options/variants/choices in V3 | 📦 Legacy flat — Catalog L2 |
| `create-product-from-image.md` | Stores Catalog (V1/V3) + Media Upload + LLM analysis | Likely Yes (production legacy) | TBD | **Multi-API orchestrator** — auto-detects catalog version via provision, runs matching V1 or V3 flow, handles media upload + analysis + product creation atomically | 📦 Legacy flat — Catalog L2 (orchestrator) |
| `find-products-query-and-search-catalog-v3.md` | Stores Catalog V3 (Search + Query) | Likely Yes (production legacy) | **Possibly Yes** | If pure query/search documentation → candidate to dissolve into API-doc URLs per §7.5 (this is read-only) | 📦 Legacy flat — Catalog L2 audit candidate |
| `query-products-catalog-v1.md` | Stores Catalog V1 (Query) | Likely Yes (production legacy) | **Possibly Yes** | Same as above — pure read flow against V1 | 📦 Legacy flat — Catalog L2 audit candidate |
| `setup-online-store-catalog-v3.md` | Stores Catalog V3 (multi-API) | Likely Yes (production legacy) | TBD | Initial-store setup orchestrator: product creation + options + variants + categories | 📦 Legacy flat — Catalog L2 (orchestrator) |
| `update-product-pre-order.md` | Stores V3 Inventory | Likely Yes (production legacy) | TBD | Pre-order config: enabling/disabling, messages, limits, `trackQuantity` requirements | 📦 Legacy flat — Inventory L2 |
| `update-product-with-options.md` | Stores Catalog V3 (Products + Variants) | Likely Yes (production legacy) | TBD | Modifying existing products/variants: adding/removing option choices, variant-specific pricing, revision-based updates | 📦 Legacy flat — Catalog L2 |

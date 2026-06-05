---
name: "CMS — Skill Audit"
description: Per-skill audit table for the CMS L1 domain.
---

# CMS — Skill Audit

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `cms-data-items-crud.md` | wix-data v2 (items, bulk/items) | Likely Yes (production legacy) | TBD | Bulk insert/update/patch/delete patterns; filter syntax | 📦 Legacy flat |
| `cms-data-operations-extended.md` | wix-data v2 (count, upsert) | Likely Yes (production legacy) | **Possibly Yes** | If pure API summary → §7.5 candidate | 📦 Legacy flat |
| `cms-ecommerce-catalog-integration.md` | wix-data + Stores catalog plugin | Likely Yes (production legacy) | No | **CATALOG plugin pattern** — non-obvious way to convert CMS collections into purchasable items | 📦 Legacy flat |
| `cms-references-and-relationships.md` | wix-data (insert/replace/remove references) | Likely Yes (production legacy) | TBD | **Multi-reference fields can't be set via regular insert/update** — must use dedicated reference endpoints; this is non-obvious | 📦 Legacy flat |
| `cms-schema-management.md` | wix-data Schemas API | Likely Yes (production legacy) | TBD | Collection structure operations + field management | 📦 Legacy flat |

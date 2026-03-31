---
name: wix-headless-cms
description: "Inner skill — invoked by wix-headless-features-orchestrator. Implements structured content pages using @wix/data for custom collections.
Triggers: @wix/data, CMS, collections, dynamic content, portfolio, projects, work showcase,
team, staff, directory, FAQ, knowledge base, resources, downloads, case studies, menu items."
---

# Wix Headless CMS — Structured Content Implementation

Wires designed components to `@wix/data` — structured content with custom schemas for portfolios, team directories, FAQs, resource libraries, and other custom collections. **NOT** for editorial content (blog), products (stores), form submissions (forms), or booking services (bookings).

## Use Case Selector

Match what the user describes to the right reference:

| User Describes | Reference |
|---|---|
| Projects, work samples, case studies, visual showcase | `references/PORTFOLIO.md` |
| Team, staff, about us, our people | `references/TEAM_DIRECTORY.md` |
| FAQ, help, Q&A, knowledge base | `references/FAQ_KNOWLEDGE_BASE.md` |
| Downloads, resources, documents, files | `references/RESOURCE_LIBRARY.md` |
| Menu items, restaurant menus, food/drink listings | Start from `references/CMS_FOUNDATIONS.md` — adapt with menu-specific fields (price, dietary tags, photo) |
| Testimonials, reviews, client quotes | Start from `references/CMS_FOUNDATIONS.md` — adapt with testimonial fields (quote, author, company, rating) |
| Other custom structured data | Start from `references/CMS_FOUNDATIONS.md`, adapt schema to the specific use case |

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| Use `@wix/data` for blog posts | Use `@wix/blog` via `wix-headless-blog` — blog posts are NOT CMS collections |
| Use `@wix/data` for product data | Use `@wix/stores` via `wix-headless-stores` — products have their own catalog API |
| Use `@wix/data` for booking services | Use `@wix/bookings` — services have their own API |
| Use `@wix/data` for form submissions | Use `@wix/forms` via `wix-headless-forms` — forms have their own submission API |
| Use `items.queryDataItems(...)` or `items.query({ dataCollectionId: ... })` | Use `items.query("CollectionId").find()` — `queryDataItems` doesn't exist in the SDK |
| Access data as `item.data?.fieldName` | Access as `item?.fieldName` — SDK returns fields directly on the item, not nested under `.data` |
| Skip `auth.elevate` on queries | Always use `auth.elevate(items.query)` — collection permissions may require it |
| Write CMS queries inline in pages | Use a service module (`src/lib/{usecase}.ts`) per CMS_FOUNDATIONS.md |
| Query collections without checking permissions | Some collections require `auth.elevate` for read access — always use elevated queries |
| Use raw `wix:image://` URLs directly | Resolve with `media.getImageUrl()` from `@wix/sdk` |
| Hardcode field names without checking dashboard | Always verify field names match the actual collection schema in the Wix dashboard |
| Build one generic template for all CMS use cases | Each use case has distinct UI patterns — use the specific reference file |

> **Visual boundary:** This skill handles SDK integration only. All styling is owned by the design skill. Components must use the class names from the designed component's styling contract (`COMPONENT_PATTERNS.md`). Do not add Tailwind classes, inline styles, or `<style>` blocks.

## Required Dependencies

```
@wix/data
@wix/essentials
```

> Features collects these for a single batch install — do NOT install independently.

## Build Order

1. Read `references/CMS_FOUNDATIONS.md` first — shared patterns (service module, image resolution, elevation, MCP seeding)
2. Read the matching use case reference from the selector table above
3. Implement the service module (`src/lib/{usecase}.ts`)
4. Implement pages and components per the reference
5. Seed sample data via MCP (text fields only)
6. **Generate images for seeded items (BLOCKING — do not skip silently)**
   If the use case has image fields (`photo`, `coverImage`, `galleryImages`):
   - **Always ask the user** if they want to generate images — do not skip this question
   - Follow `../shared/IMAGE_GENERATION.md` (Steps 1–3) for API key, generation, and Wix Media import
   - Patch each CMS item with the imported image URL per the use case reference's "Seed with Images" section
   - Items without images look incomplete — placeholder initials/divs are a fallback, not the default
   - Only skip if the user explicitly declines
7. **Log results** to `.wix/features.log.md` per `../shared/FEATURES_LOG.md`, and **append a lifecycle entry** (`####` sub-phase) to `.wix/lifecycle.log.md` per `../shared/LIFECYCLE_LOG.md`

## Implementation References

| Reference | What It Covers |
|-----------|---------------|
| `references/CMS_FOUNDATIONS.md` | Service module template, `@wix/data` queries, image resolution, elevated access, category filtering, MCP seeding |
| `references/PORTFOLIO.md` | Project grid, category filter tabs, image galleries, project detail, featured projects for home page |
| `references/TEAM_DIRECTORY.md` | Department-grouped directory, staff cards, social icons, member profiles |
| `references/FAQ_KNOWLEDGE_BASE.md` | Q&A accordion, category sections, client-side search, single-page pattern |
| `references/RESOURCE_LIBRARY.md` | File listings, download buttons, file type badges, related resources |
| `../shared/IMAGE_GENERATION.md` | AI image generation + Wix Media import (used for seeding CMS items with images) |

A data collection must exist in the Wix dashboard → CMS section before content pages will show data. If no collections exist, tell the user to create one in the Wix dashboard, or use MCP to seed sample data (see CMS_FOUNDATIONS.md).

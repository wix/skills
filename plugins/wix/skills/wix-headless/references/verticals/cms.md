---
name: cms
triggers: []                          # not trigger-based — always loaded
description: "Content pages — About + FAQ managed via Wix CMS"

features:
  - name: "About (CMS-based)"
    description: "Tell your brand story with images and rich text. Editable from the Wix dashboard's Content Manager."
  - name: "FAQ (CMS-based)"
    description: "Common questions and answers about your products. Managed from the dashboard's Content Manager."

apps: []                              # CMS is built-in, no app install

packages:
  - "@wix/data"
  - "@wix/wix-data-items-sdk"   # provides the `items` namespace (query/insert/etc.). @wix/data 1.0.448 stopped re-exporting it; pages import from here directly. See references/cms/CMS_FOUNDATIONS.md.
  - "@wix/essentials"

routes:
  - route: "/"
  - route: "/about"
  - route: "/faq"

cmsCollections:
  - name: "about-content"
    fields:
      - { name: "heading", type: "string", required: true }
      - { name: "body", type: "rich-text", required: true }
      - { name: "image", type: "image", required: false }
  - name: "faq"
    fields:
      - { name: "question", type: "string", required: true }
      - { name: "answer", type: "rich-text", required: true }
      - { name: "sortOrder", type: "number", required: true }

seed:
  agentLocation: "references/cms/"
  scope: "seed"
  description: "Create about-content + faq collections, seed 1 about-content item and 4–6 contextual FAQ items based on the business type"
  references: ["references/cms/CMS_FOUNDATIONS.md"]

# CMS has no "components" — page designers write CMS-reading pages directly using
# @wix/data queries inline. So the only post-design work is the pages scope below.
components: null

pages:
  - name: "cms-pages"
    agentLocation: "references/cms/"
    scope: "pages"
    description: "Swap placeholder copy in About + FAQ pages for live @wix/data queries"
    references: ["references/cms/CMS_FOUNDATIONS.md"]
    files:
      - "src/pages/about.astro"
      - "src/pages/faq.astro"

creates:
  - { file: src/pages/about.astro, phase: pages }
  - { file: src/pages/faq.astro,   phase: pages }

# CMS does NOT contribute to the home page. The designer owns the brand-story
# section directly (writes its own placeholder heading/paragraph). Historically
# this pack declared a home:cms marker but no phase patched it, so the
# designer's placeholder copy shipped as-is to preview. Dropping the marker
# makes that behavior explicit.
contributes: []

include: true   # always loaded — every site gets About + FAQ content pages
disabled: false
---

# CMS Pack

Always loaded. Provides content pages (Home, About, FAQ) editable from the Wix dashboard's Content Manager.

## Why always-include

Every site needs About and FAQ content. The CMS collections give the user a dashboard-editable surface, so non-technical owners can update copy without touching code.

## Pages

- **Home** (`/`) — designed by `designer-home`. The designer writes the brand-story section directly (no CMS-driven home contribution; see `contributes: []` in frontmatter above for why).
- **About** (`/about`) — content from `about-content` CMS collection
- **FAQ** (`/faq`) — content from `faq` CMS collection

## Phase 1

One agent creates both collections and seeds them:
- `about-content` — one item (heading, body, optional image) with placeholder copy based on business context
- `faq` — 4–6 items tailored to the business type (e.g., shipping, returns, sizing, care instructions)

The agent tailors FAQ content to the vertical. For stores: shipping/returns/sizing. For future verticals: different sets.

## Phase 2 pattern

About and FAQ pages read their CMS content inline via `@wix/data`:

```astro
---
import * as items from "@wix/wix-data-items-sdk";
const faqs = await items
  .query("faq")
  .ascending("sortOrder")
  .find()
  .then(r => r.items);
---
```

> **Why not `import { items } from "@wix/data"`?** That's the documented Wix headless pattern but `@wix/data` 1.0.448 dropped the `items` re-export — only sub-namespaces (`backups`, `collections`, `permissions`, …) remain, and the documented form fails the build with `'items' is not exported by '@wix/data'`. The actual `items` API lives in `@wix/wix-data-items-sdk` (which `@wix/data` depends on transitively). Importing from there directly works on every current `@wix/data` version.

No React islands required for static content pages — they SSR from data.

## Contract

This pack contributes contract keys for content-page class names. Other packs do not typically overlap with these keys.

The home page's `heroSection` and `brandStory` keys are consumed by `designer-home`, which composes the home page from every loaded pack's `homeSection` snippet.

## References

- `references/cms/CMS_FOUNDATIONS.md` — existing CMS reference (data seeding + page wiring)
- `references/cms/FAQ_KNOWLEDGE_BASE.md` — FAQ patterns

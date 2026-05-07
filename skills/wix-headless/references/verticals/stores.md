---
name: stores
triggers: ["sell", "ecommerce", "store", "shop", "products", "merchandise", "catalog", "merch", "buy"]
description: "Ecommerce — product catalog with add-to-cart. Requires ecom pack for cart/checkout."
requires: ["ecom", "gift-cards"]  # ecom = vertical-agnostic cart/checkout; gift-cards = passive pack that lights up when the dashboard's Wix Gift Card app is enabled

features:
  - name: "Product catalog"
    description: "Browse all products with images, prices, and variants. Click through to detailed product pages with add-to-cart."

apps:
  - name: "Wix Stores"
    appDefId: "215238eb-22a5-4c36-9e7b-e7c08025e04e"

packages:
  - "@wix/stores"
  - "@wix/ecom"

routes:
  - route: "/products"
  - route: "/products/[slug]"
    name: "Product Detail"   # path-derivation would produce "Products [slug]" — override with the user-facing label
  - route: "/category/[slug]"
    name: "Category"         # SEO-friendly per-category landing — server-side filtered, cursor-paginated

cmsCollections: []

seed:
  agentLocation: "references/stores/"
  scope: "seed"
  description: "Delete default sample products (Wix Stores ships 12) and create 3 on-brand products with variants/prices/inventory. Does NOT seed categories — those are merchant-driven; the storefront wires the rail/submenu/route in Phase 4 and lights up automatically when the merchant creates categories in the dashboard."
  references: ["references/stores/PRODUCT_CATALOG_DATA.md"]

components:
  agentLocation: "references/stores/"
  scope: "components"
  description: "SDK wiring that depends only on the styling contract, not on designed page markup. Writes React/Astro islands and the back-in-stock util. CSS is split into the sibling componentsCss scope."
  references:
    - "references/stores/SHARED_WIRING.md"
    - "references/stores/BACK_IN_STOCK.md"
  files:
    - "src/components/SeoTags.astro"
    - "src/components/AddToCartButton.tsx"
    - "src/components/ProductPurchase.tsx"
    - "src/components/BackInStockForm.tsx"
    - "src/utils/back-in-stock.ts"

componentsCss:
  agentLocation: "references/stores/"
  scope: "components-css"
  description: "Scoped stores CSS — components-stores.css. Runs in parallel with the components scope; reads design tokens + global.css (for leak audit) but no SDK templates. Independent of TSX work because TSX/CSS link is build-time via class names."
  references:
    - "references/stores/COMPONENTS_CSS.md"
    - "references/stores/BACK_IN_STOCK.md"  # § 3 — back-in-stock form CSS rules to append
  files:
    - "src/styles/components-stores.css"

pages:
  - name: "product-pages"
    agentLocation: "references/stores/"
    scope: "pages-products"
    description: "Swap placeholder data in products listing + detail for live productsV3 queries with cursor pagination; mount the shared <CategoryRail/>; register wixMetadata + SeoTags on detail page"
    references: ["references/stores/PRODUCT_PAGES.md"]
    files:
      - "src/pages/products/index.astro"
      - "src/pages/products/[slug].astro"
      - "src/components/ProductCard.astro"

  - name: "category-pages"
    agentLocation: "references/stores/"
    scope: "pages-categories"
    description: "Server-side filtered /category/[slug] listing (cursor-paginated). Writes shared CategoryRail and the categories.ts helper; both are imported by pages-products as well."
    references: ["references/stores/CATEGORY_PAGES.md"]
    files:
      - "src/pages/category/[slug].astro"
      - "src/components/CategoryRail.astro"
      - "src/utils/categories.ts"

  - name: "home-and-nav"
    agentLocation: "references/stores/"
    scope: "pages-home-and-nav"
    description: "Patch home page featured products to live query and contribute the Shop submenu (categories list) to Navigation"
    references: ["references/stores/HOME_AND_NAV.md"]
    files:
      - "src/pages/index.astro (patch — home product grid only)"
      - "src/components/Navigation.astro (patch — Shop submenu insert)"

creates:
  - { file: src/components/AddToCartButton.tsx,  phase: components }
  - { file: src/components/ProductPurchase.tsx,  phase: components }
  - { file: src/components/BackInStockForm.tsx,  phase: components }
  - { file: src/components/SeoTags.astro,        phase: components }
  - { file: src/utils/back-in-stock.ts,          phase: components }
  - { file: src/styles/components-stores.css,    phase: components }
  - { file: src/pages/products/index.astro,      phase: pages }
  - { file: src/pages/products/[slug].astro,     phase: pages }
  - { file: src/components/ProductCard.astro,    phase: pages }
  - { file: src/pages/category/[slug].astro,     phase: pages }
  - { file: src/components/CategoryRail.astro,   phase: pages }
  - { file: src/utils/categories.ts,             phase: pages }

# Files this vertical contributes to via named markers (Design System phase scaffolds; verticals insert).
contributes:
  - file: src/pages/index.astro
    marker: "<!-- home:stores -->"
    description: "Featured products grid (3–6 items from productsV3.queryProducts)"
  - file: src/components/Navigation.astro
    marker: "<!-- nav:links -->"
    description: "Shop menu link → /products"

include: false
disabled: false
---

# Stores Pack

Full ecommerce vertical. Loaded whenever the user's prompt implies selling products.

## Phase decomposition

Stores work is split across **Phase 3 Components** (shared React islands) and **4 Phase 4 Pages scopes** (per-route wiring):

| Scope | When | Files | Notes |
|-------|------|-------|-------|
| `components` | Step 4.5 / Phase 3 (bg) | React islands, utils, SeoTags | Needs only the styling contract |
| `pages-products` | Step 7 / Phase 4 (bg) | products/index.astro, [slug].astro, ProductCard.astro | Imports `<CategoryRail/>` and `listStoreCategories` from `pages-categories` outputs |
| `pages-categories` | Step 7 / Phase 4 (bg) | category/[slug].astro, CategoryRail.astro, utils/categories.ts | Server-side filtered, cursor-paginated. Writes the shared rail + helper used by `pages-products` too |
| `pages-home-and-nav` | Step 7 / Phase 4 (bg) | index.astro patch, Navigation patch (Shop submenu) | Needs Phase 2 Design System output + home contribution markers; live-queries categories for the Shop submenu (empty by default — categories are merchant-driven) |

Historically stores was one monolithic agent taking ~6 minutes. The split turns it into a ~2-minute parallel dispatch (max of the 4 scopes). All four Phase-4 stores scopes dispatch in parallel — `pages-products` and `pages-home-and-nav` import files from `pages-categories`, but Astro resolves imports at build time (Step 8), not at write time. Each scope only needs its own files to exist by the time `astro build` runs.

## Known failure modes (propagate to agent prompts)

Listed here once so every scope's prompt can include them; they also live in `references/shared/RETURN_CONTRACT.md` § "Common failure modes".

| Wrong | Right |
|-------|-------|
| `import { products }` | `import { productsV3 }` — V1 silently returns 0 on V3 catalogs |
| Skip `variantId` on cart add | Always include — single-variant products have one |
| HTML `<!-- comment -->` in `.astro` frontmatter | Use `//` or `/* */` — frontmatter is TypeScript |
| Omit `wixMetadata` on `/products/[slug]` | Required for Wix sitemap/SEO/deep-link platform integration |
| Hardcode `<title>` from `product.name` | Pipe `product.seoData.tags` through Layout head slot |
| Mount CartBadge on a page component | Mount in `Navigation.astro` so it appears on all pages |
| Render the Wix Gift Card app's 5 auto-mirror products in `/products` or the home grid | Filter them out with `p.ribbon?.name !== "Gift Card"` — they're DIGITAL stand-ins; real purchases happen via `/gift-cards` (gift-cards pack) |
| Use the Stores install id `215238eb-…` for back-in-stock | Use sub-page id `1380b703-ce81-ff05-f115-39571d94dfcd`; install id is rejected on V3 with `NOT_SUPPORTED_APP_DEF_ID` / `REQUEST_COLLECTION_DISABLED` (see `references/stores/BACK_IN_STOCK.md`) |
| Pass `itemUrl` or `image` to `createBackInStockNotificationRequest` | Send only `catalogReference`, `email`, `name`, numeric `price` — the SDK throws `Failed to construct 'URL': Invalid URL` on either optional field |

## Images — this pack's contribution

Entity images (product hero + lifestyle) are generated by the shared image agent (Image Phase 2), not by this pack's agents. The image agent watches for this pack's Phase 1 Seed return and generates `heroImage` + `lifestyleImage` per product, then PATCHes them onto product records.

Phase 4 agents do NOT read the image agent's output. Image URLs flow through the product record (Phase 1 populates product; Image Phase 2 PATCHes image fields; Phase 4 queries product and renders `product.media.mainMedia.image.url`).

## Required environment

- `WIX_CLIENT_ID` in `.env.local` (populated by `npx @wix/cli env pull` in Setup)
- `siteId` known (from `wix.config.json`, extracted in Setup)
- MCP prefix discovered (Setup Step 0)

## References

- `references/stores/PRODUCT_CATALOG_DATA.md` — Phase 1 (products seed; categories are merchant-driven and not seeded)
- `references/stores/SHARED_WIRING.md` — Phase 3 Components (stores-specific islands + utils)
- `references/stores/PRODUCT_PAGES.md` — Phase 4 product-pages scope
- `references/stores/CATEGORY_PAGES.md` — Phase 4 category-pages scope (rail + /category/[slug])
- `references/stores/HOME_AND_NAV.md` — Phase 4 home page patch + Shop submenu
- Cart/checkout references are in the ecom pack: `references/ecom/`

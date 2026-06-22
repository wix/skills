# Phase 4 Category Pages — Stores

Scope: `pages-categories` — written by the stores **merged build agent** (the build wave) *before* its `pages-products` scope, so `<CategoryRail/>` is on disk before that scope mounts it. This scope writes the dedicated category landing route, the shared `<CategoryRail/>`, and the `categories.ts` helper.

**Within-agent order:** the merged stores agent writes `components` → `pages-categories` (this scope) → `pages-products`. `pages-home-and-nav` is a *separate* serialized agent (it patches the shared shells) and resolves `<CategoryRail/>` at build time (Step 8). Each scope only needs its own declared files to exist by the time `astro build` runs.

## Scope

Files this agent OWNS (writes):

- `src/utils/categories.ts` — TTL-cached helpers (`listStoreCategories`, `getCategoryBySlug`, `listProductsInCategory`). Write this first — `pages-products` and `pages-home-and-nav` both import from it.
- `src/pages/category/[slug].astro` — category landing (server-side filtered, cursor-paginated)
- `src/components/CategoryRail.astro` — shared rail + Prev/Next pagination, persisted across `<ClientRouter />` swaps

Files this agent MUST NOT touch:
- `src/pages/products/index.astro`, `[slug].astro`, `src/components/ProductCard.astro` — owned by `pages-products`
- `src/pages/index.astro`, `src/components/Navigation.astro` — owned by `pages-home-and-nav`
- `src/layouts/Layout.astro`, `global.css` — owned by designer (View Transitions + loading bar live there)
- `src/components/ProductPurchase.tsx`, `AddToCartButton.tsx`, `BackInStockForm.tsx` — owned by `components`

## Inputs (from parent prompt)

- **Phase 1 return data** — `categories: []`. Phase 1 does not seed categories (they're merchant-driven). This scope still writes the helper + rail + route — they're harmless when no categories exist, and they light up automatically once the merchant creates visible categories with items in the dashboard. `listStoreCategories()` queries the API live at SSR time (5-min TTL cache), so no redeploy is needed when categories are added later.
- **Design tokens** — read the design tokens (the DESIGN.md vocabulary) from `.wix/design-tokens.css` (on disk). Page header / breadcrumbs / pill / pagination styling should follow `references/shared/STYLING.md` (utilities derived from tokens, semantic classes only for primitives).
- **Designer output summary** — confirm `Layout.astro` already includes `<ClientRouter />`, `transition:persist` markers on nav/footer, and the `[data-nav-progress]` element + after-swap hook. If any of those is missing, return `status: "partial"` with `errors: [{ code: "DESIGNER_LAYOUT_MISSING_TRANSITIONS", path: "src/layouts/Layout.astro" }]`.

## Critical rules (all must be honored)

1. **Server-side filter only.** Do NOT ship a client-side filter that hides cards via `card.hidden = true` or `data-category-ids`. That pattern doesn't scale past a few hundred products and breaks SEO. Filtering is by URL: `/category/<slug>` is the canonical filter, server-renders only matching products. The rail click is a real navigation that `<ClientRouter />` swaps in place.
2. **Use `@wix/auto_sdk_categories_categories`**, not `@wix/categories` (the published name) — the auto_sdk package is already on disk via every other `@wix/*` package's transitive deps. Importing `@wix/categories` triggers a fresh `npm install`. The provided template uses `import * as categories from "@wix/auto_sdk_categories_categories"` already; do not rewrite.
3. **`queryCategories(...)` rejects empty filters.** The SDK builder's `.find()` validates that at least one predicate has been chained. Always include `.eq("visible", true)` (the constraint we want anyway). Provided template already does this.
4. **Filter out the auto-managed "All Products" category** by `handle === "online_stores_all_products"`. It's installed by Wix Stores automatically and contains every product; surfacing it in the rail makes the All pill duplicate.
5. **Filter out empty categories** by `itemCounter === 0` so the rail doesn't show buckets that 404 in practice (the route still works, but the pill leads to "Nothing in <name> just now").
6. **`STORES_APP_ID` in `categories.ts`** — set it to the Stores app id `215238eb-22a5-4c36-9e7b-e7c08025e04e` (same id used for cart ops and Phase 1 product seed; NOT the back-in-stock id `1380b703-…`). The TTL cache, the `queryCategories` call structure, and the `@wix/auto_sdk_categories_categories` import are all specified in the rules below.
7. **Cursor pagination** uses `productsV3.queryProducts().limit(24).skipTo(cursor)`. Cursor lives in `?cursor=…` on the URL, surfaced from `result.cursors.next` / `result.cursors.prev`. Prev/Next links use `data-astro-prefetch="hover"` so hovering them warms the cache.
8. **Module-level TTL cache (5 min)** in `categories.ts` is opportunistic; safe under the Cloudflare-style fetch adapter (each worker isolate is single-tenant). Errors don't poison the cache.
9. **Two-call pipeline** in `listProductsInCategory`: first `listItemsInCategory(categoryId, { appNamespace: "@wix/stores" })` for IDs, then `productsV3.queryProducts().in("_id", ids).limit(24).skipTo(cursor).find()`. There is no Wix endpoint that does category filter + cursor paging in one shot — don't attempt `listCategoriesForItems` from the SDK; it ships items via GET querystring and breaks on arrays. If you need product → categories mapping (e.g. for breadcrumbs on product detail), call the REST POST endpoint directly: `POST /categories/v1/categories/list-categories-for-items`.

## Writing the files

Write `categories.ts` first (both other scopes import from it), then `CategoryRail.astro`, then `category/[slug].astro`.

**`src/utils/categories.ts`** — Write the TTL-cached SDK wrapper from scratch. Export:
- `listStoreCategories()` — queries visible, non-empty categories; filters out `handle === "online_stores_all_products"`; 5-min module-level cache.
- `getCategoryBySlug(slug)` — single category lookup by slug; 5-min cache.
- `listProductsInCategory(categoryId, cursor?)` — two-call pipeline (list item IDs, then `productsV3.queryProducts().in("_id", ids).limit(24).skipTo(cursor)`); 5-min cache.
- `STORES_APP_ID` — `"215238eb-22a5-4c36-9e7b-e7c08025e04e"`.
Import `@wix/auto_sdk_categories_categories` (not `@wix/categories`); see critical rules 2 and 8.

**`src/components/CategoryRail.astro`** and **`src/pages/category/[slug].astro`** — write these from scratch following the patterns below. Adapt brand tone:
1. Category page header copy ("Shop", breadcrumbs, lede) should match the rest of the site's voice.
2. If the brand uses an editorial eyebrow pattern on `/products`, mirror it on `/category/[slug]`.
3. CSS class names (`page-header`, `page-header-title`, etc.) must match what the designer published — do NOT introduce new ones.

## Pre-return file-existence assertion

Before returning `status: "complete"`, verify all three files exist on disk:

- `src/utils/categories.ts`
- `src/components/CategoryRail.astro`
- `src/pages/category/[slug].astro`

If any is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected path>" }]`.

## Return contract

```json
{
  "status": "complete",
  "phase": "stores-pages",
  "scope": "pages-categories",
  "summary": "Wrote categories.ts helper, CategoryRail, and /category/[slug] route; route renders M categories.",
  "data": {
    "categoriesRendered": 0,
    "filesWritten": [
      "src/utils/categories.ts",
      "src/components/CategoryRail.astro",
      "src/pages/category/[slug].astro"
    ]
  },
  "files": [],
  "errors": []
}
```

Phase 1 always reports zero categories (it does not seed them). Set `categoriesRendered: 0` and return `status: "complete"` — the helper, rail, and route are still written so the storefront lights up automatically the first time the merchant creates a visible category with items in the dashboard, with no code change needed.
# Phase 4 Home Page + Nav — Stores

Scope: `pages-home-and-nav`. Launched in **Step 7** after `pages-categories` has written the shared rail and `categories.ts` helper. Patches the home page's stores-related placeholder data with live `productsV3` queries AND inserts the Shop submenu (categories list) into the persisted Navigation.

## Scope

Files this agent PATCHES (does NOT rewrite):

- `src/pages/index.astro` — only the stores-related sections (featured products grid, category cards)
- `src/components/Navigation.astro` — only at the `<!-- nav:links -->` marker; insert the Shop link + categories submenu

Files this agent MUST NOT touch:
- Any other part of `index.astro` — hero, copy, newsletter, decorative ornaments are designer-owned
- Any part of `Navigation.astro` outside the `<!-- nav:links -->` marker — designer/ecom-owned (the marker model lets multiple verticals contribute siblings without conflict)
- `src/utils/categories.ts`, `src/components/CategoryRail.astro`, `src/pages/category/[slug].astro` — owned by `pages-categories`; this scope only **imports** `listStoreCategories` from `categories.ts`
- Any other component, page, or CSS
- `global.css`

## Inputs (from parent prompt)

- **Phase 1 stores return** — `products: [{id, name, slug, ...}]`. Needed for live query on home page; also useful for deciding how many to feature.
- **Design tokens** — read `.wix/site.json.designTokens` for the published color/spacing/typography vocabulary; compose Tailwind utilities derived from those tokens at the call site rather than inventing semantic classes. See `references/shared/STYLING.md` for the three styling categories.
- **Designer output summary** — path of `src/pages/index.astro` and `src/components/Navigation.astro`, with notes on what placeholder data exists.
- **Categories (lookup)** — if the designer used category links with hardcoded slugs, call `categoriesV3` SDK to discover real category slugs and rewrite `href`s.

## Critical rules

1. **Surgical edits only.** Use `Edit` tool, not `Write`. Preserve everything the designer wrote — hero, copy, decorative elements, section structure, class names.
2. **Do NOT restructure layout.** If the designer didn't include featured products, don't add it.
3. **Do NOT mutate categories in the catalog.** Read-only. Match designer's category slugs against real ones; rewrite `href` if matched; fall back to `/products` if not.
4. **Never improvise category endpoint URLs.** Use `categoriesV3` SDK. If the SDK isn't available, fall back to `<prefix>CallWixSiteAPI` with `POST /categories/v1/categories/query` body `{"query":{}}`. Improvised `/stores/v3/categories/...` URLs caused a multi-minute stall historically.
5. **If another agent already wired the home page** (e.g., a previous run), leave it alone and note this in the return.
6. **ProductCard is a template** — always accepts `{ product }`. Pass raw SDK product objects, never flat-map. See § 1a.

## When to run the home-page patch

Skip the home-page patch entirely if the home page has NO stores-consuming components:

- No `ProductGrid` / `ProductCard` with placeholder products array
- No category cards with hardcoded category slugs (e.g., `/products?category=...`)

If the home page is purely editorial (hero + copy + newsletter), return with `featuredProductsWired: false` — there's nothing to patch.

## Implementation

### 1. Home page: featured products (returned as `data.homeContributions`)

> **Do NOT patch `src/pages/index.astro` at the `<!-- home:stores -->` marker yourself.** Return the contribution as JSON; the orchestrator splices it via `scripts/merge-home.mjs` after all Phase 4 agents return. The category-href rewrites in section 2 below STILL happen as direct edits to `index.astro` (they're non-marker surgical edits) — only the featured-grid section at the marker is contributed.

Build the contribution as part of your return JSON's `data.homeContributions`:

```json
{
  "data": {
    "homeContributions": {
      "imports": [
        "import ProductCard from '../components/ProductCard.astro';",
        "import { productsV3 } from '@wix/stores';"
      ],
      "frontmatter": [
        "let featured: any[] = [];",
        "try { const { items: featuredProducts } = await productsV3.queryProducts({ fields: ['CURRENCY'] }).limit(4).find(); featured = featuredProducts ?? []; } catch (err) { console.error('[home] featured products query failed:', err); }",
        "featured = featured.filter((p) => p?.ribbon?.name !== 'Gift Card').slice(0, 3);"
      ],
      "byMarker": {
        "home:stores": "{featured.length > 0 && (<section class=\"featured-section\">…<div class=\"product-grid\">{featured.map((p) => <ProductCard product={p} />)}</div>…</section>)}"
      }
    }
  }
}
```

The merge script:
- Dedupes the `imports[]` and `frontmatter[]` lines against the designer's existing content.
- Inserts the `byMarker["home:stores"]` snippet immediately after the marker line, preserving the marker.

> **WRONG:** `featured = products.map(p => ({name: p.name, price: ...}))` then `<ProductCard name={p.name} .../>`
> **RIGHT:** `featured = featuredProducts ?? []` as `any[]`, then `<ProductCard product={p} />`
>
> Flat-mapping strips fields that ProductCard needs (`media`, `actualPriceRange`, etc.) and crashes the home page (`product` is `undefined`).

> **Gift-card mirror filter.** Apply `featured = featured.filter((p) => p.ribbon?.name !== "Gift Card")` so the Wix Gift Card app's auto-created DIGITAL mirror products don't appear in the featured grid. The home teaser block (gift-cards pack) is the right surface for gift cards on the home page.

Do **NOT** flat-map products into `{name, price, slug, image}` — pass the raw SDK objects in the marker snippet. ProductCard handles its own field extraction, image resolution, and ribbon (offer) rendering internally.

If `featured` is empty (query failed, or stock cleared), the wrapped `{featured.length > 0 && (...)}` expression renders nothing — the rest of the page stays up.

> **If the home page is purely editorial** (hero + copy + newsletter; no `<!-- home:stores -->` marker), omit `data.homeContributions` entirely or pass empty arrays/objects. The merge script will report no patches for stores. Return with `featuredProductsWired: false`.

### 1a. ProductCard interface (template — deterministic)

ProductCard is a **template file** (`templates/ProductCard.astro`). The `product-pages` scope copies it deterministically. The interface is:

```astro
interface Props {
  product: { _id?: string; name?: string; slug?: string; media?: ...; actualPriceRange?: ... };
  index?: number;
}
const { product, index } = Astro.props;
```

The card fetches its own discount-rule offers internally via `fetchLiveOffers()` (memoized per-request), so pages don't pass an `offers` prop. Just `<ProductCard product={p} />`.

**Do NOT flat-map.** ProductCard handles image resolution, price formatting, and ribbon rendering internally.

**Verification:** After writing your Edit, grep `ProductCard.astro` for `Astro.props` and confirm the prop name in your `<ProductCard .../>` JSX matches `product`.

### 2. Home page: category cards (slug matching)

The designer may hardcode category links like `href="/products?category=rubber"`. These rely on Stores-app categories matching those slugs. Phase 1 does NOT create categories — they're merchant-driven, so on a fresh build the only category in the catalog is the auto-managed "All Products" (which the helper filters out). Expect zero real categories on first load; the matching logic below should degrade gracefully to `/products` and re-evaluate on each request as the merchant adds categories in the dashboard.

Handle this:

1. **Query real categories** via `@wix/stores` `categoriesV3`:
   ```typescript
   import { categoriesV3 } from "@wix/stores";
   const { items: categories } = await categoriesV3.queryCategories().find();
   ```
   Fall back to `CallWixSiteAPI` with `POST /categories/v1/categories/query` body `{"query":{}}` if the SDK module is unavailable.
2. **Match by name or slug** — case-insensitive substring match is fine (e.g., designer's "rubber" card matches a real category "Rubber Ducks").
3. **If a match exists** → rewrite the `href` to use the real category slug (and optionally real category name).
4. **If no match exists** → render the card with `/products` (no filter) rather than a dead filter URL. Keep the visual card intact.
5. **If fewer real categories exist than cards the designer rendered** → render only matching cards. Do NOT invent categories.

> Never call `/stores/v3/categories/*` — category endpoints live under `/categories/v1/`. Improvising URLs caused a documented multi-minute stall in past runs.

### 3. Navigation: Shop submenu

The designer scaffolds `Navigation.astro` with a `<!-- nav:links -->` marker that vertical packs replace with their primary nav contributions. Stores contributes the Shop link (always) and a hover/focus submenu listing the merchant's visible categories (when any exist — empty by default, since Phase 1 does not seed them).

Read `src/utils/categories.ts` (already on disk — written by `pages-categories`) and import `listStoreCategories`. At the marker, insert:

```astro
---
// (frontmatter additions to Navigation.astro — keep existing imports)
import { listStoreCategories } from "../utils/categories";

const navCategories = await listStoreCategories();
---
```

Then replace the `<!-- nav:links -->` marker with:

```astro
<li class={`site-nav-item${navCategories.length > 0 ? ' has-submenu' : ''}`}>
  <a
    href="/products"
    class="site-nav-link"
    data-astro-prefetch="hover"
    aria-current={isActive('/products') || isActive('/category') ? 'page' : undefined}
    aria-haspopup={navCategories.length > 0 ? 'true' : undefined}
  >Shop</a>
  {navCategories.length > 0 && (
    <ul class="site-nav-submenu" aria-label="Shop categories">
      <li>
        <a href="/products" class="site-nav-sublink" data-astro-prefetch="hover">All</a>
      </li>
      {navCategories.map((cat) => (
        <li>
          <a
            href={`/category/${cat.slug}`}
            class="site-nav-sublink"
            data-astro-prefetch="hover"
            aria-current={Astro.url.pathname === `/category/${cat.slug}` ? 'page' : undefined}
          >{cat.name}</a>
        </li>
      ))}
    </ul>
  )}
</li>
<!-- nav:links -->
```

Keep the marker comment immediately after the inserted `<li>` so other vertical packs (gift-cards, etc.) can still contribute siblings.

> **Empty-categories fallback.** `navCategories` is `[]` by default — Phase 1 does not seed categories, and `listStoreCategories()` only returns visible, non-empty, merchant-created categories. When empty, the submenu renders nothing and the link is just `Shop` with no dropdown. The aria-haspopup attribute is conditionally added so screen readers don't promise a menu that isn't there. As soon as the merchant creates a visible category with items in the dashboard, the submenu lights up automatically (≤ 5 min, the helper's TTL).

> **`isActive` is already defined** in the designer-scaffolded Navigation.astro frontmatter (it returns whether a path matches the current URL). Reuse it; do not redefine.

> **`data-astro-prefetch="hover"` is required** on every category link so hovering warms the prefetch cache before the click. Designer's Layout includes `<ClientRouter />` — without prefetch, each click waits a full network round-trip.

> **CSS for submenu** comes from designer's `global.css` (`.site-nav-item`, `.site-nav-submenu`, `.site-nav-sublink`, hover/focus reveals). If those classes don't exist, return `status: "partial"` with `errors: [{ code: "DESIGNER_MISSING_NAV_SUBMENU_CSS", path: "src/styles/global.css" }]`.

## Return format

```json
{
  "status": "complete",
  "phase": "stores-pages-home-and-nav",
  "scope": "pages-home-and-nav",
  "summary": "Wired home page featured products; inserted Shop submenu with N categories into Navigation",
  "data": {
    "homePageHadPlaceholders": true,
    "featuredProductsWired": true,
    "featuredProductsCount": 4,
    "categoryCardsFound": 3,
    "categoryCardsMatched": 2,
    "categoryCardsFallbackToProducts": 1,
    "navSubmenuCategoryCount": 0,
    "homeContributions": {
      "imports": [
        "import ProductCard from '../components/ProductCard.astro';",
        "import { productsV3 } from '@wix/stores';"
      ],
      "frontmatter": [
        "let featured: any[] = [];",
        "try { const { items: featuredProducts } = await productsV3.queryProducts({ fields: ['CURRENCY'] }).limit(4).find(); featured = featuredProducts ?? []; } catch (err) { console.error('[home] featured products query failed:', err); }",
        "featured = featured.filter((p) => p?.ribbon?.name !== 'Gift Card').slice(0, 3);"
      ],
      "byMarker": {
        "home:stores": "{featured.length > 0 && (<section class=\"featured-section\">…</section>)}"
      }
    }
  },
  "files": [
    "src/pages/index.astro",
    "src/components/Navigation.astro"
  ],
  "errors": []
}
```

> `src/pages/index.astro` stays in `files[]` because this scope still performs non-marker edits on it (category-card href rewrites). The `home:stores` marker insertion is contributed via `data.homeContributions` instead, and is merged by the orchestrator after this scope returns. `src/components/Navigation.astro` listed here predates the navContributions migration — see the sibling PR for that change.

## Scope boundaries (reinforced)

- **Do NOT edit** home page layout, copy, hero text, newsletter section, or decorative SVGs.
- **Do NOT add** new sections the designer didn't include.
- **Do NOT mutate** categories in the catalog — read-only.
- **Do NOT touch** `Navigation.astro` outside the `<!-- nav:links -->` marker. Other vertical packs use the same marker model and write siblings.
- **Do NOT touch** `CartBadge.tsx` or `CartView.tsx` — owned by ecom.
- **Do NOT rewrite** `src/utils/categories.ts` or `src/components/CategoryRail.astro` — owned by `pages-categories`.
- If home page already has a live query (another agent wired it), leave alone and note in return.

## Anti-patterns

| WRONG | CORRECT |
|-------|---------|
| Replace entire `index.astro` contents | Use `Edit` to patch only the stores-related sections |
| Call `/stores/v3/categories/query` | Use `categoriesV3` SDK, or fall back to `/categories/v1/categories/query` |
| Invent category slugs that don't exist | Match real categories; fall back to `/products` for unmatched |
| Pass flat props (`name={p.name}`) when ProductCard expects `product={...}` object | ProductCard is a template — always `<ProductCard product={p} />` with the raw SDK object |
| `featured = products.map(p => ({name: p.name, ...}))` — flat-mapping SDK results | Store raw products: `featured = featuredProducts ?? []` as `any[]` |

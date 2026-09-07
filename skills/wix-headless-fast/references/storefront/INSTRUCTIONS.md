# Storefront — playbook

The commerce machinery ships as files — data layer, hooks, cart, checkout, SEO plumbing,
typed end-to-end. **The presentation is yours**: you design and implement the product card,
the grid, and the PDP surface on the shipped hooks/DTOs, plus the home page and the brand.
You never write commerce code; you never skip designing the store.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source **only** on a real fallback: a runtime error, a field this
playbook doesn't cover, or when a *reference* component's pattern is explicitly worth reading
(marked below). Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two page
imports you swap to your own components.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgSrc()` / `formatMoney()` — already used by everything shipped |
| `wix/storefront/types.ts` | the DTOs (`ProductSummary`, `ProductDetail`, `Cart`, `Category`) — contracts inlined below |
| `wix/storefront/catalog.ts` | `fetchProducts`, `fetchProductsByCategory`, `fetchProductBySlug`, `fetchCategories`, `resolveVariant` |
| `wix/storefront/cart.ts` · `cart-store.ts` | Cart V2 + shared cart state (module store — spans Astro islands) |
| `hooks/storefront/useCart.ts` | cart state + actions — contract below |
| `hooks/storefront/useShop.ts` | listing + live category filter — contract below |
| `hooks/storefront/useProductDetail.ts` | option selection → variant resolution → add-to-cart — contract below |
| `components/storefront/CartButton.tsx` · `CartDrawer.tsx` | header badge + slide-over cart — **wire as-is** (drawer once per page) |
| `components/storefront/ShopView.tsx` · `ProductCard.tsx` · `ProductGrid.tsx` · `ProductDetailView.tsx` · `VariantPicker.tsx` | **REFERENCE implementations** — correct, plain, deliberately generic. Read for patterns if useful; **build your own instead of shipping them** (below) |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — same token family as the official Wix templates). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand**: header, footer, nav. Keep the `<slot name="seo-tags" />`, the global.css import, and the CartButton/CartDrawer mounts |
| `pages/shop.astro` | SSR listing page — **keep its frontmatter** (the data fetching), swap the island import to YOUR shop component |
| `pages/products/[slug].astro` | SSR PDP with owner-editable SEO — **keep its frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly, swap the island import to YOUR detail component |

## What you build — this is the design job, not optional polish

You implement **four surfaces yourself**, styled with Tailwind utilities on the `@theme`
tokens, designed to fit the brief (the business, the tone, the audience — a toy brand and a
jewelry house should not get the same store):

1. **The product card + grid** — your tile design (image treatment, badges, price/sale
   presentation, hover behavior) and your grid rhythm (columns, density, maybe an editorial
   featured tile). Keep skeleton-while-loading and an honest empty state (the reference
   `ProductGrid` shows the pattern — `products === null` → skeletons, `[]` → empty message).
2. **The shop surface** — category filter + your grid, on `useShop`.
3. **The PDP surface** — gallery, price/sale, description, your option-selection UI (color
   options = real swatches), quantity, add-to-cart — on `useProductDetail`, which owns ALL
   selection/variant logic; you own how it looks.
4. **The home page** — hero, featured products (fetch in frontmatter → your grid), brand story.

Plus the **theme** (edit the `@theme` block in `styles/global.css` — one edit; a dark brand is
flipped token values; add brand fonts as extra tokens) and the **chrome** (header/footer in
`SiteLayout.astro`, one edit pass; mount the shipped `CartButton` in your header).

### The contracts your components consume (everything you need — don't read the source)

```ts
// ProductSummary (grid tiles) — all display-ready: prices formatted, images https URLs:
// { id, slug, name, price, maxPrice, compareAtPrice|null, ribbon|null,
//   availability: "IN_STOCK"|"OUT_OF_STOCK"|"PARTIALLY_OUT_OF_STOCK", preorder: boolean,
//   imageUrl, hoverImageUrl, optionsSummary /* "2 colors · 3 sizes" */, quickAddable: boolean }
// price vs maxPrice differ → show a range. quickAddable → useCart().addToCart(product.id).

// useShop({ initialProducts?, initialCategories? }) →
// { products: ProductSummary[]|null /* null = loading → skeletons */, categories: Category[],
//   activeCategoryId: string|null, setActiveCategoryId(id|null), loading, error }
// Category = { id, slug, name }. Render the filter bar only when categories.length > 1.

// useProductDetail({ initial? /* SSR */, slug? /* SPA */ }) →
// { product: ProductDetail|null, notFound,
//   optionGroups: [{ id, name, isColor, choices: [{ choiceId, name, colorCode|null, inStock, selected }] }],
//   selectOption(optionName, choiceName),
//   modifierValues, setModifier(key, value),          // product.modifiers: pills or text input; "*" = mandatory
//   price, compareAtPrice,                            // live: variant price once resolved
//   canAdd,                                           // gate the button; false until every option picked & in stock
//   quantity, setQuantity, add(), adding, error }
// ProductDetail adds: descriptionHtml (render as HTML), gallery: string[] (urls, main first),
// options, modifiers, variants — but selection ALWAYS goes through the hook above.

// useCart() →
// { cart: { lines, itemCount, subtotal, currency }|null, busy, error, open,
//   addToCart(productId, variantId?, qty?, extras?), updateQuantity(lineItemId, qty),
//   removeLine(lineItemId), checkout(), openCart(), closeCart(), refresh() }
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass).
2. Write your components under `src/components/storefront/` (new file names — don't overwrite
   the references), then **swap the island import** in `pages/shop.astro` and
   `pages/products/[slug].astro` to yours — keep each page's frontmatter (data fetching, SEO
   pieces) exactly as shipped. Primary-content islands mount `client:load` with the SSR props;
   browser-state widgets (cart) are `client:only="react"` — the shipped mounts show this.
3. Write `pages/index.astro` (home) on `SiteLayout`.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
config plugins — deploy already added the dep). Write route wrappers in the project's router:
`/shop` → your shop component; `/products/:slug` → your detail component
(`useProductDetail({ slug })` — components fetch client-side when no `initial` is passed).
Mount the shipped `CartButton` in the header and `CartDrawer` once. Deploy wrote the public
client id into `wix/config.ts`; nothing else to configure.

## Hard rules

- **Data and commerce logic only through the shipped exports** — never rewrite their
  internals or re-derive a request shape. Extend by calling the exports or adding a new
  function in `wix/storefront/` for a genuine gap (API contracts: the `wix-docs` skill).
- **Selection→cart goes through `useProductDetail`** — never add a product with options by
  picking `variants[0]`, and never gate `canAdd` yourself.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Theme via the `@theme` tokens; your markup uses Tailwind utilities on the same tokens. No
  parallel theme files, no hardcoded palette values in components.
- Checkout only through the shipped cart (`checkout()`) — never a hand-built checkout URL.
- Live data or an honest empty state — never mock products, prices, reviews, or counts.
- Keep the PDP page's SEO pieces (`wixMetadata` + `loadSEOTagsServiceConfig` + `<SEO.Tags>`)
  exactly as shipped — owners edit those tags in their dashboard.

## Point the user to their dashboard

Give the owner the dashboard, products, and categories links — **the deploy step's JSON
output already printed them ready-made** (`dashboardUrl`, `productsUrl`, `categoriesUrl`);
copy, don't re-derive. Real payments additionally need a premium plan + a connected payment
method (dashboard) — mention it, don't treat it as a code failure.

## Seeding

Per `seed/SEED.md` — a plain-data `plan.json` into `seed-store.mjs`, run from the project
root. Independent of the frontend work; seed a catalog that exercises the UI (≥1 product with
a color option, ≥1 on sale, an image per product) unless the brief says otherwise.

## Verify (before declaring done)

- [ ] `/shop` renders live products SSR (view-source shows product names) through **your**
      grid/card; category bar filters when categories exist; empty catalog shows your honest
      empty state.
- [ ] Your PDP: color options render as swatches, add is disabled until every option is
      picked (`canAdd`), the resolved variant's price shows, a sale shows the strikethrough.
- [ ] Cart: add / quantity ± / remove work; badge count is live; subtotal shows; cart survives
      a reload (same visitor token).
- [ ] Checkout button redirects to Wix-hosted checkout.
- [ ] PDP view-source carries the SEO tags (Astro).
- [ ] Card/grid/PDP/home are YOUR designs on the tokens — not the shipped references; the
      data-layer/hook/cart files are unedited.
- [ ] Dashboard links handed to the owner.

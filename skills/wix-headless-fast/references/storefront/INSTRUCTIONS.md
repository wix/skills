# Storefront — playbook

The commerce machinery ships as files — data layer, hooks, cart, checkout, SEO plumbing,
typed end-to-end. **The presentation doesn't ship — you build it** on the shipped hooks/DTOs:
the shop and product (PDP) pages with their islands, the home page, and the brand. The
skeletons below carry each page's contract — including the SSR and SEO machinery, which must
be exact. You never write commerce code; you never skip designing the store.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source **only** on a real fallback: a runtime error, or a field
this playbook doesn't cover. Files you edit: `SiteLayout.astro` and `styles/global.css`.
Files you **create** (skeletons below): the shop and PDP pages with their island components,
plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgSrc()` / `imgSrcSet()` / `formatMoney()` — already used by everything shipped; `imgSrcSet` + `sizes` for responsive tiles |
| `wix/storefront/types.ts` | the DTOs (`ProductSummary`, `ProductDetail`, `Cart`, `Category`) — contracts inlined below |
| `wix/storefront/catalog.ts` | `searchCatalog` (sort/filter/search + cursor paging, all server-side), `fetchProducts`, `fetchProductsByCategory`, `fetchProductBySlug`, `fetchCategories`, `resolveVariant` |
| `wix/storefront/cart.ts` · `cart-store.ts` | Cart V2 + shared cart state (module store — spans Astro islands) |
| `hooks/storefront/useCart.ts` | cart state + actions — contract below |
| `hooks/storefront/useShop.ts` | listing + live category filter — contract below |
| `hooks/storefront/useProductDetail.ts` | option selection → variant resolution → add-to-cart — contract below |
| `components/storefront/CartButton.tsx` · `CartDrawer.tsx` | header badge + slide-over cart — **wire as-is** (drawer once per page) |
| `components/storefront/ShopView.tsx` · `ProductDetailView.tsx` | **don't ship — YOU create them** (skeletons below): the client islands your shop and PDP pages mount |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — same token family as the official Wix templates). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand**: header, footer, nav. Keep the `<slot name="seo-tags" />`, the global.css import, and the CartButton/CartDrawer mounts |
| `pages/shop.astro` · `pages/products/[slug].astro` | **don't ship — YOU create them** (skeletons below): thin SSR pages that fetch server-side and mount your islands; the PDP page carries the owner-editable SEO machinery, exactly as its skeleton shows |

## What you build — this is the design job, not optional polish

You implement **three surfaces yourself** — each an SSR page plus its island, per the
skeletons below — styled with Tailwind utilities on the `@theme` tokens, designed to fit the
brief (the business, the tone, the audience — a toy brand and a jewelry house should not get
the same store):

1. **The shop page + `ShopView`** (skeletons below) — category filter + your grid of your
   tiles: image treatment, badges, price/sale presentation, hover behavior, grid rhythm
   (columns, density, maybe an editorial featured tile). `products === null` → skeleton tiles,
   `[]` → an honest empty state. Decompose into `ProductCard`/`ProductGrid` files if you like —
   your call, nothing prescribes it.
2. **The PDP page + `ProductDetailView`** (skeletons below) — gallery, price/sale,
   description, your option-selection UI (color options = real swatches), quantity,
   add-to-cart — on `useProductDetail`, which owns ALL selection/variant logic; you own how it
   looks. This is the surface that most often looks generic — make the layout the brand's: an
   editorial split, a sticky buy column, a full-bleed gallery.
3. **The home page** — hero, featured products (fetch in frontmatter → your grid), brand story.

Plus the **theme** (edit the `@theme` block in `styles/global.css` — one edit; a dark brand is
flipped token values; add brand fonts as extra tokens) and the **chrome** (header/footer in
`SiteLayout.astro`, one edit pass; mount the shipped `CartButton` in your header).

### What a complete storefront shows (recommended defaults)

These are the recommended defaults for a store whose brief says nothing about them. They are
not requirements: when the user's prompt asks for something different — a cart page instead of a
drawer, no shop page, a particular layout or look — the prompt wins, and the item here that
conflicts with it is dropped without discussion. Look at the catalog before designing (categories,
assortment size, media, options, sales, ribbons) and design for this store, not for a stereotype
of its category. Then, by default:

- **Home:** what the store sells and one shopping action in the first screen; real products under
  truthful headings ("Best Sellers" needs data behind it); not a repeat of the shop page.
- **Shop:** a real product card — image, name, price, link — in the first screen; sort and the
  filters the catalog supports; loading, empty, no-results, and error states that look different.
- **Product page:** image, name, price, the first choice, and the buy button with `blockedReason`
  in the first screen; every ribbon; every image reachable in the gallery.
- **Cart:** the shipped drawer — it opens after every add, and checkout is a button in it.
- **Overlays you build** (quick-add, mobile nav, filters): mount at the document root (a fixed
  panel inside the `backdrop-blur` header gets clipped), lock background scroll, close on Escape,
  return focus on close — as the shipped `CartDrawer` does.
- **Copy:** nothing the merchant didn't supply — no invented reviews, scarcity, or delivery
  promises; no Wix IDs or technical words in visible text.

Pre-order ships (`isPreorder`). Subscriptions, product groups, promotions, and notify-me are built
only when the catalog has them — never fabricated; `wix-docs` has their contracts.

### The contracts your components consume (everything you need — don't read the source)

```ts
// ProductSummary (grid tiles) — all display-ready: prices formatted, images https URLs:
// { id, slug, name, price, maxPrice, compareAtPrice|null, ribbon|null, ribbons: string[],
//   minPriceVariantId|null, availability: "IN_STOCK"|"OUT_OF_STOCK"|"PARTIALLY_OUT_OF_STOCK",
//   preorder: boolean, imageUrl, hoverImageUrl, optionsSummary /* "2 colors · 3 sizes" */,
//   quickAddable: boolean }
// price !== maxPrice → the product is a RANGE: render "price – maxPrice" (compareAtPrice is null
// then — never a struck price beside a range). Otherwise price is what the buyer pays (a discount
// already applied) and compareAtPrice, when present, is the labelled "was".
// ribbons = EVERY merchant ribbon, primary first — render all, one shared style; a ribbon is a
// label, never proof of a discount. quickAddable → useCart().addToCart(product.id, product.minPriceVariantId).

// useShop({ initialProducts?, initialCategories?, pageSize? /* 24 */ }) →
// { products: ProductSummary[]|null /* null = loading → skeletons */, categories: Category[],
//   activeCategoryId: string|null, setActiveCategoryId(id|null),
//   sort: keyof SORTS, setSort(sort), filters, setFilters({ minPrice?, maxPrice?, inStockOnly?, search? }),
//   loading, error, retry(), hasMore, loadMore(), loadingMore }
// Category = { id, slug, name }. Render the filter bar only when categories.length > 1.
// Sort/filter/search/paging run on Wix across the WHOLE catalog (a change restarts the list).
// SORTS (exported next to useShop) is Record<sortKey, { label: string }> — the value is an
// OBJECT, so render entry.label, never the entry itself:
//   Object.entries(SORTS).map(([key, { label }]) => <option value={key}>{label}</option>)
// hasMore → render a "load more" control calling loadMore() (disabled while loadingMore).

// useProductDetail({ initial? /* SSR */, slug? /* SPA */ }) →
// { product: ProductDetail|null, notFound,
//   optionGroups: [{ id, name, isColor, choices: [{ choiceId, name, colorCode|null, inStock, selected }] }],
//   selectOption(optionName, choiceName),
//   modifierValues, setModifier(key, value),          // product.modifiers: pills or text input; "*" = mandatory
//   price, compareAtPrice,                            // the RANGE until every option is picked, then the variant's price (+ labelled "was" when real)
//   isPreorder,                                       // resolved variant is out of stock but pre-orderable → label the action "Pre-order"
//   canAdd,                                           // gate the button; false until every option picked & in stock (or pre-orderable)
//   blockedReason,                                    // "Choose Size" / "Out of stock" / "Add Engraving" — render beside the button as
//                                                     //   neutral guidance (not error styling) while it's disabled; null when addable
//   quantity, setQuantity, add(), adding, error }     // quantity resets to 1 when an option changes
// ProductDetail adds: descriptionHtml (render as HTML), infoSections: [{ title, html }] (sections
// or accordions), gallery: string[] (urls, main first), options, modifiers, variants — but
// selection ALWAYS goes through the hook above.

// useCart() →
// { cart: { lines, itemCount, subtotal, discount /* "" when none */, currency }|null, busy, error, open,
//   addToCart(productId, variantId?, qty?, extras?), updateQuantity(lineItemId, qty),
//   removeLine(lineItemId), checkout(), openCart(), closeCart(), refresh() }
// addToCart rejects on refusal (out of stock, digital product with no file) AND records
// .error, opening the drawer either way — so render .error in whatever surface you build for
// the cart, and never chain checkout() onto an add without awaiting it successfully.
```

### The pages and islands you create — skeletons

Nothing renders until you write these — the store IS your work. Each page is a thin SSR shell
(fetch → DTO props → island); each island is a thin view over a hook. The pages' frontmatter
is **machinery, not design** — reproduce it as the skeletons show, exactly. Hooks first,
branches after (an early return above a hook changes hook order between renders and React
throws). The islands render on the server too (`client:load` SSRs), and by then the 200 and
headers are already sent — a render throw truncates the body mid-stream and surfaces to the
visitor as `ERR_HTTP2_PROTOCOL_ERROR`, not an error page. Render every state totally; nothing
in a render path may throw.

```astro
---
// src/pages/shop.astro — YOU create it. Products and categories are fetched SERVER-SIDE
// (SEO: view-source shows product names) and handed to the island as serialized DTO props;
// category switches then filter live on the client.
import SiteLayout from "../layouts/SiteLayout.astro";
import ShopView from "../components/storefront/ShopView";
import { fetchProducts, fetchCategories } from "../wix/storefront/catalog";
import type { Category, ProductSummary } from "../wix/storefront/types";

let products: ProductSummary[] = [];
let categories: Category[] = [];
try {
  [products, categories] = await Promise.all([fetchProducts({ limit: 24 }), fetchCategories()]);
} catch {
  // Guarded: an unhandled SSR throw truncates the response mid-stream; the island
  // renders your empty state instead.
}
---
<SiteLayout title="Shop">
  <!-- your page heading / intro, then: -->
  <ShopView client:load initialProducts={products} initialCategories={categories} />
</SiteLayout>
```

```astro
---
// src/pages/products/[slug].astro — YOU create it. This is a Wix ITEM PAGE: the wixMetadata
// export + <SEO.Tags> are what let the site owner edit this page's title/description/OG in
// the dashboard and register the route in the sitemap. All three SEO pieces are REQUIRED,
// exactly as here.
import SiteLayout from "../../layouts/SiteLayout.astro";
import ProductDetailView from "../../components/storefront/ProductDetailView";
import { fetchProductBySlug } from "../../wix/storefront/catalog";
import { WIX_APPS } from "@wix/essentials";
import { SEO } from "@wix/seo/components";
import { loadSEOTagsServiceConfig } from "@wix/seo/services";
import { seoTags } from "@wix/seo";

export const wixMetadata = {
  appDefId: WIX_APPS.checkoutAndOrders.id,
  pageIdentifier: WIX_APPS.checkoutAndOrders.productPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.checkoutAndOrders.productPageMetadata.identifiers.handle },
};

const slug = Astro.params.slug!;

// Behind Wix's proxy the request URL is the internal one — the real public page URL arrives
// on x-wix-forwarded-url, and the SEO service needs the public one.
const forwardedUrl = Astro.request.headers.get("x-wix-forwarded-url");
const pageUrl =
  forwardedUrl && URL.canParse(forwardedUrl) && /^https?:$/.test(new URL(forwardedUrl).protocol)
    ? forwardedUrl
    : Astro.url.href;

let product = null;
let seoTagsServiceConfig = null;
try {
  [product, seoTagsServiceConfig] = await Promise.all([
    fetchProductBySlug(slug),
    loadSEOTagsServiceConfig({
      pageUrl,
      itemType: seoTags.ItemType.STORES_PRODUCT,
      itemData: { slug },
    }),
  ]);
} catch {
  // Guarded: an unhandled SSR throw truncates the response mid-stream.
}

if (!product) {
  return new Response(null, { status: 404 });
}
---
<SiteLayout title={product.name}>
  <SEO.Tags seoTagsServiceConfig={seoTagsServiceConfig} slot="seo-tags" />
  <ProductDetailView client:load initial={product} />
</SiteLayout>
```

```tsx
// src/components/storefront/ShopView.tsx — YOU build it; your shop.astro mounts it.
import { useShop } from "../../hooks/storefront/useShop";
import type { Category, ProductSummary } from "../../wix/storefront/types";

export default function ShopView(props: {
  initialProducts?: ProductSummary[];   // SSR props from your shop.astro — pass straight
  initialCategories?: Category[];       // to useShop; omitted in a SPA (client fetch)
}) {
  const { products, categories, activeCategoryId, setActiveCategoryId, loading, error } =
    useShop(props);
  // …you implement the render:
  //   • category pills when categories.length > 1 — All + one per category,
  //     driving setActiveCategoryId(id | null)
  //   • a sort control over SORTS driving setSort; filters (price bounds, in-stock,
  //     name search) via setFilters — include the ones that fit the brief, not all of them
  //   • error → a short inline message (retry() re-runs the query)
  //   • products === null (or loading) → skeleton tiles; [] → your honest empty state
  //   • else YOUR grid of YOUR tiles (ProductSummary contract above): image (hoverImageUrl on
  //     hover; imgSrcSet + sizes for responsive delivery), name, price — a range when
  //     price !== maxPrice, else price + labelled compareAtPrice — EVERY ribbon from ribbons,
  //     optionsSummary; tile links to `/products/${p.slug}`;
  //     quickAddable → useCart().addToCart(p.id, p.minPriceVariantId)
  //   • badges come ONLY from p.ribbons. Do NOT render a "Sale" badge because compareAtPrice
  //     is set — the struck price already says it, and a product the merchant ribboned "Sale"
  //     would show the badge twice.
  //   • hasMore → your "load more" control calling loadMore() (disabled while loadingMore)
}
```

```tsx
// src/components/storefront/ProductDetailView.tsx — YOU build the whole PDP surface;
// your [slug].astro mounts it with the server-fetched product.
import { useProductDetail } from "../../hooks/storefront/useProductDetail";
import type { ProductDetail } from "../../wix/storefront/types";

export default function ProductDetailView(props: {
  initial?: ProductDetail | null;   // SSR (Astro); a SPA passes { slug } instead
  slug?: string;
}) {
  const d = useProductDetail(props);   // full contract above — selection lives HERE
  // …you implement the render. Handle in order:
  //   d.notFound  → a "doesn't exist (anymore)" message
  //   !d.product  → a loading placeholder
  //   else the product view, laid out for the brand:
  //     • gallery from d.product.gallery (urls, main first): show ONE primary
  //       image at full size, and the rest as a small thumbnail strip (or a
  //       scrollable row) that swaps the primary — never map the whole gallery
  //       to full-width images stacked down the column (products with per-color
  //       linked media carry several gallery urls, so that stacks big duplicates).
  //       A single-image gallery is just the one primary — no empty strip.
  //     • name, EVERY ribbon (d.product.ribbons), live d.price (the range until every option
  //       is picked) with d.compareAtPrice as a labelled "was" when present — never invent one;
  //       descriptionHtml rendered as HTML, then d.product.infoSections as sections/accordions
  //     • option controls from d.optionGroups → d.selectOption(optionName, choiceName)
  //       (isColor → real swatches via colorCode; disable out-of-stock choices);
  //       modifiers from d.product.modifiers → d.setModifier(key, value), "*" = mandatory
  //     • quantity (d.quantity / d.setQuantity), then the buy button gated by d.canAdd
  //       ONLY — never resolve variants yourself — calling d.add(); label it "Pre-order" when
  //       d.isPreorder; while disabled, render d.blockedReason beside it as neutral guidance
  //       (not error styling); d.adding disables, d.error renders inline
  //     • in the first screen at mobile and desktop: the image, name, price, the first choice,
  //       and the button with its reason — a shopper decides without scrolling
}
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass).
2. Create the shop and PDP pages and their islands per the skeletons above — frontmatter
   machinery exact, presentation yours. Primary-content islands mount `client:load` with the
   SSR props; browser-state widgets (cart) are `client:only="react"`.
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
  function in `wix/storefront/` for what they don't cover (API contracts: the `wix-docs` skill).
- **Selection→cart goes through `useProductDetail`** — never add a product with options by
  picking `variants[0]`, and never gate `canAdd` yourself.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Theme via the `@theme` tokens; your markup uses Tailwind utilities on the same tokens. No
  parallel theme files, no hardcoded palette values in components.
- Checkout only through the shipped cart (`checkout()`) — never a hand-built checkout URL.
- Live data or an honest empty state — never mock products, prices, reviews, or counts.
- **Prices and ribbons come from the DTOs as-is** — no computed percent-off, no "Sale" badge
  inferred from `compareAtPrice`, no struck price beside a range (the DTO already withholds it).
- **Cart totals come from `cart`** — never summed or hardcoded in the client; shipping and tax say
  "calculated at checkout" (the drawer already does).
- Your PDP page carries the SEO pieces (`wixMetadata` + `loadSEOTagsServiceConfig` +
  `<SEO.Tags>`) exactly as the skeleton shows — owners edit those tags in their dashboard.
- **Browsing, cart and checkout need no login.** They run on the Wix visitor session the
  shipped SDK client already holds. Don't gate the shop, the PDP or the cart behind sign-in,
  and don't add a members/auth flow unless the brief actually asks for accounts.
- **Call every hook before any conditional return.** A PDP that returns early for
  `notFound`/loading above its `useState`/`useEffect` changes hook order between renders and
  React throws. Hooks first, branches after.
- **Sort and filter at the source, not on a loaded page.** `useShop`'s sort/filters/search and
  `searchCatalog` run on Wix across the whole catalog before cursor paging; re-ordering the
  array a hook already returned only sorts the slice you happen to have. Never sort/filter
  client-side, and never raise the page limit instead of paging (`hasMore`/`loadMore`).

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
- [ ] Your PDP: color options render as swatches, the button shows `blockedReason` ("Choose
      Size") until every option is picked, the price is the range until then and the variant's
      price after, a sale shows the labelled "was", a sold-out combination reads "Out of stock",
      a pre-orderable one reads "Pre-order".
- [ ] Cards: every ribbon renders; a multi-price product shows a range with no struck price.
- [ ] Cart: add / quantity ± / remove work; badge count is live; subtotal shows; cart survives
      a reload (same visitor token).
- [ ] Checkout button redirects to Wix-hosted checkout.
- [ ] PDP view-source carries the SEO tags (Astro).
- [ ] Shop/PDP/home are YOUR designs on the tokens; the data-layer/hook/cart files are
      unedited.
- [ ] Dashboard links handed to the owner.

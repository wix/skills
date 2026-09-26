# Storefront — playbook

The commerce machinery ships as files — data layer, hooks, cart, checkout, SEO plumbing,
typed end-to-end. **The presentation doesn't ship — you build it** on the shipped hooks/DTOs:
the shop, category, and product (PDP) pages with their islands, the home page, and the brand.
The skeletons below carry each page's contract — including the SSR and SEO machinery, which must
be exact. You never write commerce code; you never skip designing the store.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro` and `styles/global.css`.
Files you **create** (skeletons below): the shop, category, and PDP pages with their island
components, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(p.imageUrl, "25vw")} alt={p.name} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath, already used by everything shipped |
| `wix/storefront/types.ts` | the DTOs (`ProductSummary`, `ProductDetail`, `Cart`, `Category`, `Facet`) — contracts inlined below |
| `wix/storefront/catalog.ts` | `searchCatalog` (sort/filter/facets/search + cursor paging + result count, all server-side), `fetchFacets`, `fetchProducts`, `fetchProductsByCategory`, `fetchProductBySlug`, `fetchCategories`, `fetchCategoryBySlug`, `resolveVariant` — the transport; the rules and DTO mappers are in `catalog-core.ts` / `cart-core.ts` beside it (shared with the REST layer) |
| `wix/storefront/cart.ts` · `cart-store.ts` | Cart V2 + shared cart state (module store — spans Astro islands) |
| `wix/storefront/shop-store.ts` · `product-detail-store.ts` | the listing and product-detail state machines, framework-free (`createShopStore()`, `createProductDetailStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/storefront/useCart.ts` | cart state + actions — contract below |
| `hooks/storefront/useShop.ts` | React binding of `shop-store.ts`: category scope, sort, filters, option facets, result count, paging — contract below |
| `hooks/storefront/useProductDetail.ts` | React binding of `product-detail-store.ts`: option selection → variant resolution → add-to-cart — contract below |
| `components/storefront/CartButton.tsx` · `CartDrawer.tsx` | header badge + slide-over cart — **wire as-is** (drawer once per page) |
| `components/storefront/FilterPanel.tsx` | the gallery's filter LAYOUT — toolbar (result count, sort), active chips, then a 16rem sidebar of collapsible groups (price as a two-handle slider bounded by the catalog's real prices, availability, one group per option facet with swatches/pills) beside YOUR results; a bottom sheet under `md` — **wire as-is** in your `ShopView`, your grid as its children: `<FilterPanel shop={shop}>…grid…</FilterPanel>` |
| `components/storefront/QuickAdd.tsx` | the tile's purchase control — one click for a product with no options, a picker anchored to the tile (bottom sheet on small screens) for one with options, the product page for free-text customization — **wire as-is** as the last row of every tile's text block (`<QuickAdd product={p} />`) |
| `components/storefront/OptionPicker.tsx` | the purchase controls for one product — option groups (swatches/pills, sold-out choices disabled), choice and text modifiers, an optional quantity stepper, the buy button gated by `useProductDetail` with its plain reason, "Pre-order" when pre-orderable — **wire as-is** in your PDP (`<OptionPicker detail={d} showQuantity />`); QuickAdd's picker is this same component |
| `components/storefront/ShopView.tsx` · `ProductDetailView.tsx` | **don't ship — YOU create them** (skeletons below): the client islands your shop, category, and PDP pages mount |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — same token family as the official Wix templates). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand**: header, footer, nav. Keep the `<slot name="seo-tags" />`, the global.css import, and the CartButton/CartDrawer mounts |
| `pages/shop.astro` · `pages/category/[slug].astro` · `pages/products/[slug].astro` | **don't ship — YOU create them** (skeletons below): thin SSR pages that fetch server-side and mount your islands; the category and PDP pages carry the owner-editable SEO machinery, exactly as their skeletons show |

## What you build — this is the design job, not optional polish

You implement **three surfaces yourself** — each an SSR page plus its island, per the
skeletons below — styled with Tailwind utilities on the `@theme` tokens, designed to fit the
brief (the business, the tone, the audience — a toy brand and a jewelry house should not get
the same store):

1. **The shop page + `ShopView`** (skeletons below) — category links, the shipped
   `FilterPanel`, and your grid of your tiles: image treatment, badges, price/sale
   presentation, hover behavior, grid rhythm (columns, density, maybe an editorial featured
   tile), each tile carrying the shipped `QuickAdd`. `products === null` → skeleton tiles,
   `[]` → an honest empty state. Decompose into `ProductCard`/`ProductGrid` files if you like —
   your call, nothing prescribes it. **The category page** (`/category/[slug]`) mounts the same
   `ShopView` scoped to one category — one island, two pages.
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
  truthful headings ("Best Sellers" needs data behind it); not a repeat of the shop page. A
  category tile or link on the home page goes to that category's page (`/category/<slug>`) —
  never to an anchor on the shop page that every tile shares — and its image is a product from
  THAT category (fetched with the category filter) or the category's own image, never a
  positional guess into the all-products list.
- **Shop:** a real product card — image, name, price, link — in the first screen; the shipped
  `FilterPanel` around the grid (toolbar, then a filter sidebar beside the results on desktop and
  a sheet on phones) — a store with any filterable catalog ships it, not "when it fits"; the
  shipped `QuickAdd` as the last row of every tile; each
  category reachable by a real link (`/category/<slug>`) — from the nav, the home page, or the
  shop's category row; loading, empty, no-results, and error states that look different.
- **Product page:** image, name, price, the first choice, and the buy button with `blockedReason`
  in the first screen **at 390px wide too** — on a phone the image is a bounded band
  (`max-h-[45vh]`), not a full-screen hero that pushes the price below the fold; every ribbon;
  every image reachable in the gallery.
- **Cart:** the shipped drawer — it opens after every add, and checkout is a button in it.
- **Overlays you build** (quick-add, mobile nav, filters): mount at the document root (a fixed
  panel inside the `backdrop-blur` header gets clipped), lock background scroll, close on Escape,
  return focus on close — as the shipped `CartDrawer` does. An anchored picker is positioned
  inside its tile, not `fixed` with computed offsets. If you add dismiss-on-outside-click, decide
  inside/outside before anything re-renders (a capture-phase listener), or a click on a swatch
  that re-renders the panel reads as "outside" and closes it.
- **A page whose slug resolves to nothing** (category, product) shows only the not-found state —
  no heading, toolbar, or empty grid rendered around it.
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
//   swatches: string[] /* hex colors of a color option's choices — dots on the tile, not a picker */,
//   quickAddable: boolean }
// price !== maxPrice → the product is a RANGE: render "price – maxPrice" (compareAtPrice is null
// then — never a struck price beside a range). Otherwise price is what the buyer pays (a discount
// already applied) and compareAtPrice, when present, is the labelled "was".
// ribbons = EVERY merchant ribbon, primary first — render all, one shared style; a ribbon is a
// label, never proof of a discount. The tile's buy control is the shipped <QuickAdd product={p} />:
// it reads quickAddable / minPriceVariantId / preorder itself and routes to a direct add, an
// anchored option picker, or the product page — don't rebuild that decision in the tile.

// useShop({ initialProducts?, initialCategories?, initialCategoryId?, pageSize? /* 24 */ }) →
// { products: ProductSummary[]|null /* null = loading → skeletons */, total: number|null,
//   categories: Category[], activeCategoryId: string|null, setActiveCategoryId(id|null),
//   sort: keyof SORTS, setSort(sort), filters, setFilters({ minPrice?, maxPrice?, inStockOnly?, search? }),
//   facets: Facet[], selectedChoiceIds, toggleChoice(choiceId), clearFilters(), hasActiveFilters,
//   loading, error, retry(), hasMore, loadMore(), loadingMore }
// Category = { id, slug, name, description }. Facet = { name, isColor, choices: [{ id, name, colorCode|null }] }.
// The shipped <FilterPanel shop={shop}>{…your grid…}</FilterPanel> renders total/sort/chips, the
// filter sidebar (md+) or sheet, and lays your results out beside it — hand it the whole hook result
// and put your grid + states inside it; don't build a second filter UI or a second sort control. Categories are LINKS (`/category/${c.slug}`) — a category page is a URL
// a shopper can share and a search engine can index; setActiveCategoryId is for a live scope
// switch on /shop, not a substitute for the links.
// Sort/filter/facets/search/paging run on Wix across the WHOLE catalog (a change restarts the list).
// The selection is mirrored into the query string (?sort=&min=&max=&stock=1&q=&choice=…) and read
// back on load — a filtered gallery is a shareable link; nothing for you to wire.
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
//   // a line: { lineItemId, productName, quantity, unitPrice, linePrice, imageUrl, descriptionLines,
//   //           status, subscription /* "Monthly plan · every month · 12 payments" or "" */ }
//   addToCart(productId, variantId?, qty?, extras?), updateQuantity(lineItemId, qty),
//   removeLine(lineItemId), checkout(), openCart(), closeCart(), refresh() }
// addToCart rejects on refusal (out of stock, digital product with no file) AND records
// .error, opening the drawer either way — so render .error in whatever surface you build for
// the cart, and never chain checkout() onto an add without awaiting it successfully.
```

### The pages and islands you create — skeletons

The class names in these skeletons are the Astro/React spelling of layout rules that hold on
every stack, and each rule is also named in words beside its classes. On a stack where the shipped
components don't deploy (`lib`, `static`, a port), keep the rule and write it in your own CSS.

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
// src/pages/category/[slug].astro — YOU create it. A category is a Wix ITEM PAGE like a product:
// its own URL, its SEO owner-editable in the dashboard, registered in the sitemap. Same SEO
// machinery as the PDP with the CATEGORY identifiers. It mounts the SAME ShopView, scoped.
import SiteLayout from "../../layouts/SiteLayout.astro";
import ShopView from "../../components/storefront/ShopView";
import { fetchCategoryBySlug, fetchProductsByCategory, fetchCategories } from "../../wix/storefront/catalog";
import type { Category, ProductSummary } from "../../wix/storefront/types";
import { WIX_APPS } from "@wix/essentials";
import { SEO } from "@wix/seo/components";
import { loadSEOTagsServiceConfig } from "@wix/seo/services";
import { seoTags } from "@wix/seo";

export const wixMetadata = {
  appDefId: WIX_APPS.checkoutAndOrders.id,
  pageIdentifier: WIX_APPS.checkoutAndOrders.categoryPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.checkoutAndOrders.categoryPageMetadata.identifiers.handle },
};

const slug = Astro.params.slug!;
const forwardedUrl = Astro.request.headers.get("x-wix-forwarded-url");
const pageUrl =
  forwardedUrl && URL.canParse(forwardedUrl) && /^https?:$/.test(new URL(forwardedUrl).protocol)
    ? forwardedUrl
    : Astro.url.href;

let category: Category | null = null;
let products: ProductSummary[] = [];
let categories: Category[] = [];
let seoTagsServiceConfig = null;
try {
  [category, categories, seoTagsServiceConfig] = await Promise.all([
    fetchCategoryBySlug(slug),
    fetchCategories(),
    loadSEOTagsServiceConfig({ pageUrl, itemType: seoTags.ItemType.STORES_CATEGORY, itemData: { slug } }),
  ]);
  if (category) products = await fetchProductsByCategory(category.id, { limit: 24 });
} catch {
  // Guarded: an unhandled SSR throw truncates the response mid-stream.
}

// A missing or hidden category is a real 404 — never a fallback to all products.
if (!category) {
  return new Response(null, { status: 404 });
}
---
<SiteLayout title={category.name}>
  <SEO.Tags seoTagsServiceConfig={seoTagsServiceConfig} slot="seo-tags" />
  <!-- your heading: category.name, category.description when present, then: -->
  <ShopView client:load initialProducts={products} initialCategories={categories} initialCategoryId={category.id} />
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
// src/components/storefront/ShopView.tsx — YOU build it; shop.astro AND category/[slug].astro mount it.
import { useShop } from "../../hooks/storefront/useShop";
import FilterPanel from "./FilterPanel";
import QuickAdd from "./QuickAdd";
import { imgAttrs } from "../../wix/media";
import type { Category, ProductSummary } from "../../wix/storefront/types";

export default function ShopView(props: {
  initialProducts?: ProductSummary[];   // SSR props from your page — pass straight to useShop;
  initialCategories?: Category[];       // omitted in a SPA (client fetch)
  initialCategoryId?: string | null;    // the category page passes its category's id
}) {
  const shop = useShop(props);
  const { products, categories, activeCategoryId, loading, error } = shop;
  // …you implement the render:
  //   • a category row when categories.length > 1: LINKS to `/category/${c.slug}` (plus "All" →
  //     /shop), the active one marked by activeCategoryId — real URLs, not only pills that
  //     swap state (setActiveCategoryId is fine for an additional live switch on /shop)
  //   • <FilterPanel shop={shop}> … </FilterPanel> WRAPS your results — shipped: the toolbar
  //     (result count, sort), active chips, a filter sidebar on md+ (price slider, availability,
  //     the option facets, collapsible) beside your grid, a sheet under md. Your loading / empty /
  //     error states and your grid go inside it as children. Always mounted; it shows only the
  //     facets this catalog actually has. No sort control or filter UI of your own.
  //   • error → a short inline message (retry() re-runs the query)
  //   • products === null (or loading) → skeleton tiles; [] → your honest empty state, and a
  //     distinct "no products match these filters" with clearFilters() when hasActiveFilters
  //   • else YOUR grid of YOUR tiles (ProductSummary contract above): image via
  //     <img {...imgAttrs(p.imageUrl, "(min-width: 768px) 25vw, 50vw")} alt={p.name} /> — src,
  //     srcSet, sizes and lazy loading in one spread, so a tile never ships srcSet without src;
  //     an empty imageUrl gives {} — render your placeholder then; hoverImageUrl
  //     on hover — name, price — a range when
  //     price !== maxPrice, else price + labelled compareAtPrice — EVERY ribbon from ribbons,
  //     swatches as small color dots when present (else optionsSummary as text); tile links to
  //     `/products/${p.slug}`; and <QuickAdd product={p} /> as the LAST ROW of the tile's text
  //     block, under name and price, full width — the shipped buy control (direct add / option
  //     picker / product page, decided from the product). It is a direct child of the tile root,
  //     which carries `relative`: the picker anchors to that root and takes the tile's width.
  //     THE TILE ROOT IS A <div className="relative flex flex-col">, NOT THE LINK: the <a> wraps
  //     the image and the name/price, and <QuickAdd> sits beside it as the flex column's last child
  //     (it pins itself to the bottom with mt-auto). A button inside an <a> is invalid HTML and its
  //     click navigates to the product page instead of adding.
  //   • ROW RHYTHM: the grid stretches every tile in a row to the tallest; with the tile a flex
  //     column and the control pinned to the bottom, the buy buttons share one baseline across the
  //     row even when one tile has swatches, a struck price, or a two-line name and its neighbours
  //     don't. Put the swatches between price and control; never let them push only that tile's
  //     button down. Never overlay the control on the image or float it
  //     between image and text, and never wrap it in a smaller positioned box (the picker would
  //     inherit that box's width).
  //   • the name WRAPS (`min-w-0`, `break-words`) — no `truncate` / `line-clamp-1`: a shopper reads
  //     "Red Velvet Cupcake 4-Pack", not "Red Velvet Cupc…"; price on its own line under it.
  //   • badges come ONLY from p.ribbons. Do NOT render a "Sale" badge because compareAtPrice
  //     is set — the struck price already says it, and a product the merchant ribboned "Sale"
  //     would show the badge twice.
  //   • name and price on SEPARATE lines — never one flex row where a long name and a price
  //     range fight for width and the price gets clipped at 390px. Keep the page intro short
  //     enough that a full tile (image, name, price) is in the first screen, also on a short
  //     desktop window.
  //   • hasMore → your "load more" control calling loadMore() (disabled while loadingMore)
}
```

```tsx
// src/components/storefront/ProductDetailView.tsx — YOU build the whole PDP surface;
// your [slug].astro mounts it with the server-fetched product.
import { useProductDetail } from "../../hooks/storefront/useProductDetail";
import OptionPicker from "./OptionPicker";
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
  //       When d.variant resolves and carries imageUrl, that image becomes the primary (it is
  //       one of the gallery urls) — a shopper who picks a color sees that color.
  //     • name, EVERY ribbon (d.product.ribbons), live d.price (the range until every option
  //       is picked) with d.compareAtPrice as a labelled "was" when present — never invent one;
  //       descriptionHtml rendered as HTML, then d.product.infoSections as sections/accordions
  //     • <OptionPicker detail={d} showQuantity /> right under the price — the shipped option
  //       groups (swatches for a color option, sold-out choices disabled), modifiers, quantity,
  //       and the buy button gated by the hook with its plain reason, "Pre-order" when it applies,
  //       the add error inline. Never resolve variants or gate the button yourself.
  //     • in the first screen at mobile AND desktop: the image, name, price, the first choice,
  //       and the button with its reason — a shopper decides without scrolling. On a phone that
  //       means the primary image is a bounded band, not a full-height hero: e.g. the gallery
  //       column `max-h-[45vh] md:max-h-none` with `object-contain`, thumbnails as a row under
  //       it, and the two-column split only from md (`md:grid md:grid-cols-2`); description and
  //       infoSections come AFTER the buy button, never between the price and the action.
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/storefront/shop-store.ts`, `product-detail-store.ts`,
`cart-store.ts` — so you never rewrite them: create a store per surface, `subscribe`, render from
`getState()`, call its actions. Their `*State` interfaces are the render contract; read those.
What you write is the rendering — grid, product page, picker, filter panel, drawer — and for that
read these first; they are tested code for exactly that behaviour, and rewriting them from the
prose above is where the bugs come from:

1. `components/storefront/QuickAdd.tsx` — the three purchase paths decided from the summary DTO;
   the panel is positioned inside the tile (the tile is `relative`), a bottom sheet on small
   screens, never `fixed` with computed offsets; it closes on Escape, the close button, a
   successful add, or the scrim — there is NO outside-click handler (one that runs after a
   re-render sees the clicked swatch detached and closes on every pick).
2. `components/storefront/OptionPicker.tsx` — the purchase controls as working code: swatches vs
   pills, sold-out choices disabled, quantity, the gated button with its reason and the
   "Pre-order" label; the PDP and the tile picker share it.
3. `components/storefront/CartDrawer.tsx` — the overlay contract as working code: root-level,
   scrim, scroll lock, Escape, focus in and back.
4. `components/storefront/FilterPanel.tsx` — inline commits at once, the sheet stages until Apply;
   the price pair commits only when valid.

All under `references/storefront/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass).
2. Create the shop, category, and PDP pages and their islands per the skeletons above —
   frontmatter machinery exact, presentation yours. Primary-content islands mount `client:load` with the
   SSR props; browser-state widgets (cart) are `client:only="react"`.
3. Write `pages/index.astro` (home) on `SiteLayout`.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs storefront --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts`
(the visitor client, configured with the public client id), `media.ts`, `money.ts`, and
`wix/storefront/` — `catalog.ts`, `cart.ts`, `types.ts`, the `*-core.ts` rules, and the three
stores `shop-store.ts`, `product-detail-store.ts`, `cart-store.ts`. None of it is React. The
hooks and components don't ship on this stack; the stores replace the hooks, and you write the
components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createShopStore(options)` per listing (`start()` when
  mounted, `stop()` when unmounted), `createProductDetailStore({ initial | slug })` per product
  surface, the cart store as-is (module-level). State in, actions out — exactly the hooks'
  contracts above;
- your filter panel, quick add, and cart drawer to the contracts in "What a complete storefront
  shows" — the shipped `FilterPanel.tsx`, `QuickAdd.tsx`, `CartDrawer.tsx` are readable as
  behaviour specs (the overlay contract, the three purchase paths, the sidebar/sheet split).

Routes `/shop`, `/category/:slug` (via `fetchCategoryBySlug`, null → your 404), `/products/:slug`;
dev server on 4321; a static build goes through `npx @wix/cli@latest release` with
`site.outputDirectory` pointing at the build folder, an SSR build is hosted by you. Item-page tags
from the entity's `seoData`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs storefront --stack static --out site` put the REST layer in `site/js/wix/` (browser
ESM, the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `searchCatalog`, `fetchFacetData`, `fetchProductBySlug`,
`fetchCategories`, `fetchCategoryBySlug`, `resolveVariant` from `./js/wix/catalog.js`;
`fetchCart`, `addToCart`, `updateQuantity`, `removeLine`, `checkoutUrl` from `./js/wix/cart.js`.
The state machines ship too: `createShopStore` from `./js/wix/shop-store.js` (the listing —
selection, facets, URL sync, cursor paging; `start()` once the page is up), `createProductDetailStore`
from `./js/wix/product-detail-store.js` (the PDP and every quick-add picker — selections start
empty, `resolveVariant`, `canAdd`/`blockedReason`, `add()`), and `./js/wix/cart-store.js` (the
cart, `subscribeCart`/`getCartState`, `addLine`, `updateLineQuantity`, `removeCartLine`,
`goToCheckout`, `setCartOpen`). No components ship — you write the rendering in plain JS: one
render function per surface that reads `getState()`, called from `subscribe`, with the
surface's controls calling the store's actions. The drawer opens after every add on its own;
overlays follow the CartDrawer contract (root-level, scroll lock, Escape, focus back). Pages are
`shop.html`, `category.html?slug=…`,
`product.html?slug=…`. Set `document.title` and the meta description from the entity's `seoData`
once it loads, on the product AND category pages. The visitor token persists in `localStorage` on
its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs storefront --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the
server:** port `js/wix/catalog.ts` and `catalog-core.ts` to your language — the same six functions
returning the same DTO shapes as dicts, one anonymous visitor token per process for these public
reads (mint and refresh per `client.ts`) — and render shop, category, and PDP in your templates to
the contracts above, so product names and prices are in the HTML; item-page tags from the entity's
`seoData`. **Buying in the browser:** the cart drawer on `./js/wix/cart-store.js`, the PDP's
option picker and the tile's quick add on `./js/wix/product-detail-store.js` (pass the product's
slug, or the rendered `ProductDetail` as `initial` in a JSON script tag), exactly as the static
wiring above — the browser owns the shopper's visitor token, so the server never handles
per-shopper tokens. Routes stay `/shop`, `/category/<slug>`, `/products/<slug>`. Add your public https origin
to the OAuth app's allowed domains before checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator must emit every product and
category page (a URL generator over `fetchCategories()` plus a full `searchCatalog` walk by
cursor — never only the first page). Run `deploy.mjs storefront --stack static --out <build dir>`
so `js/wix/` is inside the output the pages import from, point `site.outputDirectory` at that
folder, `wix release`. Pages sit at different depths (`/`, `/category/…`, `/products/…`): give
the templates one base path to `js/wix/` (a template variable, or root-relative `/js/wix/…`),
never a relative `./js/wix/` — it breaks one level down. The frozen grid is the first paint; the
shop's sort, filters, facets, search, and load-more still run client-side on it through
`createShopStore()` from `./js/wix/shop-store.js`, exactly as on a static site, so the gallery
contract above applies. Close
with the live URL, the rebuild + release command, and one line for the owner: dashboard edits to
the catalog reach the site when that command runs; cart and checkout are live regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
config plugins — deploy already added the dep). Write route wrappers in the project's router:
`/shop` → your shop component; `/category/:slug` → the same shop component with
`initialCategoryId` resolved from `fetchCategoryBySlug(slug)` (null → your 404 view);
`/products/:slug` → your detail component (`useProductDetail({ slug })` — components fetch
client-side when no `initial` is passed).
Mount the shipped `CartButton` in the header and `CartDrawer` once. Deploy wrote the public
client id into `wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Data and commerce logic only through the shipped exports** — never rewrite their
  internals or re-derive a request shape. Extend by calling the exports or adding a new
  function in `wix/storefront/` for what they don't cover (API contracts: the `wix-docs` skill).
- **Selection→cart goes through `useProductDetail`** — never add a product with options by
  picking `variants[0]`, and never gate `canAdd` yourself. On the PDP that is the shipped
  `OptionPicker`; in the gallery the shipped `QuickAdd` — a tile never adds a product with options itself, and never hides the buy path
  behind "go to the product page" for a product that has no options.
- **Filters are the shipped `FilterPanel`** — mounted in the gallery whenever the store has a
  catalog to filter; not rebuilt with fewer controls, not dropped because the brief didn't ask.
- **Categories are pages** — `/category/[slug]` with its SEO block, linked from the chrome; a
  category that exists only as a state toggle on `/shop` has no URL to share or index.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. No parallel theme files, no hardcoded palette values in components. Where they don't
  (`lib`, `static`, a port): style with whatever your stack does well, on one token set of your
  own; the rule that survives is the token set, not Tailwind.
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

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON also prints
`dashboardUrl`, `productsUrl`, `categoriesUrl`); an entity id fills the placeholder from the seed result.

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Products | `wix-stores/products` |
| Edit a product | `wix-stores/products/product/{productId}` |
| Categories | `wix-stores/categories/list` |
| Inventory | `wix-stores/inventory` |
| Orders | `ecom-platform/orders-list` |
| Store settings | `wix-stores/settings` |

Real payments additionally need a premium plan + a connected payment method (Settings → Accept
payments) — mention it, don't treat it as a code failure.

## Seeding

Per `seed/SEED.md` — a plain-data `plan.json` into `seed-store.mjs`, run from the project
root. Independent of the frontend work; seed a catalog that exercises the UI (≥1 product with
a color option, ≥1 on sale, an image per product) unless the brief says otherwise.

# Storefront — playbook

A complete Wix Stores storefront ships as files: catalog + variants + cart + Wix-hosted
checkout, typed end-to-end. You wire routes and build the brand layer; you don't write
commerce code.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the typed export signatures are the whole
contract, and every shape you need is in this playbook. Open a shipped file's source **only**
on a real fallback: a runtime error, or a field this playbook doesn't cover. The one exception
is `SiteLayout.astro`, which you edit (below).

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgSrc()` / `formatMoney()` — already used by everything shipped |
| `wix/storefront/types.ts` | the DTOs: `ProductSummary`, `ProductDetail`, `Cart`, `Category`… — the shapes your own UI consumes |
| `wix/storefront/catalog.ts` | `fetchProducts`, `fetchProductsByCategory`, `fetchProductBySlug`, `fetchCategories`, `resolveVariant` |
| `wix/storefront/cart.ts` | `addToCart`, `fetchCart`, `updateQuantity`, `removeLine`, `checkoutUrl` (Cart V2) |
| `wix/storefront/cart-store.ts` | shared cart state (module store — spans Astro islands) |
| `hooks/storefront/useCart.ts` | cart state + actions for any React component |
| `hooks/storefront/useShop.ts` | listing + live category filter (accepts SSR `initial` data) |
| `hooks/storefront/useProductDetail.ts` | option selection → variant resolution → add-to-cart |
| `components/storefront/ShopView.tsx` | full listing surface: category bar + grid — mount as-is |
| `components/storefront/ProductDetailView.tsx` | full PDP surface: gallery, picker, qty, add — mount as-is |
| `components/storefront/CartButton.tsx` · `CartDrawer.tsx` | header badge + slide-over cart — mount as-is (drawer once per page) |
| `components/storefront/VariantPicker.tsx` | swatches/pills/modifiers — used by ProductDetailView |
| `components/storefront/ProductCard.tsx` · `ProductGrid.tsx` | **reference** tile + grid — correct as-is; designing your own on the same DTOs is encouraged (pass `CardComponent` to ShopView/ProductGrid) |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, font — same token family as the official Wix templates). Every shipped component styles itself from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | the site chrome — **yours to brand**: header, footer, nav. Keep the `<slot name="seo-tags" />`, the global.css import, and the CartButton/CartDrawer mounts |
| `pages/shop.astro` | SSR listing → ShopView island — wire as-is |
| `pages/products/[slug].astro` | SSR PDP with owner-editable SEO (`wixMetadata` + `<SEO.Tags>`) — wire as-is |

## What you build

The **home page**, the **theme** (edit the `@theme` token block in `styles/global.css` — a dark
brand is just flipped token values), the **layout chrome** (header/footer in `SiteLayout.astro`), and
the **copy** — composing shipped pieces. A featured strip on home is `fetchProducts()` in
frontmatter + `<ProductGrid client:load products={…} />`; nav is a link to `/shop` plus the
shipped `CartButton`. Style everything you add with Tailwind utilities reading the same tokens
(`bg-primary`, `text-muted-foreground`, `rounded-lg`, …).

### Wiring — Astro (default)

Deploy already placed pages, layout, and islands. Remaining work: build `pages/index.astro`
(home) on `SiteLayout`, set the brand's tokens in `styles/global.css` (**one edit** of the
`@theme` block), and brand the header/footer in `SiteLayout.astro` (**one edit pass** — read it
once, rewrite header+footer together). Every island mounts with `client:load` when it renders
primary content with SSR props, `client:only="react"` when it reads browser-only state (the
shipped mounts already do this correctly).

### Wiring — React SPA (Vite etc.)

No pages ship — write thin route wrappers in the project's router:

```tsx
import "./styles/global.css";               // once, at the app entry (needs @tailwindcss/vite in vite.config plugins)
import ShopView from "./components/storefront/ShopView";
import ProductDetailView from "./components/storefront/ProductDetailView";
import CartButton from "./components/storefront/CartButton";
import CartDrawer from "./components/storefront/CartDrawer";
import { Link, useParams } from "react-router-dom";

const AppLink = ({ href, className, children }) => <Link to={href} className={className}>{children}</Link>;

// routes: /shop → <ShopView LinkComponent={AppLink} />
//         /products/:slug → <ProductDetailView slug={useParams().slug!} />
// layout: <CartButton /> in the header; <CartDrawer /> mounted once.
```

Components fetch client-side when no `initial` props are passed. The deploy step wrote the
public client id into `wix/config.ts`; nothing else to configure.

## Hard rules

- Wire the shipped exports as-is; never rewrite their internals or re-derive a request shape.
  Extend by calling the exports or adding a new function in `wix/storefront/` for a genuine gap
  (API contracts: the `wix-docs` skill).
- Don't wrap shipped calls in your own API routes — they run client-side by design. A backend
  route is only for a genuinely privileged (elevated) read, which nothing here needs.
- Theme via the `@theme` tokens in `styles/global.css`, never by restyling shipped component
  markup or adding a parallel theme file. Your own markup uses Tailwind utilities on the same
  tokens.
- Checkout only through the shipped cart (`checkout()` / `checkoutUrl()`) — never a hand-built
  checkout URL.
- Live data or the shipped empty state — never mock products, prices, reviews, or counts.
- On the PDP, selection→cart goes through `useProductDetail` — never add a product with
  options by picking `variants[0]`.

## Point the user to their dashboard

Content editing happens in the Wix dashboard — give the owner the dashboard, products, and
categories links. **The deploy step's JSON output already printed them ready-made**
(`dashboardUrl`, `productsUrl`, `categoriesUrl`) — copy them from there, don't re-derive.

Real payments additionally need a premium plan + a connected payment method (dashboard) —
mention it, don't treat it as a code failure.

## Seeding

Per `seed/SEED.md` — a plain-data `plan.json` into `seed-store.mjs`, run from the project
root. Independent of the frontend work; seed a catalog that exercises the UI (≥1 product with
a color option, ≥1 on sale) unless the brief says otherwise.

## Verify (before declaring done)

- [ ] `/shop` renders live products SSR (view-source shows product names) with the category
      bar when categories exist; empty catalog shows the shipped empty state.
- [ ] A product with options: choices render (color = swatches), add is disabled until every
      option is picked, and the resolved variant's price shows.
- [ ] Cart: add / quantity ± / remove work; badge count is live; subtotal shows; cart survives
      a reload (same visitor token).
- [ ] Checkout button redirects to Wix-hosted checkout.
- [ ] PDP view-source carries the SEO tags (Astro) and a sale product shows the strikethrough.
- [ ] Home/header/footer are yours; brand set via the `@theme` tokens; shipped files unedited.
- [ ] Dashboard links handed to the owner.

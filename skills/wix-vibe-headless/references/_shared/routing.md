# Mounting pages: which template is this app?

Base44 ships more than one app template, and they route differently. Check before you write a
page — a storefront built for the wrong router renders nothing, and the preview comes back blank
with no error to explain it.

```
src/routes/__root.jsx exists   →  TanStack Start, file-based routes. No src/App.jsx, no index.html.
src/App.jsx exists             →  React Router SPA.
```

The app's own `AGENTS.md` (both templates ship one) states its conventions — read it before the
first write.

## Both templates: install the nav adapter first

Shipped components import `Link`, `useParams` and friends from `@/lib/nav`, never from a router
package, so the same files run on either template. Copy the matching adapter **before** you copy a
vertical's `app/` tree:

```
_shared/nav/nav.react-router.js  →  src/lib/nav.js     (React Router template)
_shared/nav/nav.tanstack.js      →  src/lib/nav.js     (TanStack Start template)
```

Skipping this leaves every shipped card and detail page with an unresolvable import, and the dev
server fails to start rather than rendering a broken page.

## React Router template

One `Layout` holding your chrome renders `<Outlet/>`; every route nests under a single pathless
route so the chrome wraps all pages. Each vertical's `STEP 3` carries the exact snippet, including
where the preview banner sits.

## TanStack Start template

Same structure, expressed as files. The chrome that lives in `Layout` goes in `src/routes/__root.jsx`
(it already renders the document and providers — add your header/footer around its `<Outlet/>`),
and each route is its own file exporting `createFileRoute`:

```jsx
// src/routes/shop.jsx      →  /shop
import { createFileRoute } from "@tanstack/react-router";
import Shop from "@/pages/Shop";                      // the shipped page, unchanged

export const Route = createFileRoute("/shop")({ component: Shop });
```

```jsx
// src/routes/product.$slug.jsx   →  /product/:slug
import { createFileRoute } from "@tanstack/react-router";
import ProductDetail from "@/pages/ProductDetail";    // shipped; reads its param via @/lib/nav

export const Route = createFileRoute("/product/$slug")({ component: ProductDetail });
```

Three things to carry over from the React Router wiring:

- **Shipped pages stay where they are** (`src/pages/…`) and stay unedited. A route file is a
  two-line mount, not a copy of the page.
- **Path params use `$name`**, so `/product/:slug` becomes the file `product.$slug.jsx` and the
  route path `/product/$slug`. `useParams()` from `@/lib/nav` returns them the same way.
- **Providers** a vertical asks you to wrap the tree in (`CartProvider`, `MemberProvider`, …) go in
  `__root.jsx` around `<Outlet/>`, once — not per route file.

Per-user routes should also set `ssr: false` so personal data never lands in cacheable HTML:

```jsx
export const Route = createFileRoute("/my-plans")({ component: MyPlans, ssr: false });
```

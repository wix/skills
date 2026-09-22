# Mounting pages: which template is this app?

Base44 ships more than one app template, and they route differently — so which one you are on
decides how a page gets mounted. A page mounted the other template's way renders nothing, and the
preview comes back blank with no error to explain it.

**The install already told you.** Its `deploy` result carries the answer it resolved from disk:

```json
{ "template": "react-router",  "navAdapter": "written", … }
{ "template": "tanstack",      "navAdapter": "written", … }
```

Same fact, read directly, if that output has scrolled away: `src/routes/__root.jsx` present →
TanStack Start (file-based routes, no `src/App.jsx`, no `index.html`, build output in `.output/`
rather than `dist/`); `src/App.jsx` present → React Router SPA. The app's own `AGENTS.md` (both
templates ship one) states its conventions — worth a read before the first write.

## The nav adapter is already installed

Shipped components import `Link`, `useParams` and friends from `@/lib/nav`, never from a router
package, so one set of sources runs on either template. The install resolved the template and wrote
the matching adapter to `src/lib/nav.js` — `nav.react-router.js` or `nav.tanstack.js` from
`_shared/nav/` — before any vertical's files landed.

Use the file that is there. It is the one place the router is named, and on TanStack it carries two
normalisations that the imports depend on: `useParams` is scoped with `strict: false`, and
`useNavigate` returns a function you call with a path (`navigate(-1)` still goes back). Write your
own pages against `@/lib/nav` too, and they stay portable for free.

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

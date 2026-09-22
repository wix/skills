# Mounting pages: which template is this app?

Base44 ships more than one app template, and they route differently — so which one you are on
decides how a page gets mounted. A page mounted the other template's way renders nothing, and the
preview comes back blank with no error to explain it.

**An install that ran `deploy.cjs` already told you** — its result carries the template it resolved
from disk, as `{ "template": "react-router" }` or `{ "template": "tanstack" }`. Where the host
deployed the tree itself there is no such line, and the same fact reads straight off the app —
**ask `src/routes/__root.jsx` first**: present → TanStack Start (file-based routes, build output in
`.output/` rather than `dist/`); absent → React Router SPA, routed from `src/App.jsx` with an
`index.html` beside it. That order matters, because an `src/App.jsx` on a TanStack app is
something an agent wrote believing the app was React Router — `__root.jsx` is never there by
mistake. The app's own `AGENTS.md` (both templates ship one) states its conventions — worth a read
before the first write.

## On TanStack, four things differ from the React Router form

Routing guidance you meet elsewhere — routes wired into `src/App.jsx`, `react-router-dom` imports,
its `AuthProvider` / `QueryClientProvider` wrappers — describes the React Router template. On this
one:

- **There is no `src/App.jsx`, and that is the finished state.** Leave it absent; creating one
  wires a router the app does not use, and the pages mounted in it never render.
- **Route files import `createFileRoute` and `Link` from `@tanstack/react-router`**, which this
  template installs.
- **The wrappers live in `src/routes/__root.jsx`.** Same rule as `App.jsx` carries on the other
  template: add around them, never replace them.
- **Telling the two apart costs nothing** — the app's files are already in your context.

## The nav adapter is already installed

Shipped components import `Link`, `useParams` and friends from `@/lib/nav`, never from a router
package, so one set of sources runs on either template. `src/lib/nav.js` arrives with the rest of
the deployed tree, and it is the one place the router is named. Write your own pages against
`@/lib/nav` too and they stay portable for free.

**On TanStack, check what landed.** The deployed default is the React Router adapter, and
`deploy.cjs` swaps the TanStack one in when it runs — but a host that copies the tree itself lands
the default whatever the template. So on a TanStack app, open `src/lib/nav.js` and, if it
re-exports from `react-router-dom`, copy `_shared/nav/nav.tanstack.js` over it. That file carries
the two normalisations the imports depend on: `useParams` scoped with `strict: false`, and
`useNavigate` returning a function you call with a path (`navigate(-1)` included).

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

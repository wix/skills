# Wix Pricing Plans — ready-made client

The Plans & Pricing client is **shipped as real files**, not snippets to regenerate. It's a complete
plans table + plan detail + members-only hosted checkout + "my plans" area, styled with your app's
design tokens (base44's `src/index.css` — the shadcn palette the design phase already set). Copy it
into the app and wire the routes — you generate almost none of the plans code (the destructure
shapes, the price/billing-cycle field paths, the hosted checkout redirect, the anonymous `[]` case
all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock plans;
never hand-build a `/checkout` or purchase URL — purchasing always goes through the Wix-hosted
**redirect-session** (which also handles member login/signup and payment).

## Prerequisites
- The site's **Wix Pricing Plans** app is the read/checkout target. It's installed and seeded
  separately (see **Seeding** below), in parallel with this build — so it may have no plans at build
  time; the client renders the shipped empty state until plans land.
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).
- **Purchasing is members-only, via Wix-hosted checkout.** The hosted flow handles member
  login/signup + the order form + payment, then returns to your site. The deployed app domain must
  be allow-listed on the OAuth client for that return to work — a **separate Wix setup flow the user
  completes later**, out of scope here. If the return fails before that setup is done, that's
  expected; flag it and continue.

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole Plans & Pricing UI client + REST scaffolds
into `src/` (imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your
map, so you don't need to open them:**

| file | what it is |
|---|---|
| `hooks/usePlans.js` | plans-listing data — first page, cursor paging, `subscribe(plan)` checkout |
| `hooks/usePlanDetail.js` | plan-detail data — plan-by-slug + `notFound` + `subscribe()` checkout |
| `hooks/useMyPlans.js` | member's orders + auto re-sync on return from checkout |
| `components/PlanPrice.jsx` | price label — reads amount / cycle / free-trial (display only) |
| `components/PlanCard.jsx` | plan card — name, description, price, perks, Subscribe (when `buyable`) |
| `components/PlanGrid.jsx` | responsive plans grid + empty state |
| `components/OrderCard.jsx` | one member order row for the "my plans" list |
| `components/WixManageBanner.jsx` | preview-only manage banner — drop it into your Layout (STEP 3) |
| `pages/Plans.jsx` | the plans-table route (`/plans`) — grid + paging + checkout |
| `pages/PlanDetail.jsx` | the plan-detail route (`/plans/:slug`) — perks, terms, checkout |
| `pages/MyPlans.jsx` | the member's memberships + post-checkout confirmation (`/my-plans`) |
| `rest/wix-config.js` | the two ids, written by the install step |
| `rest/wix-client.js` + `rest/wix-pricing-plans.js` | REST transport + plans/orders/checkout helpers |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each
is and every field shape you need is in the snippets below. Read a shipped file's source **only** on
a real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/pricing-plans/app/` → `src/`.)


## STEP 2 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens
in `src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`,
`--muted`, `--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`,
`text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`,
`font-display`). Those tokens are **already set to the brand by the design phase**, so the shipped
pages are themed with zero work here. To adjust the palette, edit `index.css` (`:root` **and**
`.dark`) — the base44 way; **never add a parallel theme file (e.g. a `theme.css`) or restyle the
shipped JSX.** Build the Home/Header you add (STEP 3) from the **same** base44 tokens/classes so it
matches automatically. A dark brand is just base44's dark palette in `index.css` — no per-component work.

## STEP 3 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it. Pricing Plans needs **no** cross-page provider (checkout is a redirect, not client
state) — so unlike the storefront there's no `<CartProvider>` to wrap.
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every**
  page — including the shipped `Plans` / `PlanDetail` / `MyPlans` — so you **never edit the shipped
  pages to add a header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, preview-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's **ResizeObserver-measured** height so it clears the chrome and
  self-corrects when the banner is dismissed.
- Routes under the Layout: `/plans` → `Plans`, `/plans/:slug` → `PlanDetail`, `/my-plans` →
  `MyPlans` (all shipped, as-is). **You add `/` → your own Home** page.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, preview-only · default export, no props
import Plans from "@/pages/Plans";                     // shipped · default export, no props
import PlanDetail from "@/pages/PlanDetail";           // shipped · default export, no props
import MyPlans from "@/pages/MyPlans";                 // shipped · default export, no props
import Home from "@/pages/Home";       // YOU build
import Header from "@/components/Header";   // YOU build — plain in-flow markup, NOT position:fixed
import Footer from "@/components/Footer";   // YOU build

function Layout() {
  const topRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {                                  // measure the fixed region → pad content below it
    const ro = new ResizeObserver(() => setOffset(topRef.current?.offsetHeight ?? 0));
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);
  return (<>
    <div ref={topRef} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <WixManageBanner />                    {/* null on the published site / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped Plans/PlanDetail/MyPlans render here, untouched */}
      <Footer />
    </div>
  </>);
}

<Routes>
  <Route element={<Layout />}>                                {/* chrome wraps all */}
    <Route path="/" element={<Home />} />                      {/* yours */}
    <Route path="/plans" element={<Plans />} />                {/* shipped, as-is */}
    <Route path="/plans/:slug" element={<PlanDetail />} />     {/* shipped, as-is */}
    <Route path="/my-plans" element={<MyPlans />} />           {/* shipped, as-is */}
  </Route>
</Routes>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** and a **`Footer`** — the two you drop into the
`Layout` (STEP 3) so they wrap every route — plus the overall brand story, styled with the same
base44 tokens/classes. **Compose the shipped pieces** — a "featured plans" strip is just `queryPlans` +
the shipped `PlanGrid`; the nav is links to `/plans` and `/my-plans`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryPlans, checkout } from "@/rest/wix-pricing-plans";
import PlanGrid from "@/components/PlanGrid";

// Responsive header: choose ONE branch with a state flag (mount each nav item once).
// Do NOT render a desktop nav AND a mobile nav toggled by `hidden md:flex` / `md:hidden`:
// these navs are inline-styled, and an inline `display` beats a Tailwind class, so `hidden`
// never applies — BOTH branches render. One branch = one nav.
export function Header() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);            // keep it reactive to viewport changes
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* brand/logo */}
      {mobile
        ? <YourMenu />                                       // your hamburger + the same links
        : <div style={{ display: "flex", gap: 24 }}><Link to="/plans">Plans</Link><Link to="/my-plans">My plans</Link></div>}
    </nav>
  );
}

export function Featured() {                                // on your home page
  const [plans, setPlans] = useState([]);
  // NB: queryPlans returns { plans, nextCursor } — destructure the array.
  useEffect(() => { queryPlans({ limit: 3 }).then(({ plans }) => setPlans(plans)); }, []);
  const subscribe = async (plan) =>
    { window.location.href = await checkout(plan.id, { thankYouPageUrl: `${window.location.origin}/my-plans` }); };
  return <PlanGrid plans={plans} onSubscribe={subscribe} empty="Plans coming soon." />;
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev
preview can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do
a fresh full navigate/reload of the preview and re-check — don't keep rewriting correct code against
a stale render.

## Using the client from your own UI

```jsx
// Every list helper returns an object — destructure it (a bare `.map` on the return throws):
const { plans, nextCursor } = await queryPlans({ limit: 24 });   // PUBLIC plans only
// Page: pass nextCursor back as `cursor`.
const { plans: more } = await queryPlans({ cursor: nextCursor });

// Price is DISPLAY-ONLY — never compute a final charge (Wix settles price, tax, schedule at checkout):
const v = plan.pricingVariants[0];
const amount = v.pricingStrategies[0].flatRate.amount;   // decimal STRING e.g. "20.00"; "0" = free (a string — don't === 0)
const cycle  = v.billingTerms.billingCycle;              // { period:"DAY"|"WEEK"|"MONTH"|"YEAR", count } — recurring only
const trial  = v.freeTrialDays;                          // free-trial length
// Pair `amount` with `plan.currency` (ISO-4217, e.g. "USD"). Show the buy button only when plan.buyable.

// Purchase — members-only, hosted; redirect to the returned URL, never hand-build it:
window.location.href = await checkout(plan.id, { thankYouPageUrl: `${window.location.origin}/my-plans` });
// On success Wix returns to thankYouPageUrl with ?planOrderId=<GUID> (+ wixMemberLoggedIn); on abandon → postFlowUrl.

// Member's memberships — resolves to [] for anonymous visitors (never throws):
const orders = await getMyPlanOrders({ orderStatuses: ["ACTIVE"] });   // omit orderStatuses for all

// Plan image: plan.image is a WixMedia object { id, width, height, altText } with NO .url. The shipped
// cards render text only to avoid this. To show it, resolve the WixMedia `id` to a URL (wix-docs),
// or omit — never <img src={plan.image}> / <img src={plan.image.url}> (undefined / [object Object]).
```

## Extending the client
Beyond the shipped pages: **cancel / pause / resume** a member's subscription → Orders API
(`request-cancellation`, `pause-order`, `resume-order`); gate on `plan.buyerCanCancel`. **Custom
member login / logout** (so a member can log in *before* subscribing and see "my plans" without a
purchase) → pair the **members** vertical (`references/members/INSTRUCTIONS.md`). For anything the
snippets don't cover, make the call yourself with `wixApiRequest` — but look up the exact endpoint,
method, and body first (never guess):
- Pricing Plans: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans.md
- Orders: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders.md
- Headless redirect session: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md

Fallback only — when you hit an error or need something not shown here: read the relevant shipped
file under `src/`, or look it up via the **`wix-docs`** skill.

## Hard rules
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 3) — never edit the shipped
  `Plans`/`PlanDetail`/`MyPlans` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your
  `Header` is plain in-flow markup (not `position:fixed`).
- Purchase goes through the shipped `checkout()` (redirect-session) — never a hand-built URL.
- Treat plan objects as display-only — show the buy button only when `plan.buyable`; never compute
  the final charge. Never invent perks, prices, trials, testimonials, or member counts.
- Render live Wix data or the shipped empty state — never mock plans.

## Point the user to their dashboard
Provide deep links so the owner can edit content (substitute the site's `metaSiteId`):
- **Pricing Plans** — `https://manage.wix.com/dashboard/{metaSiteId}/pricing-plans` (`Dashboard →
  Pricing Plans`) → **+ Create Plan** (set the name, pricing model, perks, and connect the plan to
  the content/services it unlocks)

## Seeding
Seed plans per `seed/SEED.md` (the build-time setup module) — separate from this client build; run
in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] Opened the vertical's data route(s) (not just the home page) and confirmed the shipped
      components render themed (surface, text, brand) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps
      all routes; shipped `Plans`/`PlanDetail`/`MyPlans` untouched; content clears the fixed chrome.
- [ ] Plans list renders live data; price, billing cycle, and free trial read correctly across
      pricing models (recurring, single-payment, free); buy button only for `buyable` plans.
- [ ] Plan detail loads by slug and shows a not-found state on a bad slug.
- [ ] Purchase redirects via the redirect-session `fullUrl` (no hand-built URL) and reaches
      Wix-hosted login + payment; on return the new order appears on `/my-plans`.
- [ ] Empty catalog shows the shipped empty state; no mock plans anywhere.

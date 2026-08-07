# Wix Restaurants — ready-made client

The restaurant client is **shipped as real files**, not snippets to regenerate. It's a complete
menu + item ordering + server-cart + checkout, plus a table-reservation flow, styled entirely from
`theme.css` tokens. Copy it into the app, theme the tokens, wire the routes — you generate almost
none of the restaurant code (the menu tree join, the order cart, the reservation hold→reserve flow
all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock the
menu; never hand-build `/checkout` or reservation URLs — the shipped cart goes through the eCom
redirect-session and reservations go through the hold/reserve flow.

## Prerequisites
- The site's **Wix Restaurants Menus** app is the read target for the menu; **Restaurant Orders**
  backs online ordering; **Table Reservations** backs the booking page. They're installed and seeded
  separately (see **Seeding** below), in parallel with this build — so the menu may be empty and
  ordering / reservations may be unconfigured at build time. The client renders the shipped empty /
  "unavailable" states until content and operations land.
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).
- For Wix-hosted checkout to return, the deployed app domain must be allow-listed on the OAuth
  client — a **separate Wix setup the user completes later**, out of scope here. If checkout return
  fails before that, it's expected; flag it and continue.

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole restaurant UI client + REST scaffolds into
`src/` (imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map,
so you don't need to open them:**

| file | what it is |
|---|---|
| `theme.css` | design tokens — the **only** file you edit to re-skin (STEP 3) |
| `context/OrderCartContext.jsx` | `useOrderCart()` provider: resolves the ordering Operation, server cart, add/update/remove, checkout, `ordering` flag |
| `hooks/useItemOrder.js` | item-dialog add-to-order logic (stock + ordering-available gating, quantity) |
| `hooks/useReservation.js` | reservation flow (locations → date/party → AVAILABLE slots → hold → reserve) |
| `components/MenuItemCard.jsx`, `MenuList.jsx` | menu render UI (dish card + the menus→sections→items tree, with empty state) |
| `components/ItemDialog.jsx` | dish detail modal — description, price/variants, modifier groups (display), quantity, add-to-order |
| `components/OrderCartButton.jsx` | header order **icon** button with a live-count badge |
| `components/OrderCartDrawer.jsx` | slide-over order cart (mount once; opens from `useOrderCart`) |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `pages/Menu.jsx`, `pages/Reservations.jsx` | the two shipped routes (`/menu`, `/reservations`) |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` | REST transport + visitor-token mint/refresh (the refresh token IS the cart identity) |
| `rest/wix-restaurants-menu.js` | menu read helpers — `getFullMenu` (the assembled tree; start here) + raw `list*` |
| `rest/wix-restaurants-ordering.js` | ordering — operations, add/update/remove, `checkout` |
| `rest/wix-restaurants-reservations.js` | reservations — locations, time slots, hold, reserve |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each is
and every field shape you need is in the snippets below. Read a shipped file's source **only** on a
real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/restaurants/app/` → `src/`.)

## STEP 2 — Credentials
Write `src/rest/wix-config.js` with your `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt — the
one place both ids live.

## STEP 3 — Theme (the styling step — do ONLY this to the shipped components)
Edit `src/theme.css` tokens to the brand: palette, `--font-display`/`--font-body`, `--radius`,
spacing. Every shipped component reads these vars, so this re-skins the whole restaurant. **Do not
restyle the shipped components' JSX** — that's what keeps this a copy, not a regeneration. Style the
home page / header you build (STEP 4) from the same tokens so it matches. Dark brand → activate the
dark tokens with `document.documentElement.dataset.theme = "dark"`.

## STEP 4 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- `import "@/theme.css";` once at the app entry.
- Wrap the routed tree in `<OrderCartProvider>` (from `@/context/OrderCartContext`).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Menu` / `Reservations` — so you **never edit the shipped pages to add a
  header/footer** (they render inside `<Outlet/>` as-is). Mount `<OrderCartDrawer/>` once in the Layout.
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/menu` → `Menu`, `/reservations` → `Reservations` (both shipped, as-is).
  **You add `/` → your own Home** page.

```jsx
import "@/theme.css";
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { OrderCartProvider } from "@/context/OrderCartContext";
import OrderCartDrawer from "@/components/OrderCartDrawer";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only
import Menu from "@/pages/Menu";
import Reservations from "@/pages/Reservations";
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
      <WixManageBanner />                    {/* null in prod / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped Menu/Reservations render here, untouched */}
      <Footer />
    </div>
    <OrderCartDrawer />                       {/* overlays every page */}
  </>);
}

<OrderCartProvider>
  <Routes>
    <Route element={<Layout />}>                                {/* chrome wraps all */}
      <Route path="/" element={<Home />} />                     {/* yours */}
      <Route path="/menu" element={<Menu />} />                 {/* shipped, as-is */}
      <Route path="/reservations" element={<Reservations />} /> {/* shipped, as-is */}
    </Route>
  </Routes>
</OrderCartProvider>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** (mount `<OrderCartButton/>` in it) and a **`Footer`** —
the two you drop into the `Layout` (STEP 4) so they wrap every route — plus the overall brand story,
styled from the same `theme.css` tokens. The nav is an `<OrderCartButton/>` (a clean order-**icon**
button with a live-count badge — render it as-is, don't wrap it in your own text button) + links to
`/menu` and `/reservations`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import OrderCartButton from "@/components/OrderCartButton";

// Responsive header: choose ONE branch with a state flag, so <OrderCartButton/> mounts once.
// Do NOT render a desktop nav AND a mobile nav toggled by `hidden md:flex` / `md:hidden`:
// these navs are inline-styled, and an inline `display` beats a Tailwind class, so `hidden`
// never applies — BOTH branches render and you get two order buttons. One branch = one button.
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
        ? <YourMenu />                                       // your hamburger + <OrderCartButton/> here
        : <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <Link to="/menu">Menu</Link><Link to="/reservations">Reserve</Link><OrderCartButton />
          </div>}
    </nav>
  );
}
```

Everything visual reads `theme.css` tokens, so your home/nav match the shipped pages automatically.
`<OrderCartButton/>` is an icon button (live-count badge) — drop it in as-is, it inherits `currentColor`.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI (menu, order cart)

```jsx
import { getFullMenu } from "@/rest/wix-restaurants-menu";
import { useOrderCart } from "@/context/OrderCartContext";

// getFullMenu() is the ONLY pre-joined shape and the entry point for any menu surface. It returns
// { menus: [{ ...menu, sections: [{ ...section, items: [assembledItem] }] }] }, already ordered.
// Each item is enriched with a resolved price / variants, modifierGroups, and labels.
const { menus } = await getFullMenu();            // [] when no menus → show the shipped empty state

// useOrderCart() gives:
// { cart, operation, ordering, itemCount, isOpen, setIsOpen, loading,
//   addItem(item, { menuId, sectionId }, qty=1),   // needs the menu/section the item was shown under
//   removeItem(lineItemId), updateQuantity(lineItemId, qty), checkout(), refreshCart() }
// `ordering` is false when no ordering Operation is configured — show an "ordering unavailable" state.

// Load-bearing field paths (the shipped components already do these):
// - item.image / section.image / label.icon are OBJECTS → render `.url`, never the object; //-urls → https:
// - MENU prices are plain decimal strings with NO currency symbol ("12.50") — format in the UI.
//   The eCom cart line price (line.price.formattedAmount) DOES include the symbol.
// - an item is priced by EITHER item.price (single) OR item.variants[] (one-of, each { name, price }).
// - a cart mutation uses cart.lineItems[].id (the lineItemId), NOT the menu item id.
```

Buying happens in the shipped `ItemDialog` (opened from `MenuList`) — it owns quantity + add-to-order
and surfaces out-of-stock / ordering-unavailable errors. Compose a featured strip on your Home from
`getFullMenu()` + the shipped `MenuItemCard` if you want.

## Extending the client
Building something beyond the shipped pages, or need a path these snippets don't cover?

```jsx
// The raw list* helpers return UNRESOLVED refs and INCONSISTENT shapes (listMenus → { menus,
// nextCursor }; listSections/listItems/listVariants/listModifierGroups/listModifiers → bare arrays).
// Don't re-join them by hand — build on getFullMenu(). If you truly need a partial fetch, note they
// take an array of GUIDs: listSections(sectionIds), listItems(itemIds).

// Reservation status after reserve: RESERVED = confirmed, REQUESTED = manual approval pending
// (tell the user). firstName + phone (E.164, e.g. "+15551234567") are mandatory; a HELD reservation
// expires in 10 minutes — the hook passes the hold's { id, revision } into reserve for you.
```

Modifier up-charges / price-variant selection / special requests on the **cart line** are **not**
wired into `addItemToCart` — the restaurants `catalogReference.options` shape for these isn't
documented for client add-to-cart, so `ItemDialog` displays modifier groups for the diner but sends
only quantity. To wire them, confirm the shape via the **`wix-docs`** skill / the reference first,
never guess:
- Restaurants API reference: https://dev.wix.com/docs/api-reference/business-solutions/restaurants.md
- Sample flows (cart options): https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
- **Member login + a "my orders" account view** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`): ordering/reserving works anonymously, but signing a member
  in lets them see their own order/reservation history.

Fallback only — when you hit an error or need something not shown here: read the relevant shipped
file under `src/`, or look it up via the **`wix-docs`** skill.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Theme via `theme.css` tokens, never by rewriting the shipped components.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped `Menu`/`Reservations` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your `Header` is plain in-flow markup (not `position:fixed`).
- Order through the shipped cart: `addItem()` → `checkout()` (redirect-session) — never a hand-built `/checkout`, ordering, or reservation URL.
- Reservations: offer only `AVAILABLE` slots; pass the hold's `revision` into reserve; `firstName` + `phone` (E.164) are mandatory.
- Render live Wix data or the shipped empty / "unavailable" state — never mock menus, items, prices, operations, locations, slots, or reviews.

## Point the user to their dashboard
Provide deep links so the owner can edit content across the apps they actually use (substitute the
site's `metaSiteId` from the handoff / `ListWixSites`):
- **Menu** (always) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-menus-new` (`Dashboard → Restaurant Menus`; click **Manage Items** to add dishes; only visible menus appear in the app)
- **Online ordering** (if wired) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-orders-new/settings` (`Dashboard → Restaurant Orders → Settings`). Enable at least one fulfillment method before the site accepts orders: pickup `.../wix-restaurants-orders-new/settings/pickup`, delivery `.../settings/delivery`, dine-in `.../settings/dine-in`.
- **Table reservations** (if wired) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-table-reservations/table-reservations` (`Dashboard → Table Reservations` → **Settings**; configure tables, availability, and enable online reservations)

Tell the user at least once that they can keep setting up their restaurant (menu / ordering /
reservations) in the dashboard, and include the in-dashboard navigation as a fallback.

## Seeding
Seed the menu (and ordering/reservation setup) per `seed/SEED.md` — separate from this client build;
run in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] `theme.css` themed to the brand; shipped components/pages not restyled or rewritten.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all routes; shipped `Menu`/`Reservations` untouched; content clears the fixed chrome; `<OrderCartProvider>` wraps the tree; `<OrderCartDrawer/>` mounted; `<OrderCartButton/>` in the header.
- [ ] `getFullMenu()` renders real sections/items with prices, variants, modifiers, and labels; empty catalog shows the shipped empty state (no mock items).
- [ ] Add to order works with a real operation (or shows "ordering unavailable"); order survives reload (same visitor); update-qty / remove work; checkout redirects and re-fetches on return.
- [ ] Reservations: only `AVAILABLE` slots offered; hold → reserve produces `RESERVED`/`REQUESTED`; no locations shows the shipped empty state.
- [ ] Told the user they can continue setting up in the dashboard, with deep links.


# Wix Restaurants Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and the helper file(s) you need from `references/restaurants/`. All helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`).
>
> | Need | Copy |
> |---|---|
> | Menu display (always) | `wix-restaurants-menu.js` |
> | Online ordering (cart + checkout) | `wix-restaurants-ordering.js` |
> | Table reservations | `wix-restaurants-reservations.js` |

Builds a real, client-only Wix restaurant experience. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock the menu; never hand-build `/checkout` or reservation URLs —
always go through the official cart + redirect-session and the reservations hold/reserve flow.

## When to use
- User wants a Wix restaurant site, an online food-ordering page, or a table-reservation page.
- User asks to "connect Wix Restaurants" or replace placeholder menu/ordering/booking UI with live data.
- Adding a menu, cart + checkout, or reservations over an existing Wix Restaurants setup.

## Prerequisites
1. A Wix site with the **Wix Restaurants Menus** app installed and **menu content already added**
   (this skill is read-only over the menu — it does NOT create menus/items).
2. For **online ordering**: at least one online-ordering **Operation** configured (Wix Restaurants
   Orders). For **reservations**: the **Table Reservations** app installed with at least one location
   and online reservations enabled. If a flow's backing app/config isn't set up, that flow returns
   empty — flag it and continue; don't fabricate data.
3. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (see the router `SKILL.md`).
   Paste it into `src/rest/wix-client.js` in place of the placeholder. It is a buyer-facing
   credential (it only mints anonymous visitor tokens), **not** a secret — hardcoding/committing
   it is fine.
4. The deployed app domain must be allow-listed on the OAuth client for Wix-hosted checkout to
   return. This is a **separate Wix setup flow the user completes later** — out of this skill's
   scope. If checkout return fails before that setup is done, that's expected; flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the restaurant UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to the id
  from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh token IS the
  cart identity; it is persisted to localStorage. Do not re-mint anonymously per load or the cart
  silently empties.
- `src/rest/wix-restaurants-menu.js` — **Menu (read-only):**
  `getFullMenu` (the assembled tree — start here), `listMenus`, `listSections`, `listItems`,
  `listVariants`, `listModifierGroups`, `listModifiers`, `listLabels`
- `src/rest/wix-restaurants-ordering.js` — **Online ordering:**
  `listOperations`, `getDefaultOperation`, `addItemToCart`, `getCurrentCart`,
  `updateCartItemQuantity`, `removeFromCart`, `checkout`
- `src/rest/wix-restaurants-reservations.js` — **Reservations:**
  `listReservationLocations`, `getTimeSlots`, `createHeldReservation`, `reserveReservation`

The Menu, Item, ModifierGroup, Operation, Cart, ReservationLocation, TimeSlot, and Reservation
shapes are documented as JSDoc at the top of each helper file. Read the relevant file(s) before
building the UI — they describe the key fields and link to the full reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Menu page** — call `getFullMenu()` once. It is the **only** pre-joined shape and the entry point
  for the menu screen. It returns `{ menus: [{ ...menu, sections: [{ ...section, items: [assembledItem]
  }] }] }`, already ordered by `sectionIds` / `itemIds`, each item enriched with a resolved `price` /
  `variants`, `modifierGroups`, and `labels`. Render each item's `name`, `description`, `image`,
  `labels` (`name` + `icon`), and `featured` flag. **`item.image`, `section.image`, and `label.icon`
  are OBJECTS** (`{ url, width, height, altText }`, and `{ url }` for the icon) — render
  `item.image?.url`, `section.image?.url`, `label.icon?.url`, never the object itself. For price, show
  `item.price` (single) or the `item.variants[]` (each `{ name, price }`). **Restaurants MENU prices
  are plain decimal strings with NO currency symbol** — format with the site's currency in the UI (the
  eCom cart's `price.formattedAmount` DOES include it — see the cart snippet). This is the main render
  surface: use the `MenuPage.jsx` reference snippet below.
- **Build on `getFullMenu`, not the raw `list*` fns** — `getFullMenu` is the only helper that returns
  a joined tree with references resolved. The raw `listSections` / `listItems` / `listVariants` /
  `listModifiers` return **unresolved refs** (an item's `labels` and `modifierGroups` come back
  **id-only**, price variants unresolved) and have **inconsistent return shapes**: `listMenus` → a
  `{ menus, nextCursor }` wrapper, while `listSections` / `listItems` / `listVariants` /
  `listModifierGroups` / `listModifiers` → **bare arrays**. Don't re-join them by hand. If you truly
  need a partial fetch, note the signature — those fns take an **array of GUIDs** (`listSections(sectionIds)`,
  `listItems(itemIds)`), and the join walks `menu.sectionIds` → `listSections` → each `section.itemIds`
  → `listItems`.
- **Item detail** — render `item.modifierGroups[]`: each group's `name`, its `rule`
  (`required`, `minSelections`, `maxSelections`), and `modifiers[]` (`name`, `additionalCharge`,
  `preSelected`, `inStock`). If `orderSettings.acceptSpecialRequests`, offer a free-text field.
- **Online ordering** — resolve an operation with `getDefaultOperation()` (or let the user pick from
  `listOperations()`); if it's `null`, show an "ordering unavailable" state. Add a dish with
  `addItemToCart(item.id, { operationId, menuId, sectionId, quantity })` — `menuId`/`sectionId` are
  the menu and section the item was shown under. Read the cart back with `getCurrentCart()`; mutate
  with `updateCartItemQuantity(lineItemId, qty)` / `removeFromCart(lineItemId)` using
  `cart.lineItems[].id` (not the item id).
- **Checkout** — `window.location.href = await checkout()`. After the visitor returns, the order is
  placed and the cart is empty — re-fetch with `getCurrentCart()` on return (e.g. on mount +
  `visibilitychange`) to clear the UI.
- **Reservations** — `listReservationLocations()` for the picker (use `location` details for the
  label). **Skip archived locations** (`loc.archived === true`) — that flag IS in the location shape.
  There is **no `onlineReservationsEnabled` field** in the location shape: the util documents
  `configuration.onlineReservations.approval.mode` (`AUTOMATIC` / `MANUAL` / `MANUAL_FOR_LARGE_PARTIES`)
  and `configuration.partySize`, not an enable toggle. Do **not** filter on an invented
  `onlineReservationsEnabled` — if you need to hide locations that don't take online reservations,
  confirm the real enable/visibility field with the **wix-docs** skill / Restaurants reference first.
  Then `getTimeSlots(locationId, dateISO, partySize)` — render `availableTimeSlots` (already filtered
  to `AVAILABLE`). On slot pick, `createHeldReservation(locationId, slot.startDate, partySize)` → keep
  the returned `id` + `revision`. Collect the visitor's details, then `reserveReservation(id, revision,
  { firstName, phone, lastName?, email? })`. Read the returned reservation's top-level `status` —
  `RESERVED` is confirmed, `REQUESTED` means the location requires manual approval (tell the user it's
  pending) — and echo `reservation.details.{startDate, endDate, partySize}` back as the confirmation
  summary.
- **Empty state** — if `getFullMenu()` returns no menus, show an empty state telling the user to add
  a menu in their Wix dashboard. Never invent menu items.

## Hard rules (do not violate)
- ✅ Order ONLY through the cart: `addItemToCart()` → `checkout()` (`create-checkout` →
  `/headless/v1/redirect-session` `fullUrl`), then redirect.
- ❌ Never hand-build `/checkout`, ordering, or reservation URLs.
- ❌ Never mock menus, items, prices, operations, locations, or time slots — render live Wix data or
  the empty state.
- ❌ Never generate fake reviews, ratings, or testimonials. Empty review UI only.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ `addItemToCart` requires `operationId`, `menuId`, and `sectionId` — it throws if any is missing.
- ✅ `lineItemId` for cart mutations is `cart.lineItems[].id`, not the item id.
- ✅ Reservations: offer only `AVAILABLE` slots; a HELD reservation expires in 10 minutes — pass the
  `revision` from the hold into `reserveReservation`, and restart the flow if it expired.
- ✅ Reservee `firstName` + `phone` (E.164, e.g. `+15551234567`) are mandatory to confirm.
- The engine fails loudly on purpose: `addItemToCart`/`checkout` throw on out-of-stock or empty
  carts; reservation helpers throw on unavailable slots or expired holds. A green path means it is
  really orderable/bookable — don't swallow these.

## Beyond the snippets
The snippets cover the common menu / ordering / reservation paths. For the "20%" they don't cover,
make the call yourself with `wixApiRequest` — but look up the exact endpoint, HTTP method, and
request body in the **official Wix API reference** first; never guess:
- Restaurants API reference: https://dev.wix.com/docs/api-reference/business-solutions/restaurants.md
- Selecting a specific **price variant** or applying **modifier up-charges** on the cart line: the
  restaurants `catalogReference.options` shape for these is not documented for client add-to-cart.
  The menu UI still displays them; confirm the shape before wiring them into `addItemToCart`:
  https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
- Fulfillment methods, delivery-address validation, scheduled (preorder) time slots, service fees:
  see the Online Orders section of the reference.
- **Member login + a "my orders" account view** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`): ordering/reserving works anonymously, but signing a member
  in (custom login on your own UI) lets them see their own order/reservation history.

Keep the snippets as the default for everything they already do; reach for the API reference only
for the gap.

## Reference snippets (headless — adapt the logic, restyle freely)

These are the recurring restaurant pieces, written **headless**: the Wix field paths are correct and
complete; the markup is deliberately plain. **Copy the logic exactly; restyle the JSX to the brand.**
They consume the `src/rest/` helpers — you don't need to read those helpers' source.

**`pages/MenuPage.jsx`** — the menu render surface. Drives everything off the assembled `getFullMenu()`
tree. Note the paths that trip people up: `item.image` / `section.image` / `label.icon` are **objects**
(render `.url`, never the object), menu prices carry **no currency symbol**, and an item is priced by
**either** `item.price` (single) **or** `item.variants[]` (one-of, each `{ name, price }`).

```jsx
import { useState, useEffect } from "react";
import { getFullMenu } from "@/rest/wix-restaurants-menu";

// Wix media urls can come back protocol-relative (//...) — normalize to https.
// item.image / section.image / label.icon are OBJECTS ({ url, ... }) — read .url, never render the object.
function imageUrl(img) {
  const url = img?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

// Restaurants MENU prices are plain decimal strings with NO currency symbol ("12.50").
function formatPrice(price) {
  return price == null ? "" : `$${price}`; // swap "$" for the site's currency
}

export default function MenuPage() {
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFullMenu().then(({ menus }) => { setMenus(menus); setLoading(false); });
  }, []);

  if (loading) return <div>Loading…</div>;
  if (menus.length === 0) return <p>{/* empty state — add a menu in the Wix dashboard */}</p>;

  return (
    <div /* restyle */>
      {menus.map((menu) => (
        <section key={menu.id}>
          <h2>{menu.name}</h2>
          {menu.description && <p>{menu.description}</p>}
          {menu.sections.map((section) => (
            <div key={section.id}>
              <h3>{section.name}</h3>
              {imageUrl(section.image) && <img src={imageUrl(section.image)} alt={section.name} />}
              {section.items.map((item) => (
                <article key={item.id}>
                  {imageUrl(item.image) && <img src={imageUrl(item.image)} alt={item.name} loading="lazy" />}
                  <h4>{item.name}{item.featured && <span> ★</span>}</h4>
                  {item.description && <p>{item.description}</p>}
                  {/* labels: [{ id, name, icon }] — icon is an OBJECT ({ url }); render label.icon.url */}
                  {item.labels.map((label) => (
                    <span key={label.id}>
                      {imageUrl(label.icon) && <img src={imageUrl(label.icon)} alt="" />}
                      {label.name}
                    </span>
                  ))}
                  {/* price: single string, OR one-of variants [{ name, price }] — neither has a currency symbol */}
                  {item.price != null
                    ? <span>{formatPrice(item.price)}</span>
                    : item.variants.map((v) => (
                        <span key={v.variantId}>{v.name}: {formatPrice(v.price)}</span>
                      ))}
                  {item.orderSettings?.inStock === false && <span>Sold out</span>}
                </article>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

**`Cart.jsx`** — reads the Wix **server** cart via `getCurrentCart()` (never a local copy). The line
paths: `line.id` is the **lineItemId** used for mutations (NOT the menu item id), the display name is
`line.productName.original`, and the line price is `line.price.formattedAmount` (the eCom cart price
DOES include the currency symbol, unlike the menu). Re-fetch on return from checkout to clear the UI.

```jsx
import { useState, useEffect } from "react";
import { getCurrentCart, updateCartItemQuantity, removeFromCart, checkout } from "@/rest/wix-restaurants-ordering";

export default function Cart() {
  const [cart, setCart] = useState(null);
  const refresh = () => getCurrentCart().then(setCart);
  useEffect(() => { // re-fetch on mount + when the tab regains focus (cart is empty after a completed checkout)
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const lineItems = cart?.lineItems ?? [];
  if (lineItems.length === 0) return <p>Your cart is empty.</p>;
  return (
    <div /* restyle */>
      {lineItems.map((line) => (
        <div key={line.id}>{/* line.id is the lineItemId for mutations — NOT the menu item id */}
          <span>{line.productName?.original}</span>
          <button onClick={async () => setCart(await updateCartItemQuantity(line.id, Math.max(1, line.quantity - 1)))}>−</button>
          <span>{line.quantity}</span>
          <button onClick={async () => setCart(await updateCartItemQuantity(line.id, line.quantity + 1))}>+</button>
          <button onClick={async () => setCart(await removeFromCart(line.id))}>Remove</button>
          <span>{line.price?.formattedAmount}</span>{/* eCom cart price DOES include the currency symbol (unlike menu prices) */}
        </div>
      ))}
      <button onClick={async () => { window.location.href = await checkout(); }}>Checkout</button>
    </div>
  );
}
```

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the restaurant content for their site — across up to three apps. To facilitate this, provide the user with deep links directly to the relevant dashboard pages; only mention the apps the project actually uses. Those pages are:
- **Menu** (always) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-menus-new` (`Dashboard → Restaurant Menus`; click **Manage Items** to add dishes; only visible menus appear in the app)
- **Online ordering** (if wired) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-orders-new/settings` (`Dashboard → Restaurant Orders → Settings`). Enable at least one fulfillment method before the site accepts orders — each has its own page: pickup `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-orders-new/settings/pickup`, delivery `.../wix-restaurants-orders-new/settings/delivery`, dine-in `.../wix-restaurants-orders-new/settings/dine-in`.
- **Table reservations** (if wired) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-table-reservations/table-reservations` (`Dashboard → Table Reservations` → **Settings**; configure tables, availability, and enable online reservations)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (cart survives reload, same visitor)
- [ ] `getFullMenu()` renders real sections/items with prices, variants, modifiers, and labels
- [ ] Empty state shown when there are no menus (never invented items)
- [ ] Add to cart works with a real `operationId`/`menuId`/`sectionId`; out-of-stock items throw
- [ ] Quantity update / remove reflect in `getCurrentCart()`
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL); cart re-fetched on return
- [ ] Reservations: only `AVAILABLE` slots offered; hold → reserve produces `RESERVED`/`REQUESTED`
- [ ] No mock data anywhere
- [ ] Told the user at least once that they can continue setting up their restaurant (menu / ordering / reservations) in the dashboard and provided deep links.

# Restaurants on a static site

The pages are HTML files at the root of the site. They import the restaurants modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path.

## The modules

`/js/wix/menu.js`: `fetchMenus()` (the menu tree: menus, sections, items, variants, modifier
groups, display-ordered, prices formatted) and `fetchSiteMoney()`. `/js/wix/menu-core.js`: the
selection rules a dish sheet uses, `needsSelection(item)`, `initialSelection(item)`,
`toggleModifier(item, selection, groupId, key)`, `validateSelection(item, selection)`,
`itemPrice(item, selection, quantity, menu.money)`. `/js/wix/ordering.js` and
`/js/wix/reservations.js` are reached through the stores. Three stores hold the rules: `createMenuStore(options)` in `/js/wix/menu-store.js`, the order
cart in `/js/wix/order-store.js` (one for the whole site: `subscribeOrderCart`,
`getOrderCartState`, `isMenuOrderable(menuId)`, `addOrderLine(item, { menuId, sectionId },
quantity, selection)`, `updateOrderLineQuantity`, `removeLineFromOrder`, `loadFulfillmentTimes`,
`chooseFulfillment`, `goToOrderCheckout`, `setOrderCartOpen`), and `createReservationStore()` in
`/js/wix/reservation-store.js`. Each `.js` opens with its declarations. A store calls a listener
on every change and not when it subscribes: render once after subscribing. The visitor token
persists in `localStorage` on its own; never mint one in a page.

The menu store state: `menus` (null while loading), `activeMenuId`, `activeMenu`, `error`; its
action `setActiveMenuId`. The order cart state: `cart` (`lines`, `itemCount`, `subtotal`),
`ordering` (null while resolving, true only for an enabled operation), `orderingStatus`,
`fulfillment`, `fulfillmentTimes`, `busy`, `pendingItemId`, `error`, `open`. The reservation
store's state and actions are in its declarations; the example below uses them all.

## The menu and the add control

The menu page, the dish sheet, the order drawer and the reservation flow are yours to write, on
the stores: markup in your page, render functions that read state, listeners that call actions.
The examples follow the stores' declared interfaces; keep their calls and field names.

The add control has three gates before it reads "Add to order": `ordering === true` (the
operation), `isMenuOrderable(menuId) !== false` (the menu's settings and hours, said once at the
menu level), `item.orderable` (the dish). A market-priced dish has no control. `item.soldOut`
reads "Sold out". A dish with `needsSelection(item)` opens the sheet; a plain dish adds at once.

```html
<main id="menu"></main>
```

```js
import { createMenuStore } from "/js/wix/menu-store.js";
import { needsSelection } from "/js/wix/menu-core.js";
import { addOrderLine, getOrderCartState, isMenuOrderable, subscribeOrderCart } from "/js/wix/order-store.js";
import { openSheet } from "./sheet.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const menus = createMenuStore();
const main = document.querySelector("#menu");

main.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-item]");
  if (!b) return;
  const menu = menus.getState().activeMenu;
  const section = menu.sections.find((x) => x.id === b.dataset.section);
  const item = section.items.find((x) => x.id === b.dataset.item);
  const ctx = { menuId: menu.id, sectionId: section.id };
  if (needsSelection(item)) openSheet(item, ctx, menu.money);
  else addOrderLine(item, ctx, 1).catch(() => {});
});

function addControl(item, sectionId, menu, o) {
  if (item.marketPrice) return "";
  if (o.ordering === false) return `<p class="dish-note">${o.orderingStatus?.status === "PAUSED_UNTIL" ? "Ordering is paused" : "Ordering unavailable"}</p>`;
  if (isMenuOrderable(menu.id) === false) return "";
  if (item.soldOut) return `<p class="dish-note">Sold out</p>`;
  if (!item.orderable) return "";
  const busy = o.pendingItemId === item.id;
  return `<button type="button" class="dish-add" data-item="${item.id}" data-section="${sectionId}" ${busy ? "disabled" : ""} aria-busy="${busy}">${needsSelection(item) ? "Choose" : "Add to order"}</button>`;
}

function render() {
  const m = menus.getState(), o = getOrderCartState();
  if (m.menus === null) { main.innerHTML = `<p>Loading the menu…</p>`; return; }
  if (m.menus.length === 0) { main.innerHTML = `<p>The menu is being written.</p>`; return; }
  const menu = m.activeMenu;   // several menus: a switch calling menus.setActiveMenuId(id)
  document.title = menu.name;
  main.innerHTML = `<h1>${esc(menu.name)}</h1>${menu.description ? `<p>${esc(menu.description)}</p>` : ""}
    ${isMenuOrderable(menu.id) === false ? `<p class="menu-note">Online ordering is off for this menu right now.</p>` : ""}
    ${menu.sections.map((sec) => `<section><h2>${esc(sec.name)}</h2>${sec.items.map((item) => `
      <article class="dish">
        ${item.imageUrl ? `<img src="${item.imageUrl}" alt="">` : ""}
        <h3>${esc(item.name)}</h3>
        <p>${esc(item.description)}</p>
        <p class="dish-price">${item.marketPrice ? "Market price" : item.price ?? item.variants.map((v) => `${esc(v.name)} ${v.price}`).join(" · ")}</p>
        ${addControl(item, sec.id, menu, o)}
      </article>`).join("")}</section>`).join("")}`;
}
menus.subscribe(render);
subscribeOrderCart(render);
render();
menus.start();
```

**The dish sheet**, in `sheet.js`: a form in an overlay with the drawer's rules (fixed backdrop,
scroll lock, Escape, focus back). Its state is one selection object. A `singleSelect` group is
radios, the others checkboxes; an out-of-stock modifier is disabled; `acceptsSpecialRequests`
adds a note field; `item.variants` is a radio group when present.

```js
import { initialSelection, itemPrice, toggleModifier, validateSelection } from "/js/wix/menu-core.js";
import { addOrderLine } from "/js/wix/order-store.js";

export function openSheet(item, ctx, money) {
  let selection = initialSelection(item), quantity = 1, errors = {};
  const form = mountOverlay(item);          // your overlay: returns the <form> inside the backdrop
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "variant") selection = { ...selection, variantId: t.value };
    else if (t.dataset.group) selection = toggleModifier(item, selection, t.dataset.group, t.value);
    else if (t.name === "quantity") quantity = Math.max(1, Number(t.value) || 1);
    render();
  });
  form.addEventListener("input", (e) => { if (e.target.name === "note") selection = { ...selection, specialRequest: e.target.value }; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = validateSelection(item, selection);
    errors = v.errors;
    if (!v.ok) { render(); return; }
    addOrderLine(item, ctx, quantity, selection).then(() => form.closest(".sheet-backdrop").remove()).catch(() => {});
  });
  function render() {
    // Rebuild the groups from item.variants and item.modifierGroups: value="${mod.key}", checked when
    // selection.modifiers[g.id] includes the key, disabled when !mod.inStock, errors[g.id] under the group.
    form.querySelector(".sheet-add").textContent = `Add ${itemPrice(item, selection, quantity, money).formatted}`;
  }
  render();
}
```

## The order drawer

Once per page, at the end of `body`; the store opens it after every add. The badge in the header
is the live `itemCount`. Pickup or delivery and the time are chosen in the drawer before checkout:
the hosted checkout has no picker for them and refuses an order without them. A switch when
`fulfillment` has both types, a time select from `fulfillmentTimes` of that type, and for delivery
the address (on change the drawer reloads the times with it). The checkout button calls
`chooseFulfillment(choice)` then `goToOrderCheckout()`. Checkout is the one primary button; the
steppers and remove are compact.

```html
<button id="order-button" type="button">Order <span class="order-count" hidden></span></button>
<div id="order" class="order-backdrop" hidden>
  <aside class="order-drawer" role="dialog" aria-modal="true" aria-label="Your order" tabindex="-1">
    <header><h2>Your order</h2><button class="order-close" type="button" aria-label="Close">×</button></header>
    <p class="order-error" role="alert" hidden></p>
    <div class="order-lines"></div>
    <form class="order-fulfillment"></form>
    <p class="order-subtotal"></p>
    <button class="order-checkout" type="button">Checkout</button>
  </aside>
</div>
```

```js
import { chooseFulfillment, getOrderCartState, goToOrderCheckout, loadFulfillmentTimes, removeLineFromOrder, setOrderCartOpen, subscribeOrderCart, updateOrderLineQuantity } from "/js/wix/order-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const backdrop = document.querySelector("#order"), q = (sel) => backdrop.querySelector(sel);
const lines = q(".order-lines"), ful = q(".order-fulfillment"), count = document.querySelector(".order-count");
let wasOpen = false, opener = null, pageOverflow = "", type = null, timeCode = "";
let address = { addressLine: "", city: "", postalCode: "" };   // delivery: three inputs named like these keys

document.querySelector("#order-button").addEventListener("click", () => setOrderCartOpen(true));
q(".order-close").addEventListener("click", () => setOrderCartOpen(false));
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) setOrderCartOpen(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && getOrderCartState().open) setOrderCartOpen(false); });
lines.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-line]"); if (!b) return;
  if (b.dataset.quantity) updateOrderLineQuantity(b.dataset.line, Number(b.dataset.quantity)).catch(() => {});
  else removeLineFromOrder(b.dataset.line).catch(() => {});
});
ful.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "type") { type = t.value; timeCode = ""; loadFulfillmentTimes().catch(() => {}); }
  else if (t.name === "time") timeCode = t.value;
  else if (t.name in address) { address = { ...address, [t.name]: t.value }; if (address.city) loadFulfillmentTimes(undefined, address).catch(() => {}); }
  render(getOrderCartState());
});
q(".order-checkout").addEventListener("click", () => {
  const s = getOrderCartState();
  const time = (s.fulfillmentTimes ?? []).find((t) => t.code === timeCode);
  const choice = type ? { type, ...(time ? { time } : {}), ...(type === "DELIVERY" ? { address } : {}) } : null;
  (choice ? chooseFulfillment(choice) : Promise.resolve()).then(() => goToOrderCheckout()).catch(() => {});
});
const timeLabel = (t, zone) => t.asap ? "As soon as possible" : new Date(t.startIso).toLocaleString(undefined, { timeZone: zone || undefined, hour: "numeric", minute: "2-digit" });

function render(s) {
  if (s.open !== wasOpen) {
    wasOpen = s.open; backdrop.hidden = !s.open;
    if (s.open) { opener = document.activeElement; pageOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; q(".order-drawer").focus(); }
    else { document.body.style.overflow = pageOverflow; opener?.focus?.(); }
  }
  const n = s.cart?.itemCount ?? 0;
  count.textContent = String(n); count.hidden = n === 0;
  q(".order-error").textContent = s.error ?? ""; q(".order-error").hidden = !s.error;
  const list = s.cart?.lines ?? [];
  lines.innerHTML = list.length ? list.map((l) => `<article class="order-line">
      <p class="order-line-name">${esc(l.itemName)}</p>${l.descriptionLines.map((d) => `<p class="order-line-option">${esc(d)}</p>`).join("")}
      <span class="order-stepper"><button type="button" data-line="${l.lineItemId}" data-quantity="${l.quantity - 1}" ${l.quantity <= 1 ? "disabled" : ""}>−</button><span>${l.quantity}</span><button type="button" data-line="${l.lineItemId}" data-quantity="${l.quantity + 1}">+</button></span>
      <button type="button" class="order-line-remove" data-line="${l.lineItemId}">Remove</button>
      <p class="order-line-price">${esc(l.linePrice)}</p></article>`).join("") : `<p>Your order is empty.</p>`;
  const methods = s.fulfillment ?? [];
  if (!type) type = methods[0]?.type ?? null;
  const times = (s.fulfillmentTimes ?? []).filter((t) => t.type === type);
  ful.hidden = !list.length;
  ful.innerHTML = `${methods.some((m) => m.type === "PICKUP") && methods.some((m) => m.type === "DELIVERY") ? `<fieldset><legend>Get it by</legend><label><input type="radio" name="type" value="PICKUP" ${type === "PICKUP" ? "checked" : ""}> Pickup</label><label><input type="radio" name="type" value="DELIVERY" ${type === "DELIVERY" ? "checked" : ""}> Delivery</label></fieldset>` : ""}
    ${times.length ? `<label>When <select name="time">${times.map((t) => `<option value="${t.code}" ${t.code === timeCode ? "selected" : ""}>${esc(timeLabel(t, s.orderingStatus?.timeZone))}</option>`).join("")}</select></label>` : ""}`;
  q(".order-subtotal").textContent = s.cart?.subtotal ? `Subtotal ${s.cart.subtotal}` : "";
  q(".order-checkout").hidden = !list.length;
  if (s.busy) for (const el of backdrop.querySelectorAll("button:not(.order-close), input, select")) el.disabled = true;
}
subscribeOrderCart(render);
render(getOrderCartState());
```

## The reservation flow

`reservations.html`, on `createReservationStore()`. Only AVAILABLE times are offered, labelled in
the restaurant's time zone; the date defaults to today at the restaurant. `approval ===
"AUTOMATIC"`: pick a slot, the store holds it for ten minutes (`holdSecondsLeft` counts down),
the details form, `confirm()`. `approval === "MANUAL"` or `slot.manualApproval`: pick, the form,
`confirm()` sends a request with no hold. The form follows `location.form`; `fieldErrors` are
keyed `firstName`, `lastName`, `phone`, `email`, `custom:<id>`. `confirmed.outcome` "confirmed"
reads as confirmed, "pending" as pending the restaurant's approval. A location with
`onlineReservationsEnabled` false, or no locations at all, reads "call us to book". The example
leaves out `marketingCheckbox` (`setMarketingConsent`), `terms` and `privacy`; add them from
`location.form` the same way.

```html
<section id="reserve"></section>
```

```js
import { createReservationStore } from "/js/wix/reservation-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const store = createReservationStore();
const root = document.querySelector("#reserve");

root.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "location") store.setLocationId(t.value);
  else if (t.name === "date") store.setDate(t.value);
  else if (t.name === "time") store.setTime(t.value);
  else if (t.name === "party") store.setPartySize(Number(t.value));
  else if (t.name === "marketing") store.setMarketingConsent(t.checked);
});
root.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.reservee) store.setReserveeField(t.dataset.reservee, t.value);
  else if (t.dataset.custom) store.setCustomField(t.dataset.custom, t.value);
});
root.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.find !== undefined) store.findSlots();
  else if (b.dataset.slot !== undefined) store.holdSlot(store.getState().slots[Number(b.dataset.slot)]);
  else if (b.dataset.back !== undefined) store.reset();
});
root.addEventListener("submit", (e) => { e.preventDefault(); store.confirm().catch(() => {}); });

function render(s) {
  if (s.locations === null) { root.innerHTML = `<p>Loading…</p>`; return; }
  const loc = s.location;
  if (!loc || !loc.onlineReservationsEnabled) { root.innerHTML = `<p>Call us to book a table.</p>`; return; }
  if (s.confirmed) { root.innerHTML = `<p class="done">${s.confirmed.outcome === "confirmed" ? "Your table is booked." : s.confirmed.outcome === "pending" ? "Your request is pending the restaurant's approval." : "The reservation was not completed."}</p>`; return; }
  const f = loc.form, r = s.reservee, err = (k) => s.fieldErrors[k] ? `<p class="field-error">${esc(s.fieldErrors[k])}</p>` : "";
  root.innerHTML = `
    ${s.locations.length > 1 ? `<label>Where <select name="location">${s.locations.map((l) => `<option value="${l.id}" ${l.id === loc.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>` : ""}
    <label>Date <input type="date" name="date" value="${s.date}"></label>
    <label>Time <input type="time" name="time" value="${s.time}"></label>
    <label>Party <input type="number" name="party" min="${loc.partySizeMin}" max="${loc.partySizeMax}" value="${s.partySize}"></label>
    <button type="button" data-find ${s.loading ? "disabled" : ""}>Find a table</button>
    ${s.slots === null ? "" : s.slots.length === 0 ? `<p>No tables at that time. Try another time or date.</p>` : `<div class="slots">${s.slots.map((sl, i) => `<button type="button" data-slot="${i}" aria-pressed="${s.selectedSlot?.startIso === sl.startIso}">${esc(sl.label)}</button>`).join("")}</div>`}
    ${s.selectedSlot ? `<form class="reserve-form">
      ${s.held && s.holdSecondsLeft !== null ? `<p class="hold">Table held for ${Math.floor(s.holdSecondsLeft / 60)}:${String(s.holdSecondsLeft % 60).padStart(2, "0")}</p>` : ""}
      <label>First name <input name="firstName" data-reservee="firstName" required value="${esc(r.firstName)}"></label>${err("firstName")}
      <label>Last name <input name="lastName" data-reservee="lastName" ${f.lastNameRequired ? "required" : ""} value="${esc(r.lastName ?? "")}"></label>
      <label>Phone <input name="phone" type="tel" data-reservee="phone" required value="${esc(r.phone)}"></label>${err("phone")}
      <label>Email <input name="email" type="email" data-reservee="email" ${f.emailRequired ? "required" : ""} value="${esc(r.email ?? "")}"></label>
      ${f.customFields.map((c) => `<label>${esc(c.name)} <input name="c-${c.id}" data-custom="${c.id}" ${c.required ? "required" : ""} value="${esc(r.customFields?.[c.id] ?? "")}"></label>`).join("")}
      ${s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : ""}
      <button type="submit" ${s.canConfirm ? "" : "disabled"}>${s.approval === "MANUAL" || s.selectedSlot.manualApproval ? "Request a table" : "Confirm"}</button>
      <button type="button" data-back>Back</button></form>` : ""}`;
}
store.subscribe(render);
render(store.getState());
store.start();
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/menu.html` (`menu.html?menu=<slug>` for a menu switch), `/reservations.html`. A link to a folder
gives the visitor a 404 page.

## Rules

- Ordering goes through the order store and `menu-core`: the dish, its `menuId` and `sectionId`
  from the render context, the selection from `initialSelection`, `toggleModifier`,
  `validateSelection`, the price from `itemPrice`. Selection keys are `MenuModifier.key`.
- Money is already formatted: `price`, `additionalCharge`, `fee`, `subtotal` as given; "" means
  unknown.
- Fulfillment is set on the cart before checkout, with `chooseFulfillment`; `goToOrderCheckout()`
  falls back to pickup as soon as possible only when nothing was chosen.
- Reservations go through the reservation store. Render the confirmed state only from
  `confirmed`, and only `outcome === "confirmed"` as confirmed.
- Honest unavailability, as the gates above; live data or an honest empty state; nothing
  invented: no hours, reviews or delivery promises, no Wix ids in visible text.
- Browsing, ordering and reserving need no login.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `wix-restaurants-menus-new` (menus),
`wix-restaurants-menus-new/menu/{menuId}` (edit one), `wix-restaurants-orders-new` (orders),
`wix-restaurants-orders-new/settings` (pickup and delivery hours, fees, menu hours),
`wix-table-reservations/table-reservations`, `wix-cashier/payments` (connect a payment method); the plan
upgrade is `https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Real paid orders need a
connected payment method and a premium plan, and online reservations are premium-gated too. Give
both links in the close and name the reservations gate.

## Seeding

Per `seed/SEED.md` and `seed/seed-restaurants.mjs`: a plain-data plan, run in the script's order
with its waits. Seed one menu with a few sections, an image per dish, at least one dish with a
size or a modifier group when the restaurant takes orders, and turn on ordering and reservations
when it takes orders and bookings. A fresh Menus install carries Wix's sample "Dinner Menu" and the
menu page lists it next to the seeded menus. Never delete it or anything else on the site; the
seed result's `preexistingMenus[]` names it, and the close says so with the menus link.

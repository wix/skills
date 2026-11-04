# Restaurants on a static site

The pages are HTML files at the root of the site. They import the restaurants layer from
`/js/wix/`: the menu, ordering and reservation calls, and three stores that hold the state and
the rules of a menu, an order and a table booking. Nothing on the screen ships; every element is
yours, in the design of the site. This file shows how to drive the layer. The skeletons show the
calls and the fields and leave the markup to you.

## The layer

`/js/wix/menu.js`: `fetchMenus()` (the menu tree: menus, sections, items, variants, modifier
groups, in display order, prices formatted) and `fetchSiteMoney()`. `/js/wix/menu-core.js`: the
selection rules of a dish, `needsSelection(item)`, `initialSelection(item)`,
`toggleModifier(item, selection, groupId, key)`, `validateSelection(item, selection)`,
`ruleLabel(group)` and `itemPrice(item, selection, quantity, menu.money)`. `/js/wix/ordering.js`
and `/js/wix/reservations.js` are the transports; the pages reach them through the stores. Money
comes formatted and images come as https URLs; render them as they are.

Three stores: `createMenuStore()` in `/js/wix/menu-store.js` for a menu surface,
`/js/wix/order-store.js` for the order cart, one for the whole site, and
`createReservationStore()` in `/js/wix/reservation-store.js` for the table booking. A store owns
the rules: whether a dish can be ordered now, what a selection costs, what the cart sends, which
slots are open and when a hold lapses. A page reads the state and calls the actions; it computes
nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for every store: create it, subscribe a render function, render once, start. A store
calls the listener on every change and not on subscribe, so the first render is yours. Controls
call the store's actions; delegate from the surface's root and read what to do from the element,
so a re-render of the markup keeps the listeners.

```js
import { createMenuStore } from "/js/wix/menu-store.js";
import { getOrderCartState, subscribeOrderCart } from "/js/wix/order-store.js";

var menus = createMenuStore();
function render() {
  var m = menus.getState(), o = getOrderCartState();
  // read m and o, write your markup into the page
}
menus.subscribe(render);
subscribeOrderCart(render);
render();
menus.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The menu and the add control

`menu.html` on `createMenuStore()`. The state: `menus` (null while loading, `[]` an honest empty
state), `activeMenuId`, `activeMenu`, `error`; the action `setActiveMenuId(id)`. The tree arrives
once and switching is local; `menu.html?menu=` + `slug` links to one menu. A menu carries `name`,
`description`, `slug`, `sections` and `money`; a section `name`, `description`, `imageUrl` and
`items`. Set `document.title` from the active menu's `name`.

A dish shows `name`, `description`, `imageUrl` (`gallery` has more), `labels` (`name`, `iconUrl`),
`featured`, and its price: `price` when set, else each of `variants` with `name` and `price`,
"Market price" when `marketPrice`. Nothing is computed from these.

The add control has three gates, read from the order cart's state: `ordering === true` (the
site's ordering operation; null while resolving, false when `orderingStatus.status` is not
"ENABLED", said once at the top of the menu), `isMenuOrderable(menu.id) !== false` (this menu's
settings and hours, said once at the menu level), `item.orderable` (the dish). A market-priced
dish has no control; `item.soldOut` reads as sold out. A dish with `needsSelection(item)` opens
the dish sheet; a plain dish adds at once with `addOrderLine(item, { menuId, sectionId }, 1)`,
disabled while `pendingItemId` is this dish. `addOrderLine` rejects on refusal and the cart's
`error` holds the message.

A sketch of the binding, fields in, markup yours:

```js
import { needsSelection } from "/js/wix/menu-core.js";
import { addOrderLine, isMenuOrderable } from "/js/wix/order-store.js";

root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.menu) { menus.setActiveMenuId(b.dataset.menu); return; }
  var menu = menus.getState().activeMenu;
  var section = menu.sections.find(function (x) { return x.id === b.dataset.section; });
  var item = section.items.find(function (x) { return x.id === b.dataset.item; });
  var ctx = { menuId: menu.id, sectionId: section.id };
  if (needsSelection(item)) openSheet(item, ctx, menu.money);
  else addOrderLine(item, ctx, 1).catch(function () {});
});

function addControl(item, sectionId, menu, o) {
  if (item.marketPrice || o.ordering !== true || isMenuOrderable(menu.id) === false || !item.orderable) return "";
  var busy = o.pendingItemId === item.id;
  return '<button type="button" data-item="' + item.id + '" data-section="' + sectionId + '"'
    + (busy ? " disabled" : "") + ">" + (needsSelection(item) ? "Choose" : "Add") + "</button>";
}
```

## The dish sheet

An overlay with a form, for a dish whose `needsSelection(item)` is true: a fixed backdrop and
panel, the page's scroll locked while open, closed by Escape, a close control and a click on the
backdrop, focus moved in and returned on close. Its state is one selection object from
`initialSelection(item)`, a quantity and the last validation's errors.

- `item.variants`, when present, is one group of exclusive choices; `selection.variantId` holds
  the pick, the cheapest by default.
- `item.modifierGroups`: one group per entry with its `name` and `ruleLabel(group)`; a group with
  `singleSelect` is exclusive, any other allows several. A modifier shows `name` and
  `additionalCharge`; one with `inStock` false is disabled. A change calls
  `toggleModifier(item, selection, group.id, modifier.key)` and keeps the result; the key is
  `modifier.key`, never its id.
- `item.acceptsSpecialRequests` adds a note field writing `selection.specialRequest`.
- The button's figure is `itemPrice(item, selection, quantity, money).formatted`.
- On submit, `validateSelection(item, selection)` returns `ok` and `errors` by group id; show each
  under its group. When ok, `addOrderLine(item, ctx, quantity, selection)`, then close.

```js
import { initialSelection, itemPrice, toggleModifier, validateSelection } from "/js/wix/menu-core.js";
import { addOrderLine } from "/js/wix/order-store.js";

function openSheet(item, ctx, money) {
  var selection = initialSelection(item), quantity = 1, errors = {};
  var form = mountSheet(item); // your overlay; the groups are written once, from item
  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "variant") selection = Object.assign({}, selection, { variantId: t.value });
    else if (t.dataset.group) selection = toggleModifier(item, selection, t.dataset.group, t.value);
    else if (t.name === "quantity") quantity = Math.max(1, Number(t.value) || 1);
    priceEl.textContent = itemPrice(item, selection, quantity, money).formatted;
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = validateSelection(item, selection);
    errors = v.errors; // one line under each group in errors
    if (v.ok) addOrderLine(item, ctx, quantity, selection).then(closeSheet).catch(function () {});
  });
}
```

## The order drawer

Once per page, on `subscribeOrderCart(fn)`; the store opens it after every add, on success and on
refusal, so `error` has a place to show. The state: `cart` (null before the first load),
`ordering`, `orderingStatus`, `fulfillment` (the methods offered, each with `type` "PICKUP" or
"DELIVERY", `name`, `fee`, `minOrderPrice`), `fulfillmentTimes` (null until loaded; each with
`type`, `code`, `asap`, `startIso`), `busy` (disable the drawer's controls), `pendingItemId`,
`error`, `open`. `cart` carries `lines`, `itemCount` (the header's badge) and `subtotal`. A line
carries `lineItemId` (what the actions take, never the dish id), `itemName`, `descriptionLines`,
`quantity`, `unitPrice`, `linePrice`, `imageUrl`, `status` (anything but "IN_STOCK" needs a line
of copy). The actions: `setOrderCartOpen(open)`, `updateOrderLineQuantity(lineItemId, n)`,
`removeLineFromOrder(lineItemId)`,
`loadFulfillmentTimes(dayKey, address)`, `chooseFulfillment(choice)`, `goToOrderCheckout()`.

Pickup or delivery and the time are chosen in the drawer before checkout: the hosted checkout has
no picker for them and refuses an order without them. A switch when `fulfillment` has both types;
a time choice from the `fulfillmentTimes` of that type, labelled in `orderingStatus.timeZone`
("as soon as possible" when `asap`); for delivery an address (`addressLine`, `city`,
`postalCode`) and `loadFulfillmentTimes(undefined, address)` once the city is in. The checkout
control calls `chooseFulfillment({ type, time, address })` then `goToOrderCheckout()`, which
navigates the whole document. Render `open` with the overlay rules of the dish sheet. Subtotal
comes from `cart`, never summed in the page. Checkout is the one primary action of the drawer;
the steppers, remove and the fulfillment controls are compact.

```js
import { chooseFulfillment, getOrderCartState, goToOrderCheckout, removeLineFromOrder,
  setOrderCartOpen, subscribeOrderCart, updateOrderLineQuantity } from "/js/wix/order-store.js";

orderButton.addEventListener("click", function () { setOrderCartOpen(true); });
linesEl.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b || !b.dataset.line) return;
  if (b.dataset.quantity) updateOrderLineQuantity(b.dataset.line, Number(b.dataset.quantity)).catch(function () {});
  else removeLineFromOrder(b.dataset.line).catch(function () {});
});
checkoutEl.addEventListener("click", function () {
  var time = (getOrderCartState().fulfillmentTimes || []).find(function (t) { return t.code === timeCode; });
  chooseFulfillment({ type: type, time: time, address: type === "DELIVERY" ? address : undefined })
    .then(goToOrderCheckout).catch(function () {});
});
subscribeOrderCart(function (s) {
  backdrop.hidden = !s.open;
  countEl.textContent = s.cart && s.cart.itemCount ? String(s.cart.itemCount) : "";
  errorEl.textContent = s.error || "";
  // one block per line in s.cart.lines with data-line and data-quantity; the fulfillment
  // controls from s.fulfillment and s.fulfillmentTimes; the subtotal from s.cart.subtotal
});
```

`type`, `timeCode` and `address` are the drawer's own state, written from its controls; a change
of type clears the time and calls `loadFulfillmentTimes()`.

## The reservation flow

`reservations.html` on `createReservationStore()`. The state: `locations` (null while loading),
`location` (the active one: `name`, `address`, `timeZone`, `partySizeMin`, `partySizeMax`,
`onlineReservationsEnabled`, `form`), `date`, `time`, `partySize`, `approval` ("AUTOMATIC" or
"MANUAL"), `slots` (null before a search, `[]` when none; each with `label`, `startIso`,
`manualApproval`), `selectedSlot`, `held`, `holdSecondsLeft`, `reservee`, `fieldErrors`,
`canConfirm`, `confirmed`, `loading`, `error`. The actions: `setLocationId(id)`,
`setDate("YYYY-MM-DD")`, `setTime("HH:mm")`, `setPartySize(n)`, `findSlots()`, `holdSlot(slot)`,
`setReserveeField(name, value)` for `firstName`, `lastName`, `phone` and `email`,
`setMarketingConsent(bool)`, `setCustomField(id, value)`, `confirm()`, `reset()`.

- Only open times come back, labelled in the restaurant's time zone; the date defaults to today
  there. A location choice only when `locations` has more than one; the party size is bounded by
  `partySizeMin` and `partySizeMax`.
- `approval` "AUTOMATIC": `holdSlot(slot)` holds the pick for ten minutes and `holdSecondsLeft`
  counts down, then the details form and `confirm()`. "MANUAL", or a slot with `manualApproval`:
  pick, the form, `confirm()` sends a request with no hold, and the button says so.
- The form follows `location.form`: `firstName` and `phone` always, `lastName` when
  `lastNameRequired`, `email` when `emailRequired`, one field per entry of `customFields` (`id`,
  `name`, `required`), a consent checkbox when `marketingCheckbox` is set, `terms` and `privacy`
  when set. `fieldErrors` is keyed `firstName`, `lastName`, `phone`, `email` and `custom:` + id.
  `canConfirm` gates the button, `error` is the message when `confirm()` rejects.
- `confirmed.outcome` "confirmed" reads as booked, "pending" as awaiting the restaurant's
  approval, anything else as not completed; `form.submitMessage` is the owner's line when set.
- A location with `onlineReservationsEnabled` false, or no locations at all, reads as book by
  phone.

```js
import { createReservationStore } from "/js/wix/reservation-store.js";

var store = createReservationStore();
root.addEventListener("change", function (e) {
  var t = e.target;
  if (t.name === "location") store.setLocationId(t.value);
  else if (t.name === "date") store.setDate(t.value);
  else if (t.name === "time") store.setTime(t.value);
  else if (t.name === "party") store.setPartySize(Number(t.value));
  else if (t.name === "marketing") store.setMarketingConsent(t.checked);
});
root.addEventListener("input", function (e) {
  var t = e.target;
  if (t.dataset.reservee) store.setReserveeField(t.dataset.reservee, t.value);
  else if (t.dataset.custom) store.setCustomField(t.dataset.custom, t.value);
});
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  if ("find" in b.dataset) store.findSlots();
  else if (b.dataset.slot) store.holdSlot(store.getState().slots[Number(b.dataset.slot)]);
  else if ("back" in b.dataset) store.reset();
});
form.addEventListener("submit", function (e) { e.preventDefault(); store.confirm().catch(function () {}); });
```

The render writes the slots from `slots` with `data-slot` as the index, the hold line from
`holdSecondsLeft`, the field errors, the button from `canConfirm` and `loading`, and the confirmed
state from `confirmed`. The form's inputs are written once, when `selectedSlot` is first set; a
render after that touches the errors, the button and the hold line, not the inputs.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/menu.html` (`menu.html?menu=` + slug for one menu), `/reservations.html`. A link to a folder
gives the visitor a 404 page. Write the pages' scripts as files of their own and keep each file
small; a page's code travels as text in the upload call.

## Rules

- Ordering goes through the order store and `menu-core`: the dish, its `menuId` and `sectionId`
  from the render context, the selection from `initialSelection`, `toggleModifier` and
  `validateSelection`, the price from `itemPrice`. Selection keys are `modifier.key`.
- Money strings are final: `price`, `additionalCharge`, `fee`, `minOrderPrice`, `subtotal`,
  `linePrice` as given; "" means unknown, so omit it.
- Fulfillment is set on the cart before checkout with `chooseFulfillment`; checkout only through
  `goToOrderCheckout()`.
- The add control follows the three gates; where a control is withheld, a line says why.
- Reservations go through the reservation store. Render the confirmed state only from
  `confirmed`, and only `outcome === "confirmed"` as booked.
- Render form fields once; a render touches the values, the button and the error, not the inputs.
- Live data or an honest empty state; nothing invented: no hours, reviews or delivery promises,
  no Wix ids or technical words in visible text.
- Browsing, ordering and reserving need no login; the visitor session is already there.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `wix-restaurants-menus-new` (menus),
`wix-restaurants-menus-new/menu/{menuId}` (edit one), `wix-restaurants-orders-new` (orders),
`wix-restaurants-orders-new/settings` (pickup and delivery hours, fees, menu hours),
`wix-table-reservations/table-reservations`, `wix-cashier/payments` (connect a payment method);
the plan upgrade is `https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Real paid orders
need a connected payment method and a premium plan, and online reservations are premium-gated
too. Give both links in the close and name the reservations gate.

## Seeding

Per `seed/SEED.md` and `seed/seed-restaurants.mjs`: a plain-data plan, run in the script's order
with its waits. Seed one menu with a few sections, an image per dish, at least one dish with a
size or a modifier group when the restaurant takes orders, and turn on ordering and reservations
when it takes orders and bookings. A fresh Menus install carries Wix's sample "Dinner Menu" and
the menu page lists it next to the seeded menus. Never delete it or anything else on the site;
the seed result's `preexistingMenus[]` names it, and the close says so with the menus link.

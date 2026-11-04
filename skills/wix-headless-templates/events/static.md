# Events on a static site

The pages are HTML files at the root of the site. They import the events layer from `/js/wix/`:
the event, registration and order calls, and three stores that hold the state and the rules of
registering. Nothing on the screen ships; every element is yours, in the design of the site. This
file shows how to drive the layer. The skeletons show the calls and the fields and leave the
markup to you.

## The layer

`/js/wix/events.js`: `fetchEventsPage({ limit, offset, categoryId, status })`, `fetchEvents`,
`fetchEventBySlug(slug)` (null when the slug resolves to nothing), `fetchEventById(id)`,
`fetchOccurrences(recurringCategoryId)`, `fetchCategories`. `/js/wix/registration.js`:
`fetchTicketTiers(event)`, `submitRsvp`, `startTicketCheckout`; the pages reach these through the
registration store. `/js/wix/orders.js`: `fetchOrder(eventId, orderNumber)`, reached through the
order store. Every date label comes formatted in the event's time zone, every price comes
formatted, images come as https URLs; render them as they are.

Three stores: `createEventsStore({ pageSize, status })` in `/js/wix/events-store.js` for the
listing, `createRegistrationStore(event, { paths })` in `/js/wix/registration-store.js` for one
event's registration, built from the `EventDetail` that `fetchEventBySlug` returns, and
`createOrderStore({ orderNumber, eventId })` in `/js/wix/events-order-store.js` for the
confirmation. A store owns the rules: which tiers are buyable, the quantity caps, the running
totals, whether the organizer's form is complete, what the registration sends. A page reads the
state and calls the actions; it computes nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for every store: create it, subscribe a render function, render once, start. A store
calls the listener on every change and not on subscribe, so the first render is yours. Controls
call the store's actions; delegate from the surface's root and read what to do from the element,
so a re-render of the markup keeps the listeners.

```js
import { fetchEventBySlug } from "/js/wix/events.js";
import { createRegistrationStore } from "/js/wix/registration-store.js";

var event = await fetchEventBySlug(new URLSearchParams(location.search).get("slug"));
var paths = { confirmation: "/event-confirmation.html", event: "/event.html?slug=" + encodeURIComponent(event.slug) };
var store = createRegistrationStore(event, { paths: paths });
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The listing

`events.html` on `createEventsStore()`. The state: `events` (null before the first page, then
the page), `categories`, `activeCategoryId`, `hasMore`, `loadingMore`, `error`. The actions:
`setActiveCategoryId(id)` (null for all), `loadMore()`. Filtering runs on the loaded list while
the whole list is loaded and refetches once there are more pages, so a filter never hides events
on unloaded pages.

A card shows the summary: `imageUrl`, `dateLabel` (the organizer's `dateTbdMessage` when
`dateTbd`), `title`, `locationName` (`locationType` says "VENUE", "ONLINE" or "TBD"),
`priceLabel`, `soldOut`, `shortDescription` when there is room, and a link to
`event.html?slug=…`. Category chips only when `categories` has more than one entry. `events`
null is a loading state, `[]` an honest empty state, `error` its own; a load-more control while
`hasMore`, disabled while `loadingMore`. The home page shows what the events are and the next
one in the first screen, with a link to the listing.

```js
import { createEventsStore } from "/js/wix/events-store.js";

var list = createEventsStore();
chipsEl.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (b) list.setActiveCategoryId(b.dataset.category || null);
});
moreEl.addEventListener("click", function () { list.loadMore(); });
list.subscribe(function (s) {
  moreEl.hidden = !s.hasMore;
  moreEl.disabled = s.loadingMore;
  // chips from s.categories with data-category, the grid from s.events, states for null, [] and s.error
});
list.start();
```

## The event page

`event.html?slug=…` loads the event with `fetchEventBySlug`; null shows only the not-found
state. In the first screen, on a phone too: the image as a bounded band, `dateLabel`, `title`,
`locationName` with `address` under it, and the registration control. The description after the
control: `aboutHtml` as HTML, or `aboutParagraphs` when it is empty. `addToCalendar.google` as a
link when present; a map only from `coordinates`. Set `document.title` and the meta description
from `title` and `shortDescription` once the event loads.

The registration branches on the event's state first, then on its type:

- `registrationClosed` reads as sold out when `soldOut`, else as closed. `registrationStatus`
  "SCHEDULED_RSVP" reads as opening at `registrationOpensAtLabel`. `registrationPaused` reads as
  paused. `registrationOpen` is the one state that renders a picker or a form.
- `registrationType`: "TICKETING" renders the tier picker, "RSVP" the organizer's form,
  "EXTERNAL" a link to `externalUrl`, "NONE" nothing.
- `waitlistOnly` makes the RSVP button a waitlist action. `membersOnly` says so; the login
  itself belongs to the members layer.
- `paths` is what makes the hosted checkout return to files: pass the confirmation page and the
  event's own URL, as in the pattern above.

The ticket picker, on the registration store's state:

- `tiers` is null while loading. A tier carries `name`, `description`, `pricingType` ("FIXED",
  "FREE", "GUEST" or "OPTIONS"), `price`, `free`, `minPrice`, `options` (`id`, `name`, `price`,
  `notes`), `notes` (the tax and fee lines), `available`, `soldOut`, `saleStatus`,
  `saleStartsLabel`, `saleEndsLabel`, `limitPerCheckout`. Controls are enabled on `available`;
  a tier that is `soldOut`, "SALE_SCHEDULED" or "SALE_ENDED" says which.
- One stepper per tier, or per option of an "OPTIONS" tier, calling
  `setQuantity(tier.id, n, option.id)`; `quantities` holds the counts by `tier.id`, or by
  `tier.id + ":" + option.id` for an option. The store caps a count at `limitPerCheckout` and
  the order at `ticketLimitPerOrder`; `ticketCount` is the running total.
- A "GUEST" tier takes a named amount: a field calling `setGuestPrice(tier.id, value)`, at least
  `minPrice`; `guestPrices` holds the values.
- `totals` (`subtotal`, `tax`, `fee`, `total`) is Wix's running sum while `ticketCount` is
  above zero; the hosted checkout is authoritative.
- `canCheckout` gates the button, `submitting` is the in-flight state, `error` the message for
  the visitor. `checkout()` reserves the tickets and navigates the whole document to the hosted
  checkout; it rejects on refusal.

The RSVP form, on the same store:

- `rsvpForm.controls`: the organizer's controls in display order, each with `inputs` (`name`,
  `label`, `mandatory`, `type`, `options`, `maxLength`). One control per input, named by `name`,
  `options` as the only choices; `setRsvpValue(name, value)` with an array for a checkbox group.
  `rsvpValues` holds them by name.
- `rsvpForm.guestControl` when present: a 0 to `maxGuests` picker calling `setGuestCount(n)`,
  and one name field per guest calling `setGuestName(index, name)`; `guestCount` and
  `guestNames` hold them.
- `canRsvp` gates the button, `submitting` and `error` as above. `rsvp(true)` sends it;
  `rsvp(false)` is the decline, offered only when `rsvpResponseType` is "YES_AND_NO".
- `confirmed` is the only success signal: `status` "YES", "NO" or "WAITLIST", and the copy
  follows it. Render the confirmed state from `confirmed` alone.

A sketch of the binding, fields in, markup yours:

```js
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  var d = b.dataset;
  if (d.tier) store.setQuantity(d.tier, Number(d.quantity), d.option || undefined);
  else if ("checkout" in d) store.checkout().catch(function () {});
  else if (d.rsvp) store.rsvp(d.rsvp === "yes").catch(function () {});
});
root.addEventListener("input", function (e) {
  var t = e.target, d = t.dataset;
  if (d.guestPrice) store.setGuestPrice(d.guestPrice, t.value);
  else if ("guests" in d) store.setGuestCount(Number(t.value));
  else if (d.guestName !== undefined) store.setGuestName(Number(d.guestName), t.value);
  else if (t.name) store.setRsvpValue(t.name, t.type === "checkbox" ? checkedValues(t.name) : t.value);
});

function render(s) {
  doneEl.hidden = !s.confirmed;
  errorEl.textContent = s.error || "";
  ctaEl.disabled = s.submitting || !(event.registrationType === "TICKETING" ? s.canCheckout : s.canRsvp);
  // the tier steppers from s.tiers and s.quantities, data-tier, data-option and data-quantity on each;
  // the totals from s.totals while s.ticketCount is above zero
}
```

`checkedValues(name)` collects the checked values of the group with that name; `esc` escapes
`&`, `<`, `>` and `"` in anything that came from the site. Render the organizer's form once, when
the store is created; later renders touch the steppers, the totals, the button and the error.

## The confirmation page

`event-confirmation.html` is the only success surface for a ticket order. The hosted checkout
appends `?orderNumber=&eventId=` to it; the page reads both into `createOrderStore` and renders
from the state: `loading` while the first read runs, `event` for the title, `order` with `number`,
`email`, `statusLabel`, `items` (`name`, `price`, `quantity`, `total`), `subtotal`, `tax`, `fee`,
`total`, `ticketsPdfUrl` once `ticketsReady`; `polling` while the tickets are being prepared. When
`orderUnavailable` the page still confirms and says the tickets arrive by email: landing here is
the success. A visitor returning to the event page is not one.

```js
import { createOrderStore } from "/js/wix/events-order-store.js";

var params = new URLSearchParams(location.search);
var order = createOrderStore({ orderNumber: params.get("orderNumber") || "", eventId: params.get("eventId") || "" });
order.subscribe(function (s) {
  if (s.loading) return;
  // the title from s.event, the lines and totals from s.order when present,
  // the tickets link once s.order.ticketsReady, a preparing line while s.polling
});
order.start();
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/events.html`, `/event.html?slug=…`, `/event-confirmation.html`. A link to a folder gives the
visitor a 404 page. Write the pages' scripts as files of their own and keep each file small; a
page's code travels as text in the upload call.

## Rules

- Registration goes through the registration store and the layer; the sequence (tier read,
  reservation, redirect session, RSVP) stays in them.
- Branch on the registration state, then the type; an RSVP event never shows a ticket picker, a
  ticketed event never an RSVP form.
- The RSVP form is the organizer's: every control, its inputs by `name`, `mandatory` marked,
  `options` as the only choices.
- Render form fields once; a render touches the values, the button and the error, not the
  inputs.
- Gate the buttons on `canCheckout` and `canRsvp`; render `error`.
- Confirmed states reflect real success: RSVP from `confirmed` only, with the waitlist copy for
  "WAITLIST"; tickets only on the confirmation page with Wix's query parameters.
- Prices and labels come from the layer as they are; dates are already in the event's zone.
- Live data or an honest empty state; nothing the organizer did not supply, no invented
  spots-left counts (`limitPerCheckout` is a per-order cap), no Wix ids or technical words in
  visible text.
- Browsing and registering need no login; the visitor session is already there.
- `fetchCategories` and `fetchOrder` may be refused for a visitor; the stores degrade (chips
  from the loaded events, a confirmation without invoice lines). Leave that as it is.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `events` (event management) and
`wix-cashier/payments` (connect a payment method); the plan upgrade is
`https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Selling paid tickets needs a connected
payment method and a premium plan; free and RSVP events work without. Until both are done,
`checkout()` reports that ticket sales are not switched on yet. Give both links in the close. Tax
settings, fees, ticket limits and the RSVP form are dashboard settings the site renders as they
are.

## Seeding

Per `seed/SEED.md` and `seed/seed-events.mjs`: a plain-data plan, run in the script's order with
its waits. Seed events that exercise the pages (a ticketed event with two tiers, another ticketed
one, a free RSVP event; future dates; an image per event) unless the brief says otherwise.

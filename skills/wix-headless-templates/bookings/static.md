# Bookings on a static site

The pages are HTML files at the root of the site. They import the bookings layer from `/js/wix/`:
the service and availability calls, and two stores that hold the state and the rules of booking.
Nothing on the screen ships; every element is yours, in the design of the site. This file shows
how to drive the layer. The skeletons show the calls and the fields and leave the markup to you.

## The layer

`/js/wix/services.js`: `fetchServices({ limit, offset, categoryId, locationId })`,
`fetchServiceBySlug(slug)` (null when the slug resolves to nothing), `fetchBookingCategories()`,
`fetchLocations()`. `/js/wix/booking.js`: `fetchSlots`, `fetchNextAvailableSlots`,
`fetchBookingsSettings`, `fetchSessions`, `fetchOfferedDays`, `fetchCourseAvailability`,
`fetchAddOnGroups`, `fetchBookingForm`, `bookService`; the pages reach these through the flow
store. Prices, durations and time labels come formatted and images come as https URLs; render
them as they are.

Two stores: `createServicesStore(options)` in `/js/wix/services-store.js` for the listing, and
`createBookingFlowStore(service)` in `/js/wix/booking-flow-store.js` for one service's booking
surface, built from the `ServiceDetail` that `fetchServiceBySlug` returns. The flow store owns the
rules: which slots are bookable, the seats left, the deposit, the add-ons' total, what the button
says and whether it is enabled, what the booking sends. A page reads the state and calls the
actions; it computes nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for both stores: create it, subscribe a render function, render once, start. A store
calls the listener on every change and not on subscribe, so the first render is yours. Controls
call the store's actions; delegate from the surface's root and read what to do from the element,
so a re-render of the markup keeps the listeners.

```js
import { fetchServiceBySlug } from "/js/wix/services.js";
import { createBookingFlowStore } from "/js/wix/booking-flow-store.js";

var service = await fetchServiceBySlug(new URLSearchParams(location.search).get("slug"));
var store = createBookingFlowStore(service);
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The listing

`services.html` on `createServicesStore()`. The state: `services` (null on the first load, then
the page), `categories`, `locations`, `hasOtherLocations`, `activeCategoryId`,
`activeLocationId`, `hasMore`, `loadingMore`, `error`. The actions: `setActiveCategoryId(id)`,
`setActiveLocationId(id)`, `loadMore()`. The store reads `?category=` and `?location=` on start
and writes them back on change, so a filter is a link, `services.html?category=…`.

A card shows the summary: `imageUrl`, `name`, `tagLine`, the type (`type` is "APPOINTMENT",
"CLASS" or "COURSE"; "Online" when `conferencing`), `durationLabel`, the price line and a link to
`service.html?slug=…`. The price line is `price`, with "From " before it when `priceFrom`,
`basePrice` struck beside it when the price is discounted, `discountName` under it when present,
and nothing when `price` is "". Classes and courses show `offeredDays` once loaded. Category
chips only when `categories` has more than one; a location filter only when `locations` has more
than one option, plus an "Other locations" entry with `OTHER_LOCATIONS_ID` (exported beside the
store) when `hasOtherLocations`. A load-more control while `hasMore`; `services` null is a loading
state, `[]` an honest empty state, `error` its own.

```js
import { createServicesStore, OTHER_LOCATIONS_ID } from "/js/wix/services-store.js";

var shop = createServicesStore();
moreEl.addEventListener("click", function () { shop.loadMore(); });
shop.subscribe(function (s) {
  moreEl.hidden = !s.hasMore;
  // category links from s.categories, the grid from s.services, states for null, [] and s.error
});
shop.start();
```

## The service page

`service.html?slug=…` loads the service with `fetchServiceBySlug` and shows `name`, `tagLine`,
`description` (stored HTML, render as HTML), `imageUrl` as a bounded band on a phone, the staff
with their photos when `imageUrl` is set, the locations, `durationLabel`, the price line as on
the card, then the booking surface. The name, the price and the first bookable day's times stay in
the first screen at 390px wide. A slug that resolves to nothing shows only the not-found state.
Set `document.title` and the meta description from the service once it loads.

## The booking surface

On `createBookingFlowStore(service)`. From the state, and the action each control calls:

- `days` is null while loading, then the week's days, each with `dayKey`, `dayLabel` and
  `slots`; `[]` for a course. Show one day at a time: a strip of days, the active day's slots
  under it, `prevWeek()` and `nextWeek()` at the strip's ends. A week of a busy calendar is over a
  hundred chips; never list every day's times at once. The active day is the page's own state;
  switching day drops a slot chosen on another day.
- A slot carries `label`, `bookable`, `remainingCapacity` and `waitlistCapacity`. A slot with
  `bookable` false is disabled; a small `remainingCapacity` is worth a line; a full slot with
  `waitlistCapacity` can say so. `setSelectedSlot(slot)` with the slot object; `selectedSlot` is
  the chosen one.
- `nextAvailable` is null while looking, then the next bookable slots when the week has none:
  offer `jumpTo(slot.dayKey)`.
- `timeZoneLabel` names the zone the times are shown in; when `customerCanChangeTimeZone`,
  offer `setDisplayTimeZone("CUSTOMER")` or `"BUSINESS"`, the current one in `displayTimeZone`.
- `service.staff` with more than one member renders a staff choice calling `setStaffId(id)`, or
  `setStaffId(undefined)` for anyone; `staffId` is the pick.
- `participants` and `maxParticipants`: a stepper calling `setParticipants(n)` when the maximum
  is above one.
- `service.deposit`: when `fullUpfrontAllowed`, a choice between the deposit and the full amount,
  `setPayDeposit(true|false)`, with `payDeposit` as the current pick and `deposit.amount` as the
  figure.
- `addOnGroups`: one group per entry with its `prompt` or `name` and its `addOns` (`name`,
  `price`); `toggleAddOn(id)`, `setAddOnQuantity(id, n)` up to `maxQuantity`, `canSelectMore(groupId)`
  before offering another in a group; `addOns` holds the selection by id, `addOnsTotal` the
  formatted sum. `book()` does not send add-ons, so say they are added at the venue, or leave
  them out.
- A course: `service.type` is "COURSE", `days` stays `[]`; show `service.course` (the span and
  `ended`), `offeredDays`, `course.spotsLeft` and `course.full`, the `sessions` with
  `loadMoreSessions()` while `hasMoreSessions`, the form and one button.
- `formFields`: the booking form as given, each with `target`, `label`, `type` ("STRING",
  "EMAIL", "PHONE", "NUMBER", "URL"), `options` for a choice field, `required`. One control per
  field calling `setValue(field.target, value)`; `values` holds them by target.
- `ctaState` is "book", "requestToBook" or "viewCourse"; the button's words follow it, and a
  request is not a confirmed seat. `canBook` gates the button, `booking` is the in-flight state,
  `error` is the message for the visitor when `book()` rejects.
- `book()` navigates the whole document to the hosted checkout for a paid service; for a free or
  pay-in-person service it sets `confirmed`, the only success signal. A visitor returning from
  checkout is not one. Render the confirmed state from `confirmed` alone.

A sketch of the binding, fields in, markup yours:

```js
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  var d = b.dataset;
  if (d.day) { activeDay = d.day; render(store.getState()); }
  else if (d.week === "next") store.nextWeek();
  else if (d.week === "prev") store.prevWeek();
  else if (d.slot) store.setSelectedSlot(slotByKey(store.getState(), d.slot));
  else if (d.staff !== undefined) store.setStaffId(d.staff || undefined);
  else if (d.addon) store.toggleAddOn(d.addon);
});
root.addEventListener("input", function (e) {
  if (e.target.dataset.field) store.setValue(e.target.dataset.field, e.target.value);
});
form.addEventListener("submit", function (e) { e.preventDefault(); store.book().catch(function () {}); });

function render(s) {
  var day = (s.days || []).find(function (x) { return x.dayKey === activeDay; });
  var html = "";
  (day ? day.slots : []).forEach(function (sl) {
    html += '<button type="button" data-slot="' + sl.key + '"' + (sl.bookable ? "" : " disabled")
      + ' aria-pressed="' + (s.selectedSlot && s.selectedSlot.key === sl.key) + '">' + esc(sl.label) + "</button>";
  });
  slotsEl.innerHTML = html;
  ctaEl.disabled = !s.canBook || s.booking;
  ctaEl.textContent = s.booking ? "Booking…" : s.ctaState === "requestToBook" ? "Request to book" : "Book";
  errorEl.textContent = s.error || "";
  doneEl.hidden = !s.confirmed;
}
```

`slotByKey` finds the slot object in `s.days` by its `key`; `esc` escapes `&`, `<`, `>` and `"`
in anything that came from the site.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/services.html`, `/service.html?slug=…`. A link to a folder gives the visitor a 404 page. Every
page declares its charset in the head; the host sends none. Write the pages' scripts as files of
their own and keep each file small; a page's code travels as text in the upload call.

## Rules

- Booking goes through the flow store and `bookService`. They own the sequence, the payment
  option, the staff choice, the seat count, the deposit flag and the form submission shape.
- The button and the confirmed copy follow `ctaState`; a request is not a confirmed seat.
- Money strings are final: `price`, `basePrice`, `deposit.amount`, `addOnsTotal` as given; ""
  means unknown, so omit it.
- The form is `formFields` as given, values keyed by `target`; `required` gates `canBook`.
- Gate the button on `canBook` and show `error`; `book()` can reject, and that message is for
  the visitor.
- Render the confirmed state only from `confirmed`.
- Live data or an honest empty state; nothing invented: no reviews, no availability pressure, no
  guarantees, no Wix ids or technical words in visible text.
- Browsing and booking need no login; the visitor session is already there.
- Render form inputs once; a render touches their values, the button and the error, not the inputs.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `bookings/services` (services),
`bookings/services/form/{serviceId}` (edit one), `bookings/calendar`,
`bookings/bookings/bookings-list`, `bookings/staff`, `bookings/availability`,
`bookings/settings/booking-form-page` (the form), `bookings/settings/policies`,
`wix-cashier/payments` (connect a payment method); the plan upgrade is
`https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Completing a booking online, free
services included, needs a payment method on the site; manual payments are enough for free and
pay-in-person. Real online payments also need a premium plan. Until then `book()` reports that the
site is not accepting payments. Give both links in the close.

## Seeding

Per `seed/SEED.md` and `seed/seed-bookings.mjs`: a plain-data plan, run in the script's order with
its waits (a fresh install provisions the owner's staff resource asynchronously, and the script
polls for it). Seed three or four services that exercise the surface: an appointment with a
duration and a price, a free one, a class with weekly sessions, a course when it fits the
business, a "From" price, a deposit or a manual-approval service where the brief allows, and an
image per service.

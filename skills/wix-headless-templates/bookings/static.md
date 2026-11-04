# Bookings on a static site

The pages are HTML files at the root of the site. They import the bookings modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the booking flow the page writes, the listing, the service page, the rules and the seed.

## The modules

`/js/wix/services.js`: `fetchServices({ limit, offset, categoryId, locationId })`,
`fetchServiceBySlug(slug)`, `fetchBookingCategories()`, `fetchLocations()`. `/js/wix/booking.js`:
`fetchSlots`, `fetchNextAvailableSlots`, `fetchBookingsSettings`, `fetchSessions`,
`fetchOfferedDays`, `fetchCourseAvailability`, `fetchAddOnGroups`, `fetchBookingForm`,
`bookService`. Prices, durations and time labels come formatted; images come as https URLs.
Two stores hold the state and the rules: `createServicesStore(options)` in
`/js/wix/services-store.js` (the listing) and `createBookingFlowStore(service)` in
`/js/wix/booking-flow-store.js` (one service's booking surface, built from the `ServiceDetail`
that `fetchServiceBySlug` returns). Each `.js` opens with its declarations. A store calls a
listener on every change and not when it subscribes: render once after subscribing, then
`start()`. The visitor token persists in `localStorage` on its own; never mint one in a page.

The services store state: `services` (null on the first load, then the page), `categories`,
`locations`, `hasOtherLocations`, `activeCategoryId`, `activeLocationId`, `hasMore`,
`loadingMore`, `error`. Its actions: `setActiveCategoryId(id)`, `setActiveLocationId(id)`,
`loadMore()`. It reads `?category=` and `?location=` on start and writes them back on change.

The booking flow state: `days` (slots grouped by day, null while loading, `[]` for a course),
`windowStart`, `nextAvailable`, `staffId`, `selectedSlot`, `timeZone`, `timeZoneLabel`,
`displayTimeZone`, `customerCanChangeTimeZone`, `course`, `offeredDays`, `sessions`,
`hasMoreSessions`, `participants`, `maxParticipants`, `payDeposit`, `addOnGroups`, `addOns`,
`addOnsTotal`, `addOnsMinutes`, `formFields`, `values`, `ctaState`, `canBook`, `booking`,
`confirmed`, `error`. Its actions: `nextWeek()`, `prevWeek()`, `jumpTo(dayKey)`,
`setStaffId(id)`, `setSelectedSlot(slot)`, `setDisplayTimeZone(zone)`, `setParticipants(n)`,
`setPayDeposit(bool)`, `toggleAddOn(id)`, `setAddOnQuantity(id, n)`, `loadMoreSessions()`,
`setValue(target, value)`, `book()`.

## The booking flow

The booking surface is yours to write, on the flow store: the day strip, the slot chips, the
staff and time zone controls, the participants control, the deposit choice, the add-ons, the form
and the button. Markup in your page, one render function that reads the store's state, listeners
that call its actions. The store holds every rule: which slots are bookable, the seats left,
what the button says, whether it is enabled, what the booking sends. The example follows the
store's declared interface; keep its calls and field names, the markup and the words are yours.

Show one day at a time: a strip of the days in `days` (weekday and day number), the active day's
slots under it, the week pagers at the strip's ends. A week of a busy calendar is over a hundred
chips; never list every day's times at once. Switching day drops a slot chosen on another day. A
course has no slots: show `service.course` dates, `offeredDays`, `course.spotsLeft` ("Full" when
`course.full`), the sessions, the form and one button.

```html
<section id="book">
  <p class="book-zone"></p>
  <div class="book-days"></div>
  <div class="book-slots"></div>
  <form class="book-form"></form>
  <p class="book-error" role="alert" hidden></p>
  <p class="book-done" hidden></p>
</section>
```

```js
import { fetchServiceBySlug } from "/js/wix/services.js";
import { createBookingFlowStore } from "/js/wix/booking-flow-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const root = document.querySelector("#book");
const q = (sel) => root.querySelector(sel);
const service = await fetchServiceBySlug(new URLSearchParams(location.search).get("slug"));
if (!service) { root.innerHTML = `<p>This service is not available.</p>`; throw new Error("not found"); }
document.title = service.name;
const store = createBookingFlowStore(service);
let activeDay = null;

root.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.day) { activeDay = d.day; render(store.getState()); }
  else if (d.week === "next") store.nextWeek();
  else if (d.week === "prev") store.prevWeek();
  else if (d.jump) { activeDay = d.jump; store.jumpTo(d.jump); }
  else if (d.slot) { const s = store.getState(); store.setSelectedSlot(s.days.flatMap((day) => day.slots).find((x) => x.key === d.slot) ?? null); }
  else if (d.staff !== undefined) store.setStaffId(d.staff || undefined);
  else if (d.zone) store.setDisplayTimeZone(d.zone);
  else if (d.seats) store.setParticipants(store.getState().participants + Number(d.seats));
  else if (d.deposit) store.setPayDeposit(d.deposit === "yes");
  else if (d.addon) store.toggleAddOn(d.addon);
});
root.addEventListener("input", (e) => { if (e.target.dataset.field) store.setValue(e.target.dataset.field, e.target.value); });
q(".book-form").addEventListener("submit", (e) => { e.preventDefault(); store.book().catch(() => {}); });

const field = (f, value) => {
  const common = `data-field="${f.target}" ${f.required ? "required" : ""} value="${esc(value)}"`;
  if (f.options) return `<label>${esc(f.label)} <select ${common}>${f.options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  const type = { EMAIL: "email", PHONE: "tel", NUMBER: "number", URL: "url" }[f.type] ?? "text";
  return `<label>${esc(f.label)} <input type="${type}" ${common}></label>`;
};

function render(s) {
  q(".book-zone").textContent = s.timeZoneLabel ? `Times in ${s.timeZoneLabel}` : "";
  if (s.customerCanChangeTimeZone && s.timeZoneLabel) q(".book-zone").innerHTML += ` <button type="button" data-zone="${s.displayTimeZone === "BUSINESS" ? "CUSTOMER" : "BUSINESS"}">Show in ${s.displayTimeZone === "BUSINESS" ? "my time" : "local time"}</button>`;
  if (s.days === null) { q(".book-days").innerHTML = `<p>Loading times…</p>`; q(".book-slots").innerHTML = ""; }
  else if (service.type === "COURSE") {
    q(".book-days").innerHTML = `<p>${s.offeredDays.join(", ")}</p>`;
    q(".book-slots").innerHTML = s.course ? `<p>${s.course.full ? "Full" : s.course.spotsLeft !== null ? `${s.course.spotsLeft} spots left` : ""}</p>` : "";
  } else {
    if (!s.days.some((d) => d.dayKey === activeDay)) activeDay = s.days[0]?.dayKey ?? null;
    q(".book-days").innerHTML = `<button type="button" data-week="prev">‹</button>`
      + s.days.map((d) => `<button type="button" class="day${d.dayKey === activeDay ? " day--active" : ""}" data-day="${d.dayKey}" ${d.slots.length ? "" : "disabled"}>${esc(d.dayLabel)}</button>`).join("")
      + `<button type="button" data-week="next">›</button>`;
    const day = s.days.find((d) => d.dayKey === activeDay);
    q(".book-slots").innerHTML = day && day.slots.length
      ? day.slots.map((sl) => `<button type="button" class="slot${s.selectedSlot?.key === sl.key ? " slot--selected" : ""}" data-slot="${sl.key}" ${sl.bookable ? "" : "disabled"} aria-pressed="${s.selectedSlot?.key === sl.key}">${esc(sl.label)}${sl.bookable ? (sl.remainingCapacity !== null && sl.remainingCapacity <= 3 ? ` <small>${sl.remainingCapacity} left</small>` : "") : sl.waitlistCapacity ? " <small>Full, waitlist</small>" : " <small>Full</small>"}</button>`).join("")
      : s.nextAvailable === null ? `<p>Looking for the next available time…</p>`
      : s.nextAvailable.length ? `<p>No times this week. <button type="button" data-jump="${s.nextAvailable[0].dayKey}">Next available: ${esc(s.nextAvailable[0].label)}</button></p>`
      : `<p>No times available.</p>`;
  }
  const money = s.payDeposit && service.deposit?.amount ? ` · deposit ${service.deposit.amount}` : service.free ? " — free" : service.price ? ` · ${service.priceFrom ? "from " : ""}${service.price}` : "";
  q(".book-form").innerHTML = `
    ${service.staff.length > 1 ? `<fieldset><legend>With</legend><button type="button" data-staff="" aria-pressed="${!s.staffId}">Anyone</button>${service.staff.map((m) => `<button type="button" data-staff="${m.id}" aria-pressed="${s.staffId === m.id}">${esc(m.name)}</button>`).join("")}</fieldset>` : ""}
    ${s.maxParticipants > 1 ? `<div class="seats"><button type="button" data-seats="-1" ${s.participants <= 1 ? "disabled" : ""}>−</button><span>${s.participants}</span><button type="button" data-seats="1" ${s.participants >= s.maxParticipants ? "disabled" : ""}>+</button></div>` : ""}
    ${service.deposit?.fullUpfrontAllowed ? `<fieldset><legend>Pay</legend><button type="button" data-deposit="yes" aria-pressed="${s.payDeposit}">Deposit now</button><button type="button" data-deposit="no" aria-pressed="${!s.payDeposit}">Full amount now</button></fieldset>` : ""}
    ${s.addOnGroups.map((g) => `<fieldset><legend>${esc(g.prompt || g.name)}</legend>${g.addOns.map((a) => `<button type="button" data-addon="${a.id}" aria-pressed="${(s.addOns[a.id] ?? 0) > 0}">${esc(a.name)} ${a.price}</button>`).join("")}</fieldset>`).join("")}
    ${s.addOnsTotal ? `<p>Add-ons ${s.addOnsTotal}, added at the venue</p>` : ""}
    ${s.formFields.map((f) => field(f, s.values[f.target] ?? "")).join("")}
    <button type="submit" class="book-cta" ${s.canBook && !s.booking && s.ctaState !== "viewCourse" ? "" : "disabled"} aria-busy="${s.booking}">${s.booking ? "Booking…" : s.ctaState === "requestToBook" ? "Request to book" : "Book"}${money}</button>`;
  q(".book-error").textContent = s.error ?? ""; q(".book-error").hidden = !s.error;
  q(".book-done").hidden = !s.confirmed;
  if (s.confirmed) { q(".book-done").textContent = s.ctaState === "requestToBook" ? "Request sent. You'll hear back once it's approved." : "You're booked. A confirmation email is on its way."; q(".book-form").hidden = true; }
}
store.subscribe(render);
render(store.getState());
store.start();
```

`book()` navigates the whole document to the hosted checkout for a paid service; the site's
origin must be on the OAuth app's allowed domains so checkout can return. For a free or
pay-in-person service it sets `confirmed`, the only success signal. A visitor returning from the
checkout page is not one. The confirmed copy follows `ctaState`: a request is not a confirmed
seat. Add-ons are shown and selectable; `book()` does not send them, so say they are added at the
venue, or leave them out of the surface.

## The listing

`services.html` renders one grid from `createServicesStore()`: one render function that reads
`getState()`, called from `subscribe`, then `start()`. A card shows `imageUrl`, `name`, the type
("Appointment", "Class", "Course"; "Online" when `conferencing`), `durationLabel`, the price line
and a link to `service.html?slug=…`. The price line is `price` with "From " before it when
`priceFrom`, `basePrice` struck beside a discounted price, `discountName` when present, nothing
when `price` is "". Classes and courses show `offeredDays` once loaded. Category pills only when
`categories.length > 1`; a location filter only when there is more than one option (`locations`,
plus "Other locations" with `OTHER_LOCATIONS_ID` from the store module when `hasOtherLocations`).
A filter is a link, `services.html?category=<id>` or `services.html?location=<id>`. A "load more"
control while `hasMore`. `services === null` is skeleton tiles, `[]` an honest empty state.

## The service page

`service.html?slug=…` loads the service with `fetchServiceBySlug` and shows `name`, `tagLine`,
`description` (stored HTML or text), `imageUrl` as a bounded band on a phone, the staff with their
photos when `imageUrl`, the locations, `durationLabel`, the price line as on the card, then the
booking surface above. The name, the price and the first bookable day's times stay in the first
screen at 390px wide. A slug that resolves to nothing shows only the not-found state. Set
`document.title` and the meta description from the service once it loads.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/services.html`, `/service.html?slug=…`. A link to a folder gives the visitor a 404 page. One
stylesheet shared by the pages, on one set of tokens.

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

# Rentals on a static site

The pages are HTML files at the root of the site. They import the rentals layer from `/js/wix/`:
the rental, availability and quote calls, and two stores that hold the state and the rules of
renting. Nothing on the screen ships; every element is yours, in the design of the site. This
file shows how to drive the layer. The skeletons show the calls and the fields and leave the
markup to you.

## The layer

`/js/wix/rentals.js`: `fetchRentals({ limit, offset })`, `fetchRentalBySlug(slug)` (null when
the slug resolves to nothing), `fetchStarts`, `fetchEndOptions`, `fetchQuote`, `fetchRentalForm`,
`rentResource`; the pages reach the last five through the flow store. Rates, labels and totals
come formatted and images come as https URLs; render them as they are.

Two stores: `createRentalsStore(options)` in `/js/wix/rentals-store.js` for the listing, and
`createRentalFlowStore(rental)` in `/js/wix/rental-flow-store.js` for one rental's surface, built
from the `RentalDetail` that `fetchRentalBySlug` returns. The flow store owns the rules: which
starts are bookable, which lengths a start allows, the server's price, what the button says and
whether it is enabled, what the rental sends. A page reads the state and calls the actions; it
computes nothing of its own.

A rental is measured in one unit, `unit` "HOUR" or "DAY", and the store branches its calls on it.
The page branches its rendering the same way: hourly and daily are two renderings of one
contract.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for both stores: create it, subscribe a render function, render once, start. A store
calls the listener on every change and not on subscribe, so the first render is yours. Controls
call the store's actions; delegate from the surface's root and read what to do from the element,
so a re-render of the markup keeps the listeners.

```js
import { fetchRentalBySlug } from "/js/wix/rentals.js";
import { createRentalFlowStore } from "/js/wix/rental-flow-store.js";

var rental = await fetchRentalBySlug(new URLSearchParams(location.search).get("slug"));
var store = createRentalFlowStore(rental);
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The listing

`rentals.html` on `createRentalsStore()`. The state: `rentals` (null on the first load, then the
page), `hasMore`, `loadingMore`, `error`. The action: `loadMore()`.

A card shows the summary: `imageUrl`, `name`, `tagLine`, the unit ("Hourly" or "Daily" from
`unit`), `rateLabel` ("$40 / hour"), `rangeLabel` ("1 to 8 hours") and a link to
`rental.html?slug=…`; a label that is "" is left out. A load-more control while `hasMore`;
`rentals` null is a loading state, `[]` an honest empty state, `error` its own.

```js
import { createRentalsStore } from "/js/wix/rentals-store.js";

var list = createRentalsStore();
moreEl.addEventListener("click", function () { list.loadMore(); });
list.subscribe(function (s) {
  moreEl.hidden = !s.hasMore;
  moreEl.disabled = s.loadingMore;
  // the grid from s.rentals, states for null, [] and s.error
});
list.start();
```

## The rental page

`rental.html?slug=…` loads the rental with `fetchRentalBySlug` and shows `name`, `tagLine`,
`description` (text as stored), `imageUrl` as a bounded band on a phone, the `locations` by
`name`, `rateLabel` and `rangeLabel`, then the rental surface. The name, the rate and the first
available day's starts stay in the first screen at 390px wide. A slug that resolves to nothing
shows only the not-found state. Set `document.title` and the meta description from the rental
once it loads.

## The rental surface

On `createRentalFlowStore(rental)`. From the state, and the action each control calls:

- `days` is null while loading, then the window's days, each with `dayKey`, `dayLabel` and
  `starts`; `[]` when the window has none. `windowDays` is 7 for an hourly rental and 14 for a
  daily one; `prevWindow()` and `nextWindow()` page it, `jumpTo(dayKey)` moves it to a day.
- Hourly: show one day at a time, a strip of the days with the active day's starts under it,
  the pagers at the strip's ends. The active day is the page's own state; switching day drops a
  start chosen on another day. Daily: a day is a start, so the strip is the start picker.
- A start carries `key`, `label` ("9:00 AM" hourly, "Mon, Oct 5" daily), `bookable`, `dayKey`,
  `location`. A start with `bookable` false is disabled. `setSelectedStart(start)` with the
  start object; `selectedStart` is the chosen one.
- `timeZone` names the zone the times are in; show it beside an hourly strip.
- `endOptions` is null while loading after a start is chosen, `[]` when that start allows no
  length (say so and offer another start), else the lengths, each with `label` ("2 hours",
  "Until Fri, Oct 9") and `units`. `setSelectedEnd(end)` with the option object; `selectedEnd` is
  the pick.
- `quote` is null until a start and a length are chosen and the server answers; then `total`,
  formatted. A "" total means the currency is unknown, so omit it.
- `formFields`: the booking form as given, each with `target`, `label`, `type` ("STRING",
  "EMAIL", "PHONE", "NUMBER", "URL"), `options` for a choice field, `required`. One control per
  field calling `setValue(field.target, value)`; `values` holds them by target.
- `ctaState` is "rent" or "requestToRent"; the button's words follow it, and a request is not a
  confirmed rental. `canRent` gates the button, `renting` is the in-flight state, `error` is the
  message for the visitor when `rent()` rejects. The button can carry the money: `quote.total`
  when present, else `rateLabel`, or nothing when `rental.free`.
- `rent()` navigates the whole document to the hosted checkout for a paid rental; the site's
  origin must be on the OAuth app's allowed domains so checkout can return. For a free or
  pay-in-person rental it sets `confirmed`, the only success signal. A visitor returning from
  checkout is not one. Render the confirmed state from `confirmed` alone, with the copy following
  `ctaState`.

A sketch of the binding, fields in, markup yours:

```js
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  var d = b.dataset, s = store.getState();
  if (d.day) { activeDay = d.day; render(s); }
  else if (d.window === "next") store.nextWindow();
  else if (d.window === "prev") store.prevWindow();
  else if (d.start) store.setSelectedStart(startByKey(s, d.start));
  else if (d.end) store.setSelectedEnd(endByLocal(s, d.end));
});
root.addEventListener("input", function (e) {
  if (e.target.dataset.field) store.setValue(e.target.dataset.field, e.target.value);
});
form.addEventListener("submit", function (e) { e.preventDefault(); store.rent().catch(function () {}); });

function render(s) {
  var starts = rental.unit === "HOUR" ? startsOfDay(s, activeDay) : allStarts(s);
  var html = "";
  starts.forEach(function (st) {
    html += '<button type="button" data-start="' + st.key + '"' + (st.bookable ? "" : " disabled")
      + ' aria-pressed="' + (s.selectedStart && s.selectedStart.key === st.key) + '">' + esc(st.label) + "</button>";
  });
  startsEl.innerHTML = html;
  // the lengths from s.endOptions with data-end set to endLocal; the quote from s.quote
  ctaEl.disabled = !s.canRent || s.renting;
  errorEl.textContent = s.error || "";
  doneEl.hidden = !s.confirmed;
}
```

`startByKey` finds the start object in `s.days` by its `key`, `endByLocal` the end option in
`s.endOptions` by its `endLocal`; `startsOfDay` and `allStarts` read `s.days`; `esc` escapes `&`,
`<`, `>` and `"` in anything that came from the site.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/rentals.html`, `/rental.html?slug=…`. A link to a folder gives the visitor a 404 page. Write
the pages' scripts as files of their own and keep each file small; a page's code travels as text
in the upload call. One stylesheet shared by the pages, on one set of tokens.

## Rules

- Renting goes through the flow store and `rentResource`. They own the sequence, the payment
  option, the price preview, the daily walk and the form submission shape. The length comes from
  `endOptions`; never add a duration to a start yourself.
- Branch the rendering on `rental.unit`; the store already branches the calls.
- The button and the confirmed copy follow `ctaState`; a request is not a confirmed rental.
- Money strings are final: `rateLabel`, `ratePerUnit`, `quote.total` as given; "" means unknown,
  so omit it. The quote is the server's; `rateAmount` is for nothing on screen.
- The form is `formFields` as given, values keyed by `target`; `required` gates `canRent`.
- Render form fields once; a render touches the values, the button and the error, not the
  inputs.
- Gate the button on `canRent` and show `error`; `rent()` can reject, and that message is for the
  visitor.
- Render the confirmed state only from `confirmed`.
- Live data or an honest empty state; nothing invented: no reviews, no availability pressure, no
  Wix ids or technical words in visible text.
- Browsing and renting need no login; the visitor session is already there.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

Rentals live in the Rentals dashboard page, `https://manage.wix.com/dashboard/{siteId}/` followed
by `wix-rental/rental-list`; the Bookings services page lists only services carrying the Bookings
app id, so it shows an empty wizard on a rentals site. Payments: `wix-cashier/payments` (connect a
payment method); the plan upgrade is `https://www.wix.com/upgrade/website?metaSiteId={siteId}`.
Completing a rental online, free rentals included, needs a payment method on the site; manual
payments are enough for free and pay-in-person. Real online payments also need a premium plan.
Until then `rent()` reports that the site cannot take online bookings yet. Give both links in the
close. Resources are seeded bookable around the clock; opening hours per resource are dashboard
work, and they split a multi-day rental into one booking per day. Say so.

## Seeding

Per `seed/SEED.md` and `seed/seed-rentals.mjs`: a plain-data plan, run in the script's order with
its waits. Seed the resource types with their units and three or four rentals that exercise the
surface: an hourly one and a daily one where the business allows, a free or approval-gated one
where it fits, an image per rental. A fresh Rentals install carries Wix's own sample rental
("Conference room", $45 an hour) and the listing shows it next to the seeded ones. Never delete it
or anything else on the site; the seed result's `preexisting[]` names it, and the close says so
with the Rentals link so the owner removes it there.

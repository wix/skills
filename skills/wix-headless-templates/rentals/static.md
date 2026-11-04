# Rentals on a static site

The pages are HTML files at the root of the site. They import the rentals modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the rental flow the page writes, the listing, the rental page, the rules and the seed.

## The modules

`/js/wix/rentals.js`: `fetchRentals({ limit, offset })`, `fetchRentalBySlug(slug)`,
`fetchStarts`, `fetchEndOptions`, `fetchQuote`, `fetchRentalForm`, `rentResource`. Rates, labels
and totals come formatted; images come as https URLs. Two stores hold the state and the rules:
`createRentalsStore(options)` in `/js/wix/rentals-store.js` (the listing) and
`createRentalFlowStore(rental)` in `/js/wix/rental-flow-store.js` (one rental's surface, built from
the `RentalDetail` that `fetchRentalBySlug` returns). Each `.js` opens with its declarations. A
store calls a listener on every change and not when it subscribes: render once after subscribing,
then `start()`. The visitor token persists in `localStorage` on its own; never mint one in a page.

The rentals store state: `rentals` (null on the first load, then the page), `hasMore`,
`loadingMore`, `error`. Its action: `loadMore()`.

The rental flow state: `days` (starts grouped by day, null while loading, `[]` when the window has
none), `windowStart`, `windowDays` (7 for an hourly rental, 14 for a daily one), `timeZone`,
`selectedStart`, `endOptions` (null while loading, `[]` when the start allows no length),
`selectedEnd`, `quote` (null until a start and a length are chosen and the server answers),
`formFields`, `values`, `ctaState` ("rent" or "requestToRent"), `canRent`, `renting`,
`confirmed`, `error`. Its actions: `nextWindow()`, `prevWindow()`, `jumpTo(dayKey)`,
`setSelectedStart(start)`, `setSelectedEnd(end)`, `setValue(target, value)`, `rent()`.

## The rental flow

The rental surface is yours to write, on the flow store: the day strip, the start chips, the
length picker, the quote, the form and the button. Markup in your page, one render function that
reads the store's state, listeners that call its actions. The store holds every rule: which starts
are bookable, which lengths a start allows, the server's price, what the button says and whether
it is enabled, what the rental sends. The example follows the store's declared interface; keep its
calls and field names, the markup and the words are yours.

Hourly and daily are two renderings of one contract, branched on `rental.unit`. Show one day at a
time: a strip of the days in `days` (weekday and day number), the active day's starts under it,
the window pagers at the strip's ends. For a daily rental a day is a start, so the strip is the
start picker. Switching day drops a start chosen on another day. Once a start is chosen, the
lengths from `endOptions`; once a length is chosen, the quote.

```html
<section id="rent">
  <p class="rent-zone"></p>
  <div class="rent-days"></div>
  <div class="rent-starts"></div>
  <div class="rent-lengths"></div>
  <p class="rent-quote"></p>
  <form class="rent-form"></form>
  <p class="rent-error" role="alert" hidden></p>
  <p class="rent-done" hidden></p>
</section>
```

```js
import { fetchRentalBySlug } from "/js/wix/rentals.js";
import { createRentalFlowStore } from "/js/wix/rental-flow-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const root = document.querySelector("#rent");
const q = (sel) => root.querySelector(sel);
const rental = await fetchRentalBySlug(new URLSearchParams(location.search).get("slug"));
if (!rental) { root.innerHTML = `<p>This rental is not available.</p>`; throw new Error("not found"); }
document.title = rental.name;
const store = createRentalFlowStore(rental);
const hourly = rental.unit === "HOUR";
let activeDay = null;

root.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  const s = store.getState();
  if (d.day) { activeDay = d.day; render(s); }
  else if (d.window === "next") store.nextWindow();
  else if (d.window === "prev") store.prevWindow();
  else if (d.start) store.setSelectedStart((s.days ?? []).flatMap((day) => day.starts).find((x) => x.key === d.start) ?? null);
  else if (d.end) store.setSelectedEnd((s.endOptions ?? []).find((x) => x.endLocal === d.end) ?? null);
});
root.addEventListener("input", (e) => { if (e.target.dataset.field) store.setValue(e.target.dataset.field, e.target.value); });
q(".rent-form").addEventListener("submit", (e) => { e.preventDefault(); store.rent().catch(() => {}); });

const field = (f, value) => {
  const common = `data-field="${f.target}" ${f.required ? "required" : ""} value="${esc(value)}"`;
  if (f.options) return `<label>${esc(f.label)} <select ${common}>${f.options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  const type = { EMAIL: "email", PHONE: "tel", NUMBER: "number", URL: "url" }[f.type] ?? "text";
  return `<label>${esc(f.label)} <input type="${type}" ${common}></label>`;
};
const startChip = (st, s) => `<button type="button" class="start${s.selectedStart?.key === st.key ? " start--selected" : ""}" data-start="${st.key}" ${st.bookable ? "" : "disabled"} aria-pressed="${s.selectedStart?.key === st.key}">${esc(st.label)}</button>`;

function render(s) {
  q(".rent-zone").textContent = hourly && s.timeZone ? `Times in ${s.timeZone}` : "";
  if (s.days === null) { q(".rent-days").innerHTML = `<p>Loading availability…</p>`; q(".rent-starts").innerHTML = ""; }
  else if (hourly) {
    if (!s.days.some((d) => d.dayKey === activeDay)) activeDay = s.days[0]?.dayKey ?? null;
    q(".rent-days").innerHTML = `<button type="button" data-window="prev">‹</button>`
      + s.days.map((d) => `<button type="button" class="day${d.dayKey === activeDay ? " day--active" : ""}" data-day="${d.dayKey}" ${d.starts.length ? "" : "disabled"}>${esc(d.dayLabel)}</button>`).join("")
      + `<button type="button" data-window="next">›</button>`;
    const day = s.days.find((d) => d.dayKey === activeDay);
    q(".rent-starts").innerHTML = day && day.starts.length ? day.starts.map((st) => startChip(st, s)).join("") : `<p>No start times in this window.</p>`;
  } else {
    q(".rent-days").innerHTML = `<button type="button" data-window="prev">‹</button>`
      + s.days.flatMap((d) => d.starts).map((st) => startChip(st, s)).join("")
      + `<button type="button" data-window="next">›</button>`;
    q(".rent-starts").innerHTML = s.days.length ? "" : `<p>No days available in this window.</p>`;
  }
  q(".rent-lengths").innerHTML = !s.selectedStart ? ""
    : s.endOptions === null ? `<p>Loading lengths…</p>`
    : s.endOptions.length === 0 ? `<p>This start can't be rented for the minimum length. Pick another.</p>`
    : s.endOptions.map((en) => `<button type="button" class="length${s.selectedEnd?.endLocal === en.endLocal ? " length--selected" : ""}" data-end="${en.endLocal}" aria-pressed="${s.selectedEnd?.endLocal === en.endLocal}">${esc(en.label)}</button>`).join("");
  q(".rent-quote").textContent = !s.selectedEnd ? "" : s.quote === null ? "Calculating the price…" : s.quote.total ? `Total ${s.quote.total}` : "";
  const money = rental.free ? " — free" : s.quote?.total ? ` · ${s.quote.total}` : rental.rateLabel ? ` · ${rental.rateLabel}` : "";
  q(".rent-form").innerHTML = s.formFields.map((f) => field(f, s.values[f.target] ?? "")).join("")
    + `<button type="submit" class="rent-cta" ${s.canRent && !s.renting ? "" : "disabled"} aria-busy="${s.renting}">${s.renting ? "Reserving…" : s.ctaState === "requestToRent" ? "Request to rent" : "Rent"}${money}</button>`;
  q(".rent-error").textContent = s.error ?? ""; q(".rent-error").hidden = !s.error;
  q(".rent-done").hidden = !s.confirmed;
  if (s.confirmed) { q(".rent-done").textContent = s.ctaState === "requestToRent" ? "Request sent. You'll hear back once it's approved." : "You're all set. A confirmation email is on its way."; q(".rent-form").hidden = true; }
}
store.subscribe(render);
render(store.getState());
store.start();
```

`rent()` navigates the whole document to the hosted checkout for a paid rental; the site's
origin must be on the OAuth app's allowed domains so checkout can return. For a free or
pay-in-person rental it sets `confirmed`, the only success signal. A visitor returning from the
checkout page is not one. The confirmed copy follows `ctaState`: a request is not a confirmed
rental.

## The listing

`rentals.html` renders one grid from `createRentalsStore()`: one render function that reads
`getState()`, called from `subscribe`, then `start()`. A card shows `imageUrl`, `name`, the unit
("Hourly" or "Daily" from `unit`), `rateLabel` ("$40 / hour"), `rangeLabel` ("1 to 8 hours") and a
link to `rental.html?slug=…`; a label that is "" is left out. A "load more" control while
`hasMore`. `rentals === null` is skeleton tiles, `[]` an honest empty state.

## The rental page

`rental.html?slug=…` loads the rental with `fetchRentalBySlug` and shows `name`, `tagLine`,
`description`, `imageUrl` as a bounded band on a phone, the locations, `rateLabel` and
`rangeLabel`, then the rental surface above. The name, the rate and the first available day's
starts stay in the first screen at 390px wide. A slug that resolves to nothing shows only the
not-found state. Set `document.title` and the meta description from the rental once it loads.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/rentals.html`, `/rental.html?slug=…`. A link to a folder gives the visitor a 404 page. One
stylesheet shared by the pages, on one set of tokens.

## Rules

- Renting goes through the flow store and `rentResource`. They own the sequence, the payment
  option, the price preview, the daily walk and the form submission shape. The length comes from
  `endOptions`; never add a duration to a start yourself.
- Branch the rendering on `rental.unit`; the store already branches the calls.
- The button and the confirmed copy follow `ctaState`; a request is not a confirmed rental.
- Money strings are final: `rateLabel`, `ratePerUnit`, `quote.total` as given; "" means unknown,
  so omit it. The quote is the server's; `rateAmount` is for nothing on screen.
- The form is `formFields` as given, values keyed by `target`; `required` gates `canRent`.
- Gate the button on `canRent` and show `error`; `rent()` can reject, and that message is for the
  visitor.
- Render the confirmed state only from `confirmed`.
- Live data or an honest empty state; nothing invented: no reviews, no availability pressure, no
  Wix ids or technical words in visible text.
- Browsing and renting need no login; the visitor session is already there.

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

# Events on a static site

The pages are HTML files at the root of the site. They import the events modules from `/js/wix/`
and render what the modules return. This file is the whole playbook for that path: the modules,
the listing, the event page with its registration, the confirmation page, routes, rules, the
owner's links and the seed.

## The modules

`/js/wix/events.js`: `fetchEventsPage({ limit, offset, categoryId, status })`, `fetchEvents`,
`fetchEventBySlug(slug)`, `fetchEventById(id)`, `fetchOccurrences(recurringCategoryId)`,
`fetchCategories`. `/js/wix/registration.js`: `fetchTicketTiers(event)`, `submitRsvp`,
`startTicketCheckout`; the pages call these through the registration store. `/js/wix/orders.js`:
`fetchOrder(eventId, orderNumber)`, used by the order store. Every date label comes formatted in
the event's time zone, every price comes formatted, images are https URLs.

Three stores hold the state and the rules. `createEventsStore({ pageSize, status })` in
`/js/wix/events-store.js` is the listing: state `events` (null before the first page), `categories`,
`activeCategoryId`, `hasMore`, `loadingMore`, `error`; actions `start()`, `stop()`,
`setActiveCategoryId(id)`, `loadMore()`. `createRegistrationStore(event, { paths })` in
`/js/wix/registration-store.js` is one event's registration: state `tiers` (null while loading for
a ticketed event), `quantities`, `guestPrices`, `selections`, `ticketCount`, `ticketLimitPerOrder`,
`totals` (`subtotal`, `tax`, `fee`, `total`), `canCheckout`, `rsvpForm`, `rsvpValues`,
`guestCount`, `guestNames`, `canRsvp`, `submitting`, `confirmed`, `error`; actions `start()`,
`setQuantity(tierId, quantity, optionId)`, `setGuestPrice(tierId, value)`,
`setRsvpValue(inputName, value)`, `setGuestCount(n)`, `setGuestName(index, name)`, `checkout()`,
`rsvp(attending)`. `createOrderStore({ orderNumber, eventId })` in `/js/wix/events-order-store.js`
is the confirmation: state `event`, `order`, `orderUnavailable`, `polling`, `loading`; `start()`
reads the order and polls until `order.ticketsReady`. A store calls a listener on every change
and not when it subscribes: render once after subscribing. The visitor token persists in
`localStorage` on its own; never mint one in a page.

## The listing

`events.html` renders the cards from the events store: `imageUrl`, `dateLabel` (or
`dateTbdMessage` when `dateTbd`), `title`, `locationName` (`locationType` says VENUE, ONLINE or
TBD), `priceLabel`, `soldOut`, and a link to `event.html?slug=` + `slug`. Category pills only
when `categories` has more than one entry. `events` null is the loading state, an empty array an
honest empty state, `error` a short message, `hasMore` a load-more control disabled while
`loadingMore`.

```html
<nav id="event-categories"></nav>
<div id="events"></div>
<button id="more-events" type="button" hidden>Load more</button>
```

```js
import { createEventsStore } from "/js/wix/events-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const store = createEventsStore();
const list = document.querySelector("#events"), pills = document.querySelector("#event-categories"), more = document.querySelector("#more-events");

pills.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) store.setActiveCategoryId(b.dataset.category || null); });
more.addEventListener("click", () => store.loadMore());

function render(s) {
  pills.innerHTML = s.categories.length > 1
    ? [{ id: "", name: "All" }, ...s.categories].map((c) => `<button type="button" class="pill${(s.activeCategoryId ?? "") === c.id ? " pill--on" : ""}" data-category="${c.id}">${esc(c.name)}</button>`).join("")
    : "";
  if (s.events === null) { list.innerHTML = `<p class="loading">Loading events…</p>`; more.hidden = true; return; }
  if (s.error) list.innerHTML = `<p class="error" role="alert">${esc(s.error)}</p>`;
  else if (s.events.length === 0) list.innerHTML = `<p class="empty">No upcoming events.</p>`;
  else list.innerHTML = s.events.map((e) => `
    <article class="card">
      ${e.imageUrl ? `<img src="${e.imageUrl}" alt="" loading="lazy">` : ""}
      <p class="date">${esc(e.dateTbd ? e.dateTbdMessage : e.dateLabel)}</p>
      <h3><a href="/event.html?slug=${encodeURIComponent(e.slug)}">${esc(e.title)}</a></h3>
      <p class="venue">${esc(e.locationName)}</p>
      <p class="price">${e.soldOut ? "Sold out" : esc(e.priceLabel)}</p>
    </article>`).join("");
  more.hidden = !s.hasMore;
  more.disabled = s.loadingMore;
}
store.subscribe(render);
render(store.getState());
store.start();
```

## The event page

`event.html?slug=…` resolves the slug with `fetchEventBySlug`; null shows only the not-found
state. In the first screen, on a phone too: the image as a bounded band, `dateLabel`, `title`,
`locationName` with `address` under it, and the registration control. The description after the
control: `aboutHtml` through `innerHTML`, or `aboutParagraphs` when it is empty.
`addToCalendar.google` as a link when present; a map only from `coordinates`. Set
`document.title` and the meta description from `title` and `shortDescription` once the event
loads.

The registration branches on the state first, then the type. `registrationClosed` reads "Sold out"
when `soldOut`, else "Registration closed"; `registrationStatus === "SCHEDULED_RSVP"` reads
"Registration opens " + `registrationOpensAtLabel`; `registrationPaused` reads "Registration is
paused". Then `registrationType`: `TICKETING` renders the tier picker, `RSVP` the organizer's
form, `EXTERNAL` a link to `externalUrl`, `NONE` nothing. A `waitlistOnly` event's button says
"Join the waitlist". A `membersOnly` event says so; the login itself belongs to the members
modules. The paths option is what makes the hosted checkout return to files: pass
`{ confirmation: "/event-confirmation.html", event: "/event.html?slug=" + encodeURIComponent(event.slug) }`.

```html
<div id="event"></div>
<div id="register"></div>
```

```js
import { fetchEventBySlug } from "/js/wix/events.js";
import { createRegistrationStore } from "/js/wix/registration-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const box = document.querySelector("#register");
const event = await fetchEventBySlug(new URLSearchParams(location.search).get("slug"));
if (!event) { document.querySelector("#event").innerHTML = `<p>This event is not available.</p>`; }
else {
  document.title = event.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", event.shortDescription);
  // The page around the control: image, dateLabel, title, locationName, address, aboutHtml. Yours.
  const store = createRegistrationStore(event, { paths: { confirmation: "/event-confirmation.html", event: "/event.html?slug=" + encodeURIComponent(event.slug) } });

  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tier) store.setQuantity(b.dataset.tier, Number(b.dataset.quantity), b.dataset.option || undefined);
    else if ("checkout" in b.dataset) store.checkout().catch(() => {});
    else if ("rsvp" in b.dataset) store.rsvp(b.dataset.rsvp !== "no").catch(() => {});
  });
  box.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.guestPrice) store.setGuestPrice(t.dataset.guestPrice, t.value);
    else if (t.dataset.guests !== undefined) store.setGuestCount(Number(t.value));
    else if (t.dataset.guestName !== undefined) store.setGuestName(Number(t.dataset.guestName), t.value);
    else if (t.name) store.setRsvpValue(t.name, t.type === "checkbox" ? [...box.querySelectorAll(`[name="${t.name}"]:checked`)].map((c) => c.value) : t.value);
  });

  const field = (input) => {
    const req = input.mandatory ? " required" : "";
    if (input.options.length) return `<label>${esc(input.label)} <select name="${input.name}"${req}><option value="">Choose</option>${input.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
    return `<label>${esc(input.label)} <input name="${input.name}" ${input.maxLength ? `maxlength="${input.maxLength}"` : ""}${req}></label>`;
  };

  function render(s) {
    if (s.confirmed) { box.innerHTML = `<p class="confirmed">${s.confirmed.status === "WAITLIST" ? "You are on the waitlist." : s.confirmed.status === "NO" ? "Thanks for letting us know." : "You're in. See you there."}</p>`; return; }
    const closed = event.registrationClosed ? (event.soldOut ? "Sold out" : "Registration closed")
      : event.registrationStatus === "SCHEDULED_RSVP" ? `Registration opens ${esc(event.registrationOpensAtLabel)}`
      : event.registrationPaused ? "Registration is paused" : "";
    if (closed) { box.innerHTML = `<p class="closed">${closed}</p>`; return; }
    if (event.registrationType === "EXTERNAL") { box.innerHTML = `<a class="primary" href="${event.externalUrl}">Register</a>`; return; }
    if (event.registrationType === "NONE") { box.innerHTML = ""; return; }
    const error = s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : "";
    if (event.registrationType === "TICKETING") {
      if (s.tiers === null) { box.innerHTML = `<p class="loading">Loading tickets…</p>`; return; }
      box.innerHTML = s.tiers.map((t) => {
        const rows = t.pricingType === "OPTIONS" ? t.options.map((o) => ({ key: `${t.id}:${o.id}`, option: o.id, name: o.name, price: o.price })) : [{ key: t.id, option: "", name: "", price: t.free ? "Free" : t.price }];
        return `<section class="tier${t.available ? "" : " tier--off"}">
          <h4>${esc(t.name)}</h4>${t.description ? `<p>${esc(t.description)}</p>` : ""}
          ${t.soldOut ? `<p>Sold out</p>` : t.saleStatus === "SALE_SCHEDULED" ? `<p>On sale ${esc(t.saleStartsLabel)}</p>` : t.saleStatus === "SALE_ENDED" ? `<p>Sale ended</p>` : ""}
          ${t.pricingType === "GUEST" ? `<label>Your price (at least ${esc(t.minPrice)}) <input inputmode="decimal" data-guest-price="${t.id}" value="${esc(s.guestPrices[t.id] ?? "")}"></label>` : ""}
          ${rows.map((r) => `<div class="row"><span>${esc(r.name)}</span><span>${esc(r.price)}</span>
            <span class="stepper"><button type="button" data-tier="${t.id}" data-option="${r.option}" data-quantity="${(s.quantities[r.key] ?? 0) - 1}" ${!t.available || !(s.quantities[r.key] ?? 0) ? "disabled" : ""}>−</button><span>${s.quantities[r.key] ?? 0}</span><button type="button" data-tier="${t.id}" data-option="${r.option}" data-quantity="${(s.quantities[r.key] ?? 0) + 1}" ${!t.available ? "disabled" : ""}>+</button></span></div>`).join("")}
          ${t.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}
        </section>`;
      }).join("") + (s.totals && s.ticketCount ? `<div class="totals"><div><span>Subtotal</span><span>${esc(s.totals.subtotal)}</span></div>${s.totals.tax ? `<div><span>Tax</span><span>${esc(s.totals.tax)}</span></div>` : ""}${s.totals.fee ? `<div><span>Fee</span><span>${esc(s.totals.fee)}</span></div>` : ""}<div><span>Total</span><span>${esc(s.totals.total)}</span></div></div>` : "")
        + `<button type="button" class="primary" data-checkout ${s.canCheckout && !s.submitting ? "" : "disabled"}>${s.submitting ? "One moment…" : "Checkout"}</button>${error}`;
      return;
    }
    // RSVP: the organizer's form, every control, its inputs by name.
    const form = s.rsvpForm;
    box.innerHTML = form.controls.map((c) => c.inputs.map(field).join("")).join("")
      + (form.guestControl ? `<label>${esc(form.guestControl.label)} <input type="number" min="0" max="${form.guestControl.maxGuests}" data-guests value="${s.guestCount}"></label>`
        + Array.from({ length: s.guestCount }, (_, i) => `<label>${esc(form.guestControl.namesLabel)} ${i + 1} <input data-guest-name="${i}" value="${esc(s.guestNames[i] ?? "")}"></label>`).join("") : "")
      + `<button type="button" class="primary" data-rsvp="yes" ${s.canRsvp && !s.submitting ? "" : "disabled"}>${s.submitting ? "Sending…" : event.waitlistOnly ? "Join the waitlist" : "RSVP"}</button>`
      + (event.rsvpResponseType === "YES_AND_NO" ? `<button type="button" data-rsvp="no" ${s.submitting ? "disabled" : ""}>Can't make it</button>` : "") + error;
  }
  store.subscribe(render);
  render(store.getState());
  store.start();
}
```

Rendering the form from `innerHTML` on every change loses the focused field. Build the RSVP form
once and update only the button and the error on later changes, or restore focus by name after
each render, as the storefront's buy controls do.

## The confirmation page

`event-confirmation.html` is the only success surface for a ticket order. Wix appends
`?orderNumber=&eventId=` to it; the page reads both into `createOrderStore` and renders from
`order`: `items` (`name`, `price`, `quantity`, `total`), `subtotal`, `tax`, `fee`, `total`,
`email`, `ticketsPdfUrl` once `ticketsReady` (say the tickets are being prepared while `polling`).
When `orderUnavailable` the page still confirms and says the tickets arrive by email. A visitor
returning to the event page is not a success.

```html
<div id="confirmation"></div>
```

```js
import { createOrderStore } from "/js/wix/events-order-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const params = new URLSearchParams(location.search);
const store = createOrderStore({ orderNumber: params.get("orderNumber") ?? "", eventId: params.get("eventId") ?? "" });
const root = document.querySelector("#confirmation");
function render(s) {
  if (s.loading) { root.innerHTML = `<p class="loading">Confirming your order…</p>`; return; }
  const title = `<h1>You're going${s.event ? ` to ${esc(s.event.title)}` : ""}.</h1>`;
  if (!s.order) { root.innerHTML = title + `<p>Your tickets and receipt arrive by email.</p>`; return; }
  const o = s.order;
  root.innerHTML = title + `<p>Order ${esc(o.number)}, sent to ${esc(o.email)}.</p>`
    + o.items.map((i) => `<div class="row"><span>${i.quantity} × ${esc(i.name)}</span><span>${esc(i.total)}</span></div>`).join("")
    + `<div class="row"><span>Total</span><span>${esc(o.total)}</span></div>`
    + (o.ticketsReady && o.ticketsPdfUrl ? `<a class="primary" href="${o.ticketsPdfUrl}">Download tickets</a>` : s.polling ? `<p>Your tickets are being prepared.</p>` : `<p>Your tickets arrive by email.</p>`);
}
store.subscribe(render);
render(store.getState());
store.start();
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/events.html`, `/event.html?slug=…`, `/event-confirmation.html`. A link to a folder gives the
visitor a 404 page. The home page shows what the events are and the next one in the first screen,
with a link to the listing.

## Rules

- Registration goes through the registration store and the modules; the sequence (tier read,
  reservation, redirect session, RSVP) stays in them.
- Branch on the registration state, then the type; an RSVP event never shows a ticket picker, a
  ticketed event never an RSVP form.
- The RSVP form is the organizer's: every control, its inputs by `name`, `mandatory` marked,
  `options` as the only choices.
- Gate the buttons on `canCheckout` and `canRsvp`; render `error`.
- Confirmed states reflect real success: RSVP from `confirmed` only, with "waitlisted" for
  `WAITLIST`; tickets only on the confirmation page with Wix's query parameters.
- Prices and labels come from the DTOs as they are; dates are already in the event's zone.
- Live data or an honest empty state; nothing the organizer did not supply, no invented
  "spots left" (`limitPerCheckout` is a per-order cap).
- Browsing and registering need no login.
- `fetchCategories` and `fetchOrder` may be refused for a visitor; the stores degrade (pills from
  the loaded events, a confirmation without invoice lines). Leave that as it is.

## The owner's links

The dashboard URL from the provisioning step, plus `/events` for event management. Selling paid
tickets needs a connected payment method (`{dashboardUrl}/wix-cashier/payments`) and a premium
plan (`https://www.wix.com/upgrade/website?metaSiteId={siteId}`); free and RSVP events work
without. Until both are done, `checkout()` reports that ticket sales are not switched on yet.
Give both links in the close. Tax settings, fees, ticket limits and the RSVP form are dashboard
settings the site renders as they are.

## Seeding

Per `seed/SEED.md` and `seed/seed-events.mjs`: a plain-data plan, run in the script's order with
its waits. Seed events that exercise the pages (a ticketed event with two tiers, another ticketed
one, a free RSVP event; future dates; an image per event) unless the brief says otherwise.


# Wix Events Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and the helper file(s) you need from `references/events/`. All helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`).
>
> | Need | Copy |
> |---|---|
> | Event listing + detail (always) | `wix-events-browse.js` |
> | RSVP, ticketing, registration | `wix-events-registration.js` |

Builds a real, client-only Wix Events site. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock events; never hand-build registration or payment URLs —
register via the RSVP/ticketing APIs, and complete paid tickets on the official Wix-hosted
ticket form.

## When to use
- User wants an events site over Wix Events & Tickets, or asks to "connect Wix Events".
- Replacing placeholder/mock events with live Wix data.
- Adding event listings, an event detail page, RSVP, or ticket purchase over existing,
  published Wix events.

## Prerequisites
1. A Wix site with **Wix Events & Tickets installed and events already published** (this skill
   does NOT create events — it's read-only over them). Selling **paid** tickets also needs a
   Wix premium plan + a configured payment method; **free** events and RSVP events work without.
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the Wix
   Business Manager surfaces a copyable prompt with the id filled in — see the router `SKILL.md`). Paste
   it into `src/rest/wix-client.js` in place of the placeholder. It is a visitor-facing
   credential (it only mints anonymous visitor tokens), **not** a secret, so hardcoding/
   committing it is fine.
3. For paid tickets the buyer completes payment on the **Wix-hosted ticket form** (the redirect
   target of `getTicketCheckoutUrl`). The deployed app domain may need to be allow-listed on the
   OAuth client for that page to return cleanly — a **separate Wix setup the user completes
   later**, out of this skill's scope. If the return fails before that's done, that's expected;
   flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the events UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to the
  id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh token is
  persisted to localStorage and IS the identity of the visitor's ticket reservation/cart — do
  not re-mint anonymously per load.
- `src/rest/wix-events-browse.js` — **Browse & discovery:**
  `queryEvents`, `getEventBySlug`, `countUpcomingEvents`, `queryEventCategories`, `listEventsByCategory`
- `src/rest/wix-events-registration.js` — **RSVP & ticketing:**
  `createRsvp`, `queryTicketDefinitions`, `reserveTickets`, `getTicketCheckoutUrl`, `checkoutTickets`

The `Event`, `TicketDefinition`, and `RSVP`/`Order` shapes are documented as JSDoc comments at
the top of each helper file. Read the relevant file(s) before building the UI — they describe
the key fields and link to the full API reference for anything not shown. The **Reference
components** section below shows correct usage of the browse + registration helpers (grid,
category menu, load-more, detail page, free-ticket checkout) — adapt the logic, restyle freely.

## How to wire it (UI is the project's choice)
- **Event grid** — `queryEvents()` lists live (UPCOMING/STARTED) events, soonest first. Render
  `title`, `mainImage.url`, `dateAndTimeSettings.formatted.dateAndTime`, `location.name`, and
  `shortDescription`. Use `offset`/`nextOffset` from the result to page. Link each card by `slug`.
- **Event detail** — `getEventBySlug(slug)`; returns null on miss — show a not-found state, never
  invent an event.
  - **Description fields:** `event.shortDescription` is a **plain string** (safe teaser). The full
    `event.description` is **Ricos rich content** — an object shaped `{ nodes: [...] }`, **not a string**.
    Render it with a Ricos viewer (`@wix/ricos`) or walk `nodes` to extract text; **never** call string
    methods (`.split`/`.slice`/`.substring`) on it — that crashes the page. When you only need text, use
    `shortDescription`.
  - Branch the registration UI on `event.registration.type`:
  - `"RSVP"` → render the RSVP form (fields from `event.form.controls`).
  - `"TICKETING"` → render the ticket picker.
  - `"EXTERNAL"` → link out to `event.registration.external.url`.
  - `"NONE"` → details only, no registration.
  Only `registration.status` values starting `OPEN_` accept new registrations; otherwise show the
  closed state.
- **Categories (optional)** — `queryEventCategories()` for a filter menu (`counts.assignedEventsCount`
  per category); `listEventsByCategory(categoryId)` to list a category's events (same card fields
  and paging as `queryEvents`).
- **RSVP** — `createRsvp(eventId, { firstName, lastName, email, status, additionalGuestNames?, extraFields? })`.
  `status` defaults to `"YES"`; only offer `"NO"` when `registration.rsvp.responseType` is
  `"YES_AND_NO"`. If the event is full with a waitlist enabled, the returned RSVP comes back with
  status `"WAITLIST"` — tell the guest. Completes fully client-side; no redirect.
- **Ticketing** — show tickets, reserve, then complete on the hosted form:
  1. `queryTicketDefinitions(eventId)` → render each ticket's `name`, price (`pricing.fixedPrice.amount`
     + `currency` for standard tickets; `free` boolean for free tickets; `pricing.minPrice` for
     donation/"pay what you want"; `pricing.pricingOptions.options` for tiered), and filter on
     `saleStatus === "SALE_STARTED"`. The endpoint already returns only non-hidden, available tickets.
  2. `reserveTickets([{ ticketDefinitionId, quantity, guestPrice?, pricingOptionId? }])` → holds the
     tickets; returns `{ id, expirationDate }`. Show a countdown to `expirationDate` if you like.
  3. `window.location.href = getTicketCheckoutUrl(event, reservation.id)` → the Wix-hosted ticket
     form collects guest details + payment and returns the buyer to the event. This is the path for
     **all paid tickets**.
  - **Free tickets only:** you may instead call `checkoutTickets(eventId, { reservationId, buyer, guests })`
    to finish in-app — it returns an order with status `"FREE"`, a `ticketsPdf`, and `tickets[]`. It
    throws for paid orders (status `INITIATED`), telling you to use the hosted form.
- **Empty state** — if `countUpcomingEvents()` is 0, show an empty state telling the user to publish
  events in their Wix dashboard. Never invent events.

## Hard rules (do not violate)
- ✅ Complete paid ticket purchases ONLY via `reserveTickets()` → `getTicketCheckoutUrl()` redirect
  (the official Wix-hosted ticket form). 
- ❌ Never hand-build registration, ticket, payment, or checkout URLs — derive the hosted form URL
  from `event.eventPageUrl` via `getTicketCheckoutUrl`.
- ❌ Never mock events, tickets, or guest counts — render live Wix data or the empty/closed state.
- ❌ Never invent reviews, ratings, attendee names, or "X spots left" numbers not returned by the API.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public visitor-facing client id — safe to hardcode).
- ✅ Branch registration UI on `event.registration.type`; respect `registration.status` (only `OPEN_*`
  accepts registrations) and ticket `saleStatus`/`salesDetails.soldOut`.
- ✅ Pass `guestPrice` for donation/"pay what you want" tickets and `pricingOptionId` for tiered tickets
  to `reserveTickets`.
- The helpers fail loudly on purpose: `reserveTickets` throws when tickets aren't actually held,
  `createRsvp` throws on closed/full registration, `checkoutTickets` throws when payment is still owed.
  A green path means it really worked — don't swallow these.

## Beyond the snippets
The snippets cover the common RSVP + ticketing paths. If you hit a use case they don't cover
(coupons/`discount` at checkout, members/auth, schedule/agenda, seating maps, canceling a
reservation, a field not in the typedefs), make the call yourself with `wixApiRequest` — but look
up the exact endpoint, HTTP method, and request body in the **official Wix Events API reference**
first; never guess:
- Events API reference: https://dev.wix.com/docs/api-reference/business-solutions/events.md
- Registration (RSVP + ticketing) overview: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/introduction.md
- Member login + a "my registrations" account view → the **members** vertical (`references/members/INSTRUCTIONS.md`).
- Ticketing flow (reservations → orders → tickets): https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/introduction.md

Keep the snippets as the default for everything they already do; reach for the API reference only
for the gap.

## Reference components (headless — adapt the logic, restyle freely)

These are the recurring events pieces, written **headless**: the data wiring (Wix field paths,
the offset load-more math, the ticketing Money object, the free-ticket checkout shape) is correct
and complete — the markup is deliberately plain. **Copy the logic exactly; restyle the JSX to the
brand.** Don't re-derive the data shapes from scratch (that's where the bugs are — the category
`label`, the `lowestPrice` Money object, and the `{ events, nextOffset }` paging especially). They
consume the `src/rest/` helpers; you don't need to read those helpers' source.

**`components/EventCard.jsx`** — grid tile. Note the date/location/teaser field paths and the
TICKETING "from" price, read off `registration.tickets.lowestPrice` — a **Money object**
`{ value, currency, formattedValue }`. Render `formattedValue`, **never** the raw object (React
"objects are not valid as a child" crash). This is a different shape from the ticket-definition
price path `pricing.fixedPrice.amount` (a plain number) used inside the ticket picker.

```jsx
import { Link } from "react-router-dom";

export default function EventCard({ event }) {
  const when = event.dateAndTimeSettings?.formatted?.dateAndTime;
  const where = event.location?.name;
  const isTicketing = event.registration?.type === "TICKETING";
  // lowestPrice is a Money object { value, currency, formattedValue } — render formattedValue,
  // NEVER the raw object (React child crash). Ticket-definition prices use pricing.fixedPrice.amount.
  const fromPrice = event.registration?.tickets?.lowestPrice?.formattedValue;
  const soldOut = event.registration?.tickets?.soldOut;
  return (
    <Link to={`/events/${event.slug}`} /* restyle */>
      {event.mainImage?.url
        ? <img src={event.mainImage.url} alt={event.title} loading="lazy" />
        : <div>{/* placeholder */}</div>}
      <h3>{event.title}</h3>
      {when && <span>{when}</span>}
      {where && <span>{where}</span>}
      {event.shortDescription && <p>{event.shortDescription}</p>}
      {isTicketing && (soldOut ? <span>Sold out</span> : fromPrice && <span>From {fromPrice}</span>)}
    </Link>
  );
}
```

**`pages/Events.jsx`** — the listing (grid + category menu + empty state + load-more). Both
`queryEvents` and `listEventsByCategory` return an **object** `{ events, total, offset, nextOffset }`,
not a bare array — destructure `events` first; `nextOffset` is `null` when there are no more pages.
`queryEventCategories()` returns `{ categories, total }`; render `category.label` (**not** `name` —
the display field is `label`), key/filter by `category.id`, and show `counts.assignedEventsCount`.

```jsx
import { useState, useEffect } from "react";
import { queryEvents, listEventsByCategory, queryEventCategories, countUpcomingEvents } from "@/rest/wix-events-browse";
import EventCard from "@/components/EventCard";

export default function Events() {
  const [events, setEvents] = useState([]);
  const [nextOffset, setNextOffset] = useState(null); // offset for the next page; null when no more
  const [menu, setMenu] = useState([]);               // category menu
  const [active, setActive] = useState(null);         // selected category id, or null for "all"
  const [total, setTotal] = useState(null);

  useEffect(() => {
    countUpcomingEvents().then(setTotal);
    // queryEventCategories returns { categories, total } — destructure the array first.
    queryEventCategories().then(({ categories }) => setMenu(categories));
  }, []);

  useEffect(() => {
    const load = active
      ? listEventsByCategory(active, { limit: 24 })
      : queryEvents({ limit: 24 });
    // Both return an OBJECT { events, total, offset, nextOffset } — not a bare array.
    load.then(({ events, nextOffset }) => { setEvents(events); setNextOffset(nextOffset); });
  }, [active]);

  const loadMore = () => {
    const load = active
      ? listEventsByCategory(active, { limit: 24, offset: nextOffset })
      : queryEvents({ limit: 24, offset: nextOffset });
    load.then(({ events: more, nextOffset: next }) => { setEvents((e) => [...e, ...more]); setNextOffset(next); });
  };

  if (total === 0) return <p>{/* empty state — no events published yet */}</p>;
  return (
    <div /* restyle */>
      <nav>
        <button onClick={() => setActive(null)} aria-pressed={active === null}>All</button>
        {menu.map((c) => (
          // display field is `label`, NOT `name`; key/filter by `category.id`.
          <button key={c.id} onClick={() => setActive(c.id)} aria-pressed={active === c.id}>
            {c.label} ({c.counts?.assignedEventsCount ?? 0})
          </button>
        ))}
      </nav>
      <div /* grid */>{events.map((e) => <EventCard key={e.id} event={e} />)}</div>
      {nextOffset !== null && <button onClick={loadMore}>Load more</button>}
    </div>
  );
}
```

**`pages/EventDetail.jsx`** — the detail page. `getEventBySlug(slug)` returns **null** on miss —
show a not-found state, never invent an event. Branch the registration UI on `registration.type`
and only accept registrations while `registration.status` starts with `OPEN_`. `shortDescription`
is a plain string (safe); the full `event.description` is **Ricos rich content** `{ nodes: [...] }`
— render it with `@wix/ricos` or walk `nodes`; **never** call string methods on it (that crashes
the page).

```jsx
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { getEventBySlug } from "@/rest/wix-events-browse";

export default function EventDetail() {
  const { slug } = useParams();
  const [event, setEvent] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getEventBySlug(slug).then((e) => (e ? setEvent(e) : setNotFound(true))); // null on miss
  }, [slug]);

  if (notFound) return <div>Event not found.</div>;
  if (!event) return <div>Loading…</div>;

  const reg = event.registration ?? {};
  const open = typeof reg.status === "string" && reg.status.startsWith("OPEN_"); // only OPEN_* takes registrations
  return (
    <div /* restyle */>
      {event.mainImage?.url && <img src={event.mainImage.url} alt={event.title} />}
      <h1>{event.title}</h1>
      <p>{event.dateAndTimeSettings?.formatted?.dateAndTime}</p>
      {/* shortDescription is a plain string (safe to render). event.description is Ricos rich
          content { nodes: [...] } — render with @wix/ricos or walk nodes; NEVER call string
          methods (.slice/.substring) on it — that crashes the page. */}
      {event.shortDescription && <p>{event.shortDescription}</p>}

      {reg.type === "RSVP" && (open ? <div>{/* RSVP form — fields from event.form.controls */}</div> : <p>Registration is closed.</p>)}
      {reg.type === "TICKETING" && (open ? <div>{/* ticket picker — see the free-ticket checkout snippet */}</div> : <p>Ticket sales are closed.</p>)}
      {reg.type === "EXTERNAL" && <a href={reg.external?.url}>Register</a>}
      {reg.type === "NONE" && null}
    </div>
  );
}
```

**Free-ticket checkout** — for **free** tickets you may finish in-app instead of redirecting:
reserve, then call `checkoutTickets(eventId, { reservationId, buyer, guests })` with the guest
sub-shape `guests: [{ firstName, lastName, email }]`. It throws for paid orders (telling you to use
`getTicketCheckoutUrl`), so a green path is a real, confirmed order.

```jsx
import { reserveTickets, checkoutTickets, getTicketCheckoutUrl } from "@/rest/wix-events-registration";

// FREE tickets only: reserve, then finish in-app with checkoutTickets — no redirect.
// For ANY paid ticket, redirect instead: window.location.href = getTicketCheckoutUrl(event, reservation.id).
async function claimFreeTicket(event, ticketDefinitionId, buyer /* { firstName, lastName, email } */) {
  const reservation = await reserveTickets([{ ticketDefinitionId, quantity: 1 }]); // { id, expirationDate }
  const order = await checkoutTickets(event.id, {
    reservationId: reservation.id,
    buyer,
    guests: [{ firstName: buyer.firstName, lastName: buyer.lastName, email: buyer.email }],
  });
  return order; // status "FREE"; carries order.ticketsPdf and order.tickets[]. Throws if payment is owed.
}
```

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the events content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For events data those pages are:
- **Events** — `https://manage.wix.com/dashboard/{metaSiteId}/events` (`Dashboard → Events` → **+ Add Event**; create the event, then set it up as **Ticketed** or **RSVP**; only published events appear in the app)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (same visitor identity for reservations)
- [ ] Event grid renders live events; clicking a card opens the detail page by `slug`
- [ ] Detail page branches correctly on `registration.type` (RSVP form vs. ticket picker vs. external link)
- [ ] RSVP submit creates a real RSVP (and surfaces a `WAITLIST` result when the event is full)
- [ ] Ticket purchase reserves tickets, then redirects via `getTicketCheckoutUrl` (no hand-built URL)
- [ ] Paid checkout lands on the Wix-hosted ticket form; buyer returns to the event afterward
- [ ] Closed registration / sold-out tickets show a clear state rather than a dead end
- [ ] Empty state shown when `countUpcomingEvents()` is 0
- [ ] No mock events, tickets, or attendee data anywhere
- [ ] Told the user at least once that they can continue setting up their events in the dashboard and provided deep links.

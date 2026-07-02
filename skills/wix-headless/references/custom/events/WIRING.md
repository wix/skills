---
name: custom-events-wiring
description: "Integration-mode wiring subagent for the events capability. Wires an events listing + per-event detail into a brought-in site, then either sells tickets (reserve → redirect to Wix's hosted checkout) or collects RSVPs (createRsvp), all client-side via @wix/sdk under the visitor identity — no server, no elevation."
---

# Events — integration wiring (own / static)

You wire the **events capability** into a brought-in site (`frontend = "custom"`).
Client-side `@wix/sdk` — CDN imports for `none`-build, bundled for `own`-build
(same calls). Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline".

> **The logic is shared.** The two modes, the reserve→redirect sequence, the RSVP
> call, and the gotchas are in `../../events/FLOW.md` — read it first. The astro
> vertical's React examples (`../../astro/templates/events/*`, incl.
> `eventsDriver.ts`) are the reference implementation; here you run the **same SDK
> calls** through an `OAuthStrategy` visitor client (adapt the React idiom to
> whatever framework the brought-in site uses).

> **Why no server is needed.** The whole flow — `createTicketReservation`,
> `createRedirectSession`, `createRsvp` — is a **site-visitor** operation (the
> Events Checkout scope is granted to anonymous visitors). It runs entirely
> client-side under the `OAuthStrategy` visitor client. There is **no** server
> route and **no** elevation in connect mode (a static/SPA site has no server
> anyway). The redirect call specifically **must** run in this visitor/headless-
> OAuth context — an admin token fails with "client Id does not correspond to a
> headless oauth app."

## Inputs (inlined in your prompt)
- **`appId`** — `OAuthStrategy` `clientId`.
- **Seeded events** — read your `events` slice from `.wix/seeded.json`: `events[{ id, slug, title, type, ticketDefinitionIds[] }]`.
- The site's CSS token names (style additively from them).

## The client (acquire once)
```js
import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1"; // bundled for own-build
import { wixEventsV2, orders, ticketReservations, rsvp } from "https://esm.sh/@wix/events@1";
import { redirects } from "https://esm.sh/@wix/redirects@1";

const wix = createClient({
  modules: { wixEventsV2, orders, ticketReservations, rsvp, redirects },
  auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }),
});
```

## Render events
```js
// Detail by slug — visitor read, no elevation (a SPA has no server to elevate on):
const { event } = await wix.wixEventsV2.getEventBySlug(slug, {
  fields: ["DETAILS", "TEXTS", "REGISTRATION", "URLS"],
});
// event._id · event.slug · event.title · event.shortDescription ·
// event.mainImage?.url · event.dateAndTimeSettings?.formatted?.dateAndTime ·
// event.location?.name · event.registration?.initialType ("TICKETING"|"RSVP")
// (To list events instead: wix.wixEventsV2.queryEvents({ fields }).in("status",
//  ["UPCOMING","STARTED"]).ascending("dateAndTimeSettings.startDate").find() → res.items.
//  There is no customQueryEvents export.)

// Ticket tiers (ticketed) — the VISITOR-PUBLIC storefront read. Do NOT use
// ticketDefinitions.queryTicketDefinitions: it's a management endpoint that 403s
// the visitor (fatal here — there's no server to elevate on). `limit` is required.
const { definitions: tiers } = await wix.orders.queryAvailableTickets({
  filter: { eventId: event._id }, limit: 50,
});
// per tier: t._id · t.name · t.description · t.price.value (string) + t.price.currency ·
//           t.free · t.saleStatus ("SALE_ENDED" ⇒ unavailable) · t.limitPerCheckout
```
Wire these into the brought-in design's existing event markup (a hero, a date/location block, a ticket list). If the design has no registration control, **add the one** the event needs (a ticket picker or an RSVP form), styled from the site's CSS tokens — additive, never a redesign.

## Ticketed checkout (reserve → redirect)
```js
const reservation = await wix.ticketReservations.createTicketReservation({
  tickets: selections.map((s) => ({ ticketDefinitionId: s.ticketDefinitionId, quantity: s.quantity })),
});
const { redirectSession } = await wix.redirects.createRedirectSession({
  eventsCheckout: { reservationId: reservation._id, eventSlug: event.slug },
  callbacks: {
    thankYouPageUrl: `${location.origin}/event-confirmation`,  // or any return page the site has
    postFlowUrl: `${location.origin}/`,
  },
});
window.location.href = redirectSession.fullUrl; // Wix collects guest details + payment, emails the ticket
```
Catch errors; if the message matches `/payment method|not configured|premium/i`, show "ticket sales aren't switched on yet — the organizer needs to connect a payment method" instead of a raw error. Free/RSVP events are unaffected.

## RSVP (free events)
```js
await wix.rsvp.createRsvp({
  eventId: event._id,
  firstName, lastName, email,   // the built-in form fields
  status: "YES",                // "NO" only for YES_AND_NO events
});
// show an inline confirmation
```
The RSVP registration form is built-in (name + email) — add exactly those fields; don't fetch a form schema.

## Payment-method precondition

Completing a **paid** purchase requires the site to have a premium plan + a configured payment method (dashboard). The connection still wires correctly without it — reservations just can't be paid until it's set up. Note this to the user; free/RSVP events need neither.

## Out of scope
Assigned seating / seat maps; coupons & gift cards (Wix's hosted checkout handles those); on-site order management / cancel / refund (handled by the hosted flow + the buyer's email); manual `orders.checkout` inline payment (use the hosted redirect).

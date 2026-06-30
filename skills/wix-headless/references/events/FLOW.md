# Events — the flow (framework-agnostic)

The events **logic** — the step model, the SDK sequence for ticketed checkout, the RSVP path, the identity model, and the gotchas — independent of astro vs own/static. The astro guides (`../astro/events/*`) are the astro *wiring* of this logic; the React reference code lives at `<SKILL_ROOT>/references/astro/templates/events/` (`eventsDriver.ts` is the canonical sequence). For an own/static build the wiring guide is `../custom/events/WIRING.md` — **same calls**, through an `OAuthStrategy` visitor client.

> **The whole flow is a site-visitor operation.** Reserving tickets, minting the checkout redirect, and creating an RSVP all run under the **anonymous visitor** identity (the Events Checkout scope is granted to visitors). **No server route, no `auth.elevate()`** — this is the same client-side model as the bookings pack. (If you find yourself reaching for a `src/pages/api/*` endpoint or elevation to make a reservation work, stop — that masks the real gate, which is the payment-method precondition below.)

## 1 · Two modes (per event, from the seeded `type`)

- **`TICKETING`** — the event has ticket definitions. The visitor picks a tier + quantity, you **reserve** the tickets, then **redirect to Wix's hosted checkout** (which collects guest details + payment and emails each guest a PDF ticket with a check-in QR). You never collect payment yourself.
- **`RSVP`** — free event. The visitor fills the **built-in registration form** (name + email) and you call **`createRsvp`** directly; confirmation is shown inline. No reservation, no redirect, no payment.

Read each event's `type` from its `.wix/seeded.json` slice (`seeded.events.events[N].type`). A site may mix both.

## 2 · Ticketed checkout — the SDK sequence (`eventsDriver.ts`)

Two steps, both as the visitor:

1. **Reserve** the selected tickets:
   ```ts
   import { ticketReservations } from "@wix/events";
   const reservation = await ticketReservations.createTicketReservation({
     tickets: selections.map((s) => ({ ticketDefinitionId: s.ticketDefinitionId, quantity: s.quantity })),
   });
   const reservationId = reservation._id;            // PENDING; auto-expires in ~20 min
   ```
   `selections` is one entry per chosen tier with `quantity ≥ 1`. The reservation holds the tickets (deducted from inventory) so no one else can buy them while the visitor checks out.

2. **Redirect** to Wix's hosted checkout via the Redirects API:
   ```ts
   import { redirects } from "@wix/redirects";
   const { redirectSession } = await redirects.createRedirectSession({
     eventsCheckout: { reservationId, eventSlug },          // eventSlug from the seeded event
     callbacks: {
       thankYouPageUrl: `${origin}/event-confirmation`,     // Wix appends ?orderNumber=&eventId=
       postFlowUrl: `${origin}/events/${eventSlug}`,         // back to the event on abandon
     },
   });
   window.location.href = redirectSession.fullUrl;          // hand off to Wix
   ```
   Wix's hosted page collects the guest form + payment, emails the ticket, and returns the visitor to `thankYouPageUrl` with `?orderNumber=…&eventId=…`.

> **Why the Redirects API and not a URL.** A headless site has **no Wix-hosted event page** — `{base}/event-details/{slug}/ticket-form?reservationId=…` returns **404**. The Redirects API mints a checkout URL on Wix's own domain; it's the only path that works headless.

> **The redirect call must run in the VISITOR (headless-OAuth) context — never elevated/admin.** `createRedirectSession` embeds the headless app's `clientId`; an admin/elevated token fails with *"client Id does not correspond to a headless oauth app."* On astro this means the **browser island** calls it (ambient visitor client), not a server endpoint. On own/static it's the `OAuthStrategy` client. Don't elevate it.

## 3 · RSVP — the SDK call

```ts
import { rsvp } from "@wix/events";
await rsvp.createRsvp({
  eventId,
  firstName, lastName, email,    // the built-in form fields
  status: "YES",                 // "YES_AND_NO" events also accept "NO"
});
```
Then show an inline confirmation (no redirect). Wrap in try/catch and surface a friendly message; a duplicate email or closed registration rejects.

## 4 · The payment-method precondition (paid tickets)

Reserving a **paid** ticket as a visitor fails with **`403 "No payment method configured"`** until the site has a premium plan **and** a configured payment method (dashboard). This is the real gate — *not* a permissions problem, and **not** something elevation should paper over (elevating creates an unpayable `INITIATED` order instead). Handle it gracefully:
- Catch the reservation error; if it reads `No payment method configured` (or a payments-setup error), show: *"Ticket sales aren't switched on yet — the organizer needs to connect a payment method."* rather than a raw error.
- **Free / RSVP events are unaffected** — no premium, no payment method needed.
- The seed step already flags this in the run summary; the frontend just needs to fail soft.

## 5 · Identity (per build class)

- **Astro (managed):** components call the `@wix` modules **ambiently** — the `@wix/astro` visitor client authenticates automatically. No `createClient`, no `OAuthStrategy`, no `clientId` in app code. SSR reads (the events listing + detail) use the ambient client too; guard them in try/catch.
- **Own / static (connect):** build one `OAuthStrategy` visitor client with `clientId = appId` and call the same modules through it. (`../custom/events/WIRING.md`.)

## 6 · Listing & detail reads

- **List events:** `import { wixEventsV2 } from "@wix/events"` (or the events query module) → query events filtered to upcoming/published, ordered by start date. Read `title`, `slug` (`event.slug`), `dateAndTimeSettings.formatted`, `location`, `shortDescription`, `mainImage`.
- **One event by slug:** query with the slug filter (`.eq("slug", slug)`), then read its ticket definitions (`ticketDefinitions.queryTicketDefinitions({ filter: { eventId } })`) for the tier list + prices. Entity ids are `_id`; price is `pricingMethod.fixedPrice.value` (a string).
- Single-event sites: the listing collapses to the one event — lead the home page straight into its detail.

## 7 · Out of scope

- **Assigned seating / seat maps** — display + reserve only flat ticket definitions; no seat-map UI.
- **Coupons / gift cards at checkout** — Wix's hosted checkout handles those; don't build a discount UI.
- **Order management / cancel / refund** — handled by the Wix-hosted flow + the buyer's email; no on-site manage screen.
- **Manual `orders.checkout` (inline payment)** — that path is for pay-in-person / custom checkout and leaves orders unpaid without a payment integration. The hosted redirect is the supported headless completion.

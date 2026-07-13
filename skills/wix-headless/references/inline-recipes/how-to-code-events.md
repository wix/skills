---
name: "How to Code Events"
description: The frontend read/registration contract for a Wix Events (Events V3) site — which SDK modules to import, how to list upcoming events, read one by slug, list ticket tiers, and run the two registration paths (ticketed = reserve → redirect to Wix's hosted checkout; free = createRsvp). Specifies the *how* (modules + exact calls + the failure modes the docs omit); which events to render and how the page looks come from the request.
---
**RECIPE**: How to Code a Wix Events Frontend (Events V3 + hosted-checkout redirect)

A concise contract for writing the **frontend code** of an events site: a listing, per-event detail pages, ticketed checkout (reserve the tickets, then redirect to Wix's hosted checkout), and free RSVP registration. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which events to show, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the registration flow, not for seeding it.** It assumes an Events V3 backend already exists (published events with future dates, ticket definitions for ticketed events). It says nothing about creating events — only how to read and register for them from frontend code.

> **The whole flow is a site-visitor operation — no server route, no elevation.** Reserving tickets, minting the checkout redirect, and creating an RSVP all run under the **anonymous visitor** identity (the Events Checkout scope is granted to visitors), the same client-side model as the bookings pack. If you reach for a `src/pages/api/*` route or `auth.elevate()` to make a reservation work, **stop** — that masks the real gate (the payment-method precondition below) and the redirect call actively **fails** when elevated.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the most common source of the `event.id`-is-`undefined` bug. If a field name surprises you, you're probably reading the REST view — re-open it with `?apiView=SDK`. Discover any shape not pinned here with `SearchWixSDKDocumentation`, not by guessing a URL.

---

## The modules and the client (read this first)

No app-id constant is needed in frontend code — the only id the client needs is the public **`clientId`** (non-Astro only; see below). Ticketed checkout hands off to Wix's hosted checkout via the Redirects API, so there is **no on-site cart and no `catalogReference`**.

| Need | Package | Module |
|---|---|---|
| List events / get one by slug | `@wix/events` | `wixEventsV2` (`queryEvents`, `getEventBySlug`) |
| Ticket tiers (ticketed) | `@wix/events` | `orders` (`queryAvailableTickets`) — the visitor-public storefront read |
| Reserve tickets (ticketed) | `@wix/events` | `ticketReservations` (`createTicketReservation`) |
| Create an RSVP (free) | `@wix/events` | **`rsvpV2`** (`createRsvp`) — NOT the legacy `rsvp` module (v1 → 400) |
| Redirect to hosted checkout (ticketed) | `@wix/redirects` | `redirects` (`createRedirectSession`) |

- **The events query/get namespace is `wixEventsV2`** (despite the name, this is the current Events V3 module from `@wix/events`). Import `wixEventsV2`, `orders`, `ticketReservations`, `rsvpV2` from `@wix/events`.
- **⚠️ CRITICAL: read ticket tiers with `orders.queryAvailableTickets`, NOT `ticketDefinitions(V2).queryTicketDefinitions`.** The `ticketDefinitions*` namespaces are the **management** API (`TicketDefinitionManagement`, a manage scope) — the **anonymous visitor is `403`-denied** on every one of them (`queryTicketDefinitions`, `queryTicketDefinitionsV2`, `listTicketDefinitions`), so a storefront that reads tiers that way gets an empty picker. **Do NOT work around it with `auth.elevate()`** — that's the wrong axis (an app/admin permission elevation), it's SSR-only (useless on a non-Astro SPA), and it's unnecessary: the **visitor-public storefront read** is `orders.queryAvailableTickets({ filter: { eventId }, limit })` → `{ definitions }` (visitor-public — works for the anonymous visitor on Astro *and* SPA). The event read (`queryEvents`/`getEventBySlug`) is visitor-public too — **no elevation anywhere in this recipe.**
- **Never use the deprecated `orders.createReservation`** — reserve with `ticketReservations.createTicketReservation`.
- **Never complete a paid purchase with `orders.checkout` (inline payment)** — that path leaves orders unpaid without a payment integration. The supported headless completion is the **hosted redirect** (below).

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call the modules directly — from server components for the SSR reads (listing/detail) and from browser islands for the visitor-session writes (reserve / redirect / rsvp) via the `@wix/astro` visitor client — **no `createClient`, no `OAuthStrategy`, no `clientId`.** Nothing here needs elevation (every read and write runs as the visitor — "no elevation anywhere"); a public-env `clientId` read in `.astro` SSR is `undefined` at server render → 500, so don't build an `OAuthStrategy` client there.
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { wixEventsV2, orders, ticketReservations, rsvpV2 } from '@wix/events';
  import { redirects } from '@wix/redirects';

  const client = createClient({
    modules: { wixEventsV2, orders, ticketReservations, rsvpV2, redirects },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  ```
  The `clientId` is public, not a secret. A mis-wired public env var inlines as `undefined` and 400s every call.

---

## The shapes you read (field cheat-sheet)

```jsonc
// wixEventsV2.getEventBySlug(slug, { fields: [...] })  →  { event }
// wixEventsV2.queryEvents(...)                          →  result.events[]
event = {
  _id,                                                  // routes · reserve/rsvp bind to it   (NOT .id → undefined)
  slug,                                                 // the URL slug — checkout redirect needs it
  title, shortDescription,
  mainImage,                                            // image ref (render via the media helper)
  dateAndTimeSettings: { formatted: { dateAndTime } },  // human-formatted date string
  location: { name, type },                             // "VENUE" | "ONLINE" | TBD
  registration: { initialType },                        // "TICKETING" | "RSVP" — BRANCH on this
  // categories?: { categories: [{ _id, name }] }        // runtime shape when fields:['CATEGORIES'] is requested — but NOT on the typed Event (SDK gap): read via a cast, see below
}

// orders.queryAvailableTickets({ filter: { eventId }, limit })  →  { definitions }   (VISITOR-public)
tier = {
  _id,                                                  // reserve by this   (NOT .id)
  name, description,
  price: { value, currency },                           // value is a STRING (e.g. "45.00"); also at pricing.fixedPrice.value
  free,                                                 // boolean
  saleStatus,                                           // "SALE_STARTED" | "SALE_ENDED" | "SALE_SCHEDULED" — gate the picker on this
  limitPerCheckout,                                     // max qty per order for this tier
}
```

**⚠️ CRITICAL: entity ids are `_id`, NOT `id`.** `event._id`, `tier._id`. `event.id` is `undefined` in SDK code — a surprise `id`/`undefined` means you're reading the REST doc view; re-open it with `?apiView=SDK`.

**Filtering by event format/track (talk/workshop/social)** — if the site groups events by a format, the seed models it as **Event Categories** (`setup-events.md` STEP 4). Read the assigned category off the event and filter **client-side** — two gotchas:
- **Request `CATEGORIES` as the 2nd positional arg**, not inside the flat query: `queryEvents({ filter, sort, paging }, { fields: ['CATEGORIES'] })` and `getEventBySlug(slug, { fields: ['CATEGORIES'] })`. (`fields` lives on the options arg, not on `EventQuery`.)
- **`categories` is NOT on the typed `Event` (an SDK type gap** — the `CATEGORIES` enum and `EventCategory`/`EventCategories` types ship, but `Event` omits the property, so a direct `event.categories` read fails `tsc`/`astro check`). **Read it through a cast:** `const cats = (event as any).categories?.categories ?? []` — each entry is `{ _id, name }`; map `cats[].name` → your format enum.
- **Do NOT call the management categories endpoints** (`/events/v1/categories*`, `listEventsByCategory`) from the frontend — they're admin-scope; the visitor read is just the cast `CATEGORIES` field on the event.

---

## The registration features (build the ones the site needs)

Each section is a **self-contained feature** — implement only what the site uses. **Branch on the event's `registration.initialType`:** `TICKETING` → ticket picker (tiers + quantities → reserve → redirect); `RSVP` → the built-in name+email form → `createRsvp`. Never render an RSVP event with a ticket picker (or a ticketed event with an RSVP form).

### Listing events (upcoming only, and the `_id` rule)

```js
const { events } = await wixEventsV2.queryEvents({
  filter: { status: { $in: ['UPCOMING', 'STARTED'] } },     // exclude DRAFT / ENDED / CANCELED
  sort: [{ fieldName: 'dateAndTimeSettings.startDate', order: 'ASC' }],
  paging: { limit: 100 },                                   // ⚠️ MUST be > 0
});                                                          // → result.events[]
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md?apiView=SDK>

- **⚠️ CRITICAL: `queryEvents` takes the query object FLAT as its first arg — `queryEvents({ filter, sort, paging })`, NOT `queryEvents({ query: { … } })`.** The signature is `queryEvents(query, options)` where `query` *is* `{ filter, sort, paging }`. Wrapping it in an extra `{ query: … }` (the REST body shape, and the `.queryServices({ query })` builder shape from other verticals) is **not** rejected — the SDK silently ignores the unrecognized `query` key, so `paging` never applies, `limit` defaults to **0**, and you get **`events: []` with no error**. This is the #1 "my listing is empty even though events are published" trap. (The flat form returns the events; the nested form returns zero.)
- **⚠️ `paging.limit` MUST be > 0.** Even with the flat shape, `queryEvents` defaults `paging.limit` to **`0`, which returns zero events**. Always set a positive limit.
- The result array is **`result.events`** (not `.items`).
- **Filter to upcoming/published and never list or link a past event** — a past event isn't purchasable/registerable (the seed uses future dates). Filter by `status` (above) or by a future `startDate`.
- Read `event._id` / `event.slug` / `event.title`. A **single-event** site collapses the listing — lead the home page straight into the one event's detail. **Still drive that homepage from the listing query** (take the first/only result), never a hardcoded lone slug — so a second event the owner adds later automatically brings the listing back instead of staying invisible.

### One event by slug + its ticket tiers

```js
const { event } = await wixEventsV2.getEventBySlug(slug, {
  fields: ['DETAILS', 'TEXTS', 'REGISTRATION', 'URLS'],   // REGISTRATION carries initialType — you branch on it
});

// ticketed only — list the tiers (VISITOR-public; NOT ticketDefinitions* — those 403 the visitor):
const { definitions: tiers } = await orders.queryAvailableTickets({
  filter: { eventId: event._id }, limit: 20,
});
```
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/query-available-tickets.md?apiView=SDK>

- **Request `REGISTRATION` in `fields`** so `event.registration.initialType` is populated — that's the value you branch on.
- Per tier read `tier._id`, `tier.name`, `tier.price.value` (a **string**) + `tier.price.currency`, `tier.free`, and `tier.saleStatus` (gate the picker on `SALE_STARTED`).
- **⚠️ The confirmation page (post-checkout) reads the event by ID, and the return envelope DIFFERS from `getEventBySlug`.** After the hosted checkout redirects back to your `postFlowUrl` (carrying `?eventId=…`), look the event up with **`wixEventsV2.getEvent(eventId, { fields: ['TEXTS', 'URLS'] })`** — this returns the **`Event` object DIRECTLY (unwrapped)**: read `event.title` / `event.slug`, **not** `{ event }`. This is the one read that isn't wrapped (`getEventBySlug` *is* `{ event }`); assume the wrapper and the page crashes. Use this exact call — don't inspect the installed `.d.ts` to rediscover it.

### Ticketed checkout — reserve → redirect (the exact sequence)

Two steps, both as the visitor. **Use as-is — the payload shapes are easy to get subtly wrong.**

```js
// 1 · Reserve the selected tiers (PENDING; auto-expires after the event's reservation window).
const reservation = await ticketReservations.createTicketReservation({
  tickets: selections           // one entry per chosen tier, quantity ≥ 1
    .filter((s) => s.quantity > 0)
    .map((s) => ({ ticketDefinitionId: s.ticketDefinitionId, quantity: s.quantity })),
});
const reservationId = reservation._id;          // ⚠️ _id, not id

// 2 · Mint the hosted-checkout redirect and hand off.
const origin = window.location.origin;          // ⚠️ the published https:// host — see below
const { redirectSession } = await redirects.createRedirectSession({
  eventsCheckout: { reservationId, eventSlug: event.slug },
  callbacks: {
    thankYouPageUrl: `${origin}/event-confirmation`,   // Wix appends ?orderNumber=&eventId=
    postFlowUrl:     `${origin}/events/${event.slug}`,  // back to the event on abandon
  },
});
window.location.href = redirectSession.fullUrl;  // Wix collects guest details + payment, emails the PDF/QR ticket
```
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md?apiView=SDK>

- **⚠️ CRITICAL: don't hand-build the checkout URL.** `{base}/event-details/{slug}/ticket-form?reservationId=…` **404s on a headless site** (there's no Wix-hosted event page). The Redirects API mints a checkout URL on Wix's own domain — `eventsCheckout: { reservationId, eventSlug }` → `redirectSession.fullUrl` is the **only** path that works headless.
- **⚠️ CRITICAL: the redirect call must run in the VISITOR (headless-OAuth) context — never elevated/admin.** `createRedirectSession` embeds the headless app's `clientId`; an admin/elevated token fails with *"client Id does not correspond to a headless oauth app."* On Astro the **browser island** calls it (ambient visitor client), never a server endpoint; on non-Astro it's the `OAuthStrategy` client. Don't elevate it.
- **⚠️ CRITICAL: `origin` MUST be the published `https://` host — from `window.location.origin`, never a server-derived `new URL(request.url).origin`.** The Headless redirect allowlist registers the `https://` host and treats `http://<same host>` as a different, unlisted origin; an `http://` `postFlowUrl` makes the return ("Continue Browsing") **403** with *"… isn't listed as an allowed redirect domain."* Pass `window.location.origin` from the client. Doc: <https://dev.wix.com/docs/go-headless/getting-started/setup/manage-urls/add-allowed-redirect-domains>.
- **⚠️ Handle the paid-ticket precondition softly.** Reserving a **paid** ticket as a visitor fails with **`403 "No payment method configured"`** until the site has a premium plan **and** a configured payment method (a dashboard step the seed already flagged). This is the **real gate** — not a permissions bug, and **not** something elevation should paper over (elevating just creates an unpayable `INITIATED` order). Catch the error; if its message matches `/payment method|not configured|premium/i`, show *"Ticket sales aren't switched on yet — the organizer needs to connect a payment method."* Free / RSVP events are unaffected.
- Wrap both calls in try/catch (sold out, sale ended, no payment method) and surface a friendly message; don't crash the page.

### Free RSVP — the built-in form

```js
await rsvpV2.createRsvp({
  eventId: event._id,
  firstName, lastName, email,    // the built-in form fields — collect EXACTLY these
  status: 'YES',                 // 'NO' only for YES_AND_NO events
});
// then show an inline confirmation — no reservation, no redirect, no payment
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md?apiView=SDK>

- **⚠️ CRITICAL: use the `rsvpV2` module, NOT `rsvp`.** The legacy `rsvp.createRsvp` posts to `/events/v1/rsvp` and **400s** with `"rsvp.firstName/lastName/email must not be empty"` even when you pass those fields — that v1 surface expects a different form-response body. Import **`rsvpV2`** from `@wix/events` and call `rsvpV2.createRsvp(rsvp)` with the rsvp object **directly as the first arg** (not wrapped in `{ rsvp: … }`, which is the elevated/`@wix/essentials` style). The flat `{ eventId, firstName, lastName, email, status }` object is correct for `rsvpV2` and **works for the anonymous visitor**.
- **The RSVP registration form is built-in** (firstName, lastName, email) — add exactly those fields; **don't fetch a form schema** or hand-build extra fields.
- Wrap in try/catch — a duplicate email or closed registration rejects; surface a friendly message.

### Rendering & mounting

- **Date**: `event.dateAndTimeSettings.formatted.dateAndTime` (already human-formatted) — request the `DETAILS` field to populate it.
- **Image**: `event.mainImage` is a Wix media ref — render it via the media helper (`@wix/sdk` `media.getScaledToFillImageUrl` / `getImageUrl`); **never** hand-build a `static.wixstatic.com` URL (→ 403).
- **Price**: `tier.price.value` (string) + `tier.price.currency` (the event's stored currency — format from it, don't assume USD).
- **Mount the ticket picker / RSVP form in a `client:only="react"` island** (Astro) — they run visitor-session SDK calls and redirect. **SSR only the read pages** (listing/detail) for SEO.

### SEO on item pages (Astro, Wix-managed)

An **event detail** page is a Wix **item page**: its `<title>`/description/OG/canonical come from what the owner sets in the dashboard. On the Astro (Wix-managed) frontend, wire it per the canonical guide — **[Add SEO Support to Item Pages](https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md)** — which covers the three steps: export `wixMetadata` (registers the route → sitemap + dashboard SEO editor), call `loadSEOTagsServiceConfig(...)`, and render `<SEO.Tags>` (from `@wix/seo`; deps + `@wix/essentials ≥ 1.0.10` are in the guide's "Before you begin").

For an event page use:
- **`wixMetadata`** from `WIX_APPS.events.eventPageMetadata` — referenced **directly** in the export (module scope). Route param `slug` → `identifiers.slug`.
- **`itemType`**: `seoTags.ItemType.EVENTS_PAGE`.

Fold `loadSEOTagsServiceConfig` into the same `Promise.all` as the ambient `getEventBySlug` read, with `.catch(() => null)` (it needs only the slug — still a visitor-safe ambient call), so a SEO hiccup falls back to the layout's default title. Optional: render an `Event` schema.org JSON-LD `<script>` from the fetched event (see the guide's structured-data step).

### Out of scope
Assigned seating / seat maps (display + reserve flat ticket definitions only); coupons & gift cards at checkout (Wix's hosted checkout handles those — don't build a discount UI); on-site order management / cancel / refund (handled by the hosted flow + the buyer's email); manual `orders.checkout` inline payment (use the hosted redirect).

---

## Conclusion
A correct Events V3 registration frontend:
- imports **`wixEventsV2` / `orders` / `ticketReservations` / `rsvpV2`** from `@wix/events` plus **`redirects`** from `@wix/redirects` — and never inline `orders.checkout` or the legacy `rsvp` (v1 → 400) module;
- uses **`event._id` / `tier._id`** (never `.id`) and reads the flat fields (`event.slug`, `registration.initialType`, `tier.price.value`);
- lists with **`queryEvents({ filter, sort, paging })` FLAT** (never `{ query: { … } }` — that silently returns `events: []`) and **`paging.limit > 0`**, filtered to **upcoming/published** events, never past ones;
- reads ticket tiers with the **visitor-public `orders.queryAvailableTickets({ filter: { eventId }, limit })`** (→ `definitions`) — **never** the management `ticketDefinitions*` query (visitor 403s) and **never** `auth.elevate()` (wrong axis, SSR-only); no elevation anywhere;
- **branches on `registration.initialType`**: `TICKETING` → reserve (`createTicketReservation` → `reservation._id`) → **`createRedirectSession({ eventsCheckout })`** → `redirectSession.fullUrl`; `RSVP` → **`rsvpV2.createRsvp`** with the built-in firstName/lastName/email and an inline confirmation;
- runs the reserve/redirect/rsvp **client-side as the visitor** (no server route, no elevation), uses `window.location.origin` (the `https://` host) for the callbacks, and **fails soft** on the `403 "No payment method configured"` paid-ticket precondition.

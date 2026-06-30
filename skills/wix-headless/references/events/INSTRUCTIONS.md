---
name: events-implementer
description: "Implements the Wix Events vertical — an events listing, per-event detail pages with ticket tiers (ticketed) or a built-in RSVP form (free), ticketed checkout that reserves tickets then redirects to Wix's hosted checkout, and a confirmation page. Runs client-side via the @wix SDK under the visitor identity — no server route, no elevation. Scopes: seed, components, pages. Extends references/shared/IMPLEMENTER.md."
---

# Events Implementer

Extends `references/shared/IMPLEMENTER.md`. Read that file first for phase routing, REST auth + doc lookups, the `.wix/seeded.json` read pattern, the return contract, style conventions, and common failure modes.

## The logic lives in one place

The events **logic** — the two modes (ticketed vs RSVP), the reserve→redirect sequence, the RSVP call, the identity model, and the gotchas — is framework-agnostic and lives in **`./FLOW.md`**. Read it first. The astro guides below are the astro *wiring* of that logic; the React code under `<SKILL_ROOT>/references/astro/templates/events/` is the reference the islands use directly. For an own/static build, the wiring guide is `../custom/events/WIRING.md` (same logic, client-side `@wix/sdk`).

## Scope routing

| Scope | Phase | Reference |
|-------|-------|-----------|
| `seed` | Seed — create event(s) + ticket definitions (ticketed) and publish, via the Wix Events REST API | `./EVENTS_DATA.md` |
| `components` | Components — the client islands (ticket picker, RSVP form) | `./FLOW.md` + `../astro/events/COMPONENTS.md` |
| `pages` | Pages — `/events` listing, `/events/[slug]` detail, `/event-confirmation`, + nav/home links | `./FLOW.md` + `../astro/events/EVENTS_PAGES.md` |

## Templates — read and adapt (don't invent)

Canonical examples live at `<SKILL_ROOT>/references/astro/templates/events/`.
Your `components` and `pages` scopes **read these and adapt them** — adapt brand
copy, headings, and styling; keep the SDK calls, payload shapes, and the data
flow (re-authoring the SDK wiring from scratch is the main source of API-shape bugs).

Components (`components` scope — TSX only, no CSS):
- `<SKILL_ROOT>/references/astro/templates/events/TicketPicker.tsx` — per-tier quantity picker that calls `eventsDriver.buyTickets()` (reserve → redirect).
- `<SKILL_ROOT>/references/astro/templates/events/RsvpForm.tsx` — the built-in name+email RSVP form that calls `eventsDriver.rsvp()`.

Pages (`pages` scope):
- `<SKILL_ROOT>/references/astro/templates/events/EventCard.astro`
- `<SKILL_ROOT>/references/astro/templates/events/events/index.astro`, `<SKILL_ROOT>/references/astro/templates/events/events/[slug].astro`
- `<SKILL_ROOT>/references/astro/templates/events/event-confirmation.astro`

### Pre-copied by the orchestrator (do NOT write these yourself)
Mechanical, brand-agnostic — the orchestrator copies them before dispatch (BUILD-astro.md § build wave). Rely on them at the listed paths:
- `src/components/eventsDriver.ts` ← `<SKILL_ROOT>/references/astro/templates/events/eventsDriver.ts` — the reserve→redirect sequence (`buyTickets()`) + `rsvp()`. The islands import it; never re-author it.
- `src/styles/components-events.css` ← `<SKILL_ROOT>/references/astro/templates/events/components-events.css` — the pack's component classes.

If a pre-copied file is missing at runtime, that's an orchestrator-side bug — return `status: "partial"` with `errors: [{code: "UTILITY_TEMPLATE_NOT_PRECOPIED", path: "<missing>"}]`; do not author your own version.

## Pre-return file-existence assertion (pages scope)

Before returning `status: "complete"` from `pages`, verify on disk:
- `src/pages/events/index.astro`
- `src/pages/events/[slug].astro`
- `src/pages/event-confirmation.astro`

If any declared file is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected path>" }]`.

## Dependencies (Setup installs these — see SETUP.md)

`@wix/events @wix/redirects @wix/essentials`.
`@wix/events` provides `ticketReservations`, `rsvp`, and the events/ticket-definitions query modules; `@wix/redirects` mints the hosted-checkout redirect; `@wix/essentials` is the ambient SSR client for the listing/detail reads.

## CSS ownership — events pack

Events-specific CSS lives in `src/styles/components-events.css` (pre-copied — see above), NOT in `global.css`. Classes the pack owns: `.event-card*`, `.event-grid`, `.event-detail*`, `.ticket-tier*`, `.ticket-picker*`, `.rsvp-*`, `.event-confirmation*`. If `global.css` ships a partial rule for any of these, flag it (`{code:"GLOBAL_CSS_LEAK", class:"<name>"}`) and override in `components-events.css`.

## Events-specific failure modes

| Wrong | Right |
|-------|-------|
| Run reservation/checkout in a `src/pages/api/*` server route with `auth.elevate()` | The whole flow is **visitor-scoped** — call `ticketReservations.createTicketReservation` + `redirects.createRedirectSession` **client-side** (astro: ambient island; own/static: `OAuthStrategy`). No server route, no elevation. Elevating masks the real gate (payment method) and creates unpayable `INITIATED` orders. |
| Elevate the redirect-session call (or call it with an admin token) | `createRedirectSession` needs the **headless-OAuth visitor context** (it embeds `clientId`). An admin/elevated token fails with *"client Id does not correspond to a headless oauth app."* Call it as the visitor. |
| Build the hosted-checkout URL by hand: `{base}/event-details/{slug}/ticket-form?reservationId=…` | That **404s on a headless site** (no Wix-hosted event page). Use `redirects.createRedirectSession({ eventsCheckout: { reservationId, eventSlug } })` and redirect to `redirectSession.fullUrl`. |
| Treat a `403 "No payment method configured"` reservation error as a bug to elevate around | It's the **paid-ticket precondition**: the site needs premium + a payment method (dashboard). Fail **soft** with a friendly "ticket sales aren't switched on yet" message. Free/RSVP events are unaffected. Never imply tickets are payable when they aren't. |
| Complete a paid purchase with `orders.checkout` (inline) | That path is for pay-in-person/custom checkout and leaves orders unpaid without a payment integration. The supported headless completion is the **hosted redirect**. |
| Use the deprecated `orders.createReservation` | Use **`ticketReservations.createTicketReservation({ tickets: [{ ticketDefinitionId, quantity }] })`** → `reservation._id`. |
| Render an RSVP event with a ticket picker (or a ticketed event with an RSVP form) | Branch on the seeded `type`. `TICKETING` → `TicketPicker` (tiers + quantities → reserve→redirect). `RSVP` → `RsvpForm` (built-in name+email → `rsvp.createRsvp`, inline confirmation). |
| Hand-build RSVP form fields | The RSVP registration form is **built-in** (firstName, lastName, email). Collect exactly those and call `createRsvp({ eventId, firstName, lastName, email, status: "YES" })`. |
| Read `event.id` / ticket `id` / `event.title` from the wrong shape | Entity ids are `_id`. Event: `event._id`, `event.slug`, `event.title`, `event.shortDescription`, `event.dateAndTimeSettings.formatted.dateAndTime`, `event.location`, `event.mainImage`. Ticket def: `def._id`, `def.name`, `def.pricingMethod.fixedPrice.value` (string), `def.salesDetails.soldOut`. |
| Mount the ticket picker / RSVP form without `client:only="react"` | They run visitor-session SDK calls and redirect — always `client:only="react"`. SSR only the read pages (listing/detail) for SEO. |
| Omit try/catch on reserve / redirect / rsvp | Reservations can fail (sold out, sale ended, no payment method); redirects/rsvp can reject. Catch and surface a friendly message; don't crash the page. |
| List or link past events | Filter the listing to upcoming/published events; seed uses future dates. A past event isn't purchasable. |

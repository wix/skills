---
name: events
description: "Events & ticketing — an events listing, per-event detail pages, ticketed checkout (reserve → Wix's hosted secure checkout) and free RSVP registration via Wix Events."
triggers: ["event", "events", "ticket", "tickets", "concert", "festival", "conference", "meetup", "workshop", "gala", "fundraiser", "screening", "gig", "show", "summit", "webinar", "rsvp", "registration", "attendees"]
requires: []   # ticketed checkout hands off to Wix's hosted checkout via the Redirects API (no on-site cart) — same model as bookings, so no `ecom` co-load.

features:
  - name: "Events listing"
    description: "Browse upcoming events with date, location, and a short description. (Single-event sites lead straight to the event's detail page.)"
  - name: "Event details & registration"
    description: "Each event has its own page with the full details and a way to register — buy tickets (ticketed events) or RSVP (free events)."
  - name: "Ticket sales"
    description: "Ticketed events show their ticket types and prices; checkout hands off to Wix's secure hosted checkout, which emails each guest a PDF ticket with a check-in QR code."
  - name: "Free RSVP"
    description: "Free events use the built-in registration form (name + email) — guests confirm attendance and get a confirmation, no payment."

apps:
  - name: "Wix Events"
    appDefId: "140603ad-af8d-84a5-2c80-a0f60cb47351"

routes:
  - route: "/events"
  - route: "/events/[slug]"
    name: "Event Detail"
  - route: "/event-confirmation"
    name: "Event Confirmation"
  - route: "Hosted by Wix"
    name: "Secure Checkout"

disabled: false
---

# Events Pack

Loaded when the user's prompt implies selling tickets to, or collecting RSVPs for, an event — a concert, conference, meetup, fundraiser, workshop, screening, or a single occasion people respond to.

Two modes, chosen per event from `intent.events.eventType`:
- **`TICKETING`** — paid tickets. Reserve the selected tickets, then redirect to Wix's hosted checkout (guest form + payment + PDF/QR ticket email). Selling paid tickets requires a premium plan + a configured payment method (a dashboard step — see the seed recipe's precondition note).
- **`RSVP`** — free events. The built-in registration form (name + email, can't be removed) confirms attendance directly; no payment, no premium required.

> **Discovery contract.** Phase 1 reads only the frontmatter above to compose the plan's Pages table. Phase 2+ implementation (seeding, page composition, theming) lives in this skill's own `references/astro/templates/events/` + `references/events/INSTRUCTIONS.md`.
>
> - Seed recipe: `<SKILL_ROOT>/references/events/EVENTS_DATA.md` (event + ticket-definition creation and publish via the Wix Events REST API).
>
> The whole reserve → checkout flow is a **site-visitor** operation (the Events Checkout scope is granted to anonymous visitors), so it runs client-side under the visitor client — no server route, no elevation. Same shape as the bookings pack.

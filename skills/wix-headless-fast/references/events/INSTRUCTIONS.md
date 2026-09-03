# Events — playbook

The events machinery ships as files — event reads (list, by slug, by id), the visitor-public
ticket-tier read, the exact `reserve → hosted-checkout redirect` sequence, and RSVP, typed
end-to-end. **The presentation is yours**: you design and implement the event card, the
events index, and the event page's registration surface on the shipped hooks/DTOs, plus the
home page and the brand. You never write registration logic; you never skip designing.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/events/types.ts` | the DTOs (`EventSummary`, `EventDetail`, `TicketTier`, `RegistrationResult`) — contracts below |
| `wix/events/events.ts` | `fetchEvents`, `fetchEventBySlug`, `fetchEventById` (post-checkout confirmation read) |
| `wix/events/registration.ts` | `fetchTicketTiers`, `startTicketCheckout`, `submitRsvp` — the exact reserve→redirect sequence lives here |
| `hooks/events/useEvents.ts` | listing + category filter — contract below |
| `hooks/events/useEventRegistration.ts` | the whole registration state machine — contract below |
| `components/events/EventsView.tsx` (+ `EventCard`) · `EventRegistrationView.tsx` · `EventConfirmationView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add an Events nav link there |
| `pages/events.astro` | SSR listing — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/events/[slug].astro` | SSR detail + registration with owner-editable SEO — **keep the frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; swap the island import. The registration island stays `client:only="react"` |
| `pages/event-confirmation.astro` | the hosted checkout's thank-you landing (`?orderNumber=&eventId=`) — **keep the route**; the shipped checkout callbacks point at it |

## What you build — the design job

1. **The event card + events index** — your tile (image, date eyebrow, title,
   venue/online, price-from, sold-out badge) and rhythm, with the category filter (only when
   >1 category), skeletons while loading, and an honest empty state — on `useEvents`.
2. **The event page's registration surface** — branch on `event.registrationType`:
   `TICKETING` → your tier picker (name, description, price, quantity stepper capped by
   `limitPerCheckout`, non-`SALE_STARTED` tiers unbuyable) and the checkout CTA; `RSVP` →
   the built-in first/last/email form (a "can't make it" option only when
   `rsvpResponseType === "YES_AND_NO"`) and the confirmed/waitlist states; `EXTERNAL` →
   link out; closed → an honest closed state — on `useEventRegistration`, which owns ALL
   registration logic; you own how it looks.
3. **The home page** — hero, featured/next events (fetch in frontmatter → your components),
   brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// EventSummary (tiles) — display-ready:
// { id, slug, title, shortDescription /* plain text */, dateLabel /* "Sep 26, 2026, 7:00 PM" */,
//   startDateIso, locationName, locationType: "VENUE"|"ONLINE"|"TBD", imageUrl,
//   registrationType: "RSVP"|"TICKETING"|"EXTERNAL"|"NONE",
//   priceLabel /* "From €25.00" | "Free" | "" */, soldOut, categories: [{id,name}] }
// EventDetail adds: aboutParagraphs: string[], registrationOpen, rsvpResponseType,
//   externalUrl, addToCalendar: { google, ics }.
// TicketTier: { id, name, description, price /* "€45.00" | "Free" */, free,
//   limitPerCheckout, saleStatus /* only "SALE_STARTED" is buyable */ }

// useEvents({ initialEvents? }) →
// { events: EventSummary[]|null /* null = loading → skeletons */,
//   categories: [{id,name}] /* derived from the loaded events */,
//   activeCategoryId, setActiveCategoryId(id|null), error }

// useEventRegistration(event: EventDetail) →
// { tiers: TicketTier[]|null,                    // TICKETING only; null = loading
//   quantities, setQuantity(tierId, qty),        // clamped; sale-status gated
//   ticketCount, canCheckout,                    // gate the tickets CTA on canCheckout
//   checkout(): Promise<RegistrationResult>,     // reserve → the browser redirects to Wix checkout
//   rsvpValues, setRsvpValue(field, value),      // built-in fields: firstName/lastName/email
//   canRsvp,                                     // gate the RSVP CTA on this
//   rsvp(attending?): Promise<RegistrationResult>, // attending=false only for YES_AND_NO
//   submitting, confirmed, error }               // confirmed: rsvpConfirmed with status
//                                                //   "YES" | "NO" | "WAITLIST" (tell the guest!)
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   existing layout instead if another vertical is deployed).
2. Write your components under `src/components/events/` (new names — don't overwrite the
   references), swap the island imports in `pages/events.astro` and
   `pages/events/[slug].astro`. Listing island: `client:load` with the SSR props;
   registration island: `client:only="react"`. Keep `pages/event-confirmation.astro`'s route.
   **Author your surfaces in as few messages as possible** — batch multiple Writes per
   message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/events` → your listing; `/events/:slug` → fetch
with `fetchEventBySlug(slug)` client-side, then your registration surface;
`/event-confirmation` → the confirmation view (the checkout callbacks point at that path).

## Hard rules

- **Registration logic only through the shipped exports** — `useEventRegistration` /
  `startTicketCheckout` / `submitRsvp` own the sequence (visitor-public tier read, reserve,
  `createRedirectSession({ eventsCheckout })`, rsvpV2). Never re-derive any of it, never
  hand-build a checkout/ticket-form URL, never route it through an API route or elevate —
  the whole flow runs client-side as the visitor.
- **Branch on `registrationType`** — never render an RSVP event with a ticket picker or a
  ticketed event with an RSVP form; respect `registrationOpen`.
- **The RSVP form is built-in** — exactly first name, last name, email; never fetch a form
  schema or add fields.
- **Gate CTAs on `canCheckout` / `canRsvp`** and surface `error` — `checkout()`/`rsvp()` can
  reject (sold out, sale ended, duplicate email, payment method not configured); the message
  is for the visitor.
- **Confirmed states reflect REAL success**: RSVP → render only from `confirmed` (and say
  "waitlisted", not "confirmed", for status `WAITLIST`). Tickets → the only success surface
  is `/event-confirmation` with Wix's `?orderNumber=` params; a visitor merely returning to
  the event page is NOT a success signal.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Live data or an honest empty state — never mock events, tiers, or "X spots left".
- Keep the detail page's SEO pieces exactly as shipped.

## Point the user to their dashboard

Give the owner the dashboard link plus the Events page — the deploy step's JSON printed
`dashboardUrl`; append `/events` for event management. **Selling paid tickets needs a premium
plan + a connected payment method** (free/RSVP events work without) — mention it.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-events.mjs` from the project root.
Seed events that exercise the UI (a ticketed event with 2 tiers, another ticketed one, a free
RSVP event; future dates; an image per event).

## Verify (before declaring done)

- [ ] `/events` renders live events SSR (view-source shows titles) through YOUR components;
      empty catalog shows your honest empty state.
- [ ] An event page branches correctly: ticketed shows your tier picker (prices, steppers,
      CTA disabled at zero tickets); RSVP shows the three-field form.
- [ ] An RSVP submits end-to-end: `rsvp()` resolves, your confirmed state renders.
- [ ] A ticketed checkout reserves and redirects to the Wix-hosted checkout (or surfaces the
      "connect a payment method" message when the site has none — that's correct behavior).
- [ ] `/event-confirmation` renders (the honest no-order state on a direct visit).
- [ ] Event page view-source carries the SEO tags (Astro).
- [ ] Card/index/registration surfaces/home are YOUR designs on the tokens; data-layer/hook
      files unedited.
- [ ] Dashboard links handed to the owner (+ the paid-tickets premium note when relevant).

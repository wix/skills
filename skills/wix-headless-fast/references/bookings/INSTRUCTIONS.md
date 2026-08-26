# Bookings — playbook

The booking machinery ships as files — services reads, availability (appointment AND class),
the schema-driven booking form, and the exact `createBooking → cart → checkout-or-place`
sequence, typed end-to-end. **The presentation is yours**: you design and implement the
service card, the listing surface, and the booking surface on the shipped hooks/DTOs, plus
the home page and the brand. You never write booking logic; you never skip designing.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/bookings/types.ts` | the DTOs (`ServiceSummary`, `ServiceDetail`, `Slot`, `BookingFormField`, `BookingResult`) — contracts below |
| `wix/bookings/services.ts` | `fetchServices`, `fetchServiceBySlug`, `fetchBookingCategories` |
| `wix/bookings/booking.ts` | `fetchSlots`, `fetchBookingForm`, `bookService` — the exact booking sequence lives here |
| `hooks/bookings/useServices.ts` | listing + category filter — contract below |
| `hooks/bookings/useBookingFlow.ts` | the whole booking state machine — contract below |
| `components/bookings/ServicesView.tsx` (+ `ServiceCard`) · `ServiceBookingView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If storefront is also deployed, its layout won — add a Services nav link there |
| `pages/services.astro` | SSR listing — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/services/[slug].astro` | SSR detail + booking with owner-editable SEO — **keep the frontmatter and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; swap the island import. The booking island stays `client:only="react"` (availability is timezone-specific) |

## What you build — the design job

1. **The service card + listing surface** — your tile (image, type badge, duration/price
   presentation) and rhythm, with skeletons while loading and an honest empty state — on
   `useServices`.
2. **The booking surface** — day-grouped slot picking, week paging, staff filter (only when
   >1 staff), the schema-driven form, the book CTA (label free vs priced), and the confirmed
   state — on `useBookingFlow`, which owns ALL booking logic; you own how it looks.
3. **The home page** — hero, featured services (fetch in frontmatter → your components),
   brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// ServiceSummary (tiles) — display-ready:
// { id, slug, name, tagLine, type: "APPOINTMENT"|"CLASS", price /* "€75.00" | "Free" */,
//   free, durationMinutes|null, imageUrl, categoryId|null, staff: [{id,name}] }
// ServiceDetail adds: description, formId, paymentOption, cancellationFeeEnabled.

// useServices({ initialServices?, initialCategories? }) →
// { services: ServiceSummary[]|null /* null = loading → skeletons */,
//   categories: [{id,name}], activeCategoryId, setActiveCategoryId(id|null), error }

// useBookingFlow(service: ServiceDetail) →
// { days: [{ dayKey, dayLabel, slots: Slot[] }] | null,   // day-grouped; null = loading
//   windowStart, nextWeek(), prevWeek(),                  // 7-day paging (prev clamps to today)
//   staffId, setStaffId(id|undefined),                    // show a picker only when service.staff.length > 1
//   selectedSlot, setSelectedSlot(slot|null),             // Slot = { startLocal, endLocal, dayKey, label, … }
//   formFields: [{ target, label, type, options? }],      // never empty (contact-basics fallback)
//   values, setValue(target, value),                      // inputs write here, keyed by target
//   canBook,                                              // gate the CTA on this
//   book(): Promise<BookingResult>,                       // paid → the browser redirects to Wix checkout;
//   booking, confirmed, error }                           // free/offline → confirmed is set (REAL success)
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   storefront layout instead if both verticals are deployed).
2. Write your components under `src/components/bookings/` (new names — don't overwrite the
   references), swap the island imports in `pages/services.astro` and
   `pages/services/[slug].astro`. Listing island: `client:load` with the SSR props; booking
   island: `client:only="react"`. **Author your surfaces in as few messages as possible** —
   batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/services` → your listing; `/services/:slug` →
fetch with `fetchServiceBySlug(slug)` client-side, then your booking surface.

## Hard rules

- **Booking logic only through the shipped exports** — `useBookingFlow`/`bookService` own the
  sequence (createBooking → cart holds the seat → checkout-or-place), the payment-option
  derivation, ANY_RESOURCE, and the formSubmission shape. Never re-derive any of it, never
  call `confirmBooking`, never hand-build a checkout URL.
- **The form is schema-driven** — render `formFields` as given (values keyed by `target`);
  never hardcode field names beyond what the fallback already guarantees.
- **Gate the CTA on `canBook`** and surface `error` — `book()` can reject (slot taken,
  validation); that message is for the visitor.
- **The confirmed state must reflect REAL success**: render it only from `confirmed` (set by
  the free/offline branch). A visitor returning from the hosted checkout redirect is NOT a
  success signal — don't fake a confirmation page off the return URL.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Live data or an honest empty state — never mock services, slots, or availability.
- Keep the detail page's SEO pieces exactly as shipped.

## Point the user to their dashboard

Give the owner the dashboard link plus the Bookings services/calendar pages — the deploy
step's JSON printed `dashboardUrl`; append `/bookings/services` for service management.
Taking real online payments needs a premium plan + a connected payment method — mention it.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-bookings.mjs` from the project root.
Seed services that exercise the UI (an APPOINTMENT with duration+price, a free one, a CLASS
with future sessions when it fits the business; an image per service).

## Verify (before declaring done)

- [ ] `/services` renders live services SSR (view-source shows names) through YOUR components;
      empty catalog shows your honest empty state.
- [ ] A service page shows day-grouped bookable times; week paging works; the form renders
      (schema or fallback) and the CTA stays disabled until a slot + all fields are set.
- [ ] A FREE service books end-to-end: `book()` resolves, your confirmed state renders.
- [ ] A PAID service redirects to the Wix-hosted checkout.
- [ ] Service page view-source carries the SEO tags (Astro).
- [ ] Card/listing/booking surfaces/home are YOUR designs on the tokens; data-layer/hook files
      unedited.
- [ ] Dashboard links handed to the owner.

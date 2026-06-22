# Bookings Components — the client islands (astro)

The `components` scope of the bookings vertical. You write the React islands that
power the booking UI. The **logic** is in `../../bookings/FLOW.md` (read it first);
this doc is the astro wiring + the gotchas.

Read `references/shared/IMPLEMENTER.md` + `references/shared/STYLING.md` first.

Write in this order: `components-bookings.css` → `bookingDriver.ts` → `SeoTags.astro` → TSX islands.

## Islands you write

| File | Role |
|------|------|
| `src/styles/components-bookings.css` | Scoped CSS (`.service-card*`, `.service-grid`, `.availability-*`, `.time-slot*`, `.booking-*`). First line: `@reference "./global.css";`. Write before TSX. |
| `src/components/bookingDriver.ts` | Booking SDK sequence (`book()`, `navigateToCheckout()`). Write before islands that import it. |
| `src/components/SeoTags.astro` | Renders `service.seoData.tags`; imported by `services/[slug].astro`. |
| `src/components/ServiceBookingFlow.tsx` | `client:only` coordinator — holds the selected slot, swaps calendar → form, redirects on success. Mounted by `services/[slug].astro`. |
| `src/components/AvailabilityCalendar.tsx` | The **week calendar** — week strip + nav → the picked day's slots. APPOINTMENT → `availabilityTimeSlots`; CLASS → `eventTimeSlots`. Optional **staff picker** (>1 staff; filters availability + records `slot.resource`) and **location picker** (>1 business location; always scopes to one location to avoid duplicate per-location slots). Both fed by props from the SSR page. |
| `src/components/BookingForm.tsx` | The **schema-driven** form — renders the `@wix/forms` field list (passed in from the SSR page), keys values by `target`, calls `bookingDriver.book()`. |

## astro-specific rules

1. **Islands call `@wix` ambiently — no `createClient`/`OAuthStrategy`.** In an
   astro browser island the `@wix/astro` visitor client is ambient (the same way
   the ecom `CartView` island works): `import { availabilityTimeSlots } from "@wix/bookings"`
   and call it directly. Do **not** build an `OAuthStrategy` client or read
   `WIX_CLIENT_ID` — that pattern is for own/static builds (`../../custom/bookings/WIRING.md`).
2. **The booking sequence lives in `bookingDriver.ts` — write it, then import it.** Import `book`,
   `navigateToCheckout`, `BookResultType`, and the `SelectedSlot` type from
   `./bookingDriver`. The form island calls `book(...)` and branches:
   `CheckoutRequired` → `navigateToCheckout(cartId, postFlowUrl)`; `CheckoutSkipped`
   → redirect to `/booking-confirmation`.
3. **Mount everything `client:only="react"`.** Availability + booking are
   timezone/session-specific; never SSR them.
4. **The form fields come from SSR.** `services/[slug].astro` fetches the booking
   form schema and passes a `fields` array into `ServiceBookingFlow` → `BookingForm`
   (see `SERVICES_PAGES.md`). The island renders the fields generically — it does
   not fetch the schema itself.
5. **CSS is written first.** Write `components-bookings.css` before the islands. The classes (`.availability-*`, `.time-slot*`, `.booking-*`) live there; islands reference them by name.

## Return
`{ status, phase, scope: "components", summary, data, files, errors }`. List all files written (CSS + TS + TSX) in `files`.

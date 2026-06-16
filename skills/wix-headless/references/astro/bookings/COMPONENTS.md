# Bookings Components — the client islands (astro)

The `components` scope of the bookings vertical. You write the React islands that
power the booking UI. The **logic** is in `../../bookings/FLOW.md` (read it first);
this doc is the astro wiring + the gotchas. `src/styles/components-bookings.css`
and `src/components/bookingDriver.ts` are pre-copied — do **not** write them.

Read `references/shared/IMPLEMENTER.md` + `references/shared/STYLING.md` first.

> **Start from the templates — don't re-author the SDK wiring.** Each island has
> an example at `<SKILL_ROOT>/references/astro/templates/bookings/`. Read and adapt
> (brand copy, styling, class names already in `components-bookings.css`); keep the
> SDK calls + payload shapes.

## Islands you write

| File | From template | Role |
|------|---------------|------|
| `src/components/ServiceBookingFlow.tsx` | `…/ServiceBookingFlow.tsx` | `client:only` coordinator — holds the selected slot, swaps calendar → form, redirects on success. Mounted by `services/[slug].astro`. |
| `src/components/AvailabilityCalendar.tsx` | `…/AvailabilityCalendar.tsx` | the **week calendar** — week strip + nav → the picked day's slots. APPOINTMENT → `availabilityTimeSlots`; CLASS → `eventTimeSlots`. Optional **staff picker** (shown when >1 staff; filters availability + records `slot.resource`) and **location picker** (shown when the service has >1 business location; **always scopes availability to one location** — defaulting to the carried/first — so a multi-location service doesn't return duplicate per-location slots). Both fed by props from the SSR page. |
| `src/components/BookingForm.tsx` | `…/BookingForm.tsx` | the **schema-driven** form — renders the `@wix/forms` field list (passed in from the SSR page), keys values by `target`, calls `bookingDriver.book()`. |

## astro-specific rules

1. **Islands call `@wix` ambiently — no `createClient`/`OAuthStrategy`.** In an
   astro browser island the `@wix/astro` visitor client is ambient (the same way
   the ecom `CartView` island works): `import { availabilityTimeSlots } from "@wix/bookings"`
   and call it directly. Do **not** build an `OAuthStrategy` client or read
   `WIX_CLIENT_ID` — that pattern is for own/static builds (`../../custom/bookings/WIRING.md`).
2. **The booking sequence is imported, not re-authored.** Import `book`,
   `navigateToCheckout`, `BookResultType`, and the `SelectedSlot` type from the
   pre-copied `./bookingDriver`. The form island calls `book(...)` and branches:
   `CheckoutRequired` → `navigateToCheckout(cartId, postFlowUrl)`; `CheckoutSkipped`
   → redirect to `/booking-confirmation`.
3. **Mount everything `client:only="react"`.** Availability + booking are
   timezone/session-specific; never SSR them.
4. **The form fields come from SSR.** `services/[slug].astro` fetches the booking
   form schema and passes a `fields` array into `ServiceBookingFlow` → `BookingForm`
   (see `SERVICES_PAGES.md`). The island renders the fields generically — it does
   not fetch the schema itself.
5. **No CSS.** The classes (`.availability-*`, `.time-slot*`, `.booking-*`) are in
   the pre-copied `components-bookings.css`; reference them, don't write them.

## Return
`{ status, phase, scope: "components", summary, data, files, errors }`. If a pre-copied dependency (`bookingDriver.ts`, `components-bookings.css`) is missing, return `status: "partial"` with the coded error.

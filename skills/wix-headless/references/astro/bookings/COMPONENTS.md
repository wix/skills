# Bookings Components — Phase 3

You are the Phase 3 Components agent for the bookings vertical. Your scope: write the React islands and Astro shells that power the bookings UI. The orchestrator has already copied `src/styles/components-bookings.css` from the skill template — do NOT write it.

Read `references/shared/IMPLEMENTER.md` + `references/shared/STYLING.md` first.

---

## Files you own

| File | Purpose |
|------|---------|
| `src/components/ServiceCard.astro` | Static card for the services listing grid |
| `src/components/AvailabilityCalendar.tsx` | React island — date picker + slot grid |
| `src/components/BookingForm.tsx` | React island — booking details form + submission |

Do NOT write any `.css` files — `components-bookings.css` is pre-copied and must not be modified.

---

## ServiceCard.astro

A static Astro component. No client-side interactivity — just props in, HTML out.

**Props:**
```typescript
interface Props {
  id: string;
  slug: string;
  name: string;
  tagLine?: string;
  durationMinutes: number;
  price?: string;       // formatted string, e.g. "$75.00" — already formatted by caller
  currency?: string;
  imageUrl?: string;
  type: 'APPOINTMENT' | 'CLASS';
}
```

**Structure:**
- Outer `<a href={`/services/${slug}`}>` wrapping the entire card (`class="service-card"`)
- Image region: if `imageUrl` is present, `<img src={imageUrl} alt={name} class="service-card-image">`. Else, a `<div class="service-card-image service-card-image--placeholder" aria-hidden="true">` using `background-color: var(--color-surface-secondary)` inline.
- Content region (`class="service-card-meta"`):
  - `<h3 class="service-card-name">{name}</h3>`
  - `{tagLine && <p class="service-card-tagline">{tagLine}</p>}`
  - Meta row: duration badge + price (when present) in a `<div class="service-card-price">`:
    - Duration: `<span>{durationMinutes} min</span>`
    - Price: `<span>{price}</span>` when price is defined
    - No price text when price is absent (service may be free or "Contact for pricing")

---

## AvailabilityCalendar.tsx

A `client:only="react"` React island. Fetches and displays available slots for a specific service.

**Props:**
```typescript
interface AvailabilityCalendarProps {
  serviceId: string;
  serviceName: string;
  onSlotSelected: (slot: SelectedSlot) => void;
}

interface SelectedSlot {
  localStartDate: string;   // YYYY-MM-DDThh:mm:ss — from timeSlot.localStartDate
  localEndDate: string;     // YYYY-MM-DDThh:mm:ss — from timeSlot.localEndDate
  scheduleId: string;       // timeSlot.scheduleId
  serviceId: string;        // timeSlot.serviceId
  timezone: string;         // result.timeZone from listAvailabilityTimeSlots response
  locationId?: string;      // timeSlot.location.id (present only for BUSINESS locations)
  locationType?: string;    // timeSlot.location.locationType
}
```

**Behavior:**
1. On mount, default to today's date. Fetch available slots for today via `availabilityTimeSlots.listAvailabilityTimeSlots()`.
2. Render a simple date-navigation header (← Prev / date display / Next →) with `<button>` controls. Move by ±1 day. No full calendar grid — a date navigator is sufficient.
3. Below the date navigator, render the available slots as a grid of `<button>` elements (`className="time-slot time-slot--available"`). On click, mark the slot as selected (`className="time-slot time-slot--selected"`) and call `onSlotSelected(slot)`.
4. If no slots are available for the selected date, display: `<p className="availability-empty">No availability on this date — try another day.</p>`.
5. Loading state: display `<p className="availability-loading">Checking availability…</p>` while fetching.
6. Error state: display `<p className="availability-error">Could not load availability — please try again.</p>` and a "Retry" button.

> **`.tsx` files use `className=`, NOT `class=`.** React JSX requires the `className` attribute on intrinsic elements; using `class=` produces a `tsc` error per occurrence (`Type '{ class: string; ...}' is not assignable to type 'DetailedHTMLProps<...>'`). Only `.astro` files (like `ServiceCard.astro` above) use `class=`. The same rule applies to `BookingForm.tsx` and `ServiceBookingFlow.tsx`.

**SDK wiring:**

> **Correct namespace: `availabilityTimeSlots`** — not `availability`. The SDK exports `availabilityTimeSlots` (Time Slots V2). Using `availability` will fail at runtime.
> - For **APPOINTMENT** services: use `availabilityTimeSlots.listAvailabilityTimeSlots()`
> - For **CLASS** services: use `availabilityTimeSlots.listEventTimeSlots()` (different method, different params)
> The `AvailabilityCalendar` component handles APPOINTMENT services by default. CLASS support can be added later.

```typescript
import { createClient, OAuthStrategy } from '@wix/sdk';
import { availabilityTimeSlots, bookings } from '@wix/bookings';

const wixClient = createClient({
  modules: { availabilityTimeSlots, bookings },
  auth: OAuthStrategy({ clientId: import.meta.env.PUBLIC_WIX_CLIENT_ID }),
});

const fetchSlots = async (serviceId: string, date: Date) => {
  // Use local date strings (YYYY-MM-DDThh:mm:ss) — NOT ISO UTC strings with Z.
  // The API expects local time in the business timezone.
  const pad = (n: number) => String(n).padStart(2, '0');
  const localDate = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 0);

  const result = await wixClient.availabilityTimeSlots.listAvailabilityTimeSlots({
    serviceId: [serviceId],  // note: serviceId is an array in V2
    fromLocalDate: localDate(start),
    toLocalDate: localDate(end),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bookable: true,
    cursorPaging: { limit: 50 },
  });
  // Store the response timezone for use in booking — pass it through with each slot
  const tz = result.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { slots: result.timeSlots ?? [], timezone: tz };
};
```

Each `timeSlot` in the response has fields at the TOP LEVEL (not nested under a `slot` property):
- `timeSlot.localStartDate` / `timeSlot.localEndDate` — `YYYY-MM-DDThh:mm:ss` format (local to business timezone)
- `timeSlot.scheduleId` — schedule ID for the booking call
- `timeSlot.serviceId`
- `timeSlot.location.id` / `timeSlot.location.locationType`
- `timeSlot.bookable` — always `true` when `bookable: true` filter is used
- `timeSlot.availableResources` — **EMPTY by default** in list results; do NOT read resource ID here

> **Do NOT try to read `resource._id` from list results.** Omit `resource` from the `createBooking` payload — Wix auto-assigns an available resource during booking confirmation. You only need resource details if you want to show "book with specific staff" UI (advanced use case).

Format slot times for display: `new Date(timeSlot.localStartDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.

`SelectedSlot` carries the info needed for booking:

```typescript
interface SelectedSlot {
  localStartDate: string;   // YYYY-MM-DDThh:mm:ss — from timeSlot.localStartDate
  localEndDate: string;     // YYYY-MM-DDThh:mm:ss — from timeSlot.localEndDate
  scheduleId: string;       // timeSlot.scheduleId
  serviceId: string;        // timeSlot.serviceId
  timezone: string;         // from result.timeZone
  locationId?: string;      // timeSlot.location.id (present only for BUSINESS locations)
  locationType?: string;    // timeSlot.location.locationType
}
```

---

## BookingForm.tsx

A `client:only="react"` React island. Renders after the user selects a slot.

**Props:**
```typescript
interface BookingFormProps {
  serviceId: string;
  serviceName: string;
  slot: SelectedSlot;
  onSuccess: (bookingId: string, startDate: string) => void;  // startDate for confirmation page URL
  onCancel: () => void;
}
```

**Fields:**
- First name (required)
- Last name (optional)
- Email (required)
- Phone (optional)
- Notes / message (optional, `<textarea>`)
- Submit button: "Confirm Booking"
- Cancel link that calls `onCancel()`

**On submit:**
1. Validate email + first name are non-empty.
2. Call `bookings.createBooking(...)`:

```typescript
import { bookings } from '@wix/bookings';

// Construct the booking payload.
// startDate/endDate come from the timeSlot.localStartDate/localEndDate values.
// Omit `resource` — Wix auto-assigns an available resource during confirmation.
const bookingPayload = {
  totalParticipants: 1,
  contactDetails: {
    firstName: formData.firstName,
    lastName: formData.lastName || undefined,
    email: formData.email,
    phone: formData.phone || undefined,
  },
  selectedPaymentOption: 'OFFLINE' as const,  // "OFFLINE" = pay at session; use "ONLINE" if the service has online payment enabled
  bookedEntity: {
    slot: {
      serviceId: props.slot.serviceId,
      scheduleId: props.slot.scheduleId,
      startDate: props.slot.localStartDate,  // pass localStartDate as startDate
      endDate: props.slot.localEndDate,      // pass localEndDate as endDate
      timezone: props.slot.timezone,
      // Omit `resource` — Wix auto-assigns. Only include if you have a specific resource ID.
      ...(props.slot.locationId
        ? { location: { _id: props.slot.locationId, locationType: props.slot.locationType as any } }
        : { location: { locationType: 'OWNER_BUSINESS' as const } }),
    },
  },
};

const result = await wixClient.bookings.createBooking(bookingPayload);
```

3. On success: call `onSuccess(result.booking?._id ?? '', props.slot.localStartDate)`. Pass `localStartDate` as the second arg so `ServiceBookingFlow` can include it in the confirmation URL. The booking ID field is `_id` (underscore prefix), not `id`.
4. On error (409 — slot taken): display `<p className="booking-error">This time slot was just taken. Please select another.</p>` and call `onCancel()` to return to the calendar. Do NOT redirect.
5. Show a loading state ("Confirming…") while the request is in flight.
6. Wrap `createBooking` in try/catch — do not let it crash the island.

---

## Wiring note — how the page uses these islands

The `/services/[slug].astro` page (written by the `pages` scope) mounts both islands in a coordinated flow:

```tsx
// Pseudocode — actual wiring is done by the pages scope
const [selectedSlot, setSelectedSlot] = useState(null);

if (!selectedSlot) {
  return <AvailabilityCalendar serviceId={id} onSlotSelected={setSelectedSlot} />;
}
return <BookingForm serviceId={id} slot={selectedSlot} onSuccess={handleSuccess} onCancel={() => setSelectedSlot(null)} />;
```

The components need to export cleanly so the page's React coordinator island can import both. Export each as a default export from its file.

---

## Return contract

```json
{
  "status": "complete",
  "phase": "components",
  "vertical": "bookings",
  "files": [
    "src/components/ServiceCard.astro",
    "src/components/AvailabilityCalendar.tsx",
    "src/components/BookingForm.tsx"
  ]
}
```

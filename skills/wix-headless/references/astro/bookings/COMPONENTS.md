# Bookings Components — Phase 3

You are the Phase 3 Components agent for the bookings vertical. Your scope: write the React islands and Astro shells that power the bookings UI. The orchestrator has already copied `src/styles/components-bookings.css` from the skill template — do NOT write it.

> **Start from the canonical templates — don't invent the SDK wiring.** Every component in this scope has a verified template at `<SKILL_ROOT>/references/astro/templates/bookings/` (`ServiceCard.astro`, `AvailabilityCalendar.tsx`, `BookingForm.tsx`, `ServiceBookingFlow.tsx`, `ManageBooking.tsx`, `SeoTags.astro`). **Read and adapt them** (brand copy, styling) — this doc explains the *why* and the gotchas behind that wiring. The booking/confirm/availability/waitlist flow is subtle and live-verified; re-authoring it from scratch is a common source of API-shape bugs.

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
  serviceType: 'APPOINTMENT' | 'CLASS';  // drives which time-slots API + slot shape
  onSlotSelected: (slot: SelectedSlot) => void;
}

// APPOINTMENT and CLASS slots have DIFFERENT shapes — see "SDK wiring" below.
// APPOINTMENT slots carry `scheduleId` + `startDate`; CLASS (event) slots carry
// `eventInfo.eventId` and have NO `scheduleId`. Carry both optionally + the type.
interface SelectedSlot {
  serviceType: 'APPOINTMENT' | 'CLASS';
  localStartDate: string;   // YYYY-MM-DDThh:mm:ss — from slot.localStartDate
  localEndDate: string;     // YYYY-MM-DDThh:mm:ss — from slot.localEndDate
  serviceId: string;
  timezone: string;         // result.timeZone from the list response
  // APPOINTMENT only:
  scheduleId?: string;      // timeSlot.scheduleId — undefined for CLASS
  locationId?: string;      // timeSlot.location.id (BUSINESS locations only)
  locationType?: string;    // timeSlot.location.locationType
  // CLASS only:
  eventId?: string;         // timeSlot.eventInfo.eventId — undefined for APPOINTMENT
}
```

**Behavior:**
1. On mount, default to today's date. Fetch available slots for today via `fetchSlots(serviceId, serviceType, today)` (which picks `listAvailabilityTimeSlots` for APPOINTMENT or `listEventTimeSlots` for CLASS — see SDK wiring below).
2. Render a simple date-navigation header (← Prev / date display / Next →) with `<button>` controls. Move by ±1 day. No full calendar grid — a date navigator is sufficient.
3. Below the date navigator, render the available slots as a grid of `<button>` elements (`className="time-slot time-slot--available"`). On click, mark the slot as selected (`className="time-slot time-slot--selected"`) and call `onSlotSelected(slot)`. **Guard the click on the type-appropriate id** — `slot.localStartDate && (slot.serviceType === 'CLASS' ? slot.eventId : slot.scheduleId)`. Guarding on `scheduleId` alone silently drops every CLASS click (event slots have no `scheduleId`), so the booking form never appears.
4. If no slots are available for the selected date, display: `<p className="availability-empty">No availability on this date — try another day.</p>`.
5. Loading state: display `<p className="availability-loading">Checking availability…</p>` while fetching.
6. Error state: display `<p className="availability-error">Could not load availability — please try again.</p>` and a "Retry" button.

> **`.tsx` files use `className=`, NOT `class=`.** React JSX requires the `className` attribute on intrinsic elements; using `class=` produces a `tsc` error per occurrence (`Type '{ class: string; ...}' is not assignable to type 'DetailedHTMLProps<...>'`). Only `.astro` files (like `ServiceCard.astro` above) use `class=`. The same rule applies to `BookingForm.tsx` and `ServiceBookingFlow.tsx`.

**SDK wiring:**

> **Two different namespaces, one per service type** — both are real `@wix/bookings` exports (`availability` is not):
> - **APPOINTMENT** → `availabilityTimeSlots.listAvailabilityTimeSlots({ serviceId: [id], … bookable: true })`. Slots carry `scheduleId` + `startDate` at the top level.
> - **CLASS** → `eventTimeSlots.listEventTimeSlots({ serviceIds: [id], … includeNonBookable: false })`. Note the **different namespace** (`eventTimeSlots`, not `availabilityTimeSlots`), the **plural `serviceIds`**, and `includeNonBookable` (not `bookable`). Class slots carry their session id at **`eventInfo.eventId`** and have **no `scheduleId`** (and no top-level `startDate`).
>
> Branch on the `serviceType` prop. For CLASS the calendar is empty until the merchant schedules sessions for the class (see SERVICES_DATA.md § "CLASS session gap") — an empty state there is expected, not a bug.

> **Client ID in browser islands comes from `astro:env/client`, NOT `import.meta.env`.** In `@wix/astro` the client ID is exposed to the browser through the `astro:env/client` virtual module: `import { WIX_CLIENT_ID } from "astro:env/client"`. `import.meta.env.WIX_CLIENT_ID` (and `PUBLIC_WIX_CLIENT_ID`) is **`undefined` in the browser bundle**, so `OAuthStrategy` POSTs an empty `client_id` and every client-side SDK call fails at `POST https://www.wixapis.com/oauth2/token` with `400 {"error":"invalid_request"}`. (The var is `WIX_CLIENT_ID` — no `PUBLIC_` prefix.)

```typescript
import { createClient, OAuthStrategy } from '@wix/sdk';
import { availabilityTimeSlots, eventTimeSlots, bookings } from '@wix/bookings';
import { WIX_CLIENT_ID } from 'astro:env/client';

const wixClient = createClient({
  modules: { availabilityTimeSlots, eventTimeSlots, bookings },
  auth: OAuthStrategy({ clientId: WIX_CLIENT_ID }),
});

// Local date strings (YYYY-MM-DDThh:mm:ss) — NOT ISO UTC strings with Z. The API
// expects local time in the business timezone, alongside an explicit timeZone.
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Returns SelectedSlot[] normalized across both service types so the rest of the
// component (and BookingForm) never re-branches on raw API shapes.
const fetchSlots = async (
  serviceId: string,
  serviceType: 'APPOINTMENT' | 'CLASS',
  date: Date,
): Promise<{ slots: SelectedSlot[]; timezone: string }> => {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setHours(23, 59, 59, 0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (serviceType === 'CLASS') {
    const result = await wixClient.eventTimeSlots.listEventTimeSlots({
      serviceIds: [serviceId],          // plural — CLASS API
      fromLocalDate: localDate(start),
      toLocalDate: localDate(end),
      timeZone,
      includeNonBookable: false,
    });
    const tz = result.timeZone ?? timeZone;
    const slots: SelectedSlot[] = (result.timeSlots ?? []).map((ts: any) => ({
      serviceType: 'CLASS',
      serviceId,
      localStartDate: ts.localStartDate,
      localEndDate: ts.localEndDate,
      eventId: ts.eventInfo?.eventId,   // session id lives here — there is NO scheduleId
      timezone: tz,
    }));
    return { slots, timezone: tz };
  }

  // APPOINTMENT
  const result = await wixClient.availabilityTimeSlots.listAvailabilityTimeSlots({
    serviceId,                          // a single GUID STRING — NOT an array (the array form is the CLASS `serviceIds`)
    fromLocalDate: localDate(start),
    toLocalDate: localDate(end),
    timeZone,
    bookable: true,
    cursorPaging: { limit: 50 },
  });
  const tz = result.timeZone ?? timeZone;
  const slots: SelectedSlot[] = (result.timeSlots ?? []).map((ts: any) => ({
    serviceType: 'APPOINTMENT',
    serviceId,
    localStartDate: ts.localStartDate,
    localEndDate: ts.localEndDate,
    scheduleId: ts.scheduleId,
    locationId: ts.location?.id,
    locationType: ts.location?.locationType,
    timezone: tz,
  }));
  return { slots, timezone: tz };
};
```

Slot fields differ by type — both have `localStartDate`/`localEndDate` at the TOP LEVEL (not nested under a `slot` property):
- **APPOINTMENT** (`listAvailabilityTimeSlots`): `timeSlot.scheduleId`, `timeSlot.serviceId`, `timeSlot.location.{id,locationType}`, `timeSlot.bookable`. `timeSlot.availableResources` is **EMPTY by default** — do NOT read a resource ID here.
- **CLASS** (`listEventTimeSlots`): `timeSlot.eventInfo.eventId` (the session id), `timeSlot.totalCapacity`/`remainingCapacity`. **No `scheduleId`, no top-level `startDate`.**

> **Do NOT try to read `resource._id` from list results.** Omit `resource` from the `createBooking` payload — Wix auto-assigns an available resource during booking confirmation. You only need resource details if you want to show "book with specific staff" UI (advanced use case).

Format slot times for display: `new Date(timeSlot.localStartDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.

`SelectedSlot` (defined once at the top of this component) carries the info needed for booking — including `serviceType` and, for CLASS, `eventId` instead of `scheduleId`. `BookingForm` reads `serviceType` to choose the `createBooking` payload shape.

---

## BookingForm.tsx

A `client:only="react"` React island. Renders after the user selects a slot.

**Props:**
```typescript
interface BookingFormProps {
  serviceId: string;
  serviceName: string;
  serviceType: 'APPOINTMENT' | 'CLASS';  // selects the createBooking slot shape
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
- Submit button: "Confirm Booking"
- Cancel link that calls `onCancel()`

**On submit:**
1. Validate email + first name are non-empty.
2. Call `bookings.createBooking(...)`:

```typescript
import { createClient, OAuthStrategy } from '@wix/sdk';
import { bookings } from '@wix/bookings';
import { WIX_CLIENT_ID } from 'astro:env/client';  // browser client ID — NOT import.meta.env (see Bug-10 note)

const wixClient = createClient({
  modules: { bookings },
  auth: OAuthStrategy({ clientId: WIX_CLIENT_ID }),
});

// The slot shape differs by service type — build bookedEntity.slot accordingly.
// Omit `resource` either way — Wix auto-assigns an available resource on confirm.
const slot = props.slot.serviceType === 'CLASS'
  // CLASS: a class session is identified by eventId. Wix derives start/end/
  // timezone/resource/location from the event — do NOT send scheduleId/startDate.
  ? {
      serviceId: props.slot.serviceId,
      eventId: props.slot.eventId,
    }
  // APPOINTMENT: identified by scheduleId + explicit start/end/timezone/location.
  : {
      serviceId: props.slot.serviceId,
      scheduleId: props.slot.scheduleId,
      startDate: props.slot.localStartDate,  // pass localStartDate as startDate
      endDate: props.slot.localEndDate,      // pass localEndDate as endDate
      timezone: props.slot.timezone,
      ...(props.slot.locationId
        ? { location: { _id: props.slot.locationId, locationType: props.slot.locationType as any } }
        : { location: { locationType: 'OWNER_BUSINESS' as const } }),
    };

const bookingPayload = {
  totalParticipants: 1,
  contactDetails: {
    firstName: formData.firstName,
    lastName: formData.lastName || undefined,
    email: formData.email,
    phone: formData.phone || undefined,
  },
  selectedPaymentOption: 'OFFLINE' as const,  // "OFFLINE" = pay at session; use "ONLINE" if the service has online payment enabled
  bookedEntity: { slot },
};

const result = await wixClient.bookings.createBooking(bookingPayload);
```

3. **Confirm the booking — this is mandatory, not optional.** `createBooking` returns a booking in **`CREATED`** status, which **does not hold a seat or block availability** (only `CONFIRMED` does — [lifecycle docs](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/introduction)). If you stop at `createBooking`, the class **overbooks** and `remainingCapacity` never drops. Confirm via a server endpoint (next section) — `confirmBooking` needs Manage Bookings, so it can't run from this visitor client.
4. On success (confirm returns ok): call `onSuccess(result.booking?._id ?? '', props.slot.localStartDate)`. The booking ID field is `_id` (underscore prefix), not `id`.
5. On `SESSION_CAPACITY_EXCEEDED` (full session): route to the **waitlist** (see "Capacity, instructor & waitlist" below).
6. On other errors: `<p className="booking-error">This time slot was just taken. Please select another.</p>` + `onCancel()`. Loading state "Confirming…" while in flight. Always wrap in try/catch.

---

## Booking lifecycle, capacity, instructor & waitlist (verified live)

These four behaviors were all verified against a live Bookings site — they're easy to get wrong and pass `astro build` while breaking at runtime.

### Confirm step (overbooking guard) — server endpoint `src/pages/api/confirm-booking.ts`
`createBooking` → `CREATED` (holds nothing). Confirm it server-side to occupy the seat:
```typescript
// POST { bookingId, revision } — elevated (Manage Bookings).
import { auth } from "@wix/essentials";
import { bookings } from "@wix/bookings";
const res = await auth.elevate(bookings.confirmBooking)(bookingId, String(revision), {
  paymentStatus: "NOT_PAID",                              // pay-on-site class
  flowControlSettings: { checkAvailabilityValidation: true }, // 409s if it just filled — the real overbooking guard
});
```
`confirmBooking` is a real SDK method, so `auth.elevate(bookings.confirmBooking)` elevates correctly. The island POSTs `{ bookingId, revision }` here right after `createBooking`, and only redirects to the confirmation page when this returns ok.

### Capacity (multi-participant)
The list slot carries `totalCapacity` / `remainingCapacity` / **`bookableCapacity`** (use `bookableCapacity` — it accounts for waitlist holds). Show "N spots left"; render a "Number of spots" selector capped at `bookableCapacity` and pass it as `booking.totalParticipants` (the verified field; not `numberOfParticipants`). A slot with `bookableCapacity <= 0` is full → waitlist.

### Instructor (per CLASS session)
`listEventTimeSlots` does **not** return resources. Resolve the instructor for a chosen slot via `eventTimeSlots.getEventTimeSlot(eventId)` → `timeSlot.availableResources[].resources[].name` (take the first). Display it on the form ("with Jordan Rivera").

### Waitlist (native, v1 — there is no v2/v3 waitlist)
A full session's `createBooking` throws `SESSION_CAPACITY_EXCEEDED`, whose message contains the **v1 session id** (*"…on session `<id>`"*). Extract it and POST to a server endpoint that registers on the native waitlist (`POST /bookings/v1/waitlist/register`, needs `contactId` + Manage Bookings → elevated). See the SSR-endpoints section in `SERVICES_PAGES.md`. Front-end extraction:
```typescript
const full = `${err?.message ?? ""} ${JSON.stringify(err?.details ?? {})} ${String(err)}`;
const sessionId = full.match(/on session ([^\s"}]+)/)?.[1]; // → waitingResource
```

---

## Wiring note — how the page uses these islands

The `/services/[slug].astro` page (written by the `pages` scope) mounts both islands in a coordinated flow:

```tsx
// Pseudocode — actual wiring is done by the pages scope.
// `serviceType` (from service.type) MUST be threaded through so the calendar
// picks the right time-slots API and the form builds the right createBooking shape.
const [selectedSlot, setSelectedSlot] = useState(null);

if (!selectedSlot) {
  return <AvailabilityCalendar serviceId={id} serviceType={type} onSlotSelected={setSelectedSlot} />;
}
return <BookingForm serviceId={id} serviceType={type} slot={selectedSlot} onSuccess={handleSuccess} onCancel={() => setSelectedSlot(null)} />;
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
    "src/components/BookingForm.tsx",
    "src/components/ServiceBookingFlow.tsx",
    "src/components/ManageBooking.tsx"
  ]
}
```

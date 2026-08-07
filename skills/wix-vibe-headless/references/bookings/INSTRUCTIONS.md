
# Wix Bookings Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js`, the shared config `references/shared/wix-config.js`, and both bookings helpers from `references/bookings/`. `wix-client.js` imports from `"./wix-config.js"` and the helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`). Copy **both** helpers for the full booking flow:
>
> | File | What it covers |
> |---|---|
> | `wix-bookings-services.js` | Service listing, slot availability, media URL helper |
> | `wix-bookings-checkout.js` | Create booking, hosted checkout, bookAndCheckout convenience |

Builds a real, client-only Wix Bookings front end. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock services or slots; never hand-build a `/checkout` URL —
always create the booking through the API and complete it via the eCom checkout + redirect-session.

This skill ships the single-service booking flow for **APPOINTMENT and CLASS** services: browse
services → pick a service → pick an available slot → enter details → book → hosted checkout.
Appointments and classes differ only in the availability call (`listAvailableSlots` vs
`listEventTimeSlots`); `listSlotsForService` routes by `service.type`, and `createBooking` handles
either slot. **COURSE (whole-course enrollment) is not covered** — see "Beyond the snippets".

## When to use
- User wants a Wix Bookings appointment site or asks to "connect Wix Bookings".
- Replacing placeholder/mock services or fake calendars with live Wix data.
- Adding service listings, a slot picker, booking creation, or checkout over an existing
  Wix Bookings setup.

## Prerequisites
1. A Wix site with **Wix Bookings installed and at least one appointment service created**
   (this skill does NOT provision — it's read-only over services). Staff/resources and a
   booking policy should be configured so slots are bookable.
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the Wix
   Business Manager surfaces a copyable prompt with the id filled in — see the router `SKILL.md`). Set it
   in `src/rest/wix-config.js` in place of the placeholder. It is a buyer-facing credential
   (it only mints anonymous visitor tokens), **not** a secret, so hardcoding/committing it is fine.
3. The site must **accept payments** for paid services, and the deployed app domain must be
   allow-listed on the OAuth client for Wix-hosted checkout to return. These are **separate Wix
   setup flows the user completes later** — out of this skill's scope. If checkout return fails
   before that setup is done, that's expected; flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the booking UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Reads `WIX_CLIENT_ID` from
  `wix-config.js`. The visitor refresh token IS the booking visitor identity; it is persisted to
  localStorage. Do not re-mint anonymously per load.
- `src/rest/wix-config.js` — set `WIX_CLIENT_ID` (and `WIX_METASITE_ID`) from the prompt.
- `src/rest/wix-bookings-services.js` — **Services & availability:**
  `queryServices`, `getService`, `countServices`, `listAvailableSlots`, `getAvailableSlot`,
  `mediaUrl` (resolve a service image to an absolute URL)
- `src/rest/wix-bookings-checkout.js` — **Booking & checkout:**
  `createBooking`, `checkoutBooking`, `bookAndCheckout`

The `Service`, `TimeSlot`, and `Booking` shapes are documented as JSDoc comments at the top of
each helper file. Read them before building the UI — they describe the key fields and link to
the full API reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Service list** — `const { services, total, nextOffset } = await queryServices({ limit, offset })`
  for the listing (visitor-visible services only); it returns an **object, not a bare array** —
  destructure it, then render `.services`. Each service's id is `service.id`. Render `name`,
  `tagLine`, the image via `mediaUrl(service.media?.items?.[0]?.image)`, and the price from
  `payment.fixed.price`. `value` + `currency` are always present; `formattedValue` is
  **optional** (it may be missing), so don't depend on it — build the price from `value`+`currency`
  and use `formattedValue` only when present. e.g. `new Intl.NumberFormat(undefined, { style:
  'currency', currency }).format(Number(value))`. (Rendering `formattedValue` alone leaves the price
  blank — or your "Varies" fallback — whenever it's absent.) Pass the returned `nextOffset` back as
  `offset` to load the next page (it is `null` on the last page). See the **`pages/Services.jsx`**
  snippet below. Books **APPOINTMENT and CLASS** services (see the slot picker below); COURSE is
  whole-course enrollment and out of scope.
- **Service detail** — `getService(serviceId)` keyed off the URL/route; returns null on miss —
  show a not-found state, never invent a service. Render `description`, price, and `locations`.
- **Slot picker** — `const { slots, nextCursor } = await listSlotsForService(service, { fromLocalDate, toLocalDate, timeZone? })`:
  it routes by `service.type` — APPOINTMENT → `listAvailableSlots` (staff working hours), CLASS/COURSE
  → `listEventTimeSlots` (scheduled sessions). Both return the same `{ slots, nextCursor }` shape;
  iterate `.slots`. (Call the specific function directly if you already know the type.) Dates are
  **local** wall-clock strings `"YYYY-MM-DDThh:mm:ss"` (no zone), interpreted in `timeZone` (defaults
  to the visitor's IANA zone). **Mind the date-arg naming difference:** the list calls take
  `fromLocalDate`/`toLocalDate`, while the single-slot re-validate call (`getAvailableSlot`, below)
  takes `localStartDate`/`localEndDate` — they are not interchangeable. Only `bookable: true` slots
  come back. Render each `slot.localStartDate`/`localEndDate`; group by day for a calendar. Pass
  `nextCursor` back as `cursor` to page. See the **`SlotPicker.jsx`** snippet below.
- **Booking form** — collect the buyer's `firstName`, `lastName`, `email`, `phone`. Keep it
  minimal; richer per-service form fields live in the service's `form.id` (see "Beyond the snippets").
- **Participant count** — cap it by the service policy, not just slot capacity. The most a single
  booking may reserve is `service.bookingPolicy.participantsPolicy.maxParticipantsPerBooking`. Only
  render a participant selector when that value is `> 1`, and bound its max at
  `min(maxParticipantsPerBooking, slot.remainingCapacity)` for a class; when it is `1` (the common
  case) show no selector and book exactly one. Never offer a fixed range like 1–4 — the slot's
  `remainingCapacity` tells you the class's open spots, not how many one buyer may take, so relying
  on it alone lets the buyer pick a count that `createBooking` then rejects. Pass the chosen count
  as `createBooking`'s `totalParticipants`.
- **Re-validate + book** — right before submitting, call
  `const slot = await getAvailableSlot(serviceId, { localStartDate, localEndDate, timeZone? })` to
  confirm the slot is still open (and to pick up the staff resource). It returns the slot object or
  **`null`** if the time was just taken — **guard for `null`** and prompt for another slot; never
  book a null slot. Then create + check out in one step:
  `window.location.href = (await bookAndCheckout(slot, { email, firstName, lastName, phone }, { totalParticipants })).checkoutUrl;`
  (`bookAndCheckout` returns `{ booking, checkoutUrl }`.) Or split it — note `createBooking` is the
  **3-arg** form `(slot, contact, options)` and `checkoutBooking` returns a **bare URL string**:
  `const booking = await createBooking(slot, contact, { totalParticipants, timeZone }); window.location.href = await checkoutBooking(booking.id);`
  See the **`BookingForm.jsx`** snippet below.
- **Confirmation / return** — after the buyer returns from hosted checkout, the order is placed
  and Wix Bookings confirms the booking automatically (status becomes `CONFIRMED`, or `PENDING`
  if the service needs manual approval). Show a confirmation screen on return.
- **Empty state** — if `countServices()` is 0, show an empty state telling the user to add a
  service in their Wix dashboard. Never invent services.

## Hard rules (do not violate)
- ✅ Book ONLY via `createBooking()` → `checkoutBooking()` (or `bookAndCheckout()`), then redirect
  to the returned URL: `window.location.href = await checkoutBooking(bookingId)` — `checkoutBooking`
  returns a **bare URL string** (not an object; no `.fullUrl`), and `bookAndCheckout` returns
  `{ booking, checkoutUrl }` (redirect to `checkoutUrl`).
- ❌ Never hand-build a `/checkout`, booking, or calendar URL.
- ❌ Never mock services, time slots, or availability — render live Wix data or the empty state.
- ❌ Never invent reviews, ratings, staff, or testimonials. Empty review UI only.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Send availability/booking dates as **local** `"YYYY-MM-DDThh:mm:ss"` strings plus a
  `timeZone` — do not send UTC `Z` timestamps to the slot APIs.
- ✅ Re-validate the slot with `getAvailableSlot()` before `createBooking()` — slots get taken.
- ✅ Cap participant count at `service.bookingPolicy.participantsPolicy.maxParticipantsPerBooking`
  (render no selector when it is 1); never offer a fixed range and never use slot capacity as the
  per-buyer limit — a count above the policy makes `createBooking` fail.
- The client fails loudly on purpose: `createBooking`/`checkoutBooking` throw on an unbookable
  slot, a missing booking id, or a missing redirect URL. A green path means it's really bookable —
  don't swallow these.

## Beyond the snippets
The snippets cover **APPOINTMENT and CLASS** bookings (the slot picker routes by `service.type`).
For anything beyond that, extend the client: add a new helper on `wixApiRequest`, looking up the
exact endpoint, method, and body in the **official Wix API reference** first (never guess):
- Official Wix API reference: https://dev.wix.com/docs/api-reference.md
- Single-service booking flow (the full picture): https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-single-service-booking.md
- **Courses are NOT covered — a course is enrolled as a *whole*, not booked per session.**
  `listEventTimeSlots` returns **no** per-session slots for a COURSE (verified — empty even for admin),
  so the slot-picker flow doesn't apply. Enrolling in a course uses a course-specific flow (whole-course
  capacity computed from bookings) that these snippets don't implement —
  https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-reader-v2/query-extended-bookings.md
- **Service variants / participants** (duration- or person-based pricing):
  https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/service-options-and-variants/get-service-options-and-variants-by-service-id.md
- **Add-ons:** https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/list-add-on-groups-by-service-id.md
- **Custom booking form fields** (render `service.form.id`): Get Form Summary —
  https://dev.wix.com/docs/rest/crm/forms/form-schemas/get-form-summary.md
- **Member login + a "my bookings" account view** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`): booking itself works anonymously, but signing a member in
  (custom login on your own UI) lets them see their own appointments/history.

Keep the snippets as the default for everything they already do; reach for the API reference
only for the gap.

## Reference components (headless — adapt the logic, restyle freely)

These are the recurring bookings pieces, written **headless**: the data wiring (Wix field paths,
`{ services, ... }` / `{ slots, ... }` destructuring, the local-date arg names, the null-slot guard,
the participant cap) is correct and complete — the markup is deliberately plain. **Copy the logic
exactly; restyle the JSX to the brand.** They consume the `src/rest/` helpers; you don't need to
read those helpers' source.

**`pages/Services.jsx`** — the service listing (grid + empty state + paging). `queryServices`
returns an **object, not a bare array** — `{ services, total, nextOffset }`; destructure first
(calling `.map` on the returned object throws `… is not a function`). The id is `service.id`;
`payment.fixed.price.formattedValue` is optional, so format from `value`+`currency`.

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryServices, mediaUrl } from "@/rest/wix-bookings-services";

export default function Services() {
  const [services, setServices] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [total, setTotal] = useState(null);

  useEffect(() => {
    // queryServices returns an OBJECT, not a bare array — destructure it.
    queryServices({ limit: 24 }).then(({ services, total, nextOffset }) => {
      setServices(services);
      setTotal(total);
      setNextOffset(nextOffset);
    });
  }, []);

  const loadMore = () =>
    queryServices({ limit: 24, offset: nextOffset }).then(({ services: more, nextOffset: next }) => {
      setServices((s) => [...s, ...more]);
      setNextOffset(next);
    });

  if (total === 0) return <p>{/* empty state — add a service in the Wix dashboard */}</p>;
  return (
    <div /* restyle */>
      {services.map((service) => {
        const image = mediaUrl(service.media?.items?.[0]?.image);
        const p = service.payment?.fixed?.price;                     // may be absent (free / custom-priced)
        const price = p && (p.formattedValue                         // formattedValue is OPTIONAL — build from value+currency when missing
          || new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(Number(p.value)));
        return (
          <Link key={service.id} to={`/service/${service.id}`} /* the service id is service.id */>
            {image && <img src={image} alt={service.name} loading="lazy" />}
            <h3>{service.name}</h3>
            {service.tagLine && <p>{service.tagLine}</p>}
            {price && <span>{price}</span>}
          </Link>
        );
      })}
      {nextOffset != null && <button onClick={loadMore}>Load more</button>}
    </div>
  );
}
```

**`SlotPicker.jsx`** — lists bookable slots for a chosen service. `listSlotsForService` routes by
`service.type` and returns `{ slots, nextCursor }`; iterate `.slots`, page with `nextCursor`. The
**list** call takes `fromLocalDate`/`toLocalDate` (local wall-clock, no zone) — a different arg
naming than the single-slot `getAvailableSlot`.

```jsx
import { useState, useEffect } from "react";
import { listSlotsForService } from "@/rest/wix-bookings-services";

// Local wall-clock "YYYY-MM-DDThh:mm:ss" (NO zone / Z) — the slot APIs interpret it in timeZone.
function localMidnight(daysFromNow = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
}

export default function SlotPicker({ service, onPick }) {
  const [slots, setSlots] = useState([]);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    // listSlotsForService routes by service.type and returns { slots, nextCursor }. Note the arg names:
    // the LIST call uses fromLocalDate / toLocalDate (getAvailableSlot, the single-slot re-validate
    // call, uses localStartDate / localEndDate instead).
    listSlotsForService(service, { fromLocalDate: localMidnight(0), toLocalDate: localMidnight(14) })
      .then(({ slots, nextCursor }) => { setSlots(slots); setCursor(nextCursor); });
  }, [service]);

  const loadMore = () =>
    listSlotsForService(service, { cursor }).then(({ slots: more, nextCursor }) => {
      setSlots((s) => [...s, ...more]);
      setCursor(nextCursor);
    });

  return (
    <div /* restyle: group slots by day for a calendar */>
      {slots.map((slot) => (
        <button key={`${slot.localStartDate}-${slot.scheduleId || slot.eventInfo?.eventId}`}
          onClick={() => onPick(slot)}>
          {new Date(slot.localStartDate).toLocaleString()}
        </button>
      ))}
      {cursor && <button onClick={loadMore}>Load more</button>}
    </div>
  );
}
```

**`BookingForm.jsx`** — re-validate the picked slot, then book + check out. `getAvailableSlot`
returns the slot **or `null`** (guard it — the time may have just been taken). `createBooking` is
the 3-arg form `(slot, contact, { totalParticipants, timeZone })`, and `checkoutBooking` returns a
**bare URL string** you redirect straight to.

```jsx
import { useState } from "react";
import { getAvailableSlot } from "@/rest/wix-bookings-services";
import { createBooking, checkoutBooking } from "@/rest/wix-bookings-checkout";

export default function BookingForm({ service, slot }) {
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);

  // maxParticipantsPerBooking is the per-booking cap (commonly 1 → no selector at all). Never use
  // slot.remainingCapacity as the per-buyer limit — a count above the policy makes createBooking fail.
  const maxParticipants = service.bookingPolicy?.participantsPolicy?.maxParticipantsPerBooking ?? 1;
  const [participants, setParticipants] = useState(1);
  const set = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Re-validate right before booking — slots get taken. getAvailableSlot returns the slot or NULL;
      // the single-slot call uses localStartDate / localEndDate (not from/toLocalDate).
      const fresh = await getAvailableSlot(service.id, {
        localStartDate: slot.localStartDate,
        localEndDate: slot.localEndDate,
      });
      if (!fresh) { alert("That time was just taken — please pick another."); return; }

      // createBooking is the 3-arg form: (slot, contact, options). Pass the chosen count as totalParticipants.
      const booking = await createBooking(fresh, contact, { totalParticipants: participants });
      // checkoutBooking returns a BARE URL string (not an object) — redirect straight to it.
      window.location.href = await checkoutBooking(booking.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} /* restyle */>
      <input required type="email" placeholder="Email" value={contact.email} onChange={set("email")} />
      <input placeholder="First name" value={contact.firstName} onChange={set("firstName")} />
      <input placeholder="Last name" value={contact.lastName} onChange={set("lastName")} />
      <input placeholder="Phone" value={contact.phone} onChange={set("phone")} />
      {maxParticipants > 1 && (
        <input type="number" min={1} max={maxParticipants} value={participants}
          onChange={(e) => setParticipants(Number(e.target.value))} />
      )}
      <button type="submit" disabled={submitting}>Book</button>
    </form>
  );
}
```

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the bookings content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For bookings data those pages are:
- **Booking Services** — `https://manage.wix.com/dashboard/{metaSiteId}/bookings/services` (`Dashboard → Bookings → Booking Services`; add services and service categories)
- **Staff** — `https://manage.wix.com/dashboard/{metaSiteId}/bookings/staff` (`Dashboard → Bookings → Staff`; add staff and set working hours, so slots are actually bookable)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (same visitor identity across reloads)
- [ ] `queryServices()` renders live services; `countServices()` 0 → empty state (no mock services)
- [ ] `listAvailableSlots()` returns real bookable slots for a chosen service and date range
- [ ] Slot is re-validated with `getAvailableSlot()` immediately before booking
- [ ] Participant selector capped by `maxParticipantsPerBooking` (hidden when 1) — a count above the policy is not offerable
- [ ] `createBooking()` returns a booking with `status: "CREATED"` and a real id
- [ ] Checkout redirects to the URL `checkoutBooking()` returns (a bare string) — or `bookAndCheckout()`'s `checkoutUrl` — with no hand-built URL
- [ ] On return from checkout the booking is confirmed (status `CONFIRMED`/`PENDING`)
- [ ] No mock services, slots, or availability anywhere
- [ ] Told the user at least once that they can continue setting up their bookings in the dashboard and provided deep links.

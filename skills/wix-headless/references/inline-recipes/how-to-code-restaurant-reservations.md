---
name: "How to Code Restaurant Reservations"
description: The frontend contract for a Wix Table Reservations site — which SDK modules to import, how to read the reservation location, get available time slots, and make a reservation via the hold→reserve flow (or single create). Specifies the *how* (modules + exact calls + failure modes); the restaurant/party details come from the visitor.
---
**RECIPE**: How to Code a Wix Table-Reservations Frontend (Table Reservations)

A contract for the **frontend code** that lets a visitor **book a table**: reading the reservation location, fetching available time slots for a date + party size, and creating a reservation. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — the restaurant, the party size, and the page design come from the request / the visitor's input.

> **This recipe is for CODING reservations, not seeding them.** It assumes the backend already exists — the Table Reservations app installed and a reservation location configured with **online reservations enabled** (see `setup-restaurant-reservations.md`). It says nothing about creating or configuring the location — only how visitors read availability and book from frontend code.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The bare / REST view shows `id`; the `?apiView=SDK` view shows `_id` — and the SDK is what your frontend calls. Reading the REST view is the most common source of the `entity.id`-is-`undefined` bug. Fetch the `.md?apiView=SDK` form directly.

> **⚠️ ONLINE RESERVATIONS MUST BE ENABLED (premium) for this flow to work.** The visitor flow reads/creates against a location whose `onlineReservationsEnabled` is `true` — and (per `setup-restaurant-reservations.md`) that toggle is **premium-only** (`428 PREMIUM_ONLY` on a free site). On a non-premium site the location exists and you can *read* it, but time-slot availability / booking won't function. If bookings fail on a site you know is configured, check the site is premium and the toggle is on — it's a provisioning precondition, not a code bug.

---

## The modules and the client (read this first)

**One package: `@wix/table-reservations`** — a **distinct** package from `@wix/restaurants` (menus) and from the Orders app. It exposes three namespaces you use:

| Need | Package | Module (namespace) |
|---|---|---|
| The reservation location (id, party-size bounds) | `@wix/table-reservations` | `reservationLocations` |
| Available time slots for a date + party size | `@wix/table-reservations` | `timeSlots` |
| Create / hold / reserve a reservation | `@wix/table-reservations` | `reservations` |

**No cart, no `@wix/ecom`, no `@wix/redirects`.** A basic table reservation is a **hold**, not a purchase — there's no checkout in this flow. (Deposit/prepayment reservations exist — status `PAYMENT_INFORMATION_PENDING` — but they're out of scope for the standard book-a-table flow.)

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `reservationLocations` / `timeSlots` / `reservations` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
  ```js
  import { reservationLocations, timeSlots, reservations } from '@wix/table-reservations';
  const { reservationLocations: locs = [] } = await reservationLocations.listReservationLocations();
  ```
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { reservationLocations, timeSlots, reservations } from '@wix/table-reservations';

  const client = createClient({
    modules: { reservationLocations, timeSlots, reservations },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  // then: await client.timeSlots.getTimeSlots(locationId, new Date(date), partySize)
  ```
  The `clientId` is public, not a secret. A mis-wired public env var inlines as `undefined` and 400s every call.

---

## The shapes you read (field cheat-sheet)

SDK read shapes (`?apiView=SDK`), so entity ids are **`_id`**.

```jsonc
// reservationLocations.listReservationLocations()  →  { reservationLocations: [...] }   (no arguments)
reservationLocation = {
  _id,                         // → the reservationLocationId every call below needs   (NOT .id)
  default,                     // the auto-provisioned location has default: true
  configuration: { onlineReservations: {
    partySize: { min, max },   // bound the party-size input to this range
    onlineReservationsEnabled, // must be true for the flow to work (premium)
    approval: { mode },        // "AUTOMATIC" → reserve confirms immediately; manual → status REQUESTED
  } },
}

// timeSlots.getTimeSlots(reservationLocationId, date, partySize, options?)  →  { timeSlots: [...] }
//   NOTE: the SDK types `date` as a Date (NOT the ISO string the REST doc shows) — pass new Date(...)
timeSlot = {
  startDate,                   // a Date — pass THIS into createHeldReservation
  duration,                    // minutes
  status,                      // "AVAILABLE" | "UNAVAILABLE" | "NON_WORKING_HOURS" — book only AVAILABLE
  manualApproval,              // whether this slot needs staff approval
}

// reservations.createHeldReservation({ reservationLocationId, startDate, partySize })  →  { reservation: {...} }
// reservations.reserveReservation(reservationId, reservee, revision)  →  { reservation: {...} }
reservation = {
  _id, revision,               // keep BOTH from the held reservation — reserve needs the revision
  status,                      // "HELD" after create → "RESERVED" (auto) or "REQUESTED" (manual approval) after reserve
}
```

---

## The features (build the ones the site needs)

Each subsection is a **self-contained feature**. The only ordering is the booking chain itself (location → slots → hold → reserve).

### Reading the reservation location (and the `_id` rule)

Get the location so you have its **`_id`** and the party-size bounds for your form. `listReservationLocations()` takes **no arguments**.

```js
const { reservationLocations: locs = [] } = await reservationLocations.listReservationLocations();
const loc = locs.find((l) => l.default) ?? locs[0];
const reservationLocationId = loc._id;
const { min, max } = loc.configuration?.onlineReservations?.partySize ?? { min: 1, max: 20 };
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/list-reservation-locations.md?apiView=SDK>

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** `location.id` / `reservation.id` are `undefined` in SDK code — use `_id`. (A surprising `id` field means you're on the REST doc view — re-open with `?apiView=SDK`.)

**⚠️ Default the array (`= []`).** `listReservationLocations()` types the returned array as optional, so destructuring `{ reservationLocations: locs }` and calling `locs.find(...)` directly errors under `strict` / `astro check` (`'locs' is possibly 'undefined'`). Default it, exactly as with the restaurants `list*` methods.

### Getting available time slots

Call `getTimeSlots` with **positional** args: the location id, a **`Date` object** (`new Date(selectedDate)` — NOT the ISO string the doc shows; see the CRITICAL note below), the party size, and optional `{ slotsBefore, slotsAfter, duration }`. Then keep the `AVAILABLE` slots.

```js
const { timeSlots: slots = [] } = await timeSlots.getTimeSlots(
  reservationLocationId,
  new Date(selectedDate),                 // a Date — the SDK types this param as Date (see callout)
  partySize,
  { slotsBefore: 4, slotsAfter: 4 },
);
const available = slots.filter((s) => s.status === 'AVAILABLE');
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md?apiView=SDK>

**⚠️ CRITICAL: `getTimeSlots` takes POSITIONAL args, not a single options object.** The signature is `getTimeSlots(reservationLocationId, date, partySize, options?)` — passing one object (`getTimeSlots({ reservationLocationId, date, partySize })`) does not type-check. Only `slotsBefore`/`slotsAfter`/`duration` go in the 4th `options` arg.

**⚠️ CRITICAL: the `date` param is a `Date`, NOT the ISO-8601 string the doc shows (doc/SDK drift).** The REST/SDK doc describes `date` as an ISO-8601 string, but the shipped `@wix/table-reservations` type is **`Date`** — passing `new Date(...).toISOString()` fails to compile (`TS2345: 'string' is not assignable to 'Date'`). Pass a **`Date` object** (`new Date(selectedDate)`). Both the `date` arg you send and each `slot.startDate` you read back are `Date`s — so pass the chosen slot's `startDate` straight into `createHeldReservation`, no conversion.

**⚠️ Book only `status === 'AVAILABLE'`.** `UNAVAILABLE` (can't seat that party then) and `NON_WORKING_HOURS` (closed) are also returned — filter them out before presenting slots, or the hold will fail.

### Making a reservation (hold → reserve)

The two-step flow from the sample: **hold** the slot (10-minute temporary reservation) while the visitor enters details, then **reserve** it with their name + phone.

```js
// 1 · hold the slot — startDate is the Date from the chosen AVAILABLE time slot
const held = await reservations.createHeldReservation({
  reservationLocationId,
  startDate: chosenSlot.startDate,
  partySize,
});
// ⚠️ `held.reservation` is OPTIONAL and its `_id`/`revision` are `string | null` in the SDK type —
// narrow before use or the strict/`astro check` build fails (TS18048 / TS2345).
if (!held.reservation?._id || !held.reservation.revision) throw new Error('hold failed');
const reservationId = held.reservation._id;
const revision = held.reservation.revision;   // reserve needs this

// 2 · reserve it — reservee needs firstName + phone at minimum
const done = await reservations.reserveReservation(
  reservationId,
  { firstName, lastName, email, phone },
  revision,
);
// done.reservation.status === 'RESERVED'  (auto-approval)  |  'REQUESTED'  (manual approval on)
```
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-held-reservation.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reserve-reservation.md?apiView=SDK>

**⚠️ CRITICAL: `reserveReservation(reservationId, reservee, revision)` takes THREE positional args** — the reservation id, the `reservee` object, and the **`revision`** from the held reservation. Omitting the revision (or wrapping the three in one object) does not type-check. Keep `held.reservation.revision` from step 1.

**⚠️ CRITICAL: `reservee.firstName` and `reservee.phone` are required.** A reservation from any `source` other than `WALK_IN` (i.e. every online booking) requires at least `firstName` and `phone` — omitting them returns an error. Collect them in the details form before calling reserve.

**⚠️ A `HELD` reservation expires in 10 MINUTES.** If the visitor takes longer than 10 min to confirm, `reserveReservation` returns an error — start a fresh hold. And **do not** call `updateReservation` to move a reservation off `HELD` (it errors); the only way forward from `HELD` is `reserveReservation`.

**Result status:** with the seeded default (`approval.mode: "AUTOMATIC"`, manual approval off) the reservation becomes **`RESERVED`** immediately — confirm to the visitor. If the location requires manual approval it becomes **`REQUESTED`** (staff must approve) — tell the visitor it's pending.

**Single-shot alternative:** if you collect all details up front (no "hold while they type" step), call `reservations.createReservation({ details: { reservationLocationId, startDate, partySize }, reservee })` instead — same `firstName`/`phone` requirement; it returns `RESERVED`/`REQUESTED` directly, skipping the `HELD` phase. **⚠️ The location/time/party go under a nested `details` object (NOT top-level), and this method returns the `Reservation` DIRECTLY — not wrapped in `{ reservation }`** (unlike `createHeldReservation`/`reserveReservation`). Top-level fields or reading `.reservation` off the result fails to type-check.
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-reservation.md?apiView=SDK>

---

## Conclusion
A correct Table-Reservations frontend:
- imports **`reservationLocations` / `timeSlots` / `reservations` from `@wix/table-reservations`** — one package, three namespaces; **no cart / ecom / redirects** (a reservation is a hold, not a purchase);
- uses **`_id`** (never `id`) for the location and reservation, and **defaults the `list*` array** (`= []`) so strict/`astro check` passes;
- calls **`getTimeSlots(locationId, new Date(date), partySize, options?)`** with **positional** args — the `date` param is a **`Date`** (not the ISO string the doc shows) — and books only **`status === 'AVAILABLE'`** slots (passing the slot's `Date` `startDate` onward);
- books via **`createHeldReservation({...})` → `reserveReservation(id, reservee, revision)`** (three positional args; `firstName` + `phone` required; 10-minute hold; `reserveReservation` is the only exit from `HELD`);
- treats **`onlineReservationsEnabled` (premium)** as a precondition — the read/book flow only works once it's on.
</content>

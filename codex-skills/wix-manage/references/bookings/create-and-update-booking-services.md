---
name: "Create and Update Booking Services"
description: "Creates and updates Wix Bookings services of every type — appointments, classes and courses — from a plain request such as 'a 60-minute consultation for $75', 'a yoga class for 12 people every Tuesday' or 'a 6-week photography course'. Covers choosing the service type, defaults for what the request leaves out, pricing (free, fixed, free-to-paid), staff, capacity, duration, categories, visibility, images, scheduling class and course sessions on the calendar, and changing existing services."
---

# Create and Update Booking Services

One recipe for every Bookings service: pick the type, fill in what the user didn't say, create it, schedule its sessions when it's a class or a course, and report back. The second half covers changing a service that already exists.

All service types are created with the same call (`POST https://www.wixapis.com/bookings/v2/bulk/services/create`); the type decides which fields the body carries and what has to happen after it.

Related recipes:
- A service booked by room or equipment instead of (or as well as) staff — "a massage in whichever treatment room is free" → [Multi-Resource Service Creation](multi-resource-service-creation.md). It creates the resource types and resources and gives the service body (`serviceResources`, and `primaryResourceType` for an appointment with no staff); this recipe's staff rules don't apply to such a service.
- Memberships, class packs or session bundles for a service → [Pricing Plans Bookings Integration](../pricing-plans/pricing-plans-bookings-integration.md).
- Adding staff, or giving a staff member custom working hours → [Bookings Staff Setup](bookings-staff-setup.md).
- Cancellation, booking-window or waitlist rules → [Booking Service Policy Setup](booking-service-policy-setup.md).

If a Bookings call fails because the Wix Bookings app isn't installed on the site, install it with [Install Wix Apps](../app-installation/install-wix-apps.md) (app ID `13d21c63-b5ec-5912-8397-c3a5ddb27a97`) and retry. Don't check for the app before the first call — the error says so when it's missing.

---

## Part 1 — Create a service

### Step 1: Pick the service type

| The user describes | Type | How customers book it |
|---|---|---|
| a consultation, appointment, meeting, 1-on-1, treatment, haircut, lesson at a time the customer picks | `APPOINTMENT` | The customer picks a free slot during the staff member's working hours. One customer per booking. |
| a class, group session, drop-in, "yoga every Tuesday", bootcamp class | `CLASS` | The business sets the session times; many customers book each session, and a customer can book one, some or all sessions. |
| a course, workshop series, program, "6-week course", "8 sessions", teacher training | `COURSE` | The business sets a fixed series with a start and an end; customers book the whole course, never a single session. |

When the wording fits none of these, create an `APPOINTMENT`. When it's ambiguous between a class and a course, the deciding question is whether customers can join a single session (class) or must sign up for the whole series (course). See [About Service Types](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types) for the full comparison.

### Step 2: Fill in what the user didn't say

Use the user's values wherever they gave one. For the rest:

| Field | APPOINTMENT | CLASS | COURSE |
|---|---|---|---|
| `name` | the user's wording | the user's wording | the user's wording |
| `description` | 1–2 sentences you write | 1–2 sentences, say it's a group class | 1–2 sentences, say it's a multi-session course (mention the session count if given) |
| `defaultCapacity` | `1` (required, must be 1) | `10` (participants per session) | `10` (participants for the whole course) |
| Duration | 60 minutes, via `schedule.availabilityConstraints.sessionDurations` | each session's start and end — only from the user (Step 5), never a default | each session's start and end — only from the user (Step 5), never a default |
| Staff | one staff member, via `staffMemberIds` (required unless the service is booked by a resource — see Related recipes) | the instructor goes on the session events, not the service | the instructor goes on the session events, not the service |
| `onlineBooking` | `{ "enabled": true }` | `{ "enabled": true }` | `{ "enabled": true }` |
| `category` | an existing category that fits, or a new one (Step 3) | an existing category that fits, or a new one (Step 3) | an existing category that fits, or a new one (Step 3) |

**Price.** Never invent one.
- The user gave a price → `rateType: "FIXED"` with that amount in `fixed.price.value`. For a class it's the price of one session; for a course it's the price of the whole course — don't divide it per session.
- The user said "free" → `rateType: "NO_FEE"`.
- The user gave no price → create the service free (`NO_FEE`), say so in the summary, and offer to set a price.

**Session schedule** (CLASS / COURSE). Never invent one — no default days, times or start date. A schedule is the user's to give: "Tuesdays 6–7pm" or "Wednesdays at 19:00 starting the 14th" is one; "a 6-week course", "8 sessions" or "a weekly class" gives only the length or the count, not the days and times. Without days and times, create the service, create no sessions, and ask for them (Step 5, Step 7). This holds when you're working on your own and can't wait for an answer, too: an instruction to proceed on reasonable assumptions covers the service's other fields, never its schedule — sessions you pick are a timetable the owner didn't choose, published to customers.

**Currency.** Send only `fixed.price.value`; leave `price.currency` out. The service always takes the site's payment currency — a currency you send is replaced with it (a `"JPY"` price on a USD site is stored as USD). Don't look up the site currency first; read it from the create response when you report the price.

**Visibility.** Services are visible by default. When the user asks for a hidden service ("a hidden test course"), add `"hidden": true` to the create body.

### Step 3: Read what the site already has

Run these reads before creating anything; they're independent, so run them together.

**Staff members** — required for an APPOINTMENT, and the instructor for CLASS or COURSE sessions. For a CLASS or COURSE whose schedule the user didn't give, skip this read: no sessions are created yet, so no instructor is needed.

`POST https://www.wixapis.com/bookings/v1/staff-members/query`

```json
{ "query": {} }
```

Use each staff member's `resourceId` — not its `id` — everywhere this recipe asks for a staff ID. Pick the staff member the user named; otherwise the one with `default: true`; otherwise the first one. If the site has no staff members, create one with [Bookings Staff Setup](bookings-staff-setup.md) first.

**Categories:**

`POST https://www.wixapis.com/bookings/v2/categories/query`

```json
{ "query": {} }
```

A service without a category isn't shown on the live site, and services aren't assigned one automatically, so every create body carries a `category.id`. Use the category the user named; otherwise an existing one that fits the service. A general one such as "Our Services" (a fresh Bookings install has it) fits anything, but a category meant for something else doesn't — a yoga class doesn't go under a template's "Styling". If no category fits, or the user named one that doesn't exist, create it — `POST https://www.wixapis.com/bookings/v2/categories` with `{ "category": { "name": "Yoga" } }` (the user's name for it, or a short name for the kind of service) — use the returned `category.id`, and mention the new category in the summary.

**Existing services** (duplicate check):

`POST https://www.wixapis.com/bookings/v2/services/query`

```json
{ "query": { "paging": { "limit": 100 } } }
```

A site with more than 100 services needs more pages: repeat with `"offset": 100`, `200`… inside `paging` until a page returns fewer than 100. If a service with the same or a very similar name exists, tell the user before creating another one.

### Step 4: Create the service

`POST https://www.wixapis.com/bookings/v2/bulk/services/create` — one call creates up to 100 services. Always send `"returnEntity": true`: without it the response carries only `results[i].itemMetadata.id`, with no `schedule.id` to schedule sessions on.

**APPOINTMENT** (60-minute paid consultation):

```json
{
  "returnEntity": true,
  "services": [{
    "name": "Strategy Consultation",
    "description": "A one-on-one session to map out your next quarter.",
    "type": "APPOINTMENT",
    "defaultCapacity": 1,
    "onlineBooking": { "enabled": true },
    "staffMemberIds": ["<STAFF_RESOURCE_ID>"],
    "schedule": { "availabilityConstraints": { "sessionDurations": [60] } },
    "payment": {
      "rateType": "FIXED",
      "options": { "online": true, "inPerson": false },
      "fixed": { "price": { "value": "75" } }
    },
    "category": { "id": "<CATEGORY_ID>" }
  }]
}
```

**CLASS or COURSE** (paid yoga class for 12 — for a course, change `type` to `"COURSE"`):

```json
{
  "returnEntity": true,
  "services": [{
    "name": "Vinyasa Yoga",
    "description": "A flowing group yoga class for all levels.",
    "type": "CLASS",
    "defaultCapacity": 12,
    "onlineBooking": { "enabled": true },
    "payment": {
      "rateType": "FIXED",
      "options": { "online": true, "inPerson": false },
      "fixed": { "price": { "value": "25" } }
    },
    "category": { "id": "<CATEGORY_ID>" }
  }]
}
```

For a CLASS or COURSE, don't send `staffMemberIds` (it's read-only for these types — the API fills it from the staff on the service's recurring sessions, so staff on single, non-recurring sessions don't appear there; query the calendar events for the full list) or `sessionDurations`, and don't put sessions anywhere in this body (`course.sessions`, `CourseSession` and the like do not create sessions).

**Free service** — replace `payment` with:

```json
"payment": { "rateType": "NO_FEE", "options": { "online": false, "inPerson": true } }
```

**Payment options** — at least one of `options.online` / `options.inPerson` must be `true`, even for a free service, and `online` is allowed only for paid rate types:

| `rateType` | `online` | `inPerson` | Valid? |
|---|---|---|---|
| `FIXED` | true | false | ✓ |
| `FIXED` | false | true | ✓ |
| `FIXED` | true | true | ✓ |
| `NO_FEE` | false | true | ✓ |
| `NO_FEE` | true | false | ✗ online needs FIXED or VARIED |
| any | false | false | ✗ one must be true |

Price-by-variant (`VARIED`), custom-text (`CUSTOM`), deposits and pricing plans are described in [About Service Payments](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-payments).

**Read the response.** A `200` can still carry a failed item, so check before reporting success:

```json
{
  "results": [{
    "itemMetadata": { "id": "<SERVICE_ID>", "originalIndex": 0, "success": true },
    "item": {
      "id": "<SERVICE_ID>",
      "type": "CLASS",
      "payment": { "rateType": "FIXED", "fixed": { "price": { "value": "25", "currency": "USD" } } },
      "schedule": { "id": "<SERVICE_SCHEDULE_ID>" },
      "revision": "1"
    }
  }],
  "bulkActionMetadata": { "totalSuccesses": 1, "totalFailures": 0, "undetailedFailures": 0 }
}
```

- The service is directly under `results[i].item` — there is no `item.service`. Match items to your request by `itemMetadata.originalIndex`.
- `itemMetadata.success: false` comes with `itemMetadata.error` (code and description). Fix and resend only the failed services.
- Keep `item.id` (the service ID) and, for a CLASS or COURSE, `item.schedule.id` for Step 5.

**Optional fields:**
- **Images** — the file must already be in the Wix Media Manager ([Search Files](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/search-files), or [Bulk Import File](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/bulk-import-file) for a URL). Set only its id, nested under `image`: `"media": { "mainMedia": { "image": { "id": "<FILE_ID>" } } }` (`mainMedia` shows in the services list, `coverMedia` on the service page, `items[]` is the page gallery). An id set directly on the media item (`mainMedia.id`) returns `200` but is silently dropped — read the service back to confirm the image stuck.
- **Locations** — `"locations": [{ "type": "BUSINESS", "business": { "id": "<LOCATION_ID>" } }]` for a business location, `[{ "type": "CUSTOMER" }]` for an appointment at the customer's place (appointments only), or `[{ "type": "CUSTOM", "custom": { "address": { … } } }]`. All of a course's sessions take place at the same location. To change the locations of an existing service, use [Set Service Locations](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/set-service-locations), not Update Service. Details: [About Service Locations](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-locations).

### Step 5: Schedule the sessions (CLASS and COURSE)

A CLASS or COURSE has no sessions when it's created, so customers can't book it, and a course with no future sessions shows as ended on its service page. Sessions are Calendar events on the service's own schedule (`item.schedule.id` from Step 4).

- **The user gave days and times** ("Tuesdays at 6pm", "8 Wednesday evenings from the 14th") → create the sessions now.
- **They didn't** → create only the service, ask for the session days and times, and tell the user plainly that the service can't be booked until sessions exist. Don't make up a schedule — not even when you're told to proceed without asking; in that case finish with the service alone and name exactly what's missing.

Create the sessions with `POST https://www.wixapis.com/calendar/v3/bulk/events/create` (up to 50 events per call). The instructor in each event's `resources` is a staff `resourceId` from Step 3 — if you skipped that read because the schedule came later, run it now.

**Weekly CLASS** — every Tuesday 18:00–19:00 from the first Tuesday the user gave, no end date:

```json
{
  "returnEntity": true,
  "events": [{
    "event": {
      "scheduleId": "<SERVICE_SCHEDULE_ID>",
      "type": "CLASS",
      "start": { "localDate": "<FIRST_TUESDAY>T18:00:00" },
      "end": { "localDate": "<FIRST_TUESDAY>T19:00:00" },
      "resources": [{ "id": "<STAFF_RESOURCE_ID>", "permissionRole": "WRITER" }],
      "recurrenceRule": { "frequency": "WEEKLY", "interval": 1, "days": ["TUESDAY"] }
    }
  }]
}
```

This creates one `MASTER` event, and the calendar generates a weekly `INSTANCE` for each Tuesday. To stop the series on a date, add `"until": { "localDate": "<LAST_SESSION_DATE>T19:00:00" }` to `recurrenceRule`.

**COURSE** — one event per session, all in one call (here the first two of a weekly series):

```json
{
  "returnEntity": true,
  "events": [
    { "event": {
        "scheduleId": "<SERVICE_SCHEDULE_ID>",
        "type": "COURSE",
        "start": { "localDate": "<SESSION_1_DATE>T18:00:00" },
        "end": { "localDate": "<SESSION_1_DATE>T20:00:00" },
        "resources": [{ "id": "<STAFF_RESOURCE_ID>", "permissionRole": "WRITER" }]
    } },
    { "event": {
        "scheduleId": "<SERVICE_SCHEDULE_ID>",
        "type": "COURSE",
        "start": { "localDate": "<SESSION_2_DATE>T18:00:00" },
        "end": { "localDate": "<SESSION_2_DATE>T20:00:00" },
        "resources": [{ "id": "<STAFF_RESOURCE_ID>", "permissionRole": "WRITER" }]
    } }
  ]
}
```

Rules for every session event:
- Wrap each one as `{ "event": { … } }`.
- `scheduleId` is the **service's** `schedule.id` — not a staff member's schedule — and `type` matches the service type (`CLASS` or `COURSE`).
- `resources` must hold at least one resource; without it the call fails with `400 resources must have at least 1 resource for class events`. Use the instructor's staff `resourceId`.
- Every resource needs `"permissionRole": "WRITER"`. Without it the whole call fails with `400 resources.permissionRole must not be UNKNOWN_ROLE`.
- `start.localDate` / `end.localDate` are local times without a `Z`, in the schedule's time zone (the site's, unless you set `event.timeZone`). A recurring event must start today or later — check the current date before you build the dates.
- A `recurrenceRule` takes exactly one day. For "Tuesdays and Thursdays", send two events, one per day.
- Leave `totalCapacity` out: sessions inherit the service's `defaultCapacity`, and setting it detaches that session from later capacity changes.

**Read the response** the same way as Step 4: check `bulkActionMetadata.totalFailures` and each `results[i].itemMetadata.success`, and fix and resend only the failed events. A `400` (no `results` at all) means nothing was created.

**Confirm the sessions exist** before you call the service bookable:

`POST https://www.wixapis.com/calendar/v3/events/query`

```json
{
  "fromLocalDate": "<TODAY>T00:00:00",
  "toLocalDate": "<AFTER_LAST_SESSION>T00:00:00",
  "query": { "filter": { "scheduleId": "<SERVICE_SCHEDULE_ID>" } }
}
```

The result lists the generated sessions (`INSTANCE` events for a weekly class, the single events for a course). For a course, the service itself also reports the span: `GET https://www.wixapis.com/bookings/v2/services/<SERVICE_ID>` returns `schedule.firstSessionStart` and `schedule.lastSessionEnd` once sessions exist.

**Change sessions later** with `POST https://www.wixapis.com/calendar/v3/bulk/events/update`, sending each event's `id`, its current `revision` and only the fields that change:

```json
{
  "events": [{
    "event": {
      "id": "<EVENT_ID>",
      "revision": "<EVENT_REVISION>",
      "start": { "localDate": "<NEW_DATE>T19:00:00" },
      "end": { "localDate": "<NEW_DATE>T20:00:00" }
    }
  }]
}
```

For a weekly class, update the `MASTER` event (its id is in the create response, or query events with `"recurrenceType": ["MASTER"]`) to move every future session; updating one `INSTANCE` changes only that session. Details: [Bulk Update Event](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-update-event).

### Step 6: Appointment availability

An APPOINTMENT has no events of its own: its free slots come from the working hours of the staff in `staffMemberIds`, which by default follow the business hours. If the user wants different hours for that staff member, follow [Bookings Staff Setup](bookings-staff-setup.md) — it detaches the staff member from the business hours and creates `WORKING_HOURS` events on the staff member's own schedule.

### Step 7: Report back

Base the summary on the API responses, not on what you sent:
1. **What was created** — name, type, price as stored (amount and currency; "per session" for a class, "for the whole course" for a course; "free" if no price was given, with an offer to set one), capacity, duration or staff for an appointment, category, and hidden if it is.
2. **Assumptions** — every default from Step 2 you applied ("I set capacity to 10 since you didn't say").
3. **Sessions** (CLASS / COURSE) — the sessions you created and confirmed: list each session's date and time (for a weekly class with no end date, the weekday, time and first date). If none exist yet, say the service can't be booked until it has sessions, and end with a direct question for them: the weekday(s), start and end time, and first date — for a course, the date of each session or the weekly pattern and how many sessions.
4. **What you can change** — offer to adjust price, capacity, duration, staff or schedule.

---

## Part 2 — Change an existing service

### Find it and read its revision

When the user gave a service ID, use it. Otherwise list the services and match the name the user used:

`POST https://www.wixapis.com/bookings/v2/services/query`

```json
{ "query": { "paging": { "limit": 100 } } }
```

Page with `offset` as in Step 3 on a site with more than 100 services. If more than one service matches, ask the user which one; if none does, say so rather than creating one. Then read it to get its current `revision` and current values:

`GET https://www.wixapis.com/bookings/v2/services/<SERVICE_ID>`

### Update it

`PATCH https://www.wixapis.com/bookings/v2/services/<SERVICE_ID>` — send only the fields you're changing, with the current `revision` **inside** the `service` object (a `revision` at the top level fails with `revision must not be empty`):

```json
{
  "service": {
    "revision": "<REVISION_FROM_GET>",
    "category": { "id": "<CATEGORY_ID>" }
  }
}
```

The same shape changes the name, description, capacity, `hidden` (`true` hides the service from the site's booking pages, `false` shows it again) or `onlineBooking`. Update the existing service — don't delete and recreate it, which loses its bookings and sessions.

**Free → paid.** A `NO_FEE` service becomes paid only when one update sends the whole payment object — `rateType: "FIXED"`, `options` and `fixed.price` together. Send the `options` the GET returned (a free service usually has `inPerson: true`), so customers keep paying the way they already could; turn on `online` only when the user asks for online payment. Patching just `fixed.price` fails validation (`Payment of type FREE cannot be used with payment.rate`, or `payment.type Payment type must be set to FIXED`):

```json
{
  "service": {
    "revision": "<REVISION_FROM_GET>",
    "payment": {
      "rateType": "FIXED",
      "options": { "online": false, "inPerson": true },
      "fixed": { "price": { "value": "35" } }
    }
  }
}
```

The price takes the site's currency, as on create. To change only the amount of a service that is already `FIXED`, send the same payment object with the new value.

**Several services at once.** [Bulk Update Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-update-services) takes a list of services (each with its own `id` and `revision`); [Bulk Update Services By Filter](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-update-services-by-filter) applies one change to every service a filter matches ("make all my services 60 minutes").

**Changing the type** (`"type": "COURSE"` in the same PATCH) deletes the service's schedule and sessions and creates a new schedule. Confirm with the user before doing it, then schedule the sessions again on the new `schedule.id` (Step 5).
- An APPOINTMENT that already has future bookings can't change type — the update fails with `can't change a service of type appointment after it has been booked`. Tell the user; don't cancel their bookings to get around it.
- Changing to or from COURSE resets the service's locations to the site's default business location; restore any other location the user needs with [Set Service Locations](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/set-service-locations). Changing an APPOINTMENT to a CLASS or COURSE also clears its `staffMemberIds` and session durations.

**Deleting a service**: `DELETE https://www.wixapis.com/bookings/v2/services/<SERVICE_ID>` cancels its future sessions. Confirm with the user first.

---

## Errors

| Error | Cause | Fix |
|---|---|---|
| `service of type appointment requires at least one staff member id` | APPOINTMENT without `staffMemberIds` | Query staff (Step 3) and send a `resourceId` |
| `primary_resource_type is required for appointment services without staff members` | An APPOINTMENT booked by a room or equipment | Follow [Multi-Resource Service Creation](multi-resource-service-creation.md) for the body |
| `INVALID_PAYMENT_OPTIONS` — "mandatory to specify either payment.options.online or payment.options.inPerson as true" | No payment option set | Set `inPerson: true` (free) or `online: true` (paid) |
| `INVALID_PAYMENT_OPTIONS` — "online as true is applicable only to payments of types FIXED or VARIED" | `online: true` on a `NO_FEE` service | Free services use `online: false, inPerson: true` |
| `Payment of type FREE cannot be used with payment.rate` | Price set on a `NO_FEE` service without changing `rateType` | Send `rateType: "FIXED"`, `options` and `fixed.price` in one update |
| `revision must not be empty` / `service.revision is required` | `revision` missing or outside `service` | `{ "service": { "revision": "…", … } }`, revision from a fresh GET |
| `resources.permissionRole must not be UNKNOWN_ROLE` | Session resource without `permissionRole` | `"resources": [{ "id": "…", "permissionRole": "WRITER" }]` |
| `resources must have at least 1 resource for class events` | Session event without `resources` | Add the instructor's staff `resourceId` |
| Course page says "Ended" or "This service is not available" | The course has no future sessions | Create the sessions (Step 5) and confirm them |
| `428` app not installed | Wix Bookings isn't on the site | Install it with [Install Wix Apps](../app-installation/install-wix-apps.md) and retry |

---

## Reference

- Services: [Bulk Create Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services) · [Create Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/create-service) (field rules) · [Get Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/get-service) · [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services) · [Update Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service) · [Bulk Update Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-update-services) · [Bulk Update Services By Filter](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-update-services-by-filter) · [Delete Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/delete-service)
- Concepts: [About Service Types](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types) · [About Service Payments](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-payments) · [About Service Locations](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-locations)
- Categories: [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories) · [Create Category](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/create-category)
- Staff: [Query Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/query-staff-members) · [Create Staff Member](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/create-staff-member) · [Assign Working Hours Schedule](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/assign-working-hours-schedule)
- Sessions: [Bulk Create Event](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-create-event) · [Bulk Update Event](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-update-event) · [Query Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/query-events)
- Media: [Search Files](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/search-files) · [Bulk Import File](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/bulk-import-file)

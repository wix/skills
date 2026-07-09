---
name: "Setup Bookings"
description: Initializes a Wix Bookings backend with Services V2 — resolves a staff resource + a category, then creates bookable services (APPOINTMENT/CLASS) with duration, price, and online booking enabled, and schedules sessions for classes. Specifies the *how* (calls + format); counts and the specific services/durations/prices come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Bookings (Services V2)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for turning a freshly provisioned Wix site with the **Wix Bookings** app installed into a populated catalog of bookable services.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial Bookings backend setup. (The frontend read/booking contract is the sibling recipe `how-to-code-bookings.md`.)

> **This recipe is the *how*, not the *what*.** What to seed — how many services, which are appointments vs classes, their durations and prices, whether there are named categories or multiple staff — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities or which services to create.

> **API surfaces:** services use **Services V2** on the **public** host `https://www.wixapis.com/bookings/v2/...`. The method page's schema header shows an internal `…/_api/bookings/v2/services` form — **do not use that**; call the public `…/bookings/v2/services` form shown below. Staff members are a **V1** API (`…/bookings/v1/staff-members`). Class sessions are **Calendar Events V3** (`…/calendar/v3/events`) — a different API from Bookings. The Wix Bookings **app id** (needed only by the frontend, kept here for reference) is `13d21c63-b5ec-5912-8397-c3a5ddb27a97`.

---

## Article: Steps for Setting Up Wix Bookings
**YOU MUST** complete the following steps **in the given order** (1-4) without skipping any and **without requiring additional user input**. The **Attach images** step runs **only when imagery is on** — skip it entirely otherwise.

**⚠️ CRITICAL ORDER REQUIREMENT: resolve a staff resource (STEP 1) and a category (STEP 2) BEFORE creating services (STEP 3).** An APPOINTMENT service is rejected (`MISSING_APPOINTMENT_RESOURCES`) unless `staffMemberIds` is non-empty, and **any service without a `category.id` is invisible on the live site** (see STEP 3). For CLASS services, sessions are created **after** the service (STEP 4) because they need the service's returned `schedule.id`.

There is **no clean-up step** — a fresh Wix Bookings install ships no sample *services* (only a default "Business Owner" staff resource, which you reuse in STEP 1), so there is nothing to delete first.

### STEP 1: Resolve a staff resource (REQUIRED for APPOINTMENT)

An APPOINTMENT service needs at least one **resource** in `staffMemberIds`; an empty array is rejected with `MISSING_APPOINTMENT_RESOURCES` (*"service of type appointment requires at least one staff member or service resource"*). CLASS services do **not** need this.

**Query the existing staff** to get a `resourceId` — a fresh install always has a default **Business Owner** resource:

```bash
curl -X POST 'https://www.wixapis.com/bookings/v1/staff-members/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {}, "fields": ["RESOURCE_DETAILS"] }'
```

**⚠️ CRITICAL: `staffMemberIds` takes the `resourceId`, NOT the staff `id`.** Read `staffMember.resourceId` from the response (it's a different GUID from `staffMember.id`). Using `staffMember.id` is the most common cause of "service has no provider" at runtime. Keep the `resourceId` (and `staffMember.id` + `name`) of every staff you'll use.

**When the request wants named staff** (e.g. a salon with multiple stylists — derived from the request, not invented), create them first, then use their `resourceId`s:

```bash
curl -X POST 'https://www.wixapis.com/bookings/v1/staff-members' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "staffMember": { "name": "<First Last>", "description": "<short brand-appropriate bio>" } }'
```

- **⚠️ Do NOT send `"email": ""` or `"phone": ""`** — V1 format-validates them and rejects empty strings (`is not a valid email/phone`). **Omit the keys** unless you have a real value.
- **Do NOT configure custom working hours during seed.** New staff inherit the business working hours at creation time — that's enough for an initial build; the merchant sets custom hours from the dashboard. (The two-step custom-hours flow — `assignWorkingHoursSchedule` + `WORKING_HOURS` events — is fragile and out of scope here.)
- If the query returns **"Business schedule not found"**, the Bookings app isn't installed/provisioned — **fail loudly** with the response verbatim; do not try to install it.

### STEP 2: Resolve (or create) a category

**⚠️ CRITICAL: every service needs a `category.id` or it is NOT visible on the live site.** This is the Bookings analog of the Stores `visible:true` trap — a service created without a category is created successfully but hidden. **A fresh Bookings install ships ZERO categories**, so you **must create at least one** and assign it to every service. Do **not** assume a default "Our Services" category exists to reuse — it does not.

**Query existing categories first** (to reuse one if a prior step in this run already created it):

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {} }'
```

On a fresh site this returns `count: 0`. **Create a category** — one is enough (name it "Our Services" or something brand-appropriate). Create *additional* named categories only when the request wants grouping/filtering (the frontend shows a category bar only when more than one category exists). One call per category (they're independent — no shared revision, unlike Stores categories):

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "category": { "name": "Our Services" } }'
```

The response is `{ "category": { "id": "<categoryId>", … } }` — keep each `id`. A service belongs to **one** category; when you create several, distribute services across them so the filter is meaningful.

### STEP 3: Create the services

Create **all the services in a single bulk call** against the **public** endpoint `POST https://www.wixapis.com/bookings/v2/bulk/services/create` (up to **100** services per call — `services[]`). **How many services, their types, durations, and prices come from the request you're fulfilling** — this step only gives the call and the required format. (A single-service `POST …/bookings/v2/services` with a top-level `service` object also exists, but prefer the bundled bulk call.)

**⚠️ CRITICAL: the V2 service payload is FLAT — name/description/tagLine are top-level on each service object, NOT nested under `info`.** The V1 `info.name`/`info.description` shape is rejected by V2. Price uses `value` (a **string**), not `amount`.

**Request body shape** (one paid 60-minute APPOINTMENT shown — repeat service objects inside the `services` array; APPOINTMENT and CLASS may be mixed in one call):

```json
{
  "services": [
    {
      "type": "APPOINTMENT",
      "name": "Consultation",
      "description": "A brand-appropriate description of the service.",
      "tagLine": "Short tagline",
      "defaultCapacity": 1,
      "onlineBooking": { "enabled": true, "requireManualApproval": false, "allowMultipleRequests": false },
      "schedule": { "availabilityConstraints": { "sessionDurations": [60] } },
      "payment": {
        "rateType": "FIXED",
        "fixed": { "price": { "value": "75.00", "currency": "USD" } },
        "options": { "online": true, "inPerson": false }
      },
      "category": { "id": "<CATEGORY_ID_FROM_STEP_2>" },
      "locations": [ { "type": "BUSINESS" } ],
      "staffMemberIds": ["<RESOURCE_ID_FROM_STEP_1>"]
    }
  ],
  "returnEntity": true
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **`category.id` is mandatory for visibility** (STEP 2). Assign one to every service.
- **`onlineBooking: { "enabled": true }` is required** for all services — V2 rejects the create without it, even though it reads as optional.
- **`defaultCapacity` is required for ALL types** — `1` for APPOINTMENT; the max participants for CLASS (e.g. `20`).
- **`payment.options` — at least one of `online`/`inPerson` must be `true`** (see the validation table below). This holds even for **free** services.
- **`schedule.availabilityConstraints.sessionDurations`** — required for **APPOINTMENT only** (an array with one integer in minutes). Do **not** send it for CLASS/COURSE.
- **`staffMemberIds`** — required and **non-empty for APPOINTMENT** (pass the `resourceId`(s) from STEP 1; the default Business-Owner `resourceId` when the request names no staff). **Ignored for CLASS/COURSE** — omit it.
- **`locations[].type`** — use **`"BUSINESS"`**, never `"OWNER_BUSINESS"` (the services endpoint rejects it; `OWNER_BUSINESS` is valid only on `createBooking`'s slot location — same field name, different enum).
- **Currency** — the **site's business currency wins**: a EUR-locale site stores `EUR` even if you send `USD`. This is not an error; don't fight it (the frontend formats from the returned `currency`).
- **Imagery is opt-in** (`SEED.md` § "Entity images"). Seed **text-only** by default — omit `media` here. When imagery is on, attach the image in the dedicated pass-2 **Attach images** step after the service exists.

**Payment-options validation** (rejecting combos return `INVALID_PAYMENT_OPTIONS`):

| `rateType` | `options.online` | `options.inPerson` | Valid? |
|---|---|---|---|
| FIXED / VARIED | true | false / true | ✓ |
| FIXED / VARIED | false | true | ✓ |
| **NO_FEE** (free) | **false** | **true** | ✓ |
| NO_FEE (free) | true | — | ✗ — online is only for FIXED/VARIED |
| any | false | false | ✗ — at least one must be true |

A **free** service therefore omits `fixed` and uses `"rateType": "NO_FEE"`, `"options": { "online": false, "inPerson": true }`.

**⚠️ Reading the response — created services are under `results[]`, each as `results[].item` with per-item `results[].itemMetadata`.** A successful bulk create returns `200` with:

```json
{ "results": [
  {
    "itemMetadata": { "id": "<serviceId>", "originalIndex": 0, "success": true },
    "item": {
      "id": "<serviceId>",
      "name": "…",
      "type": "APPOINTMENT",
      "mainSlug": { "name": "<url-slug>", "custom": false },
      "schedule": { "id": "<scheduleId>", "availabilityConstraints": { … } },
      "payment": { … }
    }
  }
], "bulkActionMetadata": { "totalSuccesses": 1, "totalFailures": 0 } }
```

(`item` is present only because you sent `"returnEntity": true`.) Keep each service's **`item.id`**, **`item.mainSlug.name`** (the frontend links by slug — if absent, derive it from the name: lowercase, non-alphanumerics → hyphens, dedupe), and — for CLASS — **`item.schedule.id`** (needed for STEP 4). **Check `itemMetadata.success` per item** (`false` populates `itemMetadata.error`); retry only the **failed** services **once** with the exact same format — do not loop, and don't re-create the ones that already succeeded.

**Service modeling judgment** (the *what* still comes from the request, but model it correctly):
- **APPOINTMENT** = a customer picks a time (1-on-1: consults, haircuts, treatments). Availability comes from staff working hours — no extra step.
- **CLASS** = a recurring group session many customers book (yoga, workshops). Needs `defaultCapacity` and **scheduled sessions** (STEP 4) or its calendar is permanently empty.
- **COURSE** is out of scope for a basic seed (it requires booking + calendar events + whole-course enrollment) — use CLASS for group offerings unless the request explicitly needs fixed multi-session courses.

### STEP 4: Schedule sessions for CLASS services (CLASS only — skip for APPOINTMENT)

Creating a CLASS service does **not** create any bookable sessions; the frontend lists sessions via `eventTimeSlots`, which returns scheduled **session events**. A freshly created CLASS has none — its calendar is a dead end until you add sessions. Sessions are **Calendar Events V3**, created from each CLASS's returned `schedule.id`. Create **all sessions across all classes in a single bulk call** to `POST https://www.wixapis.com/calendar/v3/bulk/events/create` (a few upcoming sessions per class, e.g. 3 over the next ~2 weeks):

```json
{
  "events": [
    {
      "event": {
        "scheduleId": "<item.schedule.id of a CLASS FROM STEP 3>",
        "type": "CLASS",
        "start": { "localDate": "<FUTURE_DATE>T09:00:00" },
        "end":   { "localDate": "<FUTURE_DATE>T10:00:00" },
        "resources": [ { "id": "<RESOURCE_ID_FROM_STEP_1>", "permissionRole": "WRITER" } ],
        "totalCapacity": 12
      }
    }
  ]
}
```

**⚠️ CRITICAL: each element of `events` MUST be wrapped in `{ "event": { … } }`** — a bare event object is rejected. Other requirements:
- **`resources` must be non-empty** for a CLASS event (a session with no resource is rejected), and **`resources[].permissionRole` must be `"WRITER"`** (or `"COMMENTER"`) — omitting it defaults to `UNKNOWN_ROLE` → `400 "resources.permissionRole must not be UNKNOWN_ROLE"`. Use the same `resourceId` from STEP 1.
- **`start`/`end` use `{ "localDate": "YYYY-MM-DDThh:mm:ss" }`** — local time, **no `Z`** (seconds ignored). Use **today-or-future** dates.
- One bulk call can mix sessions for **different classes** — each event carries its own `scheduleId`. The response is the standard bulk shape (`results[]` with per-item `itemMetadata.success` + a `bulkActionMetadata` tally); retry only failed events once.
- For a recurring weekly schedule instead of one-off sessions, add `event.recurrenceRule` (`{ "frequency": "WEEKLY", "interval": 1, "days": ["MONDAY"], "until": { "localDate": "…" } }`) — only `WEEKLY` and a **single** day per rule are supported. One-off sessions are simpler and sufficient for a seed.
- `totalCapacity` defaults to the schedule's `defaultCapacity` if omitted; set it explicitly to the class size.

Keep each session's event id — it's `results[].itemMetadata.id` (the events bulk sends no `returnEntity`, so there is **no `item`** in its response, only `itemMetadata`) — under `seeded.services[].sessionEventIds` if the frontend will deep-link. If STEP 4 is skipped or fails, record a `notes` entry so it's surfaced: *"CLASS sessions not scheduled — add session times in the Bookings dashboard before sign-up works."*

### Attach images (imagery ON only — skip otherwise)

**Only when `imagery` is on** (`SEED.md` § "Entity images"). This is the bookings entry in the required pass-2 "attach the image to the entity" flow — the service was created text-only in STEP 3; now write the image onto it. Obtain the image per `references/IMAGE_GENERATION.md` (generate + import, or import an existing URL) → keep `file.url` and its `file.id`, then patch the service.

**The image is written under `media.mainMedia` and `media.coverMedia`, each `{ "image": { "id", "url", "width", "height" } }`.** Per the Services V2 reference (`references/bookings/create-and-update-booking-services.md`): `media.mainMedia` is shown in the services list, `media.coverMedia` on the service page, and `media.items[]` is the service-page gallery. The binding field is the image **`id`** (the Wix Media file id); `url` and dimensions are descriptive. Write shape:

```json
{
  "service": {
    "id": "<serviceId>",
    "revision": "<current revision>",
    "media": {
      "mainMedia":  { "image": { "id": "<file.id>", "url": "<file.url>", "width": 1024, "height": 1024 } },
      "coverMedia": { "image": { "id": "<file.id>", "url": "<file.url>", "width": 1024, "height": 1024 } }
    }
  }
}
```

```bash
# GET the service first for its current revision (a stale/omitted revision → conflict):
curl -X PATCH 'https://www.wixapis.com/bookings/v2/services/<serviceId>' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "service": { "id": "<serviceId>", "revision": "<current revision>", "media": { "mainMedia": { "image": { "id": "<file.id>", "url": "<file.url>", "width": 1024, "height": 1024 } }, "coverMedia": { "image": { "id": "<file.id>", "url": "<file.url>", "width": 1024, "height": 1024 } } } } }'
```

- **Fetch the current `revision` first** (`GET https://www.wixapis.com/bookings/v2/services/<serviceId>`, or reuse the `item.revision` from STEP 3's `returnEntity` response) and echo it back — a services V2 update is revision-checked.
- **⚠️ Writing the image under `media.image` (an `image` object directly under `media`) returns `HTTP 200` but silently drops it — the `revision` increments and no image lands.** Because the failure is a silent `200`, not a `400`, a successful status code is **not** on its own proof the image attached: **confirm by re-querying the service** (`GET …/bookings/v2/services/<serviceId>`) and checking `media.mainMedia` is populated.
- **Never block on image failure** (`SEED.md` § "Entity images" / IMAGE_GENERATION "Credits, cost & the not-generating fallback") — on failure, skip and leave the service text-only.

---

## Conclusion
Following these steps **in order** sets up a new Services V2 Wix Bookings site:
- Every service is assigned a **`category.id`** so it appears on the live site (the visibility invariant) — a fresh install has **no** categories, so at least one is **created** (extra named categories only when the request wants a filter).
- Every APPOINTMENT carries a non-empty **`staffMemberIds`** of staff **`resourceId`** values (the default Business-Owner resource when no staff are named), so it isn't rejected with `MISSING_APPOINTMENT_RESOURCES`.
- Services use the correct **flat Services V2** shape on the **public** host, with `onlineBooking.enabled`, `defaultCapacity`, a valid `payment.options` combo, and `sessionDurations` for appointments.
- Every CLASS has scheduled **Calendar Events V3** sessions, so its calendar is bookable rather than empty.
- **When imagery is on**, each service's image is attached by the **Attach images** step (pass-2) via `PATCH …/services/{id}` under `media.mainMedia`/`media.coverMedia` (each `{ image: { id, url, width, height } }`), revision-checked and confirmed with a follow-up query — writing under `media.image` returns `200` but silently drops the image; on failure the service stays text-only.
- IDs kept for the coding handoff: `serviceIds[]`, service `slug`s (`mainSlug.name`), staff `resourceId`s, category ids, and CLASS `sessionEventIds`.

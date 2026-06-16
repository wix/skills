# Bookings Seed — Services Data

You are seeding Wix Bookings services for a headless site. Your job:
1. Mint a site-scoped token once.
2. **If `intent.bookings.hasStaff` is `true`** — create staff members FIRST (Step 3 below), then pass their `resourceId`s on each service. **Every APPOINTMENT service needs a non-empty `staffMemberIds`** or it's rejected with `MISSING_APPOINTMENT_RESOURCES` — even when `hasStaff` is false you must pass the default **Business Owner** `resourceId` (see § "When hasStaff is false"). (CLASS services don't need a resource at create time.)
3. Create `intent.bookings.serviceCount` services via the Bookings V2 REST API. When staff exist, pass their `resourceId` values via `staffMemberIds`.
4. Return all created IDs in the standard return contract.

> **Order matters.** Steps 3 and 4 in this file are presented in the order you should execute them: staff first (when applicable), then services. The old "services-first then staff-optionally" order fails for APPOINTMENT with `MISSING_APPOINTMENT_RESOURCES`.

---

## Step 1 — Mint the token

```bash
TOKEN=$(npx @wix/cli@latest token --site "<siteId>")
```

Cache in subagent scratch. Every subsequent `curl` reuses it. Every call carries:
```
Authorization: Bearer $TOKEN
wix-site-id: <siteId>
Content-Type: application/json
```

---

## Step 2 — Verify Wix Bookings is installed

Query staff members as an installation check. A successful response (even an empty list) confirms Bookings is installed:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: <siteId>" \
  -H "Content-Type: application/json" \
  -d '{"query":{}}' \
  "https://www.wixapis.com/bookings/v1/staff-members/query"
```

- **200 OK** → proceed.
- **403 / "Business schedule not found"** → Bookings app is not installed. Return `status: "error"` with the response verbatim. Do not attempt to install it — the orchestrator's Setup phase handles app installation.

---

## Step 3 — Create staff members (when `intent.bookings.hasStaff` is `true`)

Execute this step BEFORE Step 4 when staff are required. APPOINTMENT services need at least one resource to exist before they can be created.

For each staff member to create (derive names from the brand; default to 2 staff):

```bash
# Build the payload — only include phone/email when non-empty.
# The V1 staff-members API rejects "" as an invalid email/phone.
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: <siteId>" \
  -H "Content-Type: application/json" \
  -d '{
    "staffMember": {
      "name": "<First Last>",
      "description": "<professional bio — 1–2 sentences, brand-appropriate>"
    }
  }' \
  "https://www.wixapis.com/bookings/v1/staff-members"
```

> **Do NOT send `"phone": ""` or `"email": ""`** — V1 validates them as format-checked fields and rejects empty strings with `is not a valid email/phone`. Omit the keys entirely when you don't have a real value. If the merchant later wants to populate phone/email, they can do it from the dashboard or via a PATCH.

**Important:** Staff inherit business working hours at creation time. For a basic seed, this is fine — the merchant can configure custom hours from the dashboard later.

Save `staffMember.id` and `staffMember.resourceId` from each response. **You will pass the `resourceId` values into the `staffMemberIds` field on each service in Step 4.**

> **Note:** `staffMemberIds` on services expects `resourceId` values (from `staffMember.resourceId`), NOT `staffMember.id`. Using `staffMember.id` here is the most common cause of "service has no provider" runtime errors.

> **Do NOT attempt custom working hours setup during seed.** The two-step custom-hours workflow (assignWorkingHoursSchedule + WORKING_HOURS events) is complex and fragile. Default inherited hours are sufficient for an initial build. If you encounter "Business schedule not found", skip staff creation and return a warning in `notes`.

### When `hasStaff` is `false`

For `serviceType: "CLASS"`, no staff/resource is needed at service-creation time — skip this step.

For `serviceType: "APPOINTMENT"` with `hasStaff: false`, you **still must pass a resource** in `staffMemberIds` — an empty `[]` is **rejected** with `MISSING_APPOINTMENT_RESOURCES` (*"service of type appointment requires at least one staff member or service resource"*). The Wix Bookings app provisions a default **Business Owner** resource at install; query it and pass **its** `resourceId`:

```bash
# Get the default Business-Owner resourceId (no staff were created).
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "wix-site-id: <siteId>" -H "Content-Type: application/json" \
  -d '{"query":{}}' "https://www.wixapis.com/bookings/v1/staff-members/query"
# → take the staffMember named "Business Owner" and use its `resourceId` as the single
#   entry in each APPOINTMENT service's `staffMemberIds`.
```

(Do **not** rely on `[]` — the default resource does not auto-satisfy the requirement at create time. CLASS services don't need this.)

---

## Step 3b — Create categories (OPTIONAL — only to surface the catalog category filter)

A fresh Bookings install has **one** default category ("Our Services"), so the
front-end's category filter bar stays hidden (it shows only when >1 category
exists). Create extra categories **only when the build wants a category filter**
(e.g. `intent.bookings.categories` is set, or several distinct service groups).
Skip this step otherwise — it's not needed for a basic seed.

```bash
# Create a category. Returns { category: { id, ... } } — save the id.
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: <siteId>" -H "Content-Type: application/json" \
  -d '{ "category": { "name": "<Category name, e.g. Massage>" } }' \
  "https://www.wixapis.com/bookings/v2/categories"
```

Then **assign each service to a category** by including `category` in the Step-4
create payload: `"category": { "id": "<categoryId>" }`. (If a create rejects
`category`, assign it after creation via Update Service — `PATCH
/_api/bookings/v2/services/{id}` with `service.category.id` + the current
`revision` — per the docs' "create a category and connect a service" flow.) A
service can belong to **one** category. Distribute services across 2+ categories
so the filter is meaningful.

> The front-end reads categories via `categoriesV2.queryCategories().find()` and
> filters services with `filter["category.id"] = { $eq: id }`. No category data →
> no filter bar (graceful).

---

## Step 3c — Multiple business locations (OPTIONAL — only for a multi-location demo)

The front-end's location selector auto-skips when the site has ≤1 location, so a
single-location seed needs nothing here (and the booking flow is unaffected).
Create a second business location **only** for a multi-location build
(`intent.bookings.multiLocation`):

```bash
# Create a business location. Returns { location: { id, ... } }.
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: <siteId>" -H "Content-Type: application/json" \
  -d '{ "location": { "name": "<Branch name>", "status": "ACTIVE", "locationType": "BUSINESS",
        "address": { "city": "<City>", "country": "<ISO country>" } } }' \
  "https://www.wixapis.com/locations/v1/locations"
```

Then attach locations to each service's `locations` array on create (Step 4):
`"locations": [ { "type": "BUSINESS", "business": { "id": "<locationId>" } }, … ]`.

> **Caveat (verified-behavior limitation, not a bug):** filtering *availability*
> by location also depends on each staff member's **working-hours location
> coverage** (the `STAFF_WORKING_HOURS_LOCATIONS` setting). Seeding that reliably
> is as fragile as custom working hours (see Step 3's warning), so for a seed,
> create the location + attach it to services to exercise the **catalog** location
> filter, and configure per-location staff hours from the Bookings dashboard if you
> need per-location availability to differ. The selector + service filtering work
> from the seed alone; per-location *slot* differences need the dashboard step.

---

## Step 4 — Create services (Services V2 API)

**Endpoint:** `POST https://www.wixapis.com/_api/bookings/v2/services`

> **V2 payload is flat — NOT nested under `info`.** Fields are `name`, `description`, `tagLine` at the top level of the `service` object. The V1 shape (`info.name`, `info.description`) is rejected by V2. Price uses `value`, not `amount`.

For each service to create (derive names, descriptions, and prices from `brand` + `intent.bookings`):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: <siteId>" \
  -H "Content-Type: application/json" \
  -d '{
    "service": {
      "type": "<APPOINTMENT|CLASS>",
      "name": "<service name>",
      "description": "<brand-appropriate description>",
      "tagLine": "<short tagline>",
      "defaultCapacity": 1,
      "onlineBooking": {
        "enabled": true,
        "requireManualApproval": false,
        "allowMultipleRequests": false
      },
      "schedule": {
        "availabilityConstraints": {
          "sessionDurations": [<duration as integer, e.g. 60>]
        }
      },
      "payment": {
        "rateType": "FIXED",
        "fixed": {
          "price": {
            "value": "<price as string, e.g. \"75.00\">",
            "currency": "USD"
          }
        },
        "options": {
          "online": true,
          "inPerson": false,
          "deposit": false,
          "pricingPlan": false
        }
      },
      "locations": [
        {
          "type": "BUSINESS"
        }
      ],
      "staffMemberIds": [<resourceId values — staff from Step 3, OR the default Business-Owner resourceId when hasStaff is false. NEVER [] for APPOINTMENT — it 400s with MISSING_APPOINTMENT_RESOURCES>]
    }
  }' \
  "https://www.wixapis.com/_api/bookings/v2/services"
```

> **`locations.type` enum:** the valid values are `UNKNOWN_LOCATION_TYPE`, `CUSTOM`, `BUSINESS`, and `CUSTOMER`. Use `"BUSINESS"` for "at the business address" (the seed default). Do NOT use `"OWNER_BUSINESS"` here — that string IS valid for `createBooking.bookedEntity.slot.location.locationType` on the bookings endpoint, but the **services** endpoint rejects it. Same field name, different enum.

> **`staffMemberIds`:** pass `resourceId` values (not staffMember `id` values). For APPOINTMENT this array must be **non-empty** — when `hasStaff` is `false`, pass the default **Business Owner** `resourceId` (query it per § "When hasStaff is false"); `[]` is rejected with `MISSING_APPOINTMENT_RESOURCES` (verified live). CLASS services don't require it.

**Response shape:**
```json
{
  "service": {
    "id": "<uuid>",
    "name": "<name>",
    "description": "<description>",
    "mainSlug": { "name": "<url-slug>", "custom": false },
    "supportedSlugs": [{ "name": "<url-slug>", "custom": false }],
    "type": "APPOINTMENT",
    "payment": { ... },
    "schedule": { ... }
  }
}
```

> **Slug:** Extract from `service.mainSlug.name`. If absent, derive from the service name: lowercase, replace spaces and non-alphanumeric chars with hyphens, deduplicate hyphens.

### Service creation guidelines

- **Count**: Create exactly `intent.bookings.serviceCount` services (default 3 when not specified).
- **Type**: Use `"APPOINTMENT"` for 1-on-1 services (the default); use `"CLASS"` when `intent.bookings.serviceType === "CLASS"`. For `CLASS`, set `defaultCapacity` to the max participants (e.g. `20`) instead of `1`.

> **⚠️ CLASS services need scheduled sessions before anyone can sign up.** Creating a CLASS service does **not** create any bookable sessions. The front-end lists bookable sessions via `eventTimeSlots.listEventTimeSlots()`, which returns scheduled **session events** — a freshly created CLASS service has none, so its calendar is permanently empty. **For CLASS services you MUST run Step 4b below** to schedule sessions; otherwise the class calendar is a dead end. (APPOINTMENT services don't need this — their bookable times come from staff working hours + `availabilityTimeSlots`.)
- **`sessionDurations`**: Required for APPOINTMENT. An array containing one integer (minutes). Do NOT specify for CLASS or COURSE services.
- **Names + descriptions**: Derive from `brand.description`. Examples: a yoga studio → "60-min Vinyasa Flow" (60 min), "30-min Morning Meditation" (30 min), "90-min Deep Restore" (90 min). A hair salon → "Women's Cut & Style" (60 min, $85), "Men's Haircut" (30 min, $45), "Balayage Color" (120 min, $150). Make them brand-appropriate — not generic.
- **Duration** (integers in minutes): Brand-appropriate. Consultation → 30; standard service → 60; premium/complex → 90–120.
- **Price `value`**: A string, not a number. Brand-appropriate, non-trivial. A budget studio might charge `"25.00"`; a premium clinic `"250.00"`. Default to mid-range when unclear.
- **Currency**: Set `"USD"` unless the brand's locale implies otherwise — **but note the site's business currency wins**: Services V2 silently stores the site-locale currency (e.g. a EUR-locale site stores `EUR` even when you send `USD`). This is not an error; the page templates format from the service's returned `currency`, so display stays correct. Don't fight it.
- **Fire all service creates as a parallel batch** — they are independent calls.

### Required fields summary (V2)

| Field | Required | Notes |
|-------|----------|-------|
| `type` | Yes | `APPOINTMENT`, `CLASS`, or `COURSE` |
| `name` | Yes | Display name |
| `defaultCapacity` | Yes | `1` for APPOINTMENT; participant count for CLASS |
| `onlineBooking.enabled` | Yes | Set to `true` for online booking |
| `payment.rateType` | Yes | `FIXED`, `NO_FEE`, `VARIED`, or `CUSTOM` |
| `payment.options.online` or `payment.options.inPerson` | Yes | At least one must be `true` |
| `schedule.availabilityConstraints.sessionDurations` | APPOINTMENT only | Array with one integer (minutes) |

---

## Step 4b — Create class sessions (CLASS services only)

A CLASS service is bookable only once its **schedule** has scheduled session events. Sessions are **Calendar Events V3** (not part of `@wix/bookings`), created via REST. Run this for every service you created with `type: "CLASS"`; skip it entirely for APPOINTMENT.

**Endpoint:** `POST https://www.wixapis.com/calendar/v3/events`

You need two things from earlier steps:
- the service's **schedule id** — `service.schedule.id` from the Step 4 create response (every service has one);
- a **resource id** — a CLASS event requires **at least one resource** (`resources` non-empty) or it's rejected. Use a staff `resourceId` from Step 3; if no staff were created, use the default Business-Owner resource's `resourceId` (query `POST /bookings/v1/staff-members/query` with `{"query":{}}` and take the one named `Business Owner`).

```bash
# One session. Repeat for several upcoming dates per class (e.g. 3 over the next
# ~2 weeks) so the calendar isn't empty. `localDate` is local time, no `Z`.
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: <siteId>" -H "Content-Type: application/json" \
  -d '{
    "event": {
      "scheduleId": "<service.schedule.id>",
      "type": "CLASS",
      "start": { "localDate": "2026-06-05T09:00:00" },
      "end":   { "localDate": "2026-06-05T10:00:00" },
      "resources": [ { "id": "<staff resourceId>", "permissionRole": "WRITER" } ],
      "totalCapacity": 12
    }
  }' \
  "https://www.wixapis.com/calendar/v3/events"
```

> **Gotchas (verified against the live API):**
> - `resources[].permissionRole` **must** be `"WRITER"` (or `"COMMENTER"`). Omitting it defaults to `UNKNOWN_ROLE` → `400 "resources.permissionRole must not be UNKNOWN_ROLE"`.
> - `resources` must be **non-empty** for CLASS — a session with no resource is rejected.
> - `start`/`end` use `{ "localDate": "YYYY-MM-DDThh:mm:ss" }` (local, no `Z`); seconds are ignored.
> - For a recurring weekly schedule instead of one-off sessions, add `event.recurrenceRule` (`{ "frequency": "WEEKLY", "interval": 1, "days": ["MONDAY"], "until": { "localDate": "..." } }` — only `WEEKLY` and a **single** day are supported; this creates a `MASTER` event and Wix auto-generates the instances). One-off sessions are simpler and sufficient for a seed.
> - `totalCapacity` defaults to the schedule's `defaultCapacity` if omitted; set it explicitly to the class size.

Verify by fetching slots the way the front-end does (`eventTimeSlots.listEventTimeSlots({ serviceIds: [id], … })`) or `POST /calendar/v3/events/query` filtered by `scheduleId`. Record each session's event id in your return under `seeded.bookings.services[].sessionEventIds` if you want Phase 4 to deep-link.

> **Booking-policy toggles (optional, CLASS).** Both live on the default booking policy — get it once via `POST /bookings/v1/booking-policies/query` with body `{"query":{}}` (an empty `{}` body is rejected with `query must not be empty`), then `PATCH /bookings/v1/booking-policies/<id>` with the relevant block + `fieldMask`:
> - **Waitlist** (so a full session offers "join waitlist"): `"waitlistPolicy": { "enabled": true, "capacity": 10, "reservationTimeInMinutes": 10 }`, `fieldMask.paths: ["waitlistPolicy"]`.
> - **Multi-participant** (party size > 1): `"participantsPolicy": { "maxParticipantsPerBooking": <N> }`, `fieldMask.paths: ["participantsPolicy"]`. **Defaults to `1`** — without raising it, the front-end party-size selector lets the user pick >1 but `createBooking` rejects it. Raise it (e.g. `4`) to actually enable multi-participant class booking.
>
> Skip whichever the build doesn't surface.

---

## Step 5 — Return contract

**Return this JSON inline as your agent return** (per `references/shared/RETURN_CONTRACT.md`) — do **NOT** write a `.wix/seed-returns/` file; the orchestrator aggregates seeder returns and is the sole writer of `.wix/seeded.json`:

```json
{
  "phase": "seed-bookings",
  "status": "ok",
  "seeded": {
    "services": [
      {
        "id": "<uuid>",
        "slug": "<mainSlug.name>",
        "name": "<name>",
        "type": "APPOINTMENT",
        "durationMinutes": 60,
        "price": "75.00",
        "currency": "USD"
      }
    ],
    "staff": [
      { "id": "<uuid>", "resourceId": "<uuid>", "name": "<name>" }
    ]
  },
  "recipeCalls": [
    { "url": "https://www.wixapis.com/_api/bookings/v2/services", "status": 200 }
  ]
}
```

- `staff` is an empty array `[]` when `intent.bookings.hasStaff` is false or Step 3 was skipped.
- **For `CLASS` services, schedule sessions in Step 4b** and report them (e.g. `seeded.bookings.services[].sessionEventIds`). Only if Step 4b is skipped or fails, add a `notes` entry so the orchestrator surfaces it: `"notes": ["CLASS sessions not scheduled — add session times in the Bookings dashboard before sign-up works."]`
- On any REST error: set `status: "error"`, include the failing call's response verbatim under `"error"`.

---

## Common failure modes

| Failure | Recovery |
|---------|----------|
| 403 on service create | Re-mint token and retry once. If still 403, Bookings app was not installed — return `status: "error"`. |
| 400 `"defaultCapacity is required"` | Add `"defaultCapacity": 1` to the payload (required in V2, not obvious from V1 docs). |
| 400 `"onlineBooking is required"` | Add `"onlineBooking": { "enabled": true }` — required in V2. |
| 400 on `payment.options` | At least one of `online` or `inPerson` must be `true`. Set `"inPerson": true` as fallback. |
| 400 `"sessionDurations is required"` | Add `"schedule": { "availabilityConstraints": { "sessionDurations": [60] } }` for APPOINTMENT types. |
| 400 `MISSING_APPOINTMENT_RESOURCES` on service create | An APPOINTMENT service's `staffMemberIds` must be **non-empty**. Pass the created staff `resourceId`s (Step 3), or — when `hasStaff` is false — the default **Business Owner** `resourceId` (query `/bookings/v1/staff-members/query` with `{"query":{}}`). An empty `[]` always 400s here. |
| 400 enum error on `locations.type` | Use `"BUSINESS"`, not `"OWNER_BUSINESS"`. The services endpoint accepts `UNKNOWN_LOCATION_TYPE`, `CUSTOM`, `BUSINESS`, `CUSTOMER`. `OWNER_BUSINESS` is valid on `createBooking.bookedEntity.slot.location.locationType` only. |
| 400 `is not a valid email/phone` on staff create | Don't send `"phone": ""` or `"email": ""`. Omit the keys entirely when you don't have a real value. |
| `mainSlug` absent in response | Derive slug from `service.name`: lowercase, replace spaces with hyphens, strip non-alphanumeric. |
| Staff create returns "Business schedule not found" | Skip staff creation. Return partial seeded data with `notes: ["Staff creation skipped — business schedule not found; configure via Bookings dashboard"]`. |

# Bookings Seed — Services Data

You are seeding Wix Bookings services for a headless site. Your job:
1. Mint a site-scoped token once.
2. **If `intent.bookings.hasStaff` is `true`** — create staff members FIRST (Step 3 below). Required ordering for APPOINTMENT services: at least one resource (staff or default business-owner) must exist BEFORE a service is created, or the API rejects with `MISSING_APPOINTMENT_RESOURCES`.
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

Skip this step entirely. For `serviceType: "CLASS"`, no staff/resource is needed at service-creation time. For `serviceType: "APPOINTMENT"` with `hasStaff: false`, the Wix Bookings app provisions a default business-owner resource at install time, which satisfies the resource requirement. If service creation in Step 4 still fails with `MISSING_APPOINTMENT_RESOURCES`, fall back to creating one staff member named after the brand and retry.

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
      "staffMemberIds": [<resourceId values from Step 3 — pass an empty array [] when hasStaff is false>]
    }
  }' \
  "https://www.wixapis.com/_api/bookings/v2/services"
```

> **`locations.type` enum:** the valid values are `UNKNOWN_LOCATION_TYPE`, `CUSTOM`, `BUSINESS`, and `CUSTOMER`. Use `"BUSINESS"` for "at the business address" (the seed default). Do NOT use `"OWNER_BUSINESS"` here — that string IS valid for `createBooking.bookedEntity.slot.location.locationType` on the bookings endpoint, but the **services** endpoint rejects it. Same field name, different enum.

> **`staffMemberIds`:** pass the `resourceId` values you collected in Step 3 (not the `id` values). When `intent.bookings.hasStaff` is `false`, omit the field or pass `[]` — the Bookings app's default business-owner resource handles the resource requirement for APPOINTMENT.

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

> **⚠️ CLASS services need scheduled sessions before anyone can sign up.** Creating a CLASS service does **not** create any sessions. The front-end sign-up flow lists bookable sessions via `eventTimeSlots.listEventTimeSlots()`, which returns the **scheduled session events** — and a freshly seeded CLASS service has none, so its calendar is permanently empty and there is nothing to book. This seed creates the *service catalog* only; it does **not** schedule sessions (the Schedules/Calendar-Events workflow is involved and fragile to script blind). **Surface this as a stated limitation** — add a `notes` entry to your return (see below) and, for a CLASS run, the orchestrator should tell the user: *"Class services were created; add session times in the Bookings dashboard (or a recurring schedule) to open them for sign-up."* Do not report a CLASS booking flow as fully working end-to-end when no sessions exist.
- **`sessionDurations`**: Required for APPOINTMENT. An array containing one integer (minutes). Do NOT specify for CLASS or COURSE services.
- **Names + descriptions**: Derive from `brand.description`. Examples: a yoga studio → "60-min Vinyasa Flow" (60 min), "30-min Morning Meditation" (30 min), "90-min Deep Restore" (90 min). A hair salon → "Women's Cut & Style" (60 min, $85), "Men's Haircut" (30 min, $45), "Balayage Color" (120 min, $150). Make them brand-appropriate — not generic.
- **Duration** (integers in minutes): Brand-appropriate. Consultation → 30; standard service → 60; premium/complex → 90–120.
- **Price `value`**: A string, not a number. Brand-appropriate, non-trivial. A budget studio might charge `"25.00"`; a premium clinic `"250.00"`. Default to mid-range when unclear.
- **Currency**: Use `"USD"` unless the brand's locale implies otherwise.
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

## Step 5 — Return contract

Write to `<site-root>/.wix/seed-returns/bookings.json`:

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
- **For `CLASS` services, add a `notes` entry flagging the session gap** so the orchestrator can surface it (see the CLASS warning above):
  ```json
  "notes": ["CLASS services created without scheduled sessions — add session times in the Bookings dashboard (or a recurring schedule) before sign-up works; the class calendar is empty until then."]
  ```
- On any REST error: set `status: "error"`, include the failing call's response verbatim under `"error"`.
- Create `<site-root>/.wix/seed-returns/` if it does not exist before writing.

---

## Common failure modes

| Failure | Recovery |
|---------|----------|
| 403 on service create | Re-mint token and retry once. If still 403, Bookings app was not installed — return `status: "error"`. |
| 400 `"defaultCapacity is required"` | Add `"defaultCapacity": 1` to the payload (required in V2, not obvious from V1 docs). |
| 400 `"onlineBooking is required"` | Add `"onlineBooking": { "enabled": true }` — required in V2. |
| 400 on `payment.options` | At least one of `online` or `inPerson` must be `true`. Set `"inPerson": true` as fallback. |
| 400 `"sessionDurations is required"` | Add `"schedule": { "availabilityConstraints": { "sessionDurations": [60] } }` for APPOINTMENT types. |
| 400 `MISSING_APPOINTMENT_RESOURCES` on service create | APPOINTMENT services require at least one resource (staff or default business-owner) to exist before they can be created. Run Step 3 (staff creation) first if you skipped it, or create one staff member named after the brand as fallback. |
| 400 enum error on `locations.type` | Use `"BUSINESS"`, not `"OWNER_BUSINESS"`. The services endpoint accepts `UNKNOWN_LOCATION_TYPE`, `CUSTOM`, `BUSINESS`, `CUSTOMER`. `OWNER_BUSINESS` is valid on `createBooking.bookedEntity.slot.location.locationType` only. |
| 400 `is not a valid email/phone` on staff create | Don't send `"phone": ""` or `"email": ""`. Omit the keys entirely when you don't have a real value. |
| `mainSlug` absent in response | Derive slug from `service.name`: lowercase, replace spaces with hyphens, strip non-alphanumeric. |
| Staff create returns "Business schedule not found" | Skip staff creation. Return partial seeded data with `notes: ["Staff creation skipped — business schedule not found; configure via Bookings dashboard"]`. |

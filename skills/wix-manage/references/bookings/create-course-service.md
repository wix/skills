---
name: "Create Course Service"
description: Creates a Wix Bookings COURSE service from a natural language prompt. Gathers categories and currency context, applies course-specific defaults (capacity, fixed series), creates as hidden for review, and navigates to the service form.
---

# Create Course Service from Prompt

## When to Use

- User wants to create a multi-session course: "create a training program", "set up a 6-week workshop", "add a bootcamp course", "create a teacher training course"
- The service type is COURSE — a fixed series with pre-defined start and end dates
- Customers must book the entire course (all sessions), unlike CLASS where they can pick individual sessions
- For general service creation where the type is ambiguous, see [Create Booking Service from Prompt](./create-booking-service-from-prompt.md)

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`). Use [List Installed Apps](../app-installation/list-installed-apps.md) to verify, and [Install Wix Apps](../app-installation/install-wix-apps.md) to install if missing.
- For full API field definitions, validation rules, and troubleshooting, see [Create and Update Booking Services](./create-and-update-booking-services.md)

---

## Step 1: Gather Business Context

Run these queries to collect site data for informed defaults.

### 1a. Query Service Categories

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {} }'
```

### 1b. Get Site Currency

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

Extract `properties.paymentCurrency`. Fall back to `USD` if unavailable.

### 1c. Query Existing Services (Duplicate Check)

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/services/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": { "paging": { "limit": 100 } } }'
```

Warn the user if a service with a similar name already exists.

> **Note:** Staff queries are optional for COURSE services since `staffMemberIds` is ignored by the API. However, querying staff can still be useful for context (e.g., mentioning the instructor in the description).

---

## Step 2: Apply Course Defaults

For any fields the user did not explicitly specify:

| Field | Default | Notes |
|---|---|---|
| Capacity | 10 | `defaultCapacity` — required for COURSE |
| Online booking | Enabled | `onlineBooking.enabled: true` |
| Visibility | Hidden | `hidden: true` — user reviews before publishing |

### Pricing (if not specified)

- Use the site's currency from Step 1b
- If user specifies a price → `rateType: "FIXED"` (for the entire course)
- If user says "free" → `rateType: "NO_FEE"`, `options.inPerson: true`, `options.online: false`
- If no price mentioned → infer from context (workshops ~$100-300, training programs ~$200-500, bootcamps ~$150-400) or default to free
- **Course pricing is for the full course**, not per session — remind the user of this in the summary

### Capacity (if not specified)

- Default: 10 participants
- If user mentions group size → use their number
- Typical ranges: intensive 5-10, standard 10-20, lecture-style 20-50

### Category

- If categories exist → assign the most relevant one (e.g., "Training", "Workshops")
- If no categories exist → create one:
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "category": { "name": "General" } }'
```

### Service Name & Description

- Use the user's wording for the service name
- Generate a brief, professional description (1-2 sentences) mentioning it's a multi-session course
- If the user specified the number of sessions or duration, include that in the description

---

## Step 3: Create the Course Service

Create as **hidden** so the user can review before publishing.

**CRITICAL: COURSE services do NOT use `staffMemberIds` or `sessionDurations`.** These fields are ignored. Use `defaultCapacity` instead.

**Paid course:**

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "COURSE",
      "hidden": true,
      "onlineBooking": { "enabled": true },
      "defaultCapacity": <CAPACITY>,
      "payment": {
        "rateType": "FIXED",
        "options": { "online": true, "inPerson": false },
        "fixed": {
          "price": { "value": "<PRICE>", "currency": "<CURRENCY>" }
        }
      },
      "category": {
        "id": "<CATEGORY_ID>"
      }
    }]
  }'
```

**Free course:**

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "COURSE",
      "hidden": true,
      "onlineBooking": { "enabled": true },
      "defaultCapacity": <CAPACITY>,
      "payment": {
        "rateType": "NO_FEE",
        "options": { "online": false, "inPerson": true }
      },
      "category": {
        "id": "<CATEGORY_ID>"
      }
    }]
  }'
```

### COURSE-Specific Reminders

- Do **NOT** include `staffMemberIds` — it is ignored for COURSE services
- Do **NOT** include `schedule.availabilityConstraints.sessionDurations` — not used for COURSE
- `defaultCapacity` is **required** — sets max participants for the entire course
- Customers must book the **entire course** (all sessions), not individual sessions
- After creation, course sessions must be scheduled separately via `bulkCreateEvents` using the returned `service.schedule.id` (see [Create and Update Booking Services](./create-and-update-booking-services.md))
- If the user explicitly requests visible, set `"hidden": false` but warn them

Save the `serviceId` from the response: `results[0].item.service.id`

---

## Step 4: Navigate to Service Form

```javascript
window.location.href = `/bookings/service-form/${serviceId}?fromAria=true`;
```

---

## Step 5: Summary Message

Provide a summary including:

1. **What was created** — service name, total course price, capacity
2. **Assumptions made** — list defaults used (e.g., "I set the capacity to 10 participants since you didn't specify")
3. **Pricing clarification** — note that the price is for the entire course, not per session
4. **Schedule note** — remind the user that course sessions (dates and times) still need to be set up
5. **How to publish** — "Toggle visibility ON and click Save to make this service live"
6. **Offer to adjust** — "Want me to change the price, capacity, or description?"

**Example:**

> I created **"Yoga Teacher Training"** as a hidden draft:
>
> - **Type**: Course (customers book the full program)
> - **Price**: $300 for the full course
> - **Capacity**: 10 participants
> - **Category**: Training
>
> I assumed a capacity of 10 since you didn't specify. The price of $300 covers the entire course — customers pay once for all sessions. The service is hidden — toggle visibility on and save to publish.
>
> **Next step:** You'll need to set up the course schedule (specific session dates and times) in the service form.

---

## Error Handling

| Error | Cause | Action |
|---|---|---|
| 428 "App not installed" | Bookings not installed | Install using [Install Wix Apps](../app-installation/install-wix-apps.md) |
| 400 "INVALID_PAYMENT_OPTIONS" | Payment misconfigured | Free: `inPerson: true`, `online: false`. Paid: price > 0 |
| 403 | Permission denied | Inform user they lack permission |

---

## Payment Validation Quick Reference

| rateType | `options.online` | `options.inPerson` | Valid? |
|----------|------------------|-------------------|--------|
| FIXED    | true             | false             | ✓      |
| FIXED    | false            | true              | ✓      |
| FIXED    | true             | true              | ✓      |
| NO_FEE   | false            | true              | ✓      |
| NO_FEE   | true             | false             | ✗      |
| Any      | false            | false             | ✗      |

---

## What This Skill Does NOT Cover

- **Course schedule setup** — individual session events (dates/times) must be configured separately via Calendar Events API. See [Create and Update Booking Services](./create-and-update-booking-services.md) Step 3.
- **Pricing plans** — memberships or installment payments are separate. See [Create and Update Pricing Plans](../pricing-plans/create-and-update-pricing-plans.md)
- **Instructor assignment** — `staffMemberIds` is ignored for COURSE. Staff association is managed through calendar events.
- **Service images** — requires Media Manager API (see [create-and-update-booking-services.md](./create-and-update-booking-services.md))

---

## API Documentation Reference

- [Bulk Create Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services)
- [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services)
- [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories)
- [Create Category](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/create-category)
- [Bulk Create Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-create-event)
- [Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-management/site-properties/properties/read)
- [About Service Types](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types)
- [About Service Payments](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-payments)

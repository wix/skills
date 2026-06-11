---
name: "Create Class Service"
description: "Create a class booking service — e.g. 'create a yoga class for $50', 'set up a pilates class', 'add a group fitness session', 'create a weekly meditation class'. Handles group capacity, recurring session defaults, and pricing via bulkCreateServices API. Staff assignment is not used for classes."
---

# Create Class Service from Prompt

## When to Use

- User wants to create a group class: "create a yoga class", "set up a pilates class", "add a group fitness session", "create a weekly meditation class"
- The service type is CLASS — a single event or recurring series that multiple customers can book
- Customers can sign up for one, several, or all sessions in a class series
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

> **Note:** Staff queries are optional for CLASS services since `staffMemberIds` is ignored by the API. However, querying staff can still be useful for context (e.g., mentioning instructors in the description).

---

## Step 2: Apply Class Defaults

For any fields the user did not explicitly specify:

| Field | Default | Notes |
|---|---|---|
| Capacity | 10 | `defaultCapacity` — required for CLASS |
| Online booking | Enabled | `onlineBooking.enabled: true` |

### Pricing (if not specified)

- Use the site's currency from Step 1b
- If user specifies a price → `rateType: "FIXED"` (per session)
- If user says "free" → `rateType: "NO_FEE"`, `options.inPerson: true`, `options.online: false`
- If no price mentioned → infer from context (yoga/fitness classes ~$15-30, art/music ~$20-40) or default to free

### Capacity (if not specified)

- Default: 10 participants
- If user mentions capacity (e.g., "small group of 6", "up to 20") → use their number
- Typical ranges: small group 4-8, standard 10-20, large 20-50

### Category

- If categories exist → assign the most relevant one (e.g., "Fitness", "Wellness")
- If no categories exist → create one:
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "category": { "name": "General" } }'
```

### Service Name & Description

- Use the user's wording for the service name
- Generate a brief, professional description (1-2 sentences) mentioning it's a group class

---

## Step 3: Create the Class Service

**CRITICAL: CLASS services do NOT use `staffMemberIds` or `sessionDurations`.** These fields are ignored. Use `defaultCapacity` instead.

**Paid class:**

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "CLASS",

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

**Free class:**

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "CLASS",

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

### CLASS-Specific Reminders

- Do **NOT** include `staffMemberIds` — it is ignored for CLASS services
- Do **NOT** include `schedule.availabilityConstraints.sessionDurations` — not used for CLASS
- `defaultCapacity` is **required** — sets max participants per session
- After creation, class sessions must be scheduled separately via `bulkCreateEvents` using the returned `service.schedule.id` (see [Create and Update Booking Services](./create-and-update-booking-services.md))

Save the `serviceId` from the response: `results[0].item.service.id`

---

## Step 4: Navigate to Service Form

Use the **RUN_IN_BROWSER** tool to navigate the user to the service form for final review:

```javascript
window.location.href = `/bookings/services/form/${serviceId}?fromAria=true`;
```

This executes in the user's browser and redirects them to the service editing page.

---

## Step 5: Summary Message

Provide a summary including:

1. **What was created** — service name, price per session, capacity
2. **Assumptions made** — list defaults used (e.g., "I set the capacity to 10 participants since you didn't specify")
3. **Schedule note** — remind the user that class sessions still need to be scheduled
4. **Next steps** — "Click Save to finalize, then set up the class schedule"
5. **Offer to adjust** — "Want me to change the price, capacity, or description?"

**Example:**

> I created **"Vinyasa Yoga Class"**:
>
> - **Type**: Class (group session)
> - **Price**: $25 per session
> - **Capacity**: 10 participants
> - **Category**: Fitness
>
> I assumed a capacity of 10 since you didn't specify. You can review and adjust the details in the service form.
>
> **Next step:** You'll need to set up the class schedule (days and times) in the service form.

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

- **Class schedule setup** — recurring events (days/times) must be configured separately via Calendar Events API. See [Create and Update Booking Services](./create-and-update-booking-services.md) Step 3.
- **Pricing plans** — memberships and class packs are separate. See [Create and Update Pricing Plans](../pricing-plans/create-and-update-pricing-plans.md)
- **Instructor assignment** — `staffMemberIds` is ignored for CLASS. Staff association is managed through calendar events.
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

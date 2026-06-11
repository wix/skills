---
name: "Create Appointment Service"
description: "Create an appointment booking service — e.g. 'set up consultations', 'create a 1-on-1 session', 'add a personal training appointment', 'create a meeting service for $25'. Handles staff assignment (required), session duration, pricing, and 1-on-1 capacity defaults via bulkCreateServices API."
---

# Create Appointment Service from Prompt

## When to Use

- User wants to create an appointment-based service: "set up consultations", "create a 1-on-1 session", "add a personal training appointment", "create a meeting service"
- The service type is APPOINTMENT — customer picks an available time slot during staff working hours
- For general service creation where the type is ambiguous, see [Create Booking Service from Prompt](./create-booking-service-from-prompt.md)

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`). Use [List Installed Apps](../app-installation/list-installed-apps.md) to verify, and [Install Wix Apps](../app-installation/install-wix-apps.md) to install if missing.
- For full API field definitions, validation rules, and troubleshooting, see [Create and Update Booking Services](./create-and-update-booking-services.md)

---

## Step 1: Gather Business Context

Run these queries to collect site data for informed defaults.

### 1a. Query Staff Members (CRITICAL for Appointments)

```bash
curl -X POST 'https://www.wixapis.com/bookings/v1/staff-members/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {},
    "fields": ["RESOURCE_DETAILS"]
  }'
```

Save each staff member's `resourceId` (not `id`). Note which one has `default: true`.

**APPOINTMENT services REQUIRE at least one staff member.** If no staff members exist, create one first using [Bookings Staff Setup](./bookings-staff-setup.md).

### 1b. Query Service Categories

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {} }'
```

### 1c. Get Site Currency

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

Extract `properties.paymentCurrency`. Fall back to `USD` if unavailable.

### 1d. Query Existing Services (Duplicate Check)

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/services/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": { "paging": { "limit": 100 } } }'
```

Warn the user if a service with a similar name already exists.

---

## Step 2: Apply Appointment Defaults

For any fields the user did not explicitly specify:

| Field | Default | Notes |
|---|---|---|
| Duration | 60 minutes | Set via `schedule.availabilityConstraints.sessionDurations` |
| Capacity | 1 | Appointments are typically 1-on-1 |
| Staff | Auto-assign | Use `default: true` staff, or first available |
| Online booking | Enabled | `onlineBooking.enabled: true` |

### Pricing (if not specified)

- Use the site's currency from Step 1c
- If user specifies a price → `rateType: "FIXED"`
- If user says "free" → `rateType: "NO_FEE"`, `options.inPerson: true`, `options.online: false`
- If no price mentioned → infer from context (consultations ~$50-100, sessions ~$30-60) or default to free

### Staff Assignment

- **1 staff member** → auto-assign using their `resourceId`
- **Multiple staff members** → use the one with `default: true`, or the first one
- **No staff members** → create one first using [Bookings Staff Setup](./bookings-staff-setup.md), then proceed

### Category

- If categories exist → assign the most relevant one
- If no categories exist → create a "General" category:
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "category": { "name": "General" } }'
```

### Service Name & Description

- Use the user's wording for the service name
- Generate a brief, professional description (1-2 sentences)

---

## Step 3: Create the Appointment Service

**Paid appointment:**

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "APPOINTMENT",

      "onlineBooking": { "enabled": true },
      "staffMemberIds": ["<RESOURCE_ID>"],
      "schedule": {
        "availabilityConstraints": {
          "sessionDurations": [<DURATION_MINUTES>]
        }
      },
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

**Free appointment:**

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "APPOINTMENT",

      "onlineBooking": { "enabled": true },
      "staffMemberIds": ["<RESOURCE_ID>"],
      "schedule": {
        "availabilityConstraints": {
          "sessionDurations": [<DURATION_MINUTES>]
        }
      },
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

### APPOINTMENT-Specific Reminders

- `staffMemberIds` is **required** — uses `resourceId` values, not staff member `id`
- `schedule.availabilityConstraints.sessionDurations` sets the appointment length
- Availability is based on the assigned staff member's working hours schedule

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

1. **What was created** — service name, price, duration, assigned staff member
2. **Assumptions made** — list defaults used (e.g., "I set the duration to 60 minutes since you didn't specify")
3. **Next steps** — "Click Save to finalize, then set up your availability"
4. **Offer to adjust** — "Want me to change the price, duration, or staff assignment?"

**Example:**

> I created **"Strategy Consultation"**:
>
> - **Type**: Appointment (1-on-1)
> - **Price**: $75 per session
> - **Duration**: 60 minutes
> - **Staff**: Assigned to Sarah Johnson
> - **Category**: Consulting
>
> I assumed a 60-minute duration since you didn't specify. You can review and adjust the details in the service form.

---

## Error Handling

| Error | Cause | Action |
|---|---|---|
| 428 "App not installed" | Bookings not installed | Install using [Install Wix Apps](../app-installation/install-wix-apps.md) |
| 400 "staffMemberIds required" | No staff assigned | Query staff; if none exist, create one via [Bookings Staff Setup](./bookings-staff-setup.md) |
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

- **Schedule/availability setup** — staff working hours need separate configuration. See [Bookings Staff Setup](./bookings-staff-setup.md)
- **Pricing plans** — memberships and session packs are separate. See [Create and Update Pricing Plans](../pricing-plans/create-and-update-pricing-plans.md)
- **Service images** — requires Media Manager API (see [create-and-update-booking-services.md](./create-and-update-booking-services.md))

---

## API Documentation Reference

- [Bulk Create Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services)
- [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services)
- [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories)
- [Create Category](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/create-category)
- [Query Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/query-staff-members)
- [Create Staff Member](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/create-staff-member)
- [Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-management/site-properties/properties/read)
- [About Service Types](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types)
- [About Service Payments](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-payments)

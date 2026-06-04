---
name: "Create Booking Service from Prompt"
description: Autonomous creation of a booking service from a natural language prompt. Gathers business context, applies industry-standard defaults for missing fields, creates the service as hidden for user review, and navigates to the service form.
---

# Create Booking Service from Natural Language Prompt

## When to Use
- User describes a service they want to create using natural language (e.g., "create a yoga class for $50", "set up consultation sessions", "add a personal training appointment")
- The intent is autonomous creation — fill in reasonable defaults rather than asking the user for every field

## Prerequisites
- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`)
- If Bookings is not installed, use [Install Wix Apps](../app-installation/install-wix-apps.md) to install it first
- For detailed API field definitions, validation rules, and troubleshooting, refer to [Create and Update Booking Services](./create-and-update-booking-services.md)

---

## Step 1: Gather Business Context

Before creating the service, query the site's existing data to make informed decisions. Make all of these calls to gather context:

### 1a. Query Staff Members
```bash
curl -X POST 'https://www.wixapis.com/bookings/v1/staff-members/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {},
    "fields": ["RESOURCE_DETAILS"]
  }'
```

### 1b. Query Service Categories
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {} }'
```

### 1c. Get Site Properties (Currency)
```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```
Use `properties.paymentCurrency` as the default currency. If unavailable, fall back to `USD`.

### 1d. Query Existing Services (Duplicate Check)
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/services/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": { "paging": { "limit": 100 } } }'
```
If a service with a very similar name already exists, warn the user before creating a duplicate.

---

## Step 2: Autonomous Decision Rules

Apply these defaults for any fields the user did not explicitly specify.

### Service Type
| User mentions | Type |
|---|---|
| class, yoga, pilates, group session, group workout, bootcamp class | `CLASS` |
| consultation, appointment, meeting, 1-on-1, one-on-one, session | `APPOINTMENT` |
| workshop, program, course, training program, multi-session | `COURSE` |
| (unclear or unspecified) | `APPOINTMENT` |

### Pricing
- Use the site's currency from Step 1c
- If the user specifies a price, use it with `rateType: "FIXED"`
- If the user says "free", use `rateType: "NO_FEE"` with `options.inPerson: true` and `options.online: false`
- If the user does not mention price, choose a reasonable industry-standard default based on the service type and vertical
- For paid services, set `options.online: true` unless the user specifies in-person only

### Duration (if not specified)
| Type | Default Duration |
|---|---|
| `APPOINTMENT` | 60 minutes |
| `CLASS` | 60 minutes |
| `COURSE` | Determined by number of sessions |

### Capacity (if not specified)
| Type | Default Capacity |
|---|---|
| `APPOINTMENT` | 1 (single participant) |
| `CLASS` | 10 |
| `COURSE` | 10 |

### Staff Assignment
- **APPOINTMENT only** — `staffMemberIds` is required
  - If exactly 1 staff member exists → auto-assign using their `resourceId`
  - If multiple exist → use the one with `default: true`, or the first one
  - If none exist → inform the user that a staff member must be created first (use [Bookings Staff Setup](./bookings-staff-setup.md))
- **CLASS / COURSE** — do not set `staffMemberIds` (it is ignored by the API)

### Category
- If categories exist from Step 1b, assign the most relevant one based on the service name/description
- If no categories exist, create a "General" category first:
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/categories' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "category": { "name": "General" } }'
```
- **Always assign a category** — services without categories may be invisible in category-based UI filters

### Online Booking
- Always set `onlineBooking.enabled: true` unless the user explicitly says otherwise

---

## Step 3: Create the Service

Create the service as **hidden** so it does not appear on the live site until the user reviews and publishes it.

**APPOINTMENT Example (hidden, paid):**
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "APPOINTMENT",
      "hidden": true,
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

**CLASS Example (hidden, paid):**
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "CLASS",
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

**Free Service Example (hidden):**
```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/bulk/services/create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "services": [{
      "name": "<SERVICE_NAME>",
      "description": "<GENERATED_DESCRIPTION>",
      "type": "APPOINTMENT",
      "hidden": true,
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

### Important
- Extract the `serviceId` from the response: `results[0].item.service.id`
- If the user explicitly requests the service to be visible immediately, set `"hidden": false` instead — but warn them that the service will appear on their live site with AI-generated content before they review it

---

## Step 4: Error Handling

If `bulkCreateServices` fails, handle based on the error:

| Error | Cause | Action |
|---|---|---|
| 428 "App not installed" | Bookings app not installed | Tell user to install Wix Bookings, or install it using [Install Wix Apps](../app-installation/install-wix-apps.md) |
| 400 "staffMemberIds required" | APPOINTMENT without staff | Query staff members again; if none exist, tell user to create one first |
| 400 "INVALID_PAYMENT_OPTIONS" | Payment misconfigured | For free services: set `options.inPerson: true`, `options.online: false`. For paid: ensure price > 0 |
| 403 / Permission denied | User lacks permission | Tell user they may not have permission to create services on this site |
| Any other error | Unexpected failure | Show the error details to the user and suggest they try creating the service manually in the Bookings dashboard |

If the service was successfully created but a subsequent step fails (e.g., navigation), always tell the user:
- The service **was** created successfully
- Its name and service ID
- That it is hidden (not visible on the live site)
- They can find it in the Bookings services list in their dashboard

---

## Step 5: Navigate to Service Form

After successful creation, navigate the user to the service form for review:

**URL pattern:** `/bookings/service-form/<SERVICE_ID>?fromAria=true`

Use `runInBrowser` to navigate:
```javascript
window.location.href = `/bookings/service-form/${serviceId}?fromAria=true`;
```

---

## Step 6: Summary Message

After creating the service and navigating, provide a summary that includes:

1. **What was created** — service name, type, price, duration
2. **Assumptions made** — list every field where you used a default instead of an explicit user instruction (e.g., "I set the duration to 60 minutes since you didn't specify one")
3. **What to review** — tell the user to review all fields in the form, especially:
   - Price and currency
   - Duration
   - Description (if AI-generated)
   - Staff assignment
   - Category
4. **How to publish** — "Toggle the visibility switch ON and click Save to make this service live on your site"
5. **Hidden status** — "This service is currently hidden and won't appear on your live site until you publish it"

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

## API Documentation Reference
- [Bulk Create Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services)
- [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services)
- [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories)
- [Create Category](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/create-category)
- [Query Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/query-staff-members)
- [Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-management/site-properties/properties/read)
- [About Service Types](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types)
- [About Service Payments](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-payments)

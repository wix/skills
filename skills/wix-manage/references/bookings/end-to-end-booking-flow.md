---
name: "End-to-End Booking Flow"
description: Complete booking flow from service discovery to payment. Query services, check availability with Time Slots V2, create bookings, and process payment via eCommerce checkout.
---

# End-to-End Booking Flow (REST)

Step-by-step flow for implementing a complete booking experience using REST APIs.

> ## ⚠️ This is a management recipe — owner-side calls, not visitor-facing code
>
> Every call below runs with the **site owner's credentials** (API key or the site's admin token),
> from a server or a management tool. The booking it creates belongs to the site, not to the
> person being booked.
>
> **Building a site or app where a visitor books for themselves? These payloads are right, the
> identity is not.** A visitor's booking and checkout run on an **anonymous visitor token** minted
> from the site's OAuth app client id. Using the owner's credentials for a visitor's purchase
> produces a checkout that belongs to the site: no cart persistence, no abandoned-checkout
> recovery, and no attribution to the customer. Read these first:
>
> - [Book an Appointment](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/book-an-appointment)
>   — the same flow from the visitor's side: visitor token, slot re-validation, booking form
>   fields, checkout hand-off, and eight pitfalls from real conversations
> - [Retrieve Tokens](https://dev.wix.com/docs/api-reference/business-management/headless/authentication/retrieve-tokens)
>   — minting and refreshing the anonymous visitor token
> - [Allow Redirect URIs and Domains](https://dev.wix.com/docs/go-headless/authentication/setup/allow-redirect-uris-and-domains)
>   — registering your URLs so the visitor returns to your app after the Wix-hosted checkout
> - [Manage OAuth Apps](../sites/manage-oauth-apps.md) — creating the OAuth app, whose id is the
>   `client_id` the frontend mints visitor tokens from
> - [Bookings Quick Start](https://dev.wix.com/docs/go-headless/self-managed-headless/tutorials/java-script-sdk-tutorials/bookings-quick-start)
>   — the same flow through the JavaScript SDK on a headless site
>
> Mixed apps are normal: the owner's credentials manage the catalog, staff, policies and coupons
> (the recipes here), while the visitor's own token books and pays.

## Contents

1. [Query Available Services](#step-1-query-available-services) — `POST /bookings/v2/services/query`.
   The three service types and how each one changes the rest of the flow, plus the four fields to
   carry forward: `id`, `schedule.id`, `type`, `staffMemberIds`.
2. [Check Availability](#step-2-check-availability) — `POST /_api/service-availability/v2/time-slots`.
   Time Slots V2 replaces the deprecated Availability Calendar. Dates must be full local
   datetimes or the call 400s; `availableResources` stays empty unless you ask for it by resource
   type; the `location.locationType` a slot returns is **not** the value Create Booking accepts.
   Classes come from a different endpoint and carry an `eventId`.
3. [Create the Booking](#step-3-create-the-booking) — `POST /_api/bookings-service/v2/bookings`.
   One payload shape per service type: appointments need every slot field spelled out, classes
   need only the service and event ids and derive the rest, courses book a whole schedule.
   Participants are `totalParticipants` **or** `participantsChoices`, never both. The booking
   lands as `CREATED` and is not on the calendar until step 4.
4. [Confirm or Process Payment](#step-4-confirm-or-process-payment) — two branches. Free and
   pay-at-location bookings are confirmed directly with a payment status. Paid bookings go into a
   cart that references the booking id, and the visitor is sent to its checkout URL; a
   server-to-server place-order path exists for owner-side bookings that take no payment.
5. [Service Type Summary](#service-type-summary) — appointment, class and course side by side:
   which `bookedEntity` each uses, which availability API feeds it, and what makes it different.

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`)
- For paid services: Wix Payments or eCommerce configured

> **Note:** If you receive errors from Bookings APIs, the Wix Bookings app may not be installed on the site. Use [List Installed Apps](../app-installation/list-installed-apps.md) to verify, and [Install Wix Apps](../app-installation/install-wix-apps.md) to install it if missing.

## Required APIs

- **Services API**: [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services)
- **Time Slots V2 API**: [List Availability Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots)
- **Bookings API**: [Create Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking), [Confirm Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/confirm-booking)
- **eCommerce API**: [Create Cart](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart)

---

## Step 1: Query Available Services

**Endpoint**: `POST https://www.wixapis.com/bookings/v2/services/query`

```json
{
  "query": {
    "filter": {
      "type": "APPOINTMENT"
    },
    "paging": {
      "limit": 20
    }
  }
}
```

**Service Types**:

- `APPOINTMENT` — One-on-one sessions with a staff member
- `CLASS` — Group sessions at scheduled times
- `COURSE` — Multi-session series (customers book the entire course)

**Save from the response**:

- `id` — service ID
- `schedule.id` — schedule ID (needed for appointment bookings and course bookings)
- `type` — determines the booking flow (slot vs schedule)
- `staffMemberIds` — resource IDs of assigned staff (for appointments)

---

## Step 2: Check Availability

**Endpoint**: `POST https://www.wixapis.com/_api/service-availability/v2/time-slots`

> **Important**: The old Availability Calendar API (`/bookings/v2/availability/query`) is deprecated. Always use Time Slots V2.

```json
{
  "serviceId": "<SERVICE_ID>",
  "fromLocalDate": "2024-06-15T08:00:00",
  "toLocalDate": "2024-06-16T18:00:00",
  "timeZone": "America/New_York",
  "bookable": true,
  "includeResourceTypeIds": ["<RESOURCE_TYPE_ID>"]
}
```

### Date format

Dates **must** be in `YYYY-MM-DDThh:mm:ss` format (local datetime). Plain dates like `2024-06-15` will be rejected with a 400 error.

### Parameters

| Parameter                | Required | Description                                                             |
| ------------------------ | -------- | ----------------------------------------------------------------------- |
| `serviceId`              | Yes      | From Step 1                                                             |
| `fromLocalDate`          | Yes      | Start of range in `YYYY-MM-DDThh:mm:ss` format                          |
| `toLocalDate`            | Yes      | End of range in `YYYY-MM-DDThh:mm:ss` format                            |
| `timeZone`               | Yes      | IANA timezone (e.g. `America/New_York`)                                 |
| `bookable`               | No       | Set `true` to only get bookable slots                                   |
| `includeResourceTypeIds` | No       | Array of resource type IDs — populates `availableResources` in response |

### Save from each time slot

- `serviceId`, `scheduleId` — needed for Create Booking
- `localStartDate`, `localEndDate` — slot times
- `availableResources[].resources[].id` — resource ID (only populated if `includeResourceTypeIds` was provided)
- `location.locationType` — **warning**: returns `BUSINESS` but Create Booking requires `OWNER_BUSINESS` (see Step 3)

### For Classes

Use [List Event Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots) instead. Each class session has an `eventId` — save it for the booking.

---

## Step 3: Create the Booking

**Endpoint**: `POST https://www.wixapis.com/_api/bookings-service/v2/bookings`

### For Appointments (use `slot`)

```json
{
  "booking": {
    "bookedEntity": {
      "slot": {
        "serviceId": "<SERVICE_ID>",
        "scheduleId": "<SCHEDULE_ID>",
        "startDate": "2024-06-15T14:00:00",
        "endDate": "2024-06-15T15:00:00",
        "timezone": "America/New_York",
        "resource": {
          "id": "<RESOURCE_ID>"
        },
        "location": {
          "locationType": "OWNER_BUSINESS"
        }
      }
    },
    "contactDetails": {
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com"
    },
    "totalParticipants": 1
  }
}
```

All slot fields are **required** for appointments when no `eventId` is provided:

| Field                   | Source | Notes                                                                                                                        |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `serviceId`             | Step 1 | Service GUID                                                                                                                 |
| `scheduleId`            | Step 2 | From the time slot response                                                                                                  |
| `startDate` / `endDate` | Step 2 | `YYYY-MM-DDThh:mm:ss` format                                                                                                 |
| `timezone`              | Step 2 | IANA tz format                                                                                                               |
| `resource.id`           | Step 2 | From `availableResources` in time slot response                                                                              |
| `location.locationType` | —      | Must be `OWNER_BUSINESS`, `OWNER_CUSTOM`, or `CUSTOM`. Time Slots returns `BUSINESS` but that value is **not accepted** here |

### For Classes (use `slot` with `eventId`)

```json
{
  "booking": {
    "bookedEntity": {
      "slot": {
        "serviceId": "<SERVICE_ID>",
        "eventId": "<EVENT_ID>"
      }
    },
    "contactDetails": {
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@example.com"
    },
    "totalParticipants": 1
  }
}
```

When you provide `eventId`, all other slot fields (`startDate`, `endDate`, `timezone`, `resource`, `location`) are **auto-derived** from the event. You only need `serviceId` + `eventId`.

### For Courses (use `schedule`)

```json
{
  "booking": {
    "bookedEntity": {
      "schedule": {
        "scheduleId": "<SCHEDULE_ID>",
        "serviceId": "<SERVICE_ID>",
        "timezone": "America/New_York",
        "location": {
          "locationType": "OWNER_BUSINESS"
        }
      }
    },
    "contactDetails": {
      "firstName": "Bob",
      "lastName": "Test",
      "email": "bob@example.com"
    },
    "totalParticipants": 1
  }
}
```

### Participants

Specify exactly one of:

- `totalParticipants` — for services with fixed pricing and no variants
- `participantsChoices` — for services with [variants and options](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/service-options-and-variants/introduction)

### Result

Booking is created with `status: CREATED`. This is **not yet visible** in the booking calendar. You must either:

- **Confirm it** (Step 4, for offline/free payments), or
- **Process payment** (Step 4, for online payments) — confirmation happens automatically after checkout

---

## Step 4: Confirm or Process Payment

### For free or offline-payment bookings: Confirm directly

**Endpoint**: `POST https://www.wixapis.com/_api/bookings-service/v2/bookings/<BOOKING_ID>/confirm`

```json
{
  "revision": "<REVISION>",
  "paymentStatus": "EXEMPT"
}
```

Use the `id` and `revision` from the Create Booking response. Set `paymentStatus` to `EXEMPT` for free services or `NOT_PAID` for pay-at-location.

**Result**: Booking status changes to `CONFIRMED` and is visible in the booking calendar.

### For online payments: Create a cart

Cart V2 unifies cart and checkout — there is no separate checkout entity. The created cart's `id` is what you use for the checkout URL and for placing the order.

**4a. Create Cart**

**Endpoint**: `POST https://www.wixapis.com/ecom/v2/carts`

```json
{
  "catalogItems": [
    {
      "catalogReference": {
        "catalogItemId": "<BOOKING_ID>",
        "appId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97"
      },
      "quantity": 1
    }
  ]
}
```

Use the booking ID as `catalogItemId` with the Wix Bookings app ID. Save `cart.id` from the response.

**4b. Get Checkout URL**

**Endpoint**: `POST https://www.wixapis.com/ecom/v2/carts/{cartId}/get-checkout-url`

Redirect the user to the returned `checkoutUrl`. After payment, the booking is automatically confirmed.

> When the person paying is a visitor, create the cart and this URL **with their visitor token**,
> not the owner's credentials — see the note at the top. The call succeeds either way, which is
> what makes it easy to get wrong.

**4c. Place Order — owner-side only (alternative, server-to-server)**

> This path charges nothing and belongs to the owner: it books and orders on someone's behalf with
> no payment page. It is not a substitute for sending a visitor to checkout.

First calculate the cart to get a price-verification token:

**Endpoint**: `POST https://www.wixapis.com/ecom/v2/carts/{cartId}/calculate`

Save `summary.priceVerificationToken` from the response, then place the order:

**Endpoint**: `POST https://www.wixapis.com/ecom/v2/carts/{cartId}/place-order`

```json
{
  "priceVerificationToken": "<PRICE_VERIFICATION_TOKEN>"
}
```

Creates an order directly without redirect.

---

## Service Type Summary

| Service Type | `bookedEntity`                        | Availability API                           | Key Difference                                             |
| ------------ | ------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| APPOINTMENT  | `slot` (all fields required)          | Time Slots V2                              | Single session, specific time, needs resource + scheduleId |
| CLASS        | `slot` (only `serviceId` + `eventId`) | Event Time Slots                           | Group session, auto-derives fields from event              |
| COURSE       | `schedule`                            | Check capacity via Query Extended Bookings | Multi-session, books entire schedule                       |

## See Also

- [Flow: Single-Service Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-single-service-booking)
- [Create Booking Sample Flows](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/sample-flows)
- [Time Slots V2 Sample Flows](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/sample-flows)

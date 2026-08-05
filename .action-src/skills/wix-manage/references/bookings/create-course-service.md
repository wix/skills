---
name: "Create Course Service"
description: "Create a course booking service — e.g. 'create a 6-week photography workshop', 'set up a training program', 'add a bootcamp course for $300', 'create a hidden free test course with 8 sessions'. Handles group capacity, full-course pricing, bulkCreateServices, and separate course session events via bulkCreateEvents. Staff assignment is not used for courses."
---

# Create Course Service from Prompt

## When to Use

- User wants to create a multi-session course: "create a training program", "set up a 6-week workshop", "add a bootcamp course", "create a teacher training course"
- User wants a free or hidden test COURSE with specific session dates/counts, such as "create a hidden free test course with 8 online sessions"
- The service type is COURSE — a fixed series with pre-defined start and end dates
- Customers must book the entire course (all sessions), unlike CLASS where they can pick individual sessions
- For general service creation where the type is ambiguous, see [Create Booking Service from Prompt](./create-booking-service-from-prompt.md)

## Prerequisites

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

### 1b. Query Existing Services (Duplicate Check)

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

### Pricing (if not specified)

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

**CRITICAL: COURSE services do NOT use `staffMemberIds` or `sessionDurations`.** These fields are ignored. Use `defaultCapacity` instead.

Do not put session dates under `course.sessions`, `CourseSession`, or any similar nested field in the Services V2 create/update payload. Services V2 creates the course service and returns a `service.schedule.id`; it does not create bookable course sessions from nested `course` data. A course with no Calendar events can be created successfully but appear as ended or unavailable on the service page.

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

      "onlineBooking": { "enabled": true },
      "defaultCapacity": <CAPACITY>,
      "payment": {
        "rateType": "FIXED",
        "options": { "online": true, "inPerson": false },
        "fixed": {
          "price": { "value": "<PRICE>" }
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
- Do **NOT** include `course.sessions` or inferred `CourseSession` objects in the service payload — accepted or ignored nested course data does not make sessions bookable
- `defaultCapacity` is **required** — sets max participants for the entire course
- Customers must book the **entire course** (all sessions), not individual sessions
- After creation, course sessions must be scheduled separately via `bulkCreateEvents` using the returned `service.schedule.id` (see [Create and Update Booking Services](./create-and-update-booking-services.md))
- If the user asked you to create the course and gave the session count/times, the job is not complete after `bulkCreateServices`; continue by creating the Calendar events, then verify the service has future events before telling the user it is ready

Save the `serviceId` from the response: `results[0].item.service.id`
Save the `service.schedule.id` from the response for the follow-up `bulkCreateEvents` request.

---

## Step 4: Create Course Session Events

If the user specified session dates, times, or a session count, create the course events immediately after the service exists:

1. Read `results[0].item.schedule.id` from the service create response.
2. Query or create the resource/staff member that should appear on the course events and use its `resourceId`.
3. Call `bulkCreateEvents` (`POST https://www.wixapis.com/calendar/v3/bulk/events/create`) with one event per course session.
4. For each event, set:
   - `event.scheduleId` to the course service's `service.schedule.id`
   - `event.type` to `COURSE`
   - `event.resources` to at least one resource object using a valid `resourceId`
   - start/end fields for the session time
5. Query the service/calendar events afterward to confirm future events exist before saying the course is bookable.

If the session details are missing, create only the service and clearly tell the user that the course still needs session events before it can be booked.

---

## Step 5: Summary Message

Provide a summary including:

1. **What was created** — service name, total course price, capacity
2. **Assumptions made** — list defaults used (e.g., "I set the capacity to 10 participants since you didn't specify")
3. **Pricing clarification** — note that the price is for the entire course, not per session
4. **Schedule status** — say whether course session events were created and verified; do not say the course is bookable if only the service exists
5. **Next steps** — if events were not created, tell the user to provide session dates/times or set up the course schedule
6. **Offer to adjust** — "Want me to change the price, capacity, or description?"

**Example:**

> I created **"Yoga Teacher Training"**:
>
> - **Type**: Course (customers book the full program)
> - **Price**: $300 for the full course
> - **Capacity**: 10 participants
> - **Category**: Training
>
> I assumed a capacity of 10 since you didn't specify. The price of $300 covers the entire course — customers pay once for all sessions. You can review and adjust the details in the service form.
>
> **Next step:** You'll need to set up the course schedule (specific session dates and times) before customers can book it.

---

## Error Handling

| Error | Cause | Action |
|---|---|---|
| 400 "INVALID_PAYMENT_OPTIONS" | Payment misconfigured | Free: `inPerson: true`, `online: false`. Paid: price > 0 |
| Course page says "Ended", "Beendet", or "This service is not available" after service creation | Service exists but no future course events were created on `service.schedule.id` | Create course events via Calendar Events `bulkCreateEvents`, then verify future events exist |
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
- [About Service Types](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types)
- [About Service Payments](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-payments)

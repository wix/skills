---
name: "Configure Default Business Hours"
description: Uses Calendar Events API to create WORKING_HOURS events on the business schedule. Covers the critical distinction between Calendar Events API (correct) vs Site Properties API (incorrect) for setting base availability.
---
# Technical Step-by-Step Instructions: Setting Up Wix Bookings Default Business Hours (Real-World, API-First)

## Description

Wix Bookings default business hours are recurring `WORKING_HOURS` events on the site's business schedule. They control the base availability shown under **Set default hours** and are inherited by new staff members that use default working hours.

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`)

If Bookings APIs report that the app isn't installed, use [List Installed Apps](../app-installation/list-installed-apps.md) to verify and [Install Wix Apps](../app-installation/install-wix-apps.md) to install it.

## Critical API and ID distinction

- **Correct API:** Calendar Events V3 (`/calendar/v3/events`).
- **Wrong API:** Site Properties (`/site-properties/v4/properties/business-schedule`) changes general site business information, not Bookings default hours.
- **Lookup key only:** `4e0579a5-491e-4e70-a872-d097eed6e520` is the universal `externalId` used to find the business schedule.
- **Event schedule ID:** Use the returned, site-specific `schedule.id` as each event's `scheduleId`.

Do not use the fixed external ID as `resources[].id`. Calendar validates every supplied resource against actual site resources and returns `404 "Resource with ... ID not found"` when the ID doesn't exist there. Don't substitute an arbitrary staff resource either; default business hours don't need a resource.

For these events, omit `externalScheduleId`, `scheduleOwnerId`, `resources`, `location`, `participants`, `conferencingDetails`, `capacity`, `adjustedStart`, and `adjustedEnd`. They are unnecessary, inherited, server-populated, or conditionally validated fields.

> Schema note: Nested fields marked required are required only when their optional parent object is present. For example, `resources.id` is required if `resources` is supplied, and `location.type` is required if `location` is supplied. Don't create empty optional parent objects to satisfy the schema.

## Safe reconciliation workflow

Bookings normally creates Monday-Friday defaults during installation. Always query the current state, but don't assume a particular count.

1. Find the business schedule and retain its internal `schedule.id`.
2. Query current `MASTER` `WORKING_HOURS` events and retain their IDs and revisions.
3. Match current events to the desired weekday/time slots.
4. Update matching events and create missing desired events using the minimal shapes below.
5. Re-query and verify that every desired event exists successfully.
6. Only after that verification, cancel obsolete unmatched events and perform one final query.

Never cancel all current hours before proving that replacement events can be created. A validation or permission error after cancellation can otherwise leave the site with no default hours.

## Step 1: Find the business schedule

**Endpoint:** `POST https://www.wixapis.com/calendar/v3/schedules/query`

Use [Query Schedules](https://dev.wix.com/docs/api-reference/business-management/calendar/schedules-v3/query-schedules) with:

```json
{
  "query": {
    "filter": {
      "externalId": "4e0579a5-491e-4e70-a872-d097eed6e520"
    }
  }
}
```

Require exactly one business schedule and save the returned `schedules[0].id`. The fixed value above is not the ID used in event writes.

## Step 2: Query current working hours

**Endpoint:** `POST https://www.wixapis.com/calendar/v3/events/query`

Use [Query Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/query-events):

```json
{
  "recurrenceType": ["MASTER"],
  "query": {
    "filter": {
      "scheduleId": "<site-specific-schedule-id>",
      "type": "WORKING_HOURS"
    },
    "cursorPaging": {
      "limit": 100
    }
  }
}
```

Paginate if necessary. Retain each event's `id`, `revision`, `start`, `end`, and `recurrenceRule.days`.

## Step 3: Update matching weekdays

**Endpoint:** `POST https://www.wixapis.com/calendar/v3/bulk/events/update`

Use [Bulk Update Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-update-event). Each item has its own `fieldmask`; it isn't a top-level request field.

```json
{
  "events": [
    {
      "event": {
        "id": "<existing-monday-event-id>",
        "revision": "<current-revision>",
        "start": {"localDate": "<future-monday-date>T17:00:00"},
        "end": {"localDate": "<future-monday-date>T20:00:00"}
      },
      "fieldmask": "start,end"
    }
  ],
  "timeZone": "America/Chicago",
  "returnEntity": true
}
```

Use a current or future local date that falls on the event's recurrence weekday. Always use the latest revision from a fresh query.

## Step 4: Create missing weekdays

**Endpoint:** `POST https://www.wixapis.com/calendar/v3/bulk/events/create`

Use [Bulk Create Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-create-event). A recurring business-hours event needs only `type`, the internal `scheduleId`, `start`, `end`, and a weekly `recurrenceRule`:

```json
{
  "events": [
    {
      "event": {
        "type": "WORKING_HOURS",
        "scheduleId": "<site-specific-schedule-id>",
        "start": {"localDate": "<future-monday-date>T17:00:00"},
        "end": {"localDate": "<future-monday-date>T20:00:00"},
        "recurrenceRule": {
          "frequency": "WEEKLY",
          "interval": 1,
          "days": ["MONDAY"]
        }
      }
    }
  ],
  "timeZone": "America/Chicago",
  "returnEntity": true
}
```

Create one event per weekday/time slot. Omit `recurrenceRule.until` for hours that should continue indefinitely. Check both `bulkActionMetadata` and every result item's metadata; an HTTP success alone doesn't prove every bulk item succeeded.

## Step 5: Verify, then cancel obsolete events

Re-run the Step 2 query and verify:

1. Every desired weekday/time slot has exactly one successful `MASTER` event, unless split hours were requested.
2. Each event has `type: "WORKING_HOURS"` and the expected recurrence day and local times.
3. No desired create or update returned an item-level failure.

Only then cancel obsolete unmatched events with [Bulk Cancel Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-cancel-event):

```json
{
  "eventIds": ["<obsolete-event-id>"],
  "timeZone": "America/Chicago",
  "returnEntity": true
}
```

Perform a final Step 2 query to prove there are no duplicates or unwanted slots.

## Troubleshooting

**`404 "Resource with <id> ID not found"`**

- Remove `resources` from the business-hours event.
- Use the fixed UUID only to query the business schedule by `externalId`.
- Use the returned internal `schedule.id` as `event.scheduleId`.
- Don't add a staff resource merely to make the request pass.

**`location.type` is required**

- Remove the entire optional `location` object. Don't send `location: {}`.

**`conferencingDetails.type` or provider is required**

- Remove the entire optional `conferencingDetails` object. Working-hours events don't need conferencing details.

**App not installed (`428`)**

- Install Wix Bookings, then query the business schedule again.

**Duplicate time slots**

- Query all `MASTER` events, verify the desired events, then cancel only obsolete events.

**Updates don't appear in the dashboard**

- Confirm you updated `MASTER`, not generated `INSTANCE`, events.
- Refresh revisions before updating and put `fieldmask` inside each `events[]` item.
- Re-query the Calendar API, then confirm the dashboard state.

**Cannot create a recurring event in the past**

- Use a current or future `start.localDate` that matches the recurrence weekday.

**Hours don't affect a staff member or service**

- Default hours apply only to staff using `usesDefaultWorkingHours: true`.
- Custom staff or service schedules override default business hours.

## API documentation references

- [Query Schedules](https://dev.wix.com/docs/api-reference/business-management/calendar/schedules-v3/query-schedules)
- [Query Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/query-events)
- [Bulk Create Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-create-event)
- [Bulk Update Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-update-event)
- [Bulk Cancel Events](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/bulk-cancel-event)
- [Apps Installer API](https://dev.wix.com/docs/api-reference/business-management/app-installation/install-app)

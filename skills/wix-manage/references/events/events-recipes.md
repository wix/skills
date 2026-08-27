---
name: "Events Recipes"
description: "Event planning and management — create one-off or recurring events, RSVPs, ticketing and ticket tiers, guest capacity, venues, then publish, cancel, reschedule, clone or count them. Use for anything users call events, happenings, gatherings, workshops, concerts, meetups, or webinars."
---

# Events Recipes

Route carefully: several unrelated Wix APIs are called "Events" — these recipes cover public events guests attend, not calendar sessions (Bookings) or webhook domain events. Use **Create Event** to bring a new event into existence, including its date, location, registration type and ticket tiers. Use **Manage Events** for anything about an event that already exists: publishing a draft, cancelling, rescheduling, cloning, updating details, or counting.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Create Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event)
**Technical:** Creates an event with the Wix Events V3 API — the required request body,
ISO-8601 date and time settings, venue/online/TBD location, RSVP vs ticketed
registration, guest capacity, short vs rich-text descriptions, ticket tiers and pricing,
and recurring series. Covers the exact field shapes and the API's misleading validation
messages. Use when the user wants to create an event, set its date, location,
description, guest limit or ticket prices, or set up a repeating event.

### [Manage Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events)
**Technical:** Operates on events that already exist with the Wix Events V3 API —
publishing a draft, cancelling, deleting, cloning, updating an event's date or details,
and counting events. Use when the user wants to publish or cancel an event, duplicate
one, move an event's date, or count their events. Creating an event, its tickets or a
recurring series is a separate recipe.

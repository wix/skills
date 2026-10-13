---
name: "Bookings Dashboard Navigation"
description: "Builds direct links to Wix Bookings dashboard pages on manage.wix.com — services list, edit a specific service, calendar, booking list, staff, availability, resources, and settings pages. Pairs each main Bookings entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Bookings Dashboard Navigation

Build direct links into the Wix Bookings pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

All Wix Bookings (app ID `13d21c63-b5ec-5912-8397-c3a5ddb27a97`) pages live under:

```
https://manage.wix.com/dashboard/{metaSiteId}/bookings/{route}
```

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Services list | `bookings/services` | All services (appointments, classes, courses) |
| Create service | `bookings/services/form` | New service form |
| Edit service | `bookings/services/form/{serviceId}` | A specific service |
| Service templates | `bookings/services/templates-catalog` | Create a service from a template |
| Calendar | `bookings/calendar` | Sessions and daily schedule |
| Booking list | `bookings/bookings/bookings-list` | All bookings in a table view |
| Staff list | `bookings/staff` | Staff members |
| Staff details | `bookings/staff/details/{staffMemberId}` | A specific staff member |
| Availability | `bookings/availability` | Staff working hours / availability management |
| Default business hours | `bookings/availability/default-hours` | The default weekly hours |
| Resources | `bookings/resource-management/resource-types` | Resource types (rooms, equipment) |
| Bookings settings | `bookings/settings` | Settings hub |
| Booking policies | `bookings/settings/policies` | Cancellation / booking policies |
| Reminders | `bookings/settings/reminders` | Email & SMS reminders |
| Booking form | `bookings/settings/booking-form-page` | The customer booking form |
| Apps & integrations | `bookings/integrations` | Bookings integration channels |

Entity-specific links (`{serviceId}`, `{staffMemberId}`) accept the entity's ID appended as an extra path segment. Query params can follow (e.g. `?referralInfo=...`).

Older link formats (`bookings/scheduler/owner/...`) still redirect to the current pages, so links found in existing content keep working.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Service | `POST /bookings/v2/services/query` · `GET /bookings/v2/services/{serviceId}` | `bookings/services/form/{serviceId}` (edit) or `bookings/services` (list) |
| Booking | `POST /bookings/v2/extended-bookings/query` | `bookings/bookings/bookings-list` |
| Staff member | `POST /bookings/v1/staff-members/query` | `bookings/staff/details/{staffMemberId}` |
| Session / event | `POST /calendar/v3/events/query` | `bookings/calendar` |
| Resource type | Resources v2 APIs (`/bookings/v2/resources/...`) | `bookings/resource-management/resource-types` |
| Booking policy | Services API `bookingPolicy` fields | `bookings/settings/policies` |

Example — after creating a service, hand back its edit link:

```
Created "Deep Tissue Massage".
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/bookings/services/form/{serviceId}
```

## Notes

- Pages marked with an entity ID also work without it (they fall back to the list/create state).

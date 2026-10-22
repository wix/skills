---
name: "Events Dashboard Navigation"
description: "Builds direct links to Wix Events dashboard pages on manage.wix.com — the published and draft event lists, a new event, categories, staff, a recurring series' occurrences, and one event's pages: overview, edit, tickets, guests (RSVP or ticketed), orders, schedule, registration settings and form, and policies. Pairs each Events entity with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Events Dashboard Navigation

Build direct links into the Wix Events pages of a site's dashboard. For the general URL contract
(metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

Every Events page is under the `events` namespace of the Wix Events app
(`140603ad-af8d-84a5-2c80-a0f60cb47351`). Take routes from these tables — don't build one from an
API path or a page title.

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Events list | `events` | Published events (upcoming, past, cancelled) |
| Drafts | `events/drafts` | Unpublished events |
| New event | `events/new` | Create an event; add `?eventType=RSVP` or `?eventType=TICKETS`, and `&recurrenceStatus=RECURRING` for a series. `TICKETS` is the dashboard's value — the API's `registration.initialType` is `TICKETING`; don't swap them |
| Categories | `events/categories` | Site-wide event categories |
| Staff | `events/staff` | Staff who check guests in |
| Occurrences | `events/occurrences/{categoryId}` | All occurrences of a recurring series — `dateAndTimeSettings.recurringEvents.categoryId` |

## One Event's Pages

An event's pages are `events/event/{eventId}/{tab}`. For an event whose `status` is `DRAFT`, insert
`draft/`: `events/event/draft/{eventId}/{tab}`. An unknown tab redirects to the overview.

| Page | `{tab}` | Notes |
|---|---|---|
| Overview | `overview` | |
| Edit details | `edit` | Title, date, location, description |
| Tickets | `tickets` | Ticketed events only |
| One ticket | `tickets/{ticketDefinitionId}` | Edit a ticket type |
| New ticket | `tickets/new` | |
| Guests — RSVP event | `rsvp-guests` | `registration.initialType` `RSVP` |
| One RSVP | `rsvp-guests/{rsvpId}` | |
| Guests — ticketed event | `ticketed-guests` | `registration.initialType` `TICKETING` |
| One ticket holder | `ticketed-guests/{ticketNumber}` | e.g. `FM9X-EHKF-ZO1P` |
| Orders | `orders` | Ticketed events only |
| One order | `orders/{orderNumber}` | e.g. `FM9X-EHKF-ZO` |
| Schedule (agenda) | `features/schedule` | |
| Video conferencing | `features/video-conferencing` | |
| Promotion | `promotions` | |
| Settings | `settings` | |
| Registration settings | `settings/registration-settings` | Open/close registration, guest limit, waitlist |
| Registration form | `settings/registration-form` | Form questions |
| Registration messages | `settings/registration-messages` | Confirmation texts; also `settings/registration-closed`, `settings/tickets-unavailable` |
| Policies | `settings/policies` | One policy: `settings/policies/{policyId}` |
| Ticket settings | `settings/tickets-settings` | Tickets per order, tax |
| Guest emails | `settings/rsvp-confirmation-email`, `settings/order-confirmation-email`, `settings/reminder-email`, `settings/cancellation-email`, `settings/waitlist-email` | |

Pick the guests tab from the event's type: `rsvp-guests` for RSVP events, `ticketed-guests` for
ticketed ones. Read it with `"fields": ["REGISTRATION"]` when you don't already have it.

## Pairing Entities with Their Read APIs

Fetch the entity, then link its page.

| Entity | Read API | Dashboard link |
|---|---|---|
| Event | `POST https://www.wixapis.com/events/v3/events/query` · `GET https://www.wixapis.com/events/v3/events/{eventId}` | `events/event/{eventId}/overview` (`draft/` inserted for a draft) |
| Ticket definition | `POST https://www.wixapis.com/events/v3/ticket-definitions/query` | `events/event/{eventId}/tickets/{ticketDefinitionId}` |
| RSVP | `POST https://www.wixapis.com/events/v2/rsvps/search` | `events/event/{eventId}/rsvp-guests/{rsvpId}` |
| Order | `GET https://www.wixapis.com/events/v1/events/{eventId}/orders/{orderNumber}` · list: `GET https://www.wixapis.com/events/v1/orders?eventId={eventId}` | `events/event/{eventId}/orders/{orderNumber}` |
| Ticket | `GET https://www.wixapis.com/events/v1/tickets/{ticketNumber}?eventId={eventId}` · list: `GET https://www.wixapis.com/events/v1/tickets?eventId={eventId}` | `events/event/{eventId}/ticketed-guests/{ticketNumber}` |
| Policy | `POST https://www.wixapis.com/events/v2/policies/query` | `events/event/{eventId}/settings/policies/{policyId}` |
| Category | `POST https://www.wixapis.com/events/v1/categories/query` | `events/categories` |
| Recurring series | the event's `dateAndTimeSettings.recurringEvents.categoryId` | `events/occurrences/{categoryId}` |

See [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events#find-an-event) for finding an event by title, and
[Manage Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-guests) for the guest reads.

Example — after adding a guest to a ticketed event:

```
Added Sam Lee to Winter Gala.
Guest list: https://manage.wix.com/dashboard/{metaSiteId}/events/event/{eventId}/ticketed-guests
```

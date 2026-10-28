---
name: "Event Schedule, Policies and Categories"
description: "Configures what appears around a Wix event on its page — the schedule or agenda, the policies guests accept (terms, refunds), and event categories. Use when the user wants to add an agenda or timetable to an event, add terms or a refund policy, or group events into categories such as workshops or concerts."
---

# Event Schedule, Policies and Categories

## Goal
Set up what appears around an event on its page: the schedule, policies and categories. Each call
takes the event's id — find it first with the query below. The event's URL slug, public guest list,
details page and online conferencing are event updates, in
[Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events#update-an-event).

**Find the event** by its title — this exact body:

```bash
curl -X POST 'https://www.wixapis.com/events/v3/events/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "query": {
      "filter": { "title": { "$eq": "<EVENT_TITLE>" } },
      "paging": { "limit": 100 }
    },
    "fields": ["DETAILS"]
  }'
```

- `paging` is a sibling of `filter` inside `query`; nested inside `filter` it fails `400`.
- Don't send `includeDrafts` unless the user says the event is a draft — `true` needs a draft-events
  permission. If it fails `403`, say draft events aren't readable from this connection.
- The id is `events[].id`. If several events match, pick by date or ask
  ([Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events#find-an-event)).

**Reference pages for the calls below** — the full contract of each; use these rather than
searching for them:

| Part | Reference |
| --- | --- |
| Find the event, turn the schedule section on | [Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events), [Update Event](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/update-event) |
| Schedule | [Add Schedule Item](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/add-schedule-item), [Publish Draft](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/publish-draft), [Query Schedule Items](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/query-schedule-items), [Get Schedule Item](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/get-schedule-item), [Update Schedule Item](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/update-schedule-item), [Delete Schedule Item](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/delete-schedule-item), [Discard Draft](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items/discard-draft) |
| Policies | [Create Policy](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2/create-policy), [Query Policies](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2/query-policies), [Update Policy](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2/update-policy), [Delete Policy](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2/delete-policy), [Reorder Event Policies](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2/reorder-event-policies) |
| Categories | [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/query-categories), [Create Category](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/create-category), [Bulk Create Category](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/bulk-create-category), [Update Category](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/update-category), [Delete Category](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/delete-category), [Assign Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/assign-events), [Unassign Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/unassign-events), [List Event Categories](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/list-event-categories), [Reorder Category Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/reorder-category-events) |

The request bodies below are complete for the common path; the reference pages are for the
fields this recipe doesn't use.

## Schedule (agenda)

Item calls write to a draft schedule. Always run all three steps: add the items, publish the
draft, then turn the schedule section on — skipping either of the last two leaves the event page
without the schedule.

Use `https://www.wixapis.com/events/v1/schedule`. Some reference examples show
`https://www.wixapis.com/events/v1/agenda`, which is not served.

**1. Add items** — one call per item, `POST https://www.wixapis.com/events/v1/schedule/draft`:

```bash
curl -X POST 'https://www.wixapis.com/events/v1/schedule/draft' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "eventId": "<EVENT_ID>",
    "item": {
      "name": "Doors open",
      "timeSlot": {
        "start": "2026-11-20T23:00:00Z",
        "end": "2026-11-21T00:00:00Z",
        "timeZoneId": "America/New_York"
      },
      "stageName": "Main hall",
      "tags": ["Welcome"]
    }
  }'
```

- `name` (up to 120 characters) and `timeSlot.start` / `timeSlot.end` are required. Times are
  ISO-8601; work them out in the event's time zone and send that `timeZoneId` (the default is UTC).
- Optional: `description` (up to 10,000), `stageName` (up to 30), `tags` (up to 5, each up to 30),
  `hidden`. Several items can share a time slot.
- The response is `{ "item": { "id", ... } }`.

**2. Publish:** `POST https://www.wixapis.com/events/v1/schedule/publish` with
`{ "eventId": "<EVENT_ID>" }`.

**3. Turn the section on** if it isn't:
`PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` with
`{ "event": { "agendaSettings": { "enabled": true } }, "fields": ["AGENDA"] }`.

Confirm from the three responses — each add returns the item's `id`, publish returns `2xx`, and the
update returns `agendaSettings.enabled: true`. No separate read of the schedule is needed.

**Read the schedule** — only to list or change items that already exist:
`POST https://www.wixapis.com/events/v1/schedule/query` with
`{ "query": { "filter": { "eventId": { "$eq": "<EVENT_ID>" } }, "paging": { "limit": 100 } } }`
returns `items[]`. Use this call to list items, not the `GET` list. One item:
`GET https://www.wixapis.com/events/v1/schedule/<ITEM_ID>?eventId=<EVENT_ID>&includeDraft=true`.

**Change items** (then publish again):
- Edit: `PATCH https://www.wixapis.com/events/v1/schedule/draft/<ITEM_ID>` with
  `{ "eventId": "<EVENT_ID>", "item": { "name": "Keynote" }, "fields": { "paths": ["item.name"] } }`.
  Always send `fields.paths`, one path per field you change — without it the item is replaced by
  what you sent, and every field you left out (name, tags, time slot) is cleared.
- Hide or cancel an item: `"hidden": true` or `"status": "CANCELED"` the same way (`SCHEDULED` to
  restore).
- Delete: confirm with the user first, then `DELETE https://www.wixapis.com/events/v1/schedule/draft/items?eventId=<EVENT_ID>&itemIds=<ITEM_ID>`.
- Discard all unpublished changes: confirm with the user first, then `DELETE https://www.wixapis.com/events/v1/schedule/draft?eventId=<EVENT_ID>`.
- After moving the event's date or time, update each item's `timeSlot` the same way, then publish.

## Policies

An event takes **up to 3** policies; a fourth fails `428 POLICIES_LIMIT_REACHED` — list them first
and offer to edit one instead. The examples use `https://www.wixapis.com/events/v2/policies`; the
reference's `https://www.wixapis.com/events-policies/v2/policies` is the same API.

- **Create:** `POST https://www.wixapis.com/events/v2/policies`

```json
{ "policy": { "eventId": "<EVENT_ID>", "name": "Refund policy", "body": "Tickets are refundable up to <b>7 days</b> before the event." } }
```

  `name` 1–40 characters; `body` 1–50,000 and may use simple HTML (`<p>`, `<b>`, `<ul>`).
- **List:** `POST https://www.wixapis.com/events/v2/policies/query` with
  `{ "query": { "filter": { "eventId": { "$eq": "<EVENT_ID>" } } } }` → `policies[]` with `id` and
  `revision`.
- **Edit:** `PATCH https://www.wixapis.com/events/v2/policies/<POLICY_ID>` with **all** of
  `id`, `revision` (current), `eventId`, `name` and `body` under `policy`.
- **Delete:** confirm with the user first, then `DELETE https://www.wixapis.com/events/v2/policies/<POLICY_ID>`.
- **Reorder:** `POST https://www.wixapis.com/events/v2/policies/reorder` with `eventId`,
  `policyId`, and exactly one of `beforePolicyId` / `afterPolicyId`.

## Categories

Categories are site-wide; create one once, then assign events to it. An event can be in several.

- **List categories:** `POST https://www.wixapis.com/events/v1/categories/query` with
  `{ "query": { "paging": { "limit": 100 } }, "fieldset": ["COUNTS"] }` → `categories[]` (`id`,
  `name`, `states`) and `metaData`.
- **Create:** `POST https://www.wixapis.com/events/v1/categories` with
  `{ "category": { "name": "Workshops" } }` (`name` 1–30). Several at once (up to 10):
  `POST https://www.wixapis.com/events/v1/bulk/categories/create` with `{ "categories": [ { "name": "..." } ] }`.
- **Rename:** `PATCH https://www.wixapis.com/events/v1/categories/<CATEGORY_ID>` with
  `{ "category": { "id": "<CATEGORY_ID>", "name": "New name" } }`.
- **Delete:** confirm with the user first, then `DELETE https://www.wixapis.com/events/v1/categories/<CATEGORY_ID>` — the events stay.
- **Add events to a category:** `POST https://www.wixapis.com/events/v1/categories/<CATEGORY_ID>/events`
  with `{ "eventId": ["<EVENT_ID>", "<EVENT_ID>"] }` (up to 100).
- **Remove events from a category:**
  `DELETE https://www.wixapis.com/events/v1/categories/<CATEGORY_ID>/events?eventId=<EVENT_ID>&eventId=<EVENT_ID>`.
- **An event's categories:** `GET https://www.wixapis.com/events/v1/categories/<EVENT_ID>` (the path
  takes the **event** id), or Get Event with `fields=CATEGORIES`.
- **Order events within a category:** `POST https://www.wixapis.com/events/v1/categories/<CATEGORY_ID>/reorder`
  with `eventId` and one of `beforeEventId` / `afterEventId`.

Leave categories in the `RECURRING_EVENT` state alone — don't rename them or assign events to
them; create and assign `MANUAL` categories (the default). You may delete a `RECURRING_EVENT`
category whose series has been deleted.

## Related APIs
- **Schedule Items**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items)
- **Policies V2**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2)
- **Categories**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories)
- [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events) — dates, location, page settings, registration settings

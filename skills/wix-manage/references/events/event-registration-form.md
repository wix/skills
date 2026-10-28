---
name: "Event Registration Form"
description: "Customizes the registration form of a Wix event with the Events Form API — adding, editing, reordering and removing questions, the additional-guests field, and the messages guests see after registering or when registration is closed. Use when the user wants to add or require a question on an event's RSVP or checkout form, let guests bring a plus-one, or reword a confirmation message."
---

# Event Registration Form

## Goal
Change what guests are asked when they RSVP or check out for one event, and the messages they see.
Each event has its own form, addressed by the **event id** — not by a form id from a dashboard URL.
Find the event first (below). Whether
registration is open, the guest limit and the waitlist are event settings, changed under
`event.registration` with `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` — not on the
form ([Registration settings](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events#registration-settings)). This is not the Wix Forms app's
forms — those are in [Forms](https://dev.wix.com/docs/api-reference/crm/forms/skills/create-form).

Every change here applies to the live form right away; there is no separate publish step.

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
searching for them: [Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events) (find the event),
[Get Form](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/get-form), [Add Control](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/add-control),
[Update Control](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/update-control), [Delete Control](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/delete-control),
[Update Messages](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/update-messages). The control bodies in the table below are complete —
send them as shown rather than rebuilding them from the schema.

## Read the form

```bash
curl -X GET 'https://www.wixapis.com/events/v1/events/<EVENT_ID>/form' \
  -H 'Authorization: <AUTH>'
```

`form.controls[]` is the list of questions, sorted by `orderIndex`. Each control has an `id` (for
example `phone-1a4acde6c958ff66`), a `type` (`INPUT`, `TEXTAREA`, `DROPDOWN`, `RADIO`, `CHECKBOX`,
`NAME`, `GUEST_CONTROL`, `ADDRESS_SHORT`, `ADDRESS_FULL`, `DATE`), `inputs[]` with each input's
`name`, `label`, `mandatory` and `options`, and `system: true` on the built-in name and email
controls, which can't be removed — only relabeled. `form.messages` holds the messages below. The
same form comes back from `GET https://www.wixapis.com/events/v3/events/<EVENT_ID>?fields=FORM`
under `event.form`.

Read the form before every change: to avoid adding a question that already exists, and to get the
control `id` an update or delete needs.

## Add a question

`POST https://www.wixapis.com/events/v1/events/<EVENT_ID>/form/control` (singular `control`) with
exactly one key naming the kind of question:

```bash
curl -X POST 'https://www.wixapis.com/events/v1/events/<EVENT_ID>/form/control' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "dropdown": {
      "label": "Choose main course",
      "options": ["Vegetarian", "Fish", "Steak"],
      "mandatory": true
    }
  }'
```

| Question | Body |
| --- | --- |
| Short text | `{ "text": { "label": "Company", "mandatory": false, "maxLength": 200 } }` |
| Long text / comments | `{ "text": { "label": "Dietary restrictions", "mandatory": true, "maxLength": 1000, "multiLine": true } }` |
| Dropdown (2–200 options) | `{ "dropdown": { "label": "...", "options": ["A", "B"], "mandatory": true } }` |
| Checkboxes (1–200 options) | `{ "checkbox": { "label": "...", "options": ["I agree to the terms"], "mandatory": true } }` |
| Radio buttons (2–200 options) | `{ "radioButton": { "label": "...", "options": ["Yes", "No"] } }` — no `mandatory` field |
| Date | `{ "date": { "label": "Date of birth", "mandatory": false } }` |
| Phone | `{ "phone": { "label": "Mobile", "mandatory": true } }` |
| Address | `{ "address": { "labels": { "addressLine": "Address" }, "full": false, "mandatory": false } }` — `full: true` for separate street, city, country and postal code fields |
| Additional guests | `{ "additionalGuests": { "labels": { "single": "+1", "multiple": "Guests" }, "namesMandatory": true, "maxGuests": 5 } }` |

- **Additional guests** lets one registrant bring others. `maxGuests` is 1–10: `1` is a single
  plus-one, `5` is "up to 5 guests". `namesMandatory` asks for each guest's name. If the form
  already has a `GUEST_CONTROL`, update it instead of adding a second one.
- Labels: up to 200 characters (100 for date, phone and address labels); `text.maxLength` 0–1000.
- A new question goes to the end of the form; `orderIndex` can't be set on add — move it with an
  update.
- The response is `{ "id", "form" }` — confirm the new control is in `form.controls`. Control ids
  are short names, not GUIDs — a long-text question comes back as `custom`, the additional-guests
  field as `additionalGuests` — so always take the id from the returned form. Guests must answer a
  mandatory question straight away: RSVPs that leave it empty fail `400 INVALID_FORM_RESPONSE`
  (`input custom [''] must not be empty`).
- `400 INVALID_EVENT_CONFIGURATION` — the control's configuration is not valid for this event;
  check the limits above. On ticketed events the number of attendees comes from the ticket
  quantity, so "bring guests" there means more tickets, not an additional-guests question.

## Change, reorder or remove a question

**Update:** `PUT https://www.wixapis.com/events/v1/events/<EVENT_ID>/form/controls/<CONTROL_ID>`
(plural `controls`) with the same one-of key as on add — carrying the control's **full** new
configuration, since this replaces it — and optionally `orderIndex`:

```json
{ "orderIndex": 3, "phone": { "label": "Work phone", "mandatory": false } }
```

- Make a question required or optional: resend it with `mandatory` changed.
- Add a dropdown option: resend the whole `options` array with the new value.
- Reorder: send the control's current configuration with a new `orderIndex`; controls sort in
  ascending `orderIndex`. Read the current values from the form and pick the index between the
  neighbours you want.
- Relabel the built-in fields: `{ "name": { "labels": { "firstName": "Given name", "lastName": "Family name" } } }`
  or `{ "email": { "label": "Work email" } }` on their control ids.

**Delete:** confirm with the user first, then
`DELETE https://www.wixapis.com/events/v1/events/<EVENT_ID>/form/controls/<CONTROL_ID>`. The
returned form can still list the control with `"deleted": true` — ignore controls flagged that way,
and confirm with a fresh read of the form.

`404 CONTROL_NOT_FOUND` — the id is not on this event's form; read the form again.

## Change the messages guests see

`PATCH https://www.wixapis.com/events/v1/events/<EVENT_ID>/form/messages` with the messages under
`messages` and one path per message you change under `fields.paths`. **Always send `fields.paths`**
— without it the call replaces all messages, and every message you didn't send (such as the RSVP
button label) is cleared.

```bash
curl -X PATCH 'https://www.wixapis.com/events/v1/events/<EVENT_ID>/form/messages' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "messages": {
      "rsvp": { "positiveMessages": { "confirmation": { "title": "See you there!" } } },
      "registrationClosed": { "message": "Registration is full — check our news page for updates." }
    },
    "fields": {
      "paths": [
        "messages.rsvp.positiveMessages.confirmation.title",
        "messages.registrationClosed.message"
      ]
    }
  }'
```

| Message | Path under `messages` |
| --- | --- |
| RSVP answer labels and button | `rsvp.rsvpYesOption`, `rsvp.rsvpNoOption`, `rsvp.submitActionLabel` |
| After an RSVP "yes" | `rsvp.positiveMessages.confirmation.{title, message, addToCalendarActionLabel, shareActionLabel}` |
| After joining the waitlist | `rsvp.waitlistMessages.confirmation.{title, message, addToCalendarActionLabel, shareActionLabel}` |
| After an RSVP "no" | `rsvp.negativeMessages.confirmation.{title, shareActionLabel}` |
| Ticket checkout | `checkout.{title, submitActionLabel}`, `checkout.confirmation.{title, message, downloadTicketsLabel, addToCalendarLabel, shareEventLabel}` |
| Registration closed | `registrationClosed.{message, exploreEventsActionLabel}` |
| Tickets unavailable | `ticketsUnavailable.{message, exploreEventsActionLabel}` |

These are the texts on the event's pages; the emails guests receive can't be edited through this API.

## Not supported

- **Conditional questions** (show a question only after another answer) — the event form has no
  conditional logic; say so.
- **Validating an answer against a list** (a members-only code) — answers are not checked.
- **One form per ticket holder** on ticketed events is an event setting, not a form control:
  `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` with
  `{ "event": { "registration": { "tickets": { "guestsAssignedSeparately": true } } } }`.

## Related APIs
- **Events Form**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form) — [Add Control](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/add-control), [Update Messages](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form/update-messages)
- [Manage Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-guests) — guests' answers, adding guests with form values
- [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events) — registration settings

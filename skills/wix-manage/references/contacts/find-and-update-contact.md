---
name: "Find and Update Contact"
description: Finds a CRM contact the user identified by name (or company/email/phone) and updates a field on it. Covers the exact filterable field list of Query Contacts, why filtering by name.first/name.last returns 400 "not declared as filterable", using Search Contacts instead of listing every contact, and the revision that Update Contact requires.
---
# Find and Update Contact

Use this recipe when a user names a contact in words — "update my contact Jordan Lee", "change Dana's phone number", "set the job title for the person at Acme" — and you need to locate that contact and change a field on it.

Do the whole thing: locate the contact, then apply the change. The user naming the contact and the field is the confirmation; don't stop to ask which contact API to use.

The happy path is exactly **two calls**: Search Contacts, then Update Contact.

## Locate the contact

### Query Contacts cannot filter by name

`POST https://www.wixapis.com/contacts/v5/contacts/query` only declares these fields as filterable:

| Field | Operators | Sortable |
|---|---|---|
| `id` | `$eq`, `$in` | no |
| `createdDate` | `$eq`, `$gt`, `$lt`, `$gte`, `$lte` | ASC |
| `updatedDate` | `$eq`, `$gt`, `$lt`, `$gte`, `$lte` | ASC |
| `email.email` | `$eq`, `$in`, `$exists` | no |
| `phone.phone` | `$eq`, `$in`, `$exists` | no |
| `externalId` | `$eq`, `$in`, `$exists` | no |

Any other field in `query.filter` is rejected with HTTP 400:

```json
{
  "message": "value Field 'name.last' is not declared as filterable",
  "details": {
    "validationError": {
      "fieldViolations": [
        { "field": "value", "description": "Field 'name.last' is not declared as filterable" }
      ]
    }
  }
}
```

`name.first`, `name.last`, `company.name` and `company.jobTitle` all fail this way, with `$eq` and with a bare value. Retrying with a different operator does not help — the field is not filterable at all in Query Contacts.

So: use Query Contacts only when you already have an `id`, an exact `email.email`, an exact `phone.phone`, or an `externalId`. For anything else, use Search Contacts.

### Search Contacts — the way to find a contact by name

`POST https://www.wixapis.com/contacts/v5/contacts/search` combines free-text matching with filtering and cursor paging.

Free-text searchable properties: `name.full`, `email.email`, `phone.phone`, `company.name`, `company.jobTitle`, `memberInfo.email`, `memberInfo.profileInfo.nickname`.

```bash
curl -X POST \
  'https://www.wixapis.com/contacts/v5/contacts/search' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "search": {
      "search": {
        "expression": "Jordan Lee",
        "mode": "AND",
        "fuzzy": true
      },
      "cursorPaging": { "limit": 10 }
    },
    "nameFormat": "BY_FIRST_NAME"
  }'
```

Note the doubled nesting: the free-text block is `search.search`, alongside `search.filter`, `search.sort` and `search.cursorPaging`.

- `mode`: `AND` requires every term (use it for a first + last name), `OR` requires any term.
- `fuzzy`: tolerates typos in the expression.
- `nameFormat`: `BY_FIRST_NAME` or `BY_LAST_NAME` — controls how names are matched and ordered.

Unlike Query Contacts, the **filter inside a search request does accept the name fields**, with `$eq`, `$ne`, `$in`, `$nin`, `$exists` and `$startsWith`. Use it when you want an exact surname match rather than free text:

```json
{
  "search": {
    "filter": { "name.last": { "$eq": "Lee" } },
    "cursorPaging": { "limit": 10 }
  }
}
```

Permission: `CONTACTS.CONTACT_READ`.

### Do not list every contact and filter in memory

Paging through `POST /contacts/v5/contacts/query` with no filter to scan for a name works on a small test site and does not scale — Query and Search both cap at 100 items per page. Search Contacts already does this server-side. Reach for a full scan only when the user's description matches no searchable property at all (for example "the contact I added last Tuesday", which is `createdDate` on Query Contacts).

## Apply the update

`PATCH https://www.wixapis.com/contacts/v5/contacts/{contact.id}`

Update Contact requires the contact's **current `revision`** — this is optimistic concurrency, not an optional field. Omitting it or sending a stale value fails the call.

You already have it: both Search Contacts and Query Contacts return the full contact, including `id` and `revision`. Read them off the search result you just got. A separate `GET /contacts/v5/contacts/{contactId}` is only needed when the user handed you a contact id with no revision.

Send `revision` plus only the fields you are changing; other fields keep their current values.

```bash
curl -X PATCH \
  'https://www.wixapis.com/contacts/v5/contacts/acfe01b8-9ee7-4279-b792-0d3c429ce09d' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "contact": {
      "revision": "1",
      "phone": { "phone": "+1-212-555-0100" }
    }
  }'
```

The response returns the contact with `revision` incremented by 1. `phone.e164` is generated from `phone.phone` when the number is a valid E.164 number, so a formatted input like `+1-212-555-0100` comes back as `phone.e164: "+12125550100"`.

Restrictions worth knowing before you build the payload:

- `externalId` can be set only at creation and never changed.
- The main `email.email` of a contact that is also a site member can't be changed here — use the [Members API](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/introduction).
- At least one of `name`, `email`, or `phone` must remain after the update.

Permission: `CONTACTS.CONTACT_UPDATE` (plus `CONTACTS.CONTACT_MEMBER_EMAIL_UPDATE` for a member's main email).

## Handling ambiguity in the search result

- **Exactly one match** — update it and confirm what changed.
- **Several matches** — say how many you found and list them with the details that distinguish them (email, phone, company), then update the one the user identifies. Don't guess between two people.
- **No match** — report that no contact matches, and offer to create one with [Create Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/create-contact) rather than silently doing nothing.

## Common Pitfalls

- **Filtering `name.last` / `name.first` in Query Contacts.** 400 `not declared as filterable`. Use Search Contacts.
- **Changing the filter operator after that 400.** `{"name.last": {"$eq": "Lee"}}` fails identically to `{"name.last": "Lee"}`.
- **Falling back to fetching every contact and matching in memory.** Search Contacts matches `name.full` server-side.
- **Calling Update Contact without `revision`.** Required on every update.
- **Calling Get Contact just to read `revision`** when the search result you already have contains it.
- **Using the v4 filter vocabulary against v5.** Contacts v4 nests fields under `info` (`info.name.last`) — those paths do not exist in the v5 contact, whose fields are top-level (`name.last`, `email.email`, `phone.phone`).

## Related Documentation

- [Search Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/search-contacts)
- [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/query-contacts)
- [Update Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/update-contact)
- [Get Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/get-contact)
- [Contacts Dashboard Navigation](contacts-dashboard-navigation.md) — for handing back a `contacts/view/{contactId}` link after the update

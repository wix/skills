---
name: "Find Contacts"
description: "Finds a site's contacts and answers questions about them: one contact by name, email or phone, contacts in a city, state or country, contacts with a label, birthdays, site members or email subscribers among the contacts, how many contacts match, every contact for an export, and possible duplicate contacts. Covers which contact fields can be filtered, how name matching works, paging through every result, and which fields the answer reads. Use when the user asks to find, look up, list, count or export contacts, wants a contact's details such as their address, or needs a contact's ID for another task such as their bookings or orders."
---

# Find Contacts

Reads contacts. Every call here is read-only. Three endpoints cover the requests:

- **Search Contacts (v5)** — `POST https://www.wixapis.com/contacts/v5/contacts/search`. Use it for everything in the table below.
- **Query Contacts (v5)** — `POST https://www.wixapis.com/contacts/v5/contacts/query`. Use it to read every contact on the site (birthdays on a day, duplicates, a full export).
- **Query Contacts (v4)** — `POST https://www.wixapis.com/contacts/v4/contacts/query`. Use it only for contacts with a label.

The v5 calls return the same field names; the v4 call returns different ones, listed in Step 4.

**Every request below is complete and was run on a live site: send it as written, with your own values, and do not look up the method schema first.** The steps already give each field these calls need: the free-text body with `mode` (`AND` or `OR`) and `fuzzy` (Step 1), the filter fields and operators (Step 1), `cursorPaging` and the cursor-only next page (Steps 2 and 3), and the response fields (Steps 2 and 4).

To change, label or delete a contact after finding it, use [Update a Contact](update-a-contact.md), [Bulk Label and Unlabel Contacts](bulk-label-and-unlabel-contacts.md) or [Bulk Delete Contacts](bulk-delete-contacts.md).

## Step 1: Pick the filter

Search Contacts takes free text in `search.search.expression`, a `search.filter`, or both:

| The user gives | Search Contacts body |
|---|---|
| A name ("Monica Lam", "find kamila") | `{"search": {"search": {"expression": "Monica Lam", "mode": "AND"}}}` |
| An email | `{"search": {"filter": {"email.email": "jane@example.com"}}}` |
| Several emails | `{"search": {"filter": {"email.email": {"$in": ["a@example.com", "b@example.com"]}}}}` |
| A phone number | `{"search": {"filter": {"phone.phone": "+1 312 555 0101"}}}` |
| A city ("my contacts from Chicago") | `{"search": {"filter": {"addresses.address.city": {"$hasSome": ["Chicago"]}}}}` |
| A state or region | `{"search": {"filter": {"addresses.address.subdivision": {"$hasSome": ["US-IL"]}}}}` |
| A country | `{"search": {"filter": {"addresses.address.country": {"$hasSome": ["US"]}}}}` |
| Born in a date range | `{"search": {"filter": {"$and": [{"birthdate": {"$gte": "1980-01-01"}}, {"birthdate": {"$lt": "1990-01-01"}}]}}}` |
| Site members only | `{"search": {"filter": {"memberInfo.memberId": {"$exists": true}}}}` |
| Email subscribers | `{"search": {"filter": {"email.subscriptionStatus.status": "SUBSCRIBED"}}}` |
| Bounced emails | `{"search": {"filter": {"email.deliverabilityStatus": "BOUNCED"}}}` |
| Added in a period | `createdDate` with `$gte` and `$lt`, each in its own condition under `$and` |

How these fields behave:

- **Names.** The expression matches the start of any word in the name, email, phone or company, and ignores case: `"Kam"` finds Kamila. Without `"mode": "AND"`, any one word is enough, so `"Monica Lam"` also returns every other Monica and every other Lam. With `AND`, every word must match, in any order, but each word still matches as a prefix: `"Monica Lam"` also returns Monica Lambert. So keep only the exact matches, ignoring case: when the user gives one word, the contacts whose `name.first` or `name.last` equals it; when they give two or more words, the contacts whose `name.first` and `name.last` together equal them. When the search returns no contacts at all, send the same body with `"fuzzy": true` added next to `expression`; it finds spelling variants such as "Kamilla" for Kamila. When it returns contacts but none matches exactly, go to Step 5.
- **Email** matches only the contact's main email and ignores case. Free text does not search `additionalEmails`; to find an email held there, filter `"additionalEmails.email": {"$hasSome": ["jane@example.com"]}`.
- **Phone** matches in any format: `+1 312 555 0101`, `+13125550101`, `312-555-0101` and `3125550101` all find the same contact.
- **City** ignores case, and `$startsWith` also works. `$eq` on `addresses.address.city` is rejected with `400 ... is using non allowed operator '$eq'`; use `$hasSome`.
- **State or region** is the ISO 3166-2 code: `US-IL`, `GB-ENG`. A bare `IL` does not match.
- **Date ranges.** One object with both `$gte` and `$lt` on the same field is rejected with `400 Filter must contain single operator`. Put each bound in its own condition under `$and`, as in the table.
- **Labels** cannot be filtered in Search Contacts (`400 Field 'info.labelKeys' is not declared as filterable`). Use Query Contacts (v4), Step 4.
- **Filter with Search Contacts, not the v5 Query Contacts.** The v5 Query Contacts filters only on `id`, dates, `email.email`, `phone.phone` and `externalId`, and rejects a name filter. Use it only to read every contact (Step 3).

Filters and free text combine in one request: `{"search": {"search": {"expression": "Dana"}, "filter": {"addresses.address.city": {"$hasSome": ["Chicago"]}}}}`.

**Birthdays on a day of any year** ("birthdays today", "who has a birthday this month"). No filter matches a month and day across years. Read every contact with Query Contacts (v5), Step 3, and keep those whose `birthdate` (`YYYY-MM-DD`) has the month you need (characters 6-7) and, for one day, the day (characters 9-10). Contacts without a birthday have no `birthdate`. Compute the age from the year. Use the site's time zone for "today": `properties.timeZone` from `GET https://www.wixapis.com/site-properties/v4/properties`.

## Step 2: Search

```bash
curl -X POST 'https://www.wixapis.com/contacts/v5/contacts/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "search": { "expression": "Monica Lam", "mode": "AND" },
    "cursorPaging": { "limit": 100 }
  }
}'
```

The response holds `contacts[]` and `pagingMetadata`. Each contact has:

| Field | What it holds |
|---|---|
| `id` | Contact ID. Other APIs that filter by a customer take it, for example `buyerInfo.contactId` in eCommerce orders |
| `revision` | Needed by [Update a Contact](update-a-contact.md) |
| `name.first`, `name.last` | Name |
| `email.email` | Main email; `email.subscriptionStatus.status` and `email.deliverabilityStatus` |
| `additionalEmails[].email` | Other emails |
| `phone.phone`, `phone.e164` | Main phone; other phones in `additionalPhones[]` |
| `addresses[].address` | `addressLine`, `city`, `subdivision`, `postalCode`, `country`; `addresses[].tag` is `HOME`, `WORK`, `BILLING`, `SHIPPING` or `OTHER` |
| `birthdate` | `YYYY-MM-DD` |
| `company.name`, `company.jobTitle` | Company |
| `memberInfo.memberId`, `memberInfo.status` | Present only when the contact is a site member. APIs that work on members take the `memberId` |
| `createdDate`, `lastActivity.date` | When the contact was added, and their last activity |

A field the contact does not have is missing from the response, not empty.

**Count.** `pagingMetadata.total` on the first page is the number of contacts that match. To get only the number, send `"cursorPaging": {"limit": 0}`, or use [Count Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/count-contacts): `POST https://www.wixapis.com/contacts/v5/contacts/count` with `{"filter": {...}}` and/or `{"search": "<text>"}`, which returns `{"count": 2}`.

**Paging.** `cursorPaging.limit` is at most 100; `101` is rejected with `400`. While `pagingMetadata.hasNext` is `true`, send the next request with only the cursor; the cursor carries the free text and the filter of the first request. A request that sends `search`, `filter` or `aggregations` together with a cursor is rejected with `400 Search, filter and aggregations cannot be specified together with cursor`.

```json
{ "search": { "cursorPaging": { "limit": 100, "cursor": "<pagingMetadata.cursors.next>" } } }
```

A list needs every page: stop only when `hasNext` is `false`. A count needs only `total` from the first page, or Count Contacts. `total` appears on the first page only.

**Just created.** Search Contacts and Query Contacts (v4) read a search index: a contact created in the last seconds can be missing from them (in tests, from 1 s to more than 4 s). Query Contacts (v5) reads the contacts themselves and returns it at once. When you hold its ID, read it with `GET https://www.wixapis.com/contacts/v4/contacts/<contactId>`.

## Step 3: Every contact with Query Contacts (v5)

```bash
curl -X POST 'https://www.wixapis.com/contacts/v5/contacts/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "query": { "cursorPaging": { "limit": 100 } } }'
```

The contacts in `contacts[]` have the same fields as in Search Contacts (Step 2), including `birthdate`, `additionalEmails[]` and `additionalPhones[]`. `cursorPaging.limit` is at most 100. While `pagingMetadata.hasNext` is `true`, send the next request with only the cursor: `{"query": {"cursorPaging": {"limit": 100, "cursor": "<pagingMetadata.cursors.next>"}}}`. Read every page before you answer.

## Step 4: Labels with Query Contacts (v4)

Filter on the label's key. Get the key from the label's name with `POST https://www.wixapis.com/contacts/v4/labels/query` and `{"query": {"filter": {"displayName": {"$eq": "VIP"}}}}`, then read `labels[].key`. A key can carry a generated suffix, such as `custom.vip-a1B2c`, so never build one from the name.

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/contacts/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {
    "filter": { "info.labelKeys": { "$hasSome": ["custom.vip-a1B2c"] } },
    "sort": [{ "fieldName": "createdDate", "order": "ASC" }],
    "paging": { "limit": 1000, "offset": 0 }
  }
}'
```

`paging.limit` is at most 1,000. For the next page, send the same body with `offset` increased by `limit`; stop when `pagingMetadata.hasNext` is `false`. `pagingMetadata.total` is the number of matches. Send a `sort`: without one, the results do not come back in the `createdDate` order the reference describes.

Query Contacts (v4) also filters on `info.name.first`, `info.name.last` (whole word, ignores case; `$startsWith` for a prefix), `primaryInfo.email`, `primaryInfo.phone`, `info.birthdate`, `createdDate` and `info.addresses.city`. `info.addresses.postalCode` is rejected with `400 UNSUPPORTED_FILTER`.

Its contacts have different field names from the v5 calls:

| Field | What it holds |
|---|---|
| `id`, `revision` | Contact ID and revision |
| `info.name.first`, `info.name.last` | Name |
| `primaryInfo.email`, `primaryInfo.phone` | Main email and phone |
| `info.emails.items[].email` | Every email, the main one with `primary: true` |
| `info.phones.items[].e164Phone` | Every phone in E.164 form, such as `+13125550101` |
| `info.addresses.items[].address` | `addressLine`, `city`, `subdivision`, `postalCode`, `country` |
| `info.birthdate` | `YYYY-MM-DD` |
| `info.labelKeys.items[]` | Label keys |

## Step 5: Build the answer

- **One contact:** match the user's name exactly (Step 1). One match: give the details the user asked for, such as the address from `addresses[].address`. Several exact matches: list them with their email and ask which one. None: say so, give the names of the closest results, and ask.
- **Contact for another task** (their bookings, orders, plan or messages): take the `id` of the one exact match, or `memberInfo.memberId` for an API that works on members, and continue with that task's recipe. Ask first when several contacts match.
- **Lists and exports:** read every page and return the columns the user asked for. For a full export of every contact, use Query Contacts (v5), Step 3. A list longer than a few dozen rows goes in a file or a table, not in a chat message.
- **Possible duplicates:** Wix rejects a new contact whose main email or main phone is already on another contact (`409 DUPLICATE_CONTACT_EXISTS`, with `matchingContactId`). So duplicates on a site are contacts with the same name, or an email or phone that is the main one on one contact and an additional one on another. Read every contact with Query Contacts (v5), Step 3, and group them by `name.first` plus `name.last` in lower case, by every email (`email.email` and `additionalEmails[].email`, in lower case) and by every phone (`phone.e164` and `additionalPhones[].e164`). Report each group with more than one contact, with the IDs, names, emails and phones. Merging or deleting contacts changes data: ask the user first.

No contacts found: say so with the filter you used, and offer a wider search, such as the free text without `"mode": "AND"`.

## Related

- [Search Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/search-contacts)
- [Count Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/count-contacts)
- [Query Contacts (v5)](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/query-contacts)
- [Query Contacts (v4)](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts)
- [Query Labels](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/query-labels)

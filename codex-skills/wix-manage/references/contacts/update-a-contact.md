---
name: "Update a Contact"
description: Updates an existing contact's email, phone, name, or address with the Contacts API. Covers locating the contact when the user identifies it by name, passing its current revision, and the ISO 3166-2 subdivision format required for state, region and province codes.
---
# Update a Contact

## Description
Changes fields on a contact that already exists — its email, phone, name, or address.

## API Endpoints
- `POST https://www.wixapis.com/contacts/v5/contacts/search` — locate the contact
- `PATCH https://www.wixapis.com/contacts/v5/contacts/{contactId}` — change its fields
- `POST https://www.wixapis.com/contacts/v5/contacts/{contactId}/addresses` — add one address

Contacts has two live versions. Use the v5 endpoints above for updates; the v4 update takes a
different, more deeply nested body, and mixing the two shapes is rejected with
`400 {"message":"Expected an object"}`.

## Steps

### 1. Locate the contact with Search Contacts, not Query Contacts

When the user identifies a contact by name — "my contact Jordan Lee" — the lookup is Search
Contacts. Query Contacts filters on a small closed set of fields that does not include the
contact's name, so a query filtered by name is rejected:

```
HTTP 400 {"message":"value Field 'name.first' is not declared as filterable",
 "details":{"validationError":{"fieldViolations":[{"field":"value",
   "description":"Field 'name.first' is not declared as filterable"}]}}}
```

Search Contacts takes a free-text expression, and matches on names. Note the doubled `search` —
the outer one is the search request, the inner one is the free-text clause:

```json
{ "search": { "search": { "expression": "Jordan Lee" } } }
```

Read both `id` and `revision` off the contact it returns. Step 2 needs both. Query Contacts is
still the right call when you already have an email address, a phone number or an id to filter on.

### 2. Send the update with the contact's current revision

Copy this body and change the values. Only the fields you send are being set; `id` and `revision`
identify which contact and which version you are updating:

```json
{
  "contact": {
    "id": "<contact id from step 1>",
    "revision": "<revision from step 1>",
    "email": { "email": "jordan.lee@newmail.com" }
  }
}
```

Swap `email` for `phone` (`{ "phone": { "phone": "+1-212-555-0100" } }`) or `name` to change those
instead. `revision` changes on every write, so re-read it if an update conflicts.

### 3. Add an address with Add Contact Address

To attach one more address, post it to the contact's `addresses` sub-resource rather than sending
the whole contact — the address is appended, so existing addresses survive:

```json
{
  "revision": "<revision from step 1>",
  "address": {
    "address": {
      "addressLine": "350 Fifth Avenue",
      "city": "New York",
      "subdivision": "US-NY",
      "postalCode": "10118",
      "country": "US"
    }
  }
}
```

Note the doubled `address` here too: the outer object is the contact's address entry, which can
carry a `tag`, and the inner one is the postal address itself.

`tag` is one of `OTHER`, `HOME`, `WORK`, `BILLING`, `SHIPPING`, and that list is closed — there is
no "untagged" or "none" member. When the user did not say what kind of address it is, leave `tag`
out, exactly as above; inventing a value for that case is rejected:

```
HTTP 400 {"message":"address is invalid:
`-- tag enum must be in [UNKNOWN_ADDRESS_TAG(0), OTHER(1), HOME(2), WORK(3), BILLING(4), SHIPPING(5)]"}
```

### 4. Write `subdivision` in ISO 3166-2 form

`subdivision` is the 2-letter country code, a hyphen, then 1-3 characters for the state, region,
prefecture or province: `US-NY`, `GB-ENG`, `FR-976`. A bare state code is rejected, on updates as
well as on creates:

```
HTTP 400 {"message":"address is invalid:
`-- address is invalid:
    `-- subdivision is not a valid subdivision code",
 "details":{"validationError":{"fieldViolations":[{
   "field":"address.address.subdivision",
   "description":"is not a valid subdivision code","violatedRule":"FORMAT",
   "data":{"type":"SUBDIVISION"}}]}}}
```

The Contacts reference describes this field as a "short code (2 or 3 letters)" and gives `NY` as
the example, which the server does not accept. Use the hyphenated form.

`country` is the plain [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) code
— `US`, no hyphen. Only `subdivision` carries the country prefix.

## Related

- [Update Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/update-contact)
- [Search Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/search-contacts)
- [Add Contact Address](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/add-contact-address)

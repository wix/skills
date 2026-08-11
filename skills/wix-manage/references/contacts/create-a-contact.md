---
name: "Create a Contact"
description: Creates a contact with the Contacts API. Covers the minimum identifying fields, the single-object shape of `email` and `phone`, and adding a physical address with the ISO 3166-2 subdivision format required for state, region, and province codes.
---
# Create a Contact

## Description
Creates a contact, optionally with a physical address in the same call.

## API Endpoint
`POST https://www.wixapis.com/contacts/v5/contacts`

## Steps

### 1. Create the contact

At least one of `name.first`, `name.last`, `email.email`, or `phone.phone` must be present. Copy this body and change the values:

```json
{
  "contact": {
    "name": { "first": "Maria", "last": "Gomez" },
    "email": { "email": "maria.gomez@example.com" },
    "phone": { "phone": "+1 212 555 0134" }
  }
}
```

`email` is a single object, exactly as above. Send a list instead — `emails: [{ tag: 'MAIN', email: '…' }]` — and the request still returns `200`, but the field is discarded: the contact is created with no email at all. Nothing in the response reports this, so it surfaces only when something later reads the contact back and the email is missing. The same holds for `phone`. Read `contact.email.email` off the create response to confirm it was stored.

### 2. Add an address (optional)

Include `addresses` in the same create call when the user gave a street address:

```json
{
  "contact": {
    "name": { "first": "Maria", "last": "Gomez" },
    "email": { "email": "maria.gomez@example.com" },
    "addresses": [
      {
        "tag": "HOME",
        "address": {
          "addressLine": "350 Fifth Avenue",
          "city": "New York",
          "subdivision": "US-NY",
          "postalCode": "10118",
          "country": "US"
        }
      }
    ]
  }
}
```

`addresses[].address` takes either `addressLine` as free text, or a structured `streetAddress` object — not both.

`tag` is one of `OTHER`, `HOME`, `WORK`, `BILLING`, `SHIPPING`, and that list is closed — there is no "untagged" or "none" member. When the user did not say what kind of address it is, leave `tag` out and it defaults to `OTHER`; inventing a value for that case is rejected with `400`.

### 3. Write `subdivision` in ISO 3166-2 form

`subdivision` is the 2-letter country code, a hyphen, then 1-3 characters for the state, region, prefecture or province: `US-NY`, `GB-ENG`, `FR-976`. A bare state code is rejected:

```
HTTP 400 {"message":"contact is invalid:
`-- addresses [at index 0] is invalid:
    `-- address is invalid:
       `-- subdivision is not a valid subdivision code",
 "details":{"validationError":{"fieldViolations":[{
   "field":"contact.addresses[0].address.subdivision",
   "description":"is not a valid subdivision code","violatedRule":"FORMAT",
   "data":{"type":"SUBDIVISION"}}]}}}
```

The Create Contact reference describes this field as a "short code (2 or 3 letters)" and gives `NY` as the example, which the server does not accept. Use the hyphenated form.

`country` is the plain [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) code — `US`, no hyphen. Only `subdivision` carries the country prefix.

## Related

- [Create Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/create-contact)
- [Update Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5/update-contact)

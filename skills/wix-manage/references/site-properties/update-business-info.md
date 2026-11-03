---
name: "Show and Update Business Info"
description: "Shows and changes a site's business info through the Site Properties API: the business name, description and company ID, the public contact email, phone, fax and address, and the opening hours the site shows. Covers changing one detail while keeping the others, removing a detail, and adding, changing or removing business hours and holiday closures. Not for Wix Bookings availability (default bookable hours) or the site's currency, time zone, language or region."
---

# Show and Update Business Info

The business info of a site is a set of Site Properties: the business profile (name, description, company ID), the public contact details (email, phone, fax, address) and the business hours. These are the details the site and its apps show as the business's public info, and the ones the dashboard settings show as business info.

| The user wants to... | Call |
|---|---|
| See the current details | [Get Site Properties](#read-the-current-details) |
| Change the email, phone, fax or address, or remove one | [Update Business Contact](#change-or-remove-a-contact-detail) |
| Change the business name, description or company ID | [Update Business Profile](#change-the-business-name-or-description) |
| Add, change or remove opening hours or a holiday closure | [Update Business Schedule](#change-the-business-hours) |

A request like "set the name, phone and email" needs two calls: the name goes through Update Business Profile, the phone and email through Update Business Contact. Each update method rejects the other method's fields with `400`.

Not covered here:
- Bookings availability (when clients can book) is not the business schedule. Use [Configure Default Business Hours](../calendar/configure-default-business-hours.md).
- Currency, time zone, language and region: use [Change a Site's Regional Properties](change-payment-currency-site-properties.md).
- There is no tagline field. When the user asks for a tagline, ask whether they mean the business description (`description`) or a text on a site page, which is edited in the site editor.

## Rules for every update

- **Send a field mask.** Each update takes `fields.paths`, the top-level field names you change. A request without it fails with `400 "Illegal request - No updates on request body"`.
- **A path in the mask with no value in the body clears that field.** Build the mask from the fields you send. Do not add a path "to be safe": `paths: ["phone", "email"]` with only `phone` in the body deletes the email.
- **`address` is one value.** The mask takes `address`, never `address.city` (`400 "Fields Vector(address.city) are not allowed"`). The address you send replaces the stored one: an address with only `city` clears the street, zip, state and country. To change part of the address, read it, change the parts, and send the whole object, `isPhysical` and `googleFormattedAddress` included (see [Change the address](#change-or-remove-a-contact-detail)).
- **The business schedule is one value too.** Update Business Schedule replaces both `periods` and `specialHourPeriod` with what you send, and it ignores a field mask. To add or change one day, read the schedule, change it, and send all of it back.
- **A `2xx` with an empty body `{}` means the update is saved.** Every update method returns `{}`. Do not make an extra call only to check a `2xx` update. When you show the user the stored values, a `GET` right after the update already returns them.
- **The values are not validated.** An email without `@`, a time like `9am`, or a close time before the open time is stored as sent with `2xx`. Check the values before you send them: email `name@domain`, times `HH:MM` from `00:00` to `24:00`, a country as a 2-letter ISO 3166-1 code. A 3-letter country code such as `USA` fails with `500`.
- **Confirmation.** When the user gave the new value ("replace our email with ...", "set the name to ..."), the request is the confirmation: make the change. Ask first when you would change something the user did not name: removing the address or all hours because of an unclear request, or replacing a detail the user only described.

## Read the current details

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

To read only some fields, repeat the `fields` query parameter:
`GET https://www.wixapis.com/site-properties/v4/properties?fields=email&fields=phone&fields=address`.

The business info is at the top level of `properties`:

```json
{
  "version": "42",
  "properties": {
    "businessName": "Harbor Bakery",
    "description": "Fresh bread and pastries every morning.",
    "companyId": "123456789",
    "email": "hello@example.com",
    "phone": "+1 555-010-0100",
    "address": {
      "streetNumber": "12",
      "street": "Mill Lane",
      "apartmentNumber": "",
      "city": "Springfield",
      "state": "CA",
      "zip": "90001",
      "country": "US",
      "isPhysical": true,
      "googleFormattedAddress": "12 Mill Lane, Springfield, CA 90001, USA"
    },
    "businessSchedule": {
      "periods": [
        { "openDay": "MONDAY", "openTime": "09:00", "closeDay": "MONDAY", "closeTime": "17:00" }
      ],
      "specialHourPeriod": [
        { "startDate": "2026-12-25T05:00:00Z", "endDate": "2026-12-26T05:00:00Z", "isClosed": true, "comment": "Christmas" }
      ]
    }
  }
}
```

A field that was never set is missing from the response. A removed address is missing too. `siteDisplayName` is the site's name in My Sites and the dashboard, not the business name. Renaming the site is a separate task that this recipe does not cover. The response also holds the regional fields (`paymentCurrency`, `timeZone`, `language`, `locale`) and others that this recipe does not change.

## Change or remove a contact detail

[Update Business Contact](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-contact): `POST https://www.wixapis.com/site-properties/v4/properties/business-contact`. Mask paths: `email`, `phone`, `fax`, `address`.

Change the email and phone:

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-contact' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessContact": {
      "email": "hello@example.com",
      "phone": "+1 555-010-0100"
    },
    "fields": { "paths": ["email", "phone"] }
  }'
```

`phone` is one free-text string. To change only the country prefix (for example to `+34`), read the current `phone`, replace its prefix, and send the whole new number.

Change the address: send all parts of the address. For a change to one part ("only the street changed"), read `properties.address` first, copy the whole object, change that part, and send it back. Two fields are easy to lose:
- `isPhysical`: copy it from the read. Left out, it becomes `false`.
- `googleFormattedAddress`: the address as one line. When the read has one, write the new address in it. Copied unchanged, it keeps the old address. Left out, it becomes empty.

```json
{
  "businessContact": {
    "address": {
      "streetNumber": "48",
      "street": "Harbor Road",
      "apartmentNumber": "",
      "city": "Springfield",
      "state": "CA",
      "zip": "90001",
      "country": "US",
      "isPhysical": true,
      "googleFormattedAddress": "48 Harbor Road, Springfield, CA 90001, USA"
    }
  },
  "fields": { "paths": ["address"] }
}
```

Put the house number in `streetNumber` and the street name in `street`. `country` is a 2-letter code (`US`, `GB`, `FR`).

Remove a detail: name it in the mask and leave it out of the body. This removes the address and keeps the email and phone:

```json
{
  "businessContact": {},
  "fields": { "paths": ["address"] }
}
```

## Change the business name or description

[Update Business Profile](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-profile): `POST https://www.wixapis.com/site-properties/v4/properties/business-profile`. Mask paths: `businessName`, `description`, `companyId` (the company number from the local authorities, shown on invoices and price quotes), and `logo` and `siteDisplayName`, which this recipe does not change. `logo` takes the path of an image that is already in the site's Wix Media, without the media base URL; this recipe does not cover uploading one.

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-profile' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessProfile": {
      "businessName": "Harbor Bakery",
      "description": "Fresh bread and pastries every morning."
    },
    "fields": { "paths": ["businessName", "description"] }
  }'
```

This method rejects contact fields (`email`, `phone`, `address`) and fields it does not have (`tagline`, `categories`) with `400 "Illegal request - Fields Vector(<field>) are not allowed for updateBusinessProfile"`.

## Change the business hours

[Update Business Schedule](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-schedule): `POST https://www.wixapis.com/site-properties/v4/properties/business-schedule`. No field mask. The body is the whole schedule:

- `periods`: the weekly hours, one entry per open period. Days are `MONDAY` to `SUNDAY`. Times are `HH:MM`, 24-hour, `00:00` to `24:00`. A period that ends after midnight closes on the next day (`"openDay": "FRIDAY", "openTime": "20:00", "closeDay": "SATURDAY", "closeTime": "02:00"`). A day with two periods (a lunch break) has two entries. A closed day has no entry.
- `specialHourPeriod`: holiday closures and other exceptions. Each entry is the time from `startDate` to `endDate`, as ISO 8601 date-times in UTC. `isClosed: true` means closed for that time, `false` means open. `comment` is optional text. To close for whole days, start at local midnight of the first day and end at local midnight after the last day, converted to UTC with the site's `properties.timeZone`. For a site in `America/New_York` (UTC-5 in winter), closed on December 25, 2026: `"startDate": "2026-12-25T05:00:00Z", "endDate": "2026-12-26T05:00:00Z"`.

To add or change hours, run the `GET` first, change `properties.businessSchedule`, and send both arrays. This keeps Monday to Friday and the holiday closure, and adds Saturday:

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-schedule' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessSchedule": {
      "periods": [
        { "openDay": "MONDAY", "openTime": "09:00", "closeDay": "MONDAY", "closeTime": "17:00" },
        { "openDay": "TUESDAY", "openTime": "09:00", "closeDay": "TUESDAY", "closeTime": "17:00" },
        { "openDay": "WEDNESDAY", "openTime": "09:00", "closeDay": "WEDNESDAY", "closeTime": "17:00" },
        { "openDay": "THURSDAY", "openTime": "09:00", "closeDay": "THURSDAY", "closeTime": "17:00" },
        { "openDay": "FRIDAY", "openTime": "09:00", "closeDay": "FRIDAY", "closeTime": "17:00" },
        { "openDay": "SATURDAY", "openTime": "10:00", "closeDay": "SATURDAY", "closeTime": "14:00" }
      ],
      "specialHourPeriod": [
        { "startDate": "2026-12-25T05:00:00Z", "endDate": "2026-12-26T05:00:00Z", "isClosed": true, "comment": "Christmas" }
      ]
    }
  }'
```

A body with only `periods` deletes every holiday closure, and a body with only `specialHourPeriod` deletes the weekly hours.

To remove all hours from the site, send `{ "businessSchedule": { "periods": [], "specialHourPeriod": [] } }`. A later `GET` returns the two arrays empty.

## Related
- [Site Properties API](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties): the full read shape
- [Site Settings Dashboard Navigation](site-properties-dashboard-navigation.md): a link to the settings hub, where the business info is

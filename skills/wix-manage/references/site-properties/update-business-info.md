---
name: "Show and Update Business Info"
description: "Shows and changes a site's business info through the Site Properties API: the business name, description and company ID, and the public contact email, phone, fax and address. Covers changing one detail while keeping the others, and removing a detail. Also explains why opening hours and holiday closures should not be set through Site Properties, and points to the Bookings and Restaurants APIs that actually drive them. Not for Wix Bookings availability (default bookable hours) or the site's currency, time zone, language or region."
---

# Show and Update Business Info

The business info of a site is a set of Site Properties: the business profile (name, description, company ID), the public contact details (email, phone, fax, address) and the business hours. These are the details the site and its apps show as the business's public info, and the ones the dashboard settings show as business info.

| The user wants to... | Call |
|---|---|
| See the current details | [Get Site Properties](#read-the-current-details) |
| Change the email, phone, fax or address, or remove one | [Update Business Contact](#change-or-remove-a-contact-detail) |
| Change the business name, description or company ID | [Update Business Profile](#change-the-business-name-or-description) |
| Add, change or remove opening hours or a holiday closure | [Not through Site Properties](#change-the-business-hours) — go to the Bookings or Restaurants API instead |

A request like "set the name, phone and email" needs two calls: the name goes through Update Business Profile, the phone and email through Update Business Contact. Each update method rejects the other method's fields with `400`.

Not covered here:
- Bookings availability (when clients can book) is not the business schedule. Use [Configure Default Business Hours](../calendar/configure-default-business-hours.md).
- Currency, time zone, language and region: use [Change a Site's Regional Properties](change-payment-currency-site-properties.md).
- There is no tagline field. When the user asks for a tagline, ask whether they mean the business description (`description`) or a text on a site page, which is edited in the site editor.
- Opening hours and holiday closures: the Site Properties `businessSchedule` (`periods` and `specialHourPeriod`) is no longer read by any Wix product. See [Change the business hours](#change-the-business-hours) for where hours actually live.

## Rules for every update

- **Send a field mask.** Each update takes `fields.paths`, the top-level field names you change. A request without it fails with `400 "Illegal request - No updates on request body"`.
- **A path in the mask with no value in the body clears that field.** Build the mask from the fields you send. Do not add a path "to be safe": `paths: ["phone", "email"]` with only `phone` in the body deletes the email.
- **`address` is one value.** The mask takes `address`, never `address.city` (`400 "Fields Vector(address.city) are not allowed"`). The address you send replaces the stored one: an address with only `city` clears the street, zip, state and country. To change part of the address, read it, change the parts, and send the whole object, `isPhysical` and `googleFormattedAddress` included (see [Change the address](#change-or-remove-a-contact-detail)).
- **Don't use Update Business Schedule for opening hours.** It still exists and returns `2xx`, but no Wix product reads the result. See [Change the business hours](#change-the-business-hours) for the APIs that actually drive opening hours.
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

A field that was never set is missing from the response. A removed address is missing too. `siteDisplayName` is the site's name in My Sites and the dashboard, not the business name. Renaming the site is a separate task that this recipe does not cover. The response also holds the regional fields (`paymentCurrency`, `timeZone`, `language`, `locale`) and others that this recipe does not change. `businessSchedule` may still appear here, but it is not in use — see [Change the business hours](#change-the-business-hours).

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

The Site Properties `businessSchedule` (`periods` and `specialHourPeriod`, set through [Update Business Schedule](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-schedule)) is no longer in use by any Wix product. It still accepts updates and returns `2xx`, and a `GET` on `/site-properties/v4/properties` still echoes back whatever was last written there, but nothing on the site reads it. Do not use it to set opening hours, even though it looks like the general-purpose place for them.

Only two verticals hold their own business-hours entity, and each is edited through its own API:

- **Bookings** — the schedule belongs to each staff member, not the site. Use [Assign Working Hours Schedule](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/assign-working-hours-schedule) on the Staff Members API to set when a staff member is available.
- **Restaurants (online ordering)** — the weekly hours and exceptions live on the ordering settings, not the site. Use [Update Menu Ordering Settings](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/update-menu-ordering-settings) for the regular weekly hours, and [Create Availability Exception](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/availability-exceptions/create-availability-exception) for special days and closures (the restaurant equivalent of a holiday closure).

**Stores has no business-schedule entity at all** — there is no opening-hours concept to set for a store.

If the user's site does not have Bookings or Restaurants installed, say that opening hours have no effect on the site today, rather than writing them to the unused Site Properties field.

## Related
- [Site Properties API](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties): the full read shape
- [Site Settings Dashboard Navigation](site-properties-dashboard-navigation.md): a link to the settings hub, where the business info is
- [Assign Working Hours Schedule](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/assign-working-hours-schedule): Bookings staff member hours
- [Update Menu Ordering Settings](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/update-menu-ordering-settings): Restaurants weekly ordering hours
- [Create Availability Exception](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/availability-exceptions/create-availability-exception): Restaurants special/closed days

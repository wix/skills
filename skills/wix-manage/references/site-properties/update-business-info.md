---
name: "Show and Update Business Info"
description: "Shows and changes a site's business info through the Site Properties API: the business name, description and company ID, and the public contact email, phone, fax and address. Covers changing one detail while keeping the others, and removing a detail. Also explains why the Site Properties business schedule is not where opening hours live, and routes Bookings and Restaurants hours requests to their own APIs. Not for Wix Bookings availability (default bookable hours), Restaurants ordering hours, or the site's currency, time zone, language or region."
---

# Show and Update Business Info

The business info of a site is a set of Site Properties: the business profile (name, description, company ID) and the public contact details (email, phone, fax, address). These are the details the site and its apps show as the business's public info, and the ones the dashboard settings show as business info.

### 🚨 Opening hours are NOT in this API — stop and ask, do not investigate

A request like "change our business hours", "we're open on Saturdays now" or "add a holiday closure" is **not** a Site Properties task, however much it sounds like one — **do not read or call any other skill, doc or endpoint to try to resolve it.** `properties.businessSchedule` (`periods`, `specialHourPeriod`) still exists and [Update Business Schedule](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-schedule) still accepts writes to it with `2xx` — **but it is confirmed dead for Bookings** (see [Configure Default Business Hours](../calendar/configure-default-business-hours.md), which documents Calendar Events as the correct API there instead) **and for Restaurants** (see below: ordering hours live on the fulfillment method, not here) — so writing it and reporting "done" would be wrong, not just incomplete, for either. There is no general, app-independent "site opening hours" to fall back on either: opening hours only exist inside Bookings or Restaurants, never at the site level, and Stores has no business-hours concept at all.

**Before doing anything else, find out which app the hours are for** — a site can run Bookings, Restaurants, both or neither — and if the request doesn't already say, ask. The question just needs to establish that (Bookings vs. Restaurants online ordering); phrase it however reads naturally, but ask it before attempting anything, rather than guessing or explaining the limitation without asking.

Once you know, use that app's own API — this skill does not cover it. For Wix Bookings' **default** business hours (the base availability shown in the dashboard's "Set default hours", as opposed to one staff member's own hours), use [Configure Default Business Hours](../calendar/configure-default-business-hours.md). For Restaurants, see the worked example below. The other verticals' APIs are in [Related](#related).

#### Restaurants: online-ordering hours are on the fulfillment method, not the menu

A restaurant's delivery/pickup hours are not a menu property and not Menu Ordering Settings (that API only toggles whether a menu is orderable at all, via `onlineOrderingEnabled` — it has no weekly schedule). The actual weekly hours live on the **fulfillment method** itself (the "Delivery" or "Pickup" option a site offers), under its `availability.availableTimes`.

1. List the site's fulfillment methods and find the one with the matching `type` (`DELIVERY` or `PICKUP`) — keep its `id` and `revision`:
   ```bash
   curl -X GET 'https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods' \
     -H 'Authorization: <AUTH>'
   ```
2. PATCH that method's `availability` — one `availableTimes` entry per open weekday (`dayOfWeek`: `MON`...`SUN`), each with `timeRanges: [{ startTime, endTime }]` (`hours` 0-23, `minutes` 0-59). A day with no entry is closed. `revision` is mandatory and must be current; a stale one `400`s:
   ```bash
   curl -X PATCH 'https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods/<methodId>' \
     -H 'Content-Type: application/json' \
     -H 'Authorization: <AUTH>' \
     --data-binary '{
       "fulfillmentMethod": {
         "revision": "<currentRevision>",
         "availability": {
           "timeZone": "America/New_York",
           "availableTimes": [
             { "dayOfWeek": "SUN", "timeRanges": [{ "startTime": { "hours": 10, "minutes": 0 }, "endTime": { "hours": 14, "minutes": 0 } }] },
             { "dayOfWeek": "MON", "timeRanges": [{ "startTime": { "hours": 10, "minutes": 0 }, "endTime": { "hours": 14, "minutes": 0 } }] }
           ]
         }
       }
     }'
   ```
   `timeZone` is required on every write (Wix overrides it with the site's own region anyway, so any valid IANA zone is accepted).

Holiday or special closures are a separate entity, not part of the weekly schedule above: [Create Availability Exception](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/availability-exceptions/create-availability-exception).

| The user wants to... | Call |
|---|---|
| See the current details | [Get Site Properties](#read-the-current-details) |
| Change the email, phone, fax or address, or remove one | [Update Business Contact](#change-or-remove-a-contact-detail) |
| Change the business name, description or company ID | [Update Business Profile](#change-the-business-name-or-description) |
| Add, change or remove opening hours or a holiday closure | Not this API — see above |

A request like "set the name, phone and email" needs two calls: the name goes through Update Business Profile, the phone and email through Update Business Contact. Each update method rejects the other method's fields with `400`.

Not covered here:
- Opening hours, for Bookings, Restaurants or Stores, however the user phrases it ("business hours", "when we're open"): see above.
- Currency, time zone, language and region: use [Change a Site's Regional Properties](change-payment-currency-site-properties.md).
- There is no tagline field. When the user asks for a tagline, ask whether they mean the business description (`description`) or a text on a site page, which is edited in the site editor.

## Rules for every update

- **Send a field mask.** Each update takes `fields.paths`, the top-level field names you change. A request without it fails with `400 "Illegal request - No updates on request body"`.
- **A path in the mask with no value in the body clears that field.** Build the mask from the fields you send. Do not add a path "to be safe": `paths: ["phone", "email"]` with only `phone` in the body deletes the email.
- **`address` is one value.** The mask takes `address`, never `address.city` (`400 "Fields Vector(address.city) are not allowed"`). The address you send replaces the stored one: an address with only `city` clears the street, zip, state and country. To change part of the address, read it, change the parts, and send the whole object, `isPhysical` and `googleFormattedAddress` included (see [Change the address](#change-or-remove-a-contact-detail)).
- **A `2xx` with an empty body `{}` means the update is saved.** Every update method returns `{}`. Do not make an extra call only to check a `2xx` update. When you show the user the stored values, a `GET` right after the update already returns them.
- **The values are not validated.** An email without `@`, a time like `9am`, or a close time before the open time is stored as sent with `2xx`. Check the values before you send them: email `name@domain`, times `HH:MM` from `00:00` to `24:00`, a country as a 2-letter ISO 3166-1 code. A 3-letter country code such as `USA` fails with `500`.
- **Confirmation.** When the user gave the new value ("replace our email with ...", "set the name to ..."), the request is the confirmation: make the change. Ask first when you would change something the user did not name: removing the address because of an unclear request, or replacing a detail the user only described.

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
    }
  }
}
```

A field that was never set is missing from the response. A removed address is missing too. `siteDisplayName` is the site's name in My Sites and the dashboard, not the business name. Renaming the site is a separate task that this recipe does not cover. The response also holds the regional fields (`paymentCurrency`, `timeZone`, `language`, `locale`) and others that this recipe does not change. It also still holds a `businessSchedule` field — do not treat its presence as actionable; see the warning above.

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

## Related
- [Site Properties API](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties): the full read shape
- [Site Settings Dashboard Navigation](site-properties-dashboard-navigation.md): a link to the settings hub, where the business info is
- [Configure Default Business Hours](../calendar/configure-default-business-hours.md): Bookings default availability, via Calendar Events
- [Assign Working Hours Schedule](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/assign-working-hours-schedule): one staff member's working hours
- [Update Fulfillment Method](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/update-fulfillment-method): Restaurants regular delivery/pickup hours (worked example above)
- [Update Menu Ordering Settings](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/update-menu-ordering-settings): whether a menu is orderable at all, not its hours
- [Create Availability Exception](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/availability-exceptions/create-availability-exception): Restaurants holiday/special closures

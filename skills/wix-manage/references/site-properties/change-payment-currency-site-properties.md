---
name: "RECIPE: Change a Site's Regional Properties (Currency, Time Zone, Language) via Site Properties API"
description: "Changes a site's regional properties through the Site Properties API: the site-level payment currency (store billing currency), the time zone, and the primary language."
---

# RECIPE: Change a Site's Regional Properties via Site Properties API

## Goal
Update a Wix site's **regional properties** — payment currency, time zone, or primary language — programmatically.

## When to use
- You need to switch a site's store/payment currency (for example, from `USD` to `EUR`).
- You need to change a site's time zone or primary language.
- You want to automate regional/business setup for sites.

## Important notes before you start
- These fields are part of **Site Properties** (often shown in the dashboard under regional/business info).
- Payment currency and time zone are set with **Update Business Region**. Primary language is set with a separate call, in Step 3.
- Both calls take a **field mask** (`fields.paths`) naming the fields you're updating. **Mask paths are top-level field names.** The read response also contains a `locale` object, but it is not the write surface — see Gotchas.

| Property | Field name | Value format | Set with |
|---|---|---|---|
| Payment currency | `paymentCurrency` | 3-letter ISO-4217 code — `USD`, `EUR`, `GBP` | Step 2 |
| Time zone | `timeZone` | IANA time zone name — `America/New_York`, `Europe/Rome` | Step 2 |
| Primary language | `language` | 2-letter ISO 639-1 code — `en`, `es`, `it` | Step 3 |

## Step 1 — (Optional) Read the current site properties
This shows the current values and snapshot version.

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

## Step 2 — Update payment currency or time zone
Call [Update Business Region](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-region): put the new values under `businessRegion` and name each one in `fields.paths`.

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-region' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessRegion": {
      "paymentCurrency": "EUR",
      "timeZone": "Europe/Rome"
    },
    "fields": {
      "paths": ["paymentCurrency", "timeZone"]
    }
  }'
```

To change only one of them, send just that field and its path. A successful call returns an empty object `{}`.

## Step 3 — Update the primary language
Update Business Region does not accept `language`. Set it with `PATCH` on the Site Properties root: put the new value under `properties` and name it in `fields.paths`. This call has no method reference page, so the request below is its full contract.

```bash
curl -X PATCH 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "properties": {
      "language": "es"
    },
    "fields": {
      "paths": ["language"]
    }
  }'
```

A successful call returns only the updated snapshot version, not the properties:

```json
{ "version": "123" }
```

## Step 4 — Confirm
Neither update echoes the new values back. Re-read with the Step 1 `GET` and check the fields you changed.

## Gotchas & troubleshooting
- **Always send a field mask**: omitting `fields.paths` fails with `400` (on the Step 3 call, `"Illegal request - No updates on request body"`).
- **Do not nest the mask path under `locale`.** The `GET` response contains a `locale` object (`languageCode`, `country`), which makes a path like `locale.timezone` look plausible — it is rejected with `400` and `"Illegal request - Unknown field in field mask - locale.timezone"`. Time zone and language are the top-level `timeZone` and `language` fields.
- **Update Business Region rejects `language` and `locale`** in its field mask. Change the language with the Step 3 call.
- **`locale.languageCode` is a read-only projection** and can differ from the top-level `language` value. Set `language`; read `language` back to verify.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- **Get Site Properties** (full read shape): [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties)
- **Update Business Region**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-region)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

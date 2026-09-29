---
name: "RECIPE: Update Site Business Region (Payment Currency, Time Zone)"
description: "Updates a site's payment currency or time zone via one POST to the Update Business Region endpoint. Covers the required businessRegion + field mask body shape. Does not cover language — Site Properties has no update endpoint for it."
---

# RECIPE: Update Site Business Region (Payment Currency, Time Zone)

## Goal
Update a Wix site's **payment currency** or **time zone** programmatically.

## When to use
- You need to switch a site's store/payment currency (for example, from `USD` to `EUR`).
- You need to change a site's time zone.
- You want to automate regional/business setup for sites.

## Not covered here: language
Site Properties exposes a read-only `language` field (and a `locale` object), but there is **no update endpoint for language** in this API. Do not attempt to set it via this or any Site Properties call.

## Important notes before you start
- These fields are part of **Site Properties** (often shown in the dashboard under regional/business info).
- Use a **field mask** (`fields.paths`) to indicate which of `paymentCurrency`/`timeZone` you're updating.
- To clear a field, include it in `fields.paths` but omit it from `businessRegion`.

## Step 1 — (Optional) Read current site properties
This is useful to confirm the current currency/time zone before changing them.

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

## Step 2 — Update the properties you need
Use `POST /site-properties/v4/properties/business-region`: put the new values under `businessRegion` and name each one in a `fields.paths` mask.

| Property | Field name | Value format |
|---|---|---|
| Payment currency | `paymentCurrency` | 3-letter ISO-4217 code — `USD`, `EUR`, `GBP` |
| Time zone | `timeZone` | IANA time zone name — `America/New_York`, `Europe/Rome` |

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-region' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessRegion": {
      "paymentCurrency": "EUR"
    },
    "fields": {
      "paths": ["paymentCurrency"]
    }
  }'
```

Both at once, same shape:

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-region' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessRegion": {
      "paymentCurrency": "EUR",
      "timeZone": "Europe/Paris"
    },
    "fields": {
      "paths": ["paymentCurrency", "timeZone"]
    }
  }'
```

### Expected response
A successful call returns an empty object — it does **not** echo the properties back:

```json
{}
```

To confirm the new value, re-read with the Step 1 `GET`.

## Gotchas & troubleshooting
- **Always send a field mask**: only properties named in `fields.paths` are updated; anything in `businessRegion` but missing from the mask is ignored.
- **The body key is `businessRegion`, not `properties`.** This is a different endpoint from the generic Site Properties `GET`/`PATCH`.
- **Language is not settable here.** The `GET` response includes a top-level `language` field and a `locale` object (`languageCode`, `country`), but both are read-only projections for this API — there is no corresponding update field or endpoint.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).
- Site property updates are rate-limited to 30 requests per site per 60-second window.

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- **Update Business Region**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-region)
- **Get Site Properties** (full read shape): [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

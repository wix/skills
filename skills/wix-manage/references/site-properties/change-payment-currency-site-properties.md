---
name: "RECIPE: Change a Site's Regional Properties (Currency, Time Zone, Language) via Site Properties API"
description: "Updates the site-level payment currency (store billing currency) using Site Properties API, including the required request body shape and field mask. Covers the site time zone and primary language; field masks name top-level properties."
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
- A successful update increments the Site Properties `version`.
- The update is split into two calls: payment currency and time zone go through **Update Business Region** (values under `businessRegion`); primary language goes through a `PATCH` on the Site Properties root (value under `properties`).
- Both calls take a **field mask** (`fields.paths`) naming the fields you're updating. Mask paths are top-level field names — see Gotchas.

## Step 1 — (Optional) Read current site properties version
This is useful to understand the current snapshot version and other regional fields.

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

## Step 2 — Update the properties you need
Payment currency and time zone go through [Update Business Region](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-region), the documented call for them: put the new values under `businessRegion` and name each one in a `fields.paths` mask. Primary language goes through a separate, undocumented call, below — use that call for language only.

| Property | Field name | Value format |
|---|---|---|
| Payment currency | `paymentCurrency` | 3-letter ISO-4217 code — `USD`, `EUR`, `GBP` |
| Time zone | `timeZone` | IANA time zone name — `America/New_York`, `Europe/Rome` |
| Primary language | `language` | 2-letter ISO 639-1 code — `en`, `es`, `it` |

```bash
curl -X POST 'https://www.wixapis.com/site-properties/v4/properties/business-region' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "businessRegion": {
      "paymentCurrency": "EUR",
      "timeZone": "America/New_York"
    },
    "fields": {
      "paths": ["paymentCurrency", "timeZone"]
    }
  }'
```

A successful call returns an empty object `{}`.

Primary language: Update Business Region does not accept `language`. Use `PATCH` on the Site Properties root. This call has no method reference page, so the request below is its full contract:

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

### Expected response
The language call returns only the updated Site Properties snapshot version — it does **not** echo the properties back:

```json
{ "version": "123" }
```

To confirm the new value, re-read with the Step 1 `GET`.

## Gotchas & troubleshooting
- **Always send a field mask**: omitting `fields.paths` fails with `400` and `"Illegal request - No updates on request body"`.
- **Mask paths must be top-level fields.** The `GET` response contains a `locale` object (`languageCode`, `country`), which makes a path like `locale.timezone` look plausible — a nested path is rejected with `400` and `"Illegal request - Unknown field in field mask - <path>"`. Time zone and language are the top-level `timeZone` and `language` fields.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).
- Update Business Region rejects `language` and `locale` in its field mask with `400` and `"Illegal request - Fields Vector(<fields>) are not allowed for updateBusinessRegion"`. Set the language with the `PATCH` call.

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- **Get Site Properties** (full read shape): [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

---
name: "RECIPE: Change a Site's Regional Properties (Currency, Time Zone, Language) via Site Properties API"
description: "Updates the site-level payment currency (store billing currency) using Site Properties API, including the required request body shape and field mask. Covers the site time zone and primary language through the same call, whose field mask names top-level properties."
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
- Use a **field mask** (`fields.paths`) to indicate which fields you're updating.
- **Field mask paths are top-level property names.** The read response also contains a `locale` object, but it is not the write surface — see Gotchas.

## Step 1 — (Optional) Read current site properties version
This is useful to understand the current snapshot version and other regional fields.

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

## Step 2 — Update the properties you need
Use the `PATCH /site-properties/v4/properties` endpoint: put the new values under `properties` and name each one in a `fields.paths` mask.

| Property | Field name | Value format |
|---|---|---|
| Payment currency | `paymentCurrency` | 3-letter ISO-4217 code — `USD`, `EUR`, `GBP` |
| Time zone | `timeZone` | IANA time zone name — `America/New_York`, `Europe/Rome` |
| Primary language | `language` | 2-letter ISO 639-1 code — `en`, `es`, `it` |

```bash
curl -X PATCH 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "properties": {
      "paymentCurrency": "EUR"
    },
    "fields": {
      "paths": ["paymentCurrency"]
    }
  }'
```

Time zone, same shape:

```bash
curl -X PATCH 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "properties": {
      "timeZone": "America/New_York"
    },
    "fields": {
      "paths": ["timeZone"]
    }
  }'
```

To update several properties at once, include each one in `properties` and name each in `paths`:

```bash
--data-binary '{
    "properties": { "timeZone": "Europe/Rome", "language": "en" },
    "fields": { "paths": ["timeZone", "language"] }
  }'
```

### Expected response
A successful call returns only the updated Site Properties snapshot version — it does **not** echo the properties back:

```json
{ "version": "123" }
```

To confirm the new value, re-read with the Step 1 `GET`.

## Gotchas & troubleshooting
- **Always send a field mask**: omitting `fields.paths` fails with `400` and `"Illegal request - No updates on request body"`.
- **Do not nest the mask path under `locale`.** The `GET` response contains a `locale` object (`languageCode`, `country`), which makes a path like `locale.timezone` look plausible — it is rejected with `400` and `"Illegal request - Unknown field in field mask - locale.timezone"`. Time zone and language are the top-level `timeZone` and `language` fields.
- **`locale.languageCode` is a read-only projection** and can differ from the top-level `language` value. Set `language`; read `language` back to verify.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).
- There is no separate per-field endpoint for currency, time zone, or language — all three go through this one call.

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- **Get Site Properties** (full read shape): [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

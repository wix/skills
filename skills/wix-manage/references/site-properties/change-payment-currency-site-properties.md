---
name: "RECIPE: Change a Site's Regional Properties (Currency, Time Zone, Language, Region) via Site Properties API"
description: "Updates the site-level payment currency (store billing currency) using Site Properties API, including the required request body shape and field mask. Covers the site time zone, primary language, and site region (locale country); field masks name top-level properties."
---

# RECIPE: Change a Site's Regional Properties via Site Properties API

## Goal
Update a Wix site's **regional properties** — payment currency, time zone, primary language, or region — programmatically.

## When to use
- You need to switch a site's store/payment currency (for example, from `USD` to `EUR`).
- You need to change a site's time zone, primary language, or region (the country in its locale).
- Prices or dates are written in another country's format (`10,00 $` for `$10.00`): that is the region.
- You want to automate regional/business setup for sites.

## Important notes before you start
- These fields are part of **Site Properties** (often shown in the dashboard under regional/business info).
- A successful update increments the Site Properties `version`.
- The update is split into two calls: payment currency and time zone go through **Update Business Region** (values under `businessRegion`); primary language and region go through a `PATCH` on the Site Properties root (value under `properties`). A request that spans both groups, such as "set my region and time zone", needs both calls.
- Both calls take a **field mask** (`fields.paths`) naming the fields you're updating. Mask paths are top-level field names — see Gotchas.

## Step 1 — Read current site properties
Required before setting the region: the region `PATCH` needs the site's primary language, `properties.language`, from this response. For the other properties, this read is optional; it shows the current snapshot version and regional fields.

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

## Step 2 — Update the properties you need
Payment currency and time zone go through [Update Business Region](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/update-business-region), the documented call for them: put the new values under `businessRegion` and name each one in a `fields.paths` mask. Primary language and region go through a separate, undocumented call, below. Use that call for language and region only.

| Property | Field name | Value format |
|---|---|---|
| Payment currency | `paymentCurrency` | 3-letter ISO-4217 code — `USD`, `EUR`, `GBP` |
| Time zone | `timeZone` | IANA time zone name — `America/New_York`, `Europe/Rome` |
| Primary language | `language` | 2-letter ISO 639-1 code — `en`, `es`, `it` |
| Region | `locale` | Object `{ "languageCode": "<properties.language, from Step 1>", "country": "<ISO 3166-1 alpha-2 code>" }` |

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

Region: the same `PATCH`, with the whole `locale` object and the mask path `locale`. The locale (`languageCode` with `country`, for example `en-US`) decides how the site writes amounts and dates. First run the Step 1 `GET`, then send its `properties.language` as `languageCode`, together with the new `country`. Use `properties.language`, not the current `properties.locale.languageCode`: the two can differ (a site in `en` with locale `de-DE`), and keeping the old code keeps that language's formats (`de-US` writes `10,00 $`). Do not guess it either: the `PATCH` stores whatever `languageCode` you send. Set the region with this call, not with the Multilingual locales API: that API changes the site's content languages, not its region.

```bash
curl -X PATCH 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "properties": {
      "locale": {
        "languageCode": "<SITE_LANGUAGE>",
        "country": "DE"
      }
    },
    "fields": {
      "paths": ["locale"]
    }
  }'
```

### Expected response
The `PATCH` call returns only the updated Site Properties snapshot version — it does **not** echo the properties back:

```json
{ "version": "123" }
```

To confirm the new value, re-read with the Step 1 `GET`.

## Gotchas & troubleshooting
- **Always send a field mask**: omitting `fields.paths` fails with `400` and `"Illegal request - No updates on request body"`.
- **Mask paths must be top-level fields.** The `GET` response contains a `locale` object (`languageCode`, `country`), which makes a path like `locale.timezone` or `locale.country` look plausible — a nested path is rejected with `400` and `"Illegal request - Unknown field in field mask - <path>"`. Time zone and language are the top-level `timeZone` and `language` fields; for the region, name the whole `locale` object.
- A `locale` without `languageCode` is rejected with `400` and `"Illegal request - Locale '-AT' doesn't match '([a-z]{2})([-_][a-zA-Z]{2})?'"`. Send the site's `language` as `languageCode` with the new `country`.
- Content that already exists picks up a change late: a currency change reached an existing product's price a few minutes after the call, and a region change reached its formatted price within about two minutes. A read right after the call can still show the old value, so re-read the content (not only the Site Properties) before saying the change is visible.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).
- Update Business Region rejects `language` and `locale` in its field mask with `400` and `"Illegal request - Fields Vector(<fields>) are not allowed for updateBusinessRegion"`. Set the language with the `PATCH` call.

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- **Get Site Properties** (full read shape): [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

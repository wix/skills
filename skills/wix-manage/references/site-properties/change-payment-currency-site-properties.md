---
name: "RECIPE: Change a Site's Payment (Store) Currency via Site Properties API"
description: "Updates site-level properties with the Site Properties API — payment currency (store billing currency), site description, business name and site display name — including the required request body shape and the mandatory `fields.paths` field mask."
---

# RECIPE: Update Site Properties (Currency, Description, Business Name) via Site Properties API

## Goal
Update a Wix site's **site-level properties** — payment currency, site description, business name,
site display name — programmatically. Every one of them uses the same request, shown below.

## When to use
- You need to set or change the **site description**.
- You need to switch a site's store/payment currency (for example, from `USD` to `EUR`).
- You need to set the business name or the site display name.
- You want to automate regional/business setup for sites.

## Important notes before you start
- The `paymentCurrency` field is part of **Site Properties** (often shown in the dashboard under regional/business info).
- A successful update increments the Site Properties `version`.
- Use a **field mask** (`fields.paths`) to indicate which fields you're updating.

## Step 1 — (Optional) Read current site properties version
This is useful to understand the current snapshot version and other regional fields.

```bash
curl -X GET 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Authorization: <AUTH>'
```

## Step 2 — Update the payment currency
Use the `PATCH /site-properties/v4/properties` endpoint: put the new currency under `properties.paymentCurrency` and include a `fields.paths` mask.

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

### Expected response
A successful call returns an updated Site Properties snapshot version, for example:

```json
{ "version": "123" }
```

## Step 3 — Update the other site properties with the same call

`paymentCurrency` is not a special case. The same `PATCH /site-properties/v4/properties` with a
`fields.paths` mask sets the rest of the site's business profile — one entry in `properties` and
the matching path in the mask, and several fields in one call if you list them all:

| To set | `properties` key | `fields.paths` entry |
| --- | --- | --- |
| Site description | `description` | `"description"` |
| Business name | `businessName` | `"businessName"` |
| Site display name | `siteDisplayName` | `"siteDisplayName"` |
| Payment currency | `paymentCurrency` | `"paymentCurrency"` |

```bash
curl -X PATCH 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "properties": {
      "description": "Freshly baked artisan breads and pastries, made daily."
    },
    "fields": {
      "paths": ["description"]
    }
  }'
```

Read the current values back from `GET /site-properties/v4/properties`; the response nests them
under `properties`.

`POST /site-properties/v4/properties/business-profile`, which takes `businessProfile` plus the
same `fields.paths` mask, writes the same profile fields. Prefer the `PATCH` above so one request
shape covers every property.

## Gotchas & troubleshooting
- **Always send a field mask**: omitting `fields.paths` will fail with `400` and `"Illegal request - No updates on request body"`.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

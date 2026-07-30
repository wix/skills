---
name: "RECIPE: Change a Site's Payment (Store) Currency via Site Properties API"
description: "Changes a site's LANGUAGE or PAYMENT CURRENCY with the Site Properties API — the recipe to use for 'change my site's language/primary language to X' and for switching the store billing currency. For a language change, send `language` and `locale` together in one PATCH masked as [\"language\",\"locale\"]; either field alone leaves the site's primary locale unchanged. Also covers the currency payload, the top-level-only field-mask rule, and why the Multilingual change-primary token-polling flow is not needed."
---

# RECIPE: Change a Site's Payment (Store) Currency via Site Properties API

## Goal
Update a Wix site's regional properties programmatically — the **payment currency** (the ISO-4217 currency code used to bill customers) and the **site language**.

## When to use
- You need to switch a site's store/payment currency (for example, from `USD` to `EUR`).
- You need to change the site's language (for example, to Spanish).
- You want to automate regional/business setup for sites.

## Which call to use

Both settings live on the same Site Properties resource, one `PATCH` each.

| The user wants to change | `properties` fields to send | `fields.paths` mask |
|---|---|---|
| Payment / store currency | `paymentCurrency` | `["paymentCurrency"]` |
| The site's language | `language` **and** `locale` | `["language", "locale"]` |

## Important notes before you start
- The `paymentCurrency`, `language` and `locale` fields are all part of **Site Properties** (shown in the dashboard under **Language & Region**).
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

## Changing the site's language

One `PATCH` to the same endpoint. **Send both `language` and `locale`, and mask both.**

```bash
curl -X PATCH 'https://www.wixapis.com/site-properties/v4/properties' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "properties": {
      "language": "es",
      "locale": {
        "languageCode": "es",
        "country": "ES"
      }
    },
    "fields": {
      "paths": ["language", "locale"]
    }
  }'
```

- `language` — two-letter [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) code (`es`, `fr`, `de`).
- `locale.languageCode` — the same language code. `locale.country` — two-letter [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) region code.

**Both fields are required for the site's language to actually change.** Patching only
`language` (mask `["language"]`) or only `locale` (mask `["locale"]`) updates that one property and
leaves the site's primary locale as it was. With both fields in one call, the site's primary locale
switches to the new language a few seconds later.

### Confirm the change

```bash
curl -X POST 'https://www.wixapis.com/locales/v2/locale/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{ "query": {} }'
```

After the change the site has a single locale carrying the new language:

```json
{ "locales": [ { "id": "es", "languageCode": "es", "displayName": "Spanish", "flag": "ESP", "primaryLocale": true } ] }
```

`GET https://www.wixapis.com/locale-settings/v2/settings` returns the same locale under
`localeSettings.primaryLocale` and is an equally good confirmation read.

Propagation is asynchronous. If the read still shows the old locale, wait a couple of seconds and
read again — do not re-send the `PATCH`.

### Do not use the Multilingual change-primary flow for a language change

`POST https://www.wixapis.com/locales/v2/locale/change-primary` is the low-level Multilingual path.
It is asynchronous, returns a token you then have to poll, deletes the previous primary locale, and
returns `409 ALREADY_EXISTS` when the target language already exists on the site as a secondary
locale. A plain "change my site's language to X" request does not need any of that — use the single
`PATCH` above.

If you are already on that path, poll with the token in the URL's **query string**:
`GET https://www.wixapis.com/locales/v2/locale/change-primary?token=<GUID>`. Appending the token to
the path (`.../locale/change-primary/<GUID>`) returns `404`, and passing it in a separate
request-options object (`params`, `query`, `qs`, …) sends no token at all and returns
`400 {"message":"token is not a valid GUID,token must not be empty"}`.

## Gotchas & troubleshooting
- **Always send a field mask**: omitting `fields.paths` will fail with `400` and `"Illegal request - No updates on request body"`.
- **Field-mask paths are top-level property names only.** `"paths": ["locale.languageCode"]` fails with `400 "Illegal request - Unknown field in field mask - locale.languageCode"`. Mask the whole `locale` object instead.
- Currency must be a **3-letter ISO-4217** code (for example, `USD`, `CAD`, `EUR`, `GBP`).

## Related APIs
- **Site Properties API**: [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/introduction)
- **Multilingual Locales API** (confirmation reads): [Query Locales](https://dev.wix.com/docs/api-reference/business-management/multilingual/locale-management/locales/query-locales), [Get Locale Settings](https://dev.wix.com/docs/api-reference/business-management/multilingual/locale-management/locale-settings/get-locale-settings)
- Stores Currency Converter (conversion utilities, not for setting the site currency):
  - `POST https://www.wixapis.com/currency_converter/v1/currencies/amounts/{from}/convert/{to}`

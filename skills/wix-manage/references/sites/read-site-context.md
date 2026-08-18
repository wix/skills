---
name: "Read Site Context"
description: One-call site snapshot — installed apps (by name), locale, currency, and status — using the Dynamic Site Context API. Replaces separate query-sites + list-installed-apps + site-properties calls.
---
# Read Site Context

A single call that returns a site's name, URL, status, locale/region settings, and all installed apps with human-readable display names. Use this at the start of any management task when you need to understand what a site has installed and how it is configured.

Works with both account-level and site-scoped tokens. Passing a `siteId` is optional.

## Required APIs

- **Get Dynamic Context (markdown)**: [docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown)
- **Get Dynamic Context (JSON)**: [docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context)

Related:

- [Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites) — when you need to page through many sites or filter by field
- [Get Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps) — raw app instances; use this if you need fields not in the context snapshot
- [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties) — full properties object including business description, address, social links

---

## Markdown endpoint (recommended)

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown`

Returns `{ "markdown": "..." }` with human-readable app display names, locale, status, and any app-specific metadata the API injects (e.g. Stores catalog version). Best for reading and routing.

### With a site ID — one site

```bash
curl -X POST \
  'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{"siteId": "<metaSiteId>"}'
```

Response:

```
## 1. Acme Store

**ID**: `<metaSiteId>`
**URL**: [https://example.wixsite.com/acme](https://example.wixsite.com/acme)
**Status**: Published
**Editor Type**: Editorless
**Created**: Aug 14, 2026, 05:21 · **Updated**: Aug 17, 2026, 20:44
**Velo**: Enabled

### Properties

**Locale & Region**
- Language: **en**
- Country: **US**
- Timezone: **America/New_York**
- Currency: **USD**

### Apps

- **Wix Stores** (ID: `215238eb-22a5-4c36-9e7b-e7c08025e04e`) — Catalog app version: **V3**
- **Wix Bookings** (ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`)
- **Wix Blog** (ID: `14bcded7-0066-7c35-14d7-466cb3f09103`)
```

### Without a site ID — what you get depends on the token

```bash
curl -X POST \
  'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

- **Account-level token**: returns up to 10 sites on the account. If there are more, the markdown includes: `_Showing 10 sites (more available)_` with a note to call again with a specific `siteId`.
- **Site-scoped token** (e.g. the Wix connector in Base44): returns only the site the token is scoped to — useful as a quick way to confirm which site you're operating on before making changes.

---

## JSON endpoint

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context`

Same request shape but returns structured JSON. The `installedApps` array contains raw `appId` UUIDs — mostly unrecognizable platform internals. Extract only what you need:

```javascript
const res = await fetch(
  "https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context",
  {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ siteId: metaSiteId }),
  }
);
const { sites } = await res.json();
const site = sites[0];

const KNOWN_APPS = {
  stores:       "215238eb-22a5-4c36-9e7b-e7c08025e04e",
  bookings:     "13d21c63-b5ec-5912-8397-c3a5ddb27a97",
  blog:         "14bcded7-0066-7c35-14d7-466cb3f09103",
  events:       "140603ad-af8d-84a5-2c80-a0f60cb47351",
  pricingPlans: "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3",
  restaurants:  "13e8d036-5516-6f75-e025-2aca3b5d7930",
};

const appById = Object.fromEntries(
  (site.installedApps ?? []).map((a) => [a.appId, a])
);

const context = {
  id:              site.id,
  name:            site.displayName,
  url:             site.url,
  currency:        site.properties?.paymentCurrency,
  locale:          `${site.properties?.locale?.languageCode}-${site.properties?.locale?.country}`,
  timezone:        site.properties?.timeZone,
  hasStores:       !!appById[KNOWN_APPS.stores],
  storesCatalogV:  appById[KNOWN_APPS.stores]?.catalogVersion ?? null, // "V3" | "V1" | null
  hasBookings:     !!appById[KNOWN_APPS.bookings],
  hasBlog:         !!appById[KNOWN_APPS.blog],
  hasEvents:       !!appById[KNOWN_APPS.events],
  hasPricingPlans: !!appById[KNOWN_APPS.pricingPlans],
  hasRestaurants:  !!appById[KNOWN_APPS.restaurants],
};
```

Prefer the markdown endpoint when you just need to read and route — it gives you display names without a lookup table.

---

## Why use this over separate calls

| | Dynamic Context | Separate calls |
|---|---|---|
| Site name, URL, status | ✓ | [Query Sites](query-sites.md) |
| Locale + currency | ✓ | [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties) |
| Installed apps (by name) | ✓ | [Get Installed Apps](../app-installation/list-installed-apps.md) + ID lookup |
| Calls needed | **1** | 3+ |

---

## Next Steps

- Found Wix Stores? → [Stores recipes](../../SKILL.md#stores)
- Found Wix Bookings? → [Bookings recipes](../../SKILL.md#bookings)
- Found Wix Blog? → [Blog recipes](../../SKILL.md#blog)
- Need to find the site ID first? → [Query Sites](query-sites.md)

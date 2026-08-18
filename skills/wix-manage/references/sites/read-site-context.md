---
name: "Read Site Context"
description: One-call site snapshot — installed apps (by name), locale, currency, and status — using the Dynamic Site Context API. Replaces separate query-sites + list-installed-apps + site-properties calls.
---
# Read Site Context

A single call that returns a site's name, URL, status, locale/region settings, and all installed apps with human-readable display names. Use this at the start of any management task when you need to understand what a site has installed and how it is configured.

## Prerequisites

- Account-level authentication (the same token used for all other Wix management APIs)
- Site ID is optional — omit it to get all account sites at once

## Required APIs

- **Dynamic Site Context API**: [Get Dynamic Context Markdown](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md)

---

## Markdown endpoint (recommended)

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown`

Returns `{ "markdown": "..." }` — human-readable app display names, locale, status, and Wix Stores catalog version. This is the preferred form for reading and routing.

### With a site ID — single site

```bash
curl -X POST \
  'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{"siteId": "<metaSiteId>"}'
```

Response:

```
## 1. Harbor and Oak

**ID**: `5e0eed94-9982-49da-a980-08fa2cd4a198`
**URL**: [https://h6s-410bd0d161d8fc-ayalg5.wix-site-host.com/](...)
**Status**: Published
**Editor Type**: Editorless
**Created**: Aug 16, 2026, 18:46 · **Updated**: Aug 17, 2026, 13:10
**Velo**: Enabled

### Properties

**Locale & Region**
- Language: **en**
- Country: **IE**
- Timezone: **Europe/Dublin**
- Currency: **EUR**

### Apps

- **Promote SEO** (ID: `1480c568-...`)
- **Wix Invoices** (ID: `13ee94c1-...`)
- **Wix Stores** (ID: `215238eb-...`) — Catalog app version: **V3**
```

App names are human-readable display names. Wix Stores entries include the catalog version (V1/V3).

### Without a site ID — all account sites

```bash
curl -X POST \
  'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Returns up to 10 sites. If the account has more, the markdown includes a note:

```
_Showing 10 sites (more available)_

> **This account has more than the 10 sites shown above.** To load context for any
> site not listed here, call `GetSiteContext` with its `siteName` or `siteId`.
```

Use this when you have an account-level token and need to discover what sites exist before picking one to act on. Use the single-site form once you have the target `siteId`.

---

## JSON endpoint

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context`

Same request shape (`{}` or `{"siteId": "..."}`) but returns structured JSON. The `installedApps` array contains raw `appId` UUIDs — most are unrecognizable platform internals. Extract only what you need:

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

// Known app IDs worth checking
const APP_IDS = {
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
  id:       site.id,
  name:     site.displayName,
  url:      site.url,
  currency: site.properties?.paymentCurrency,
  locale:   `${site.properties?.locale?.languageCode}-${site.properties?.locale?.country}`,
  timezone: site.properties?.timeZone,
  // vertical flags
  hasStores:       !!appById[APP_IDS.stores],
  storesCatalogV:  appById[APP_IDS.stores]?.catalogVersion ?? null, // "V3" | "V1" | null
  hasBookings:     !!appById[APP_IDS.bookings],
  hasBlog:         !!appById[APP_IDS.blog],
  hasEvents:       !!appById[APP_IDS.events],
  hasPricingPlans: !!appById[APP_IDS.pricingPlans],
  hasRestaurants:  !!appById[APP_IDS.restaurants],
};
```

Prefer the markdown endpoint when you just need to read and route — it gives you display names without a lookup table and is easier to reason about.

---

## Why use this over separate calls

| | Dynamic Context | Separate calls |
|---|---|---|
| Site name, URL, status | ✓ | query-sites |
| Locale + currency | ✓ | site-properties |
| Installed apps (by name) | ✓ | list-installed-apps + ID lookup |
| Calls needed | **1** | 3+ |

---

## Next Steps

- Found Wix Stores? → [Stores recipes](../../SKILL.md#stores)
- Found Wix Bookings? → [Bookings recipes](../../SKILL.md#bookings)
- Found Wix Blog? → [Blog recipes](../../SKILL.md#blog)
- Need to find the site ID first? → [Query Sites](query-sites.md)

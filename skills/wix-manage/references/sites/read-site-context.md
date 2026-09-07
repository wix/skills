---
name: "Read Account or Site Context"
description: Probe a Wix site or account for full context in one call — installed apps by display name, locale, currency, timezone, and status. Account token + siteId targets one site; account token alone returns up to 10; site-scoped token alone returns the site it is scoped to.
---
# Read Account or Site Context

Returns a site's name, URL, status, locale/region, and all installed apps with human-readable display names.

---

## Markdown endpoint (recommended)

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown`

Returns `{ "markdown": "..." }`.

### Account token + siteId — one specific site

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

### Without siteId

```bash
curl -X POST \
  'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

- **Account token**: returns up to 10 sites. If the account has more: `_Showing 10 sites (more available)_` — call again with a specific `siteId`.
- **Site-scoped token** (e.g. the Wix connector in Base44): returns the one site the token is scoped to.

---

## JSON endpoint

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context`

Same request shape. `installedApps` contains raw `appId` UUIDs — extract only what you need:

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

---

## API Reference

- [Get Dynamic Context — markdown](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown)
- [Get Dynamic Context — JSON](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context)
- [Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites) — for paginating or filtering the full site list
- [Get Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps) — raw app instances with fields not in the context snapshot
- [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties) — full properties including business description, address, social links

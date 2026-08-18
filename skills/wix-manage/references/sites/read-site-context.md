---
name: "Read Site Context"
description: One-call site snapshot — installed apps (by name), locale, currency, and status — using the Dynamic Site Context API. Replaces separate query-sites + list-installed-apps + site-properties calls.
---
# Read Site Context

A single call that returns a site's name, URL, status, locale/region settings, and all installed apps with human-readable display names. Use this at the start of any management task when you need to understand what a site has installed and how it is configured.

## Prerequisites

- Account-level authentication (the same token used for all other Wix management APIs)
- Site ID (`metaSiteId`) — typically in your prompt or found via [Query Sites](query-sites.md)

## Required APIs

- **Dynamic Site Context API**: [Get Dynamic Context Markdown](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md)

---

## Call

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown`

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{"siteId": "<metaSiteId>"}'
```

Omit `siteId` to get a snapshot of all sites on the account.

---

## Response

Returns `{ "markdown": "..." }`. The markdown contains:

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

- **Promote SEO** (ID: `1480c568-5cbd-9392-5604-1148f5faffa0`)
- **Wix Invoices** (ID: `13ee94c1-b635-8505-3391-97919052c16f`)
- **Wix Stores** (ID: `215238eb-22a5-4c36-9e7b-e7c08025e04e`) — Catalog app version: **V3**
```

App names are display names (not raw UUIDs). Some apps include extra metadata — Wix Stores shows the catalog version (V1/V3), which determines which endpoints to use.

The API also injects global notes at the top of the markdown when relevant — for example, a Wix Stores catalog-version warning when any site has Stores installed.

---

## Why use this over separate calls

| | Dynamic Context | Separate calls |
|---|---|---|
| Site name, URL, status | ✓ | query-sites |
| Locale + currency | ✓ | site-properties |
| Installed apps (by name) | ✓ | list-installed-apps + ID lookup |
| Calls needed | **1** | 3+ |

`list-installed-apps` returns raw `appDefId` UUIDs; this endpoint returns human-readable display names.

---

## Use Cases

### Understand an unfamiliar site before acting

```javascript
const res = await fetch(
  "https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown",
  {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ siteId: metaSiteId }),
  }
);
const { markdown } = await res.json();
// Read markdown to learn what apps are installed, locale, and site status
```

### Decide which vertical to manage

If the prompt is vague about what the site does, read the site context first — the installed apps list tells you which Wix Business Solution is active (Stores, Bookings, Blog, Events, etc.) and which management recipes to follow.

### Determine Wix Stores catalog version before any stores call

Check whether Stores shows `Catalog app version: V3` or `V1` before using stores endpoints:
- V3 sites: use `/stores/v3/` endpoints and V3 catalog recipes
- V1 sites: use `/stores/v1/` (legacy) endpoints and V1 catalog recipes — never mix

---

## JSON variant

Replace `/markdown` with the bare endpoint to get structured JSON instead:

**Endpoint**: `POST https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context`

The JSON response includes an `account` object plus a `sites` array. App entries contain raw `appId` strings (not display names), so the markdown variant is preferred for reading.

---

## Next Steps

- Found Wix Stores? → [Stores recipes](../../SKILL.md#stores)
- Found Wix Bookings? → [Bookings recipes](../../SKILL.md#bookings)
- Found Wix Blog? → [Blog recipes](../../SKILL.md#blog)
- Need to find the site ID first? → [Query Sites](query-sites.md)

---
name: "Manage OAuth Apps"
description: Create, read, update, and query OAuth apps for a Wix headless site. Each OAuth app is the credential holder (client_id) for a frontend or external client connecting to the site's Wix APIs.
---
# Manage OAuth Apps

An OAuth app is a site-level credential holder — its `id` is the `client_id` used in OAuth 2.0 flows by any frontend or external client connecting to the site. When a headless site is provisioned, Wix creates one automatically; use this recipe to create additional apps, inspect existing ones, or update their redirect configuration.

> **Secret is dashboard-only.** The `client_secret` is shown once in the Headless Settings dashboard and never returned by the API. Rotation is also dashboard-only — there is no programmatic rotate-secret endpoint.

---

## Prerequisites

- Site-level authentication with `SCOPE.OAUTH_APP.MANAGE` permission
- The site must be a headless site (OAuth apps are headless-only)

---

## Create an OAuth App

**Endpoint**: `POST https://www.wixapis.com/oauth-app/v1/oauth-apps`

```bash
curl -X POST \
  'https://www.wixapis.com/oauth-app/v1/oauth-apps' \
  -H 'Authorization: <AUTH>' \
  -H 'wix-site-id: <metaSiteId>' \
  -H 'Content-Type: application/json' \
  -d '{
    "oAuthApp": {
      "name": "My Storefront",
      "loginUrl": "https://example.com/login",
      "allowedRedirectUris": ["https://example.com/callback"],
      "allowedRedirectDomains": ["example.com"]
    }
  }'
```

**Response**:
```json
{
  "oAuthApp": {
    "id": "<clientId>",
    "name": "My Storefront",
    "loginUrl": "https://example.com/login",
    "allowedRedirectUris": ["https://example.com/callback"],
    "allowedRedirectDomains": ["example.com"],
    "createdDate": "2026-08-18T10:00:00Z"
  }
}
```

`id` is the OAuth `client_id`. After creating the app, retrieve the `client_secret` from the Headless Settings dashboard.

---

## Get an OAuth App

**Endpoint**: `GET https://www.wixapis.com/oauth-app/v1/oauth-apps/{id}`

```bash
curl 'https://www.wixapis.com/oauth-app/v1/oauth-apps/<clientId>' \
  -H 'Authorization: <AUTH>' \
  -H 'wix-site-id: <metaSiteId>'
```

---

## Query OAuth Apps

**Endpoint**: `POST https://www.wixapis.com/oauth-app/v1/oauth-apps/query`

```bash
curl -X POST \
  'https://www.wixapis.com/oauth-app/v1/oauth-apps/query' \
  -H 'Authorization: <AUTH>' \
  -H 'wix-site-id: <metaSiteId>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {} }'
```

Returns all OAuth apps for the site.

---

## Update an OAuth App

**Endpoint**: `PATCH https://www.wixapis.com/oauth-app/v1/oauth-apps/{id}`

Update requires an explicit `mask.paths` — omitting it silently updates nothing.

Updatable fields: `name`, `description`, `loginUrl`, `logoutUrl`, `allowedRedirectUris`, `allowedRedirectDomains`, `technology`.

```bash
curl -X PATCH \
  'https://www.wixapis.com/oauth-app/v1/oauth-apps/<clientId>' \
  -H 'Authorization: <AUTH>' \
  -H 'wix-site-id: <metaSiteId>' \
  -H 'Content-Type: application/json' \
  -d '{
    "oAuthApp": {
      "allowedRedirectUris": ["https://example.com/callback", "https://example.com/auth"]
    },
    "mask": { "paths": ["allowedRedirectUris"] }
  }'
```

---

## Key Fields

| Field | Notes |
|---|---|
| `id` | The OAuth `client_id`. Read-only. |
| `name` | Required on create. 2–256 chars. |
| `loginUrl` | External login redirect. Defaults to Wix login if omitted. |
| `logoutUrl` | Called when the user logs out at Wix. |
| `allowedRedirectUris` | Exact-match URIs for post-authentication redirect. Max 20. |
| `allowedRedirectDomains` | Domain-level allow-list for non-auth redirects (e.g. checkout). Max 20. |
| `applicationType` | `WEB_APP`, `MOBILE`, `OTHER` |

---

## API Reference

- [OAuth Apps — Create](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/create-o-auth-app)
- [OAuth Apps — Get](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/get-o-auth-app)
- [OAuth Apps — Query](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/query-o-auth-apps)
- [OAuth Apps — Update](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/update-o-auth-app)

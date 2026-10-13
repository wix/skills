---
name: "Manage OAuth Apps"
description: Create, read, update, and query OAuth apps for a Wix headless site. Each OAuth app's id is the client_id a frontend uses to mint anonymous visitor tokens and call Wix APIs.
---
# Manage OAuth Apps

An OAuth app is a site-level credential holder. Its `id` is the `client_id` (the two terms are interchangeable — Wix uses `appId` in provisioning responses, `clientId` in token requests, and `id` in the OAuth Apps API; they all refer to the same value).

When a headless site is provisioned it gets one OAuth app automatically (see [Create Headless Site](create-headless-site.md)); use this recipe to create additional apps, inspect existing ones, or update their redirect configuration.

> **`client_id` is not a secret** — it is a public identifier safe to embed in frontend code. The visitor token it mints is also non-privileged: it represents an anonymous visitor, not an admin. The `client_secret` is different — shown once in the Headless Settings dashboard, never returned by the API, and rotation is dashboard-only.

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

## Minting a Visitor Token

Once you have a `client_id`, frontends use it to mint an anonymous visitor token for buyer-facing API calls.

**Endpoint**: `POST https://www.wixapis.com/oauth2/token`

```bash
# Initial anonymous mint
curl -X POST 'https://www.wixapis.com/oauth2/token' \
  -H 'Content-Type: application/json' \
  -d '{ "clientId": "<clientId>", "grantType": "anonymous" }'

# Response: { "access_token": "...", "refresh_token": "...", "expires_in": 14400 }
```

```bash
# Refresh (use this instead of re-minting)
curl -X POST 'https://www.wixapis.com/oauth2/token' \
  -H 'Content-Type: application/json' \
  -d '{ "clientId": "<clientId>", "grantType": "refresh_token", "refreshToken": "<refreshToken>" }'
```

Use the `access_token` as the `Authorization` header on subsequent API calls.

> **Never re-mint anonymous on every load.** The visitor token is the cart/session identity — a fresh anonymous mint creates a new visitor and silently empties the cart. Persist the `refresh_token` and use it to renew.

---

## API Reference

- [OAuth Apps — Create](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/create-o-auth-app)
- [OAuth Apps — Get](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/get-o-auth-app)
- [OAuth Apps — Query](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/query-o-auth-apps)
- [OAuth Apps — Update](https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/update-o-auth-app)
- [Retrieve Tokens — `/oauth2/token` contract, all grant types](https://dev.wix.com/docs/api-reference/business-management/headless/authentication/retrieve-tokens)

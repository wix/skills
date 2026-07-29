# Device Flow

Implements the OAuth 2.0 Device Authorization Grant (RFC 8628). The user approves in a browser while the agent polls for tokens.

Produces two kinds of token:
- **Account token** — works for account-level APIs (e.g. list sites). Expires in ~4 hours.
- **Site token** — required for any site-specific API (contacts, products, bookings, …). Derived on demand from the account `refreshToken` + a `siteId`. Expires in ~15 minutes.

## Constants

```
BASE_URL  = https://manage.wix.com
CLIENT_ID = 6f95cec8-3e98-48b9-b4e5-1fb92fcd9973
```

Required headers on every request:

```
X-XSRF-TOKEN: nocheck
Cookie: XSRF-TOKEN=nocheck
User-Agent: wix-cli
Content-Type: application/json   (on POST requests)
```

## Step 1 — Request a device code

```
GET /oauth2/device/code?clientId=CLIENT_ID
```

Response:

```json
{ "deviceCode": "…", "userCode": "XXXXXXXX", "verificationUri": "https://users.wix.com/login/device-login", "expiresIn": 600 }
```

## Step 2 — Ask the user to authorize

Show the user this URL and code:

```
URL:  {verificationUri}?color=developer&studio=true
Code: {userCode}
```

Make sure the user has copied or noted the code **before** opening the link — they'll need to enter it on the page. Present the URL as a clickable link that opens in a new tab if your interface supports it.

## Step 3 — Poll for the token

Every 3 seconds, POST:

```
POST /oauth2/token
{ "clientId": "CLIENT_ID", "grantType": "urn:ietf:params:oauth:grant-type:device_code", "scope": "offline_access", "deviceCode": "{deviceCode}" }
```

- While waiting: server returns `400` with `{ "error": "authorization_pending" }` or `{ "message": "Device code is not yet verified" }` — keep polling.
- On approval: `200` with `{ "access_token": "…", "refresh_token": "…", "expires_in": 14400 }`.
- Stop polling after `expiresIn` seconds total.

## Step 4 — Fetch user info

```
GET /_serverless/wix-cli-userinfo/userinfo
Authorization: Bearer {access_token}
```

Response: `{ "userId": "…", "email": "…" }`

## Step 5 — Persist

At this point you already hold all the values in memory — store them securely to whatever credential store your platform provides (file, secrets manager, environment variables, etc.), without asking the user to enter them manually. **Treat these as secrets: never print them in the conversation, never include them in logs, and never send them to any service other than the Wix APIs.**

```
accessToken   string
refreshToken  string
expiresIn     number  (seconds)
issuedAt      number  (Unix timestamp in seconds, recorded at the moment tokens were received)
userInfo      { userId, email }
```

## Getting a valid token on subsequent calls

**Account token**

1. Load stored credentials. If missing → run the device flow above.
2. Check validity: `issuedAt + expiresIn - 600 > now` (10-min buffer).
3. If expired → refresh silently:

```
POST /oauth2/token
{ "clientId": "CLIENT_ID", "grantType": "refresh_token", "refreshToken": "{refreshToken}" }
```

Same response shape as Step 3. Persist the new tokens with a fresh `issuedAt`.

4. If refresh returns `400 invalid_grant` → session revoked; run the device flow again.

**Site token**

The account token returns `403` on site-level endpoints. Derive a site token on demand:

```
POST /oauth2/token
{ "clientId": "CLIENT_ID", "grantType": "refresh_token", "refreshToken": "{refreshToken}", "siteId": "{siteId}" }
```

Response: `{ "access_token": "…", "refresh_token": "…", "expires_in": 900 }`

Re-derive on each use rather than caching — it expires in 15 minutes.

## Examples

**List sites (account token)**

```
POST https://www.wixapis.com/site-list/v2/sites/query
Authorization: Bearer {accountToken}
{ "query": { "filter": { "namespace": { "$in": ["WIX", "HEADLESS"] } }, "cursorPaging": { "limit": 100 } } }
```

Returns `{ sites: [{ id, displayName, namespace, … }] }` — the `id` is the `siteId` for site-scoped calls.

> Without the `namespace` filter, headless sites are silently excluded from results.

**List contacts (site token)**

```
POST https://www.wixapis.com/contacts/v4/contacts/query
Authorization: Bearer {siteToken}
{ "query": { "paging": { "limit": 10 } } }
```

Returns `{ contacts: […] }`.

---

For the full Wix REST API reference — endpoints, request/response shapes, and field details — see [https://www.wix.com/skills/docs](https://www.wix.com/skills/docs).

For REST API recipes covering common management operations (stores, bookings, contacts, CMS, and more) — see [https://www.wix.com/skills/manage](https://www.wix.com/skills/manage).

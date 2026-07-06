# Deployment — stripe (self-hosted; publish + register origin)

For a **stripe** project, hosting is the user's, so two one-time backend actions finalize the live site. Both use the token from this folder's `AUTHENTICATION.md`; run them once the deployed site is up.

## 1 · Publish the Wix site

**Always publish the metasite after deploying.** Some Wix-served flows the frontend relies on (redirects to Wix-hosted pages and other features served from the published site) only work once the site has been published. Just publish every time, so a flow that needs it never silently fails. The call is idempotent and takes **no body**:

```bash
set -a; . ./.env; set +a
TOKEN=$(cat /tmp/wix_token); SITE_ID="${WIX_WIX_METASITE_ID:-$WIX_METASITE_ID}"
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/site-publisher/v1/site/publish" \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" -d '{}'
# 200 with an empty body `{}` means published — that 200 is the only success signal (no URL is returned).
```

## 2 · Register the deployed origin on the OAuth app

For the frontend's visitor calls (`OAuthStrategy` with the public `clientId`) to be **accepted from the deployed site**, the site's origin must be on the OAuth app's allowed domains. Otherwise every browser SDK call from the live URL is rejected.

We don't own the hosting, so the deployed URL is unknown until the site is deployed — this is a **post-deploy step performed once the URL is known** (it can't be done during Setup/Seed). The OAuth app's id **is the `clientId`** — `WIX_WIX_CLIENT_ID`.

### Idempotent — register a given URL only once

First **read** the app's current allowed domains; if the deployed origin is already present, the registration is already done — **skip it**. Only ever add a URL that isn't there yet.

```bash
set -a; . ./.env; set +a
TOKEN=$(cat /tmp/wix_token); ID="${WIX_WIX_CLIENT_ID:-$WIX_CLIENT_ID}"
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  "https://www.wixapis.com/oauth-app/v1/oauth-apps/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"
# → read oAuthApp.allowedRedirectDomains; if the deployed origin is already in it, you're done.
```

### Add the deployed origin

`PATCH` the app, sending the **existing** `allowedRedirectDomains` **plus** the new origin (the API replaces the field, so include what's already there), with a field mask:

```bash
set -a; . ./.env; set +a
TOKEN=$(cat /tmp/wix_token); ID="${WIX_WIX_CLIENT_ID:-$WIX_CLIENT_ID}"
curl -sS -w "\nHTTP_STATUS:%{http_code}" -X PATCH \
  "https://www.wixapis.com/oauth-app/v1/oauth-apps/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "oAuthApp": { "id": "'"$ID"'", "allowedRedirectDomains": [ <existing…>, "<deployed-origin>" ] },
    "mask": { "paths": ["allowedRedirectDomains"] }
  }'
```

- `<deployed-origin>` is the live site's domain/URL (what the browser SDK runs on).
- For the **exact field semantics and format** (domain vs. full URL, member-login redirect URIs vs. allowed domains), read the doc — don't guess: <https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/update-oauth-app.md>. Member-login redirect URIs are a **separate field** (`allowedRedirectUris`) from the origin (`allowedRedirectDomains`): the visitor SDK only needs the origin allowed, but **if this deploy has member login via the Wix login page, the member-login callback must also be registered** in `allowedRedirectUris` — same masked-`PATCH` shape as the origin (add both under one `mask.paths`), and required or login 4xxs. Mechanics + the "not read-only" gotcha: `../managed/DEPLOYMENT.md` → "Member login on a non-Astro frontend". (Custom login — `../inline-recipes/how-to-code-members-custom-login.md` — needs neither, as it has no login-page redirect.)

> **If the live site's visitor token call still 400s after the origin is registered, suspect the bundle — not CORS.** An unregistered origin and an `undefined` `clientId` in the build produce the same browser-side 400. Before chasing CORS/propagation, confirm the real `clientId` value is actually inlined in the deployed bundle (see `../SDK_HANDOFF.md` §2).

## If deployment is NOT part of this agent flow

If the agent isn't the one deploying — the user will deploy the site themselves — the skill **cannot know the deployed URL**, so it cannot register the origin. (It can still publish the site — step 1 doesn't need the URL.) **Flag the origin step to the user clearly**, e.g.:

> *"One required step remains before the frontend can talk to Wix: once your site is live, its URL must be registered on the Wix OAuth app (allowed domains). Give me the deployed URL — or re-run this skill with it — and I'll register it. Until then, Wix SDK calls from the live site will be rejected."*

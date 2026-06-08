# Register the deployed origin on the OAuth app

For the frontend's visitor calls (`OAuthStrategy` with the public `clientId`) to be **accepted from the deployed site**, the site's origin must be on the OAuth app's allowed domains. Otherwise every browser SDK call from the live URL is rejected.

In regular `wix-headless` this is done by `init` — it knows the hosting URL up front and registers `localhost` + preview + prod domains on the OAuth app. **Here we don't own the hosting, so the deployed URL is unknown until the site is deployed.** That makes this a **post-deploy step the skill performs once the URL is known** — it can't be done during Setup/Seed.

## When to run

After the site is deployed and its URL is known. The OAuth app's id **is the clientId** — `WIX_WIX_CLIENT_ID`. Use the admin token from `.env` (`references/AUTHENTICATION.md`).

## Idempotent — register a given URL only once

First **read** the app's current allowed domains; if the deployed origin is already present, the registration is already done — **skip it**. Only ever add a URL that isn't there yet.

```bash
set -a; . ./.env; set +a
TOKEN=$(cat /tmp/wix_token); ID="${WIX_WIX_CLIENT_ID:-$WIX_CLIENT_ID}"
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  "https://www.wixapis.com/oauth-app/v1/oauth-apps/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"
# → read oAuthApp.allowedRedirectDomains; if the deployed origin is already in it, you're done.
```

## Add the deployed origin

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
- For the **exact field semantics and format** (domain vs. full URL, member-login redirect URIs vs. allowed domains), read the doc — don't guess: <https://dev.wix.com/docs/api-reference/business-management/headless/oauth-apps/update-oauth-app.md>. Member-login redirect URIs are a separate, deferred concern; the visitor SDK only needs the origin allowed.
- This call needs OAuth-app management permission on the app (same provider-side scope story as Setup/Seed); a non-200 here surfaces and stops, like any other Wix call.

## If deployment is NOT part of this agent flow

If the agent isn't the one deploying — the user will deploy the site themselves — the skill **cannot know the deployed URL**, so it cannot register the origin. **Flag this to the user clearly**, e.g.:

> *"One required step remains before the frontend can talk to Wix: once your site is live, its URL must be registered on the Wix OAuth app (allowed domains). Give me the deployed URL — or re-run this skill with it — and I'll register it. Until then, Wix SDK calls from the live site will be rejected."*

This is the one piece `init` normally handles for hosted sites; because hosting is the host's, it has to be closed out here.

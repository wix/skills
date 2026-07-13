# Deployment — managed (Wix CLI release)

For a **managed** project, Wix owns the hosting, so finalizing the live site is a single command — Wix handles publishing the site **and** registering the deployed origin on the OAuth app **out of the box**. There are no manual publish or origin-registration calls (unlike the self-hosted types).

## Release

From the project directory:

```bash
CI=1 npx @wix/cli@latest release
```

- Publishes whatever the managed project is configured to deploy to Wix's hosting/CDN, and brings the live site up.
- The deployed origin is registered on the OAuth app automatically — the frontend's visitor SDK calls are accepted from the live URL with no extra step.
- The published URL is printed on stdout (`Site published on <url>`).

## Social login (Google/Facebook) on a **non-Astro** frontend — register the callback URI (post-release)

**Only when the run has SOCIAL member login (Google/Facebook) on a non-Astro SPA/static frontend** (`inline-recipes/how-to-code-members-custom-login.md` mechanism (B) — the `getAuthUrl({ idp })` → `/callback` handshake). A **non-Astro SPA's own callback path is not auto-registered** — and **social login stays dead (4xx on the login redirect) until you register it**. This is a genuine gap `wix release` does *not* close for you. (**Direct-credential** login — mechanism (A), `register`/`login` — has no redirect and needs none of this.)

- `release` auto-registers the deployed **origin** (`allowedRedirectDomains`) — that's the visitor-SDK/CORS surface (above). It does **not** register the member-login **callback URL** (`allowedRedirectUris`). These are two different fields; members needs **both**, and only the first is automatic.
- **This is a post-release step** — the callback URL embeds the deployed origin, which is unknown until `release` prints it. Do it right after release, once the URL is known.
- **⚠️ `allowedRedirectUris` IS writable via the API — do not conclude it's read-only/dashboard-only.** The `UpdateOAuthApp` reference may not list it among the obvious updatable fields, but a masked `PATCH` sets it. The trap is a **required field mask**: without `mask.paths` the `PATCH` returns `200` and **silently no-ops**.
- **⚠️ Right after `release`, the by-id `GetOAuthApp`/`UpdateOAuthApp` calls can return a TRANSIENT `404 "appId was not found <id>"` — even with the correct id — for several minutes (eventual consistency on the freshly-created app).** This is **not** a wrong-id error: the `{id}` in `/oauth-app/v1/oauth-apps/{id}` is the OAuth app's own `id`, which for a managed project **equals `wix.config.json`'s `appId`** (and equals the public `clientId`) — using it is correct. (`siteId` is *not* the app id — that one genuinely 404s.) The **`QueryOAuthApps` endpoint resolves sooner** than by-id, so use it to (a) confirm the app is ready and (b) read the current `allowedRedirectUris` to append. If a by-id `GET`/`PATCH` 404s, **retry with a short backoff — do not conclude the id is wrong or the field is unwritable** (a real eval run gave up here and shipped an unregistered callback; a later retry with the same id succeeded).

```bash
ID="<appId from wix.config.json>"   # == the OAuth app id == public clientId (NOT siteId)
# 1) Read current URIs (query resolves before by-id does, post-release). Append to what it returns — PATCH REPLACES the array.
curl -sS -w "\nHTTP_STATUS:%{http_code}" -X POST https://www.wixapis.com/oauth-app/v1/oauth-apps/query \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{ "query": { "filter": { "id": { "$eq": "'"$ID"'" } } } }'
#   → oAuthApps[0].allowedRedirectUris (append to these). Also confirms the id is live.
# 2) PATCH with the field mask (append the exact callback AND the versioned-preview wildcard; keep existing).
#    If this 404s right after release, RETRY with backoff — it is the propagation race, not a bad id:
curl -sS -X PATCH https://www.wixapis.com/oauth-app/v1/oauth-apps/$ID \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -w "\nHTTP_STATUS:%{http_code}" -d '{
    "oAuthApp": { "id": "'"$ID"'",
      "allowedRedirectUris": [ <existing…>, "https://<host>/callback", "https://*-<host>/callback" ] },
    "mask": { "paths": ["allowedRedirectUris"] }
  }'
```

- Include **both** the exact URL **and** the `https://*-<host>/…` wildcard — Wix serves versioned preview subdomains. The callback path must match the recipe's `redirectUri` **exactly** (e.g. `window.location.origin + '/callback'`). Note `release` may pre-register the framework's own `/api/auth/callback`, but **not your custom social `/callback`** — that's the one you add here.
- `allowedRedirectDomains` and `allowedRedirectUris` can go in **one** `PATCH` (list both under `mask.paths`) if you ever need to set the origin by hand too.
- **If you're not the one deploying**, you can't know the domain — flag the member-login callback URI to the user to register, and note **login is dead until they do** (higher-stakes than the origin flag).

> **⚠️ Registering `/callback` is necessary but NOT sufficient for social login.** The provider itself (Google / Facebook) must also be **enabled/configured on the site** — and as of this writing there is **no public API for that**, and it isn't reliably exposed in the headless dashboard either (verified: the request reaches the IAM auth/identification backends and returns *"use a different login method"* until the provider is configured). So a headless run **cannot fully turn social login on by itself**. After wiring + registering the callback, **surface a clear manual step in the handoff**: *"Social login is wired, but Google/Facebook must be enabled for this site's members (Site Member Settings / internal IAM config) before it will complete — I can't do this headlessly."* Do **not** report social login as working. (Direct-credential login has no such gate and completes fully headlessly — prefer it when the brief allows.)

> **Direct-credential login** (mechanism (A) — `register`/`login`) does **not** need this — they're direct API calls with no redirect. Only `sendPasswordResetEmail`'s `redirectUri` and logout's return URL need allow-listing (same masked-`PATCH` shape). **Social login** (mechanism (B), above) is the one that needs the `/callback` registered.

## Static frontends (no build step)

These two fixes are **Wix-hosting facts** — they apply to a connected **static** site (plain HTML, no bundler) on the managed path, and the docs are silent on both. A bundler SPA that builds to its own output directory doesn't need them.

- **The entry file must be named `index.html`.** Wix serves `index.html` at the site root. A brought-in design named anything else (e.g. `"My Design.html"`) **publishes "successfully" but 500s/404s at runtime**. Rename the entry to `index.html` **before** release and fix internal references to it.
- **`site.outputDirectory` must point at the directory holding `index.html`.** `init` writes `site.outputDirectory: "./dist"`, which assumes an SPA that *builds* to `dist`. A static site has no build, so `./dist` is wrong — set `outputDirectory` in `wix.config.json` to the directory that actually contains `index.html`, or `release` publishes but the live site 404s at root.

## Transient errors

A release can hit transient infrastructure errors (`ECONNRESET`, `ETIMEDOUT`, `STATE_MISMATCH`, "try again shortly"). Retry the release serially up to **3×** with a short backoff. **Build failures are not retryable** — they're code bugs; fix the code, not the retry.

That's the whole of finalize for `managed` — no `site-publisher` call, and no `oauth-app` **origin** PATCH (the origin is auto-registered). The **one** exception is the member-login callback on a non-Astro frontend above — that `allowedRedirectUris` PATCH is manual and required.

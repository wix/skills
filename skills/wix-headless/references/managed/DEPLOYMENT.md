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

## Member login on a **non-Astro** frontend — register the callback URI (post-release)

**Only when the run has member login on a non-Astro SPA/static frontend using the Wix login page** (`inline-recipes/how-to-code-members-non-astro.md` — the `getAuthUrl` → `/callback` handshake). Astro's built-in `/api/auth/*` callback shapes are auto-registered; a **non-Astro SPA's own callback path is not** — and **login stays dead (4xx on the login redirect) until you register it**. This is a genuine gap `wix release` does *not* close for you.

- `release` auto-registers the deployed **origin** (`allowedRedirectDomains`) — that's the visitor-SDK/CORS surface (above). It does **not** register the member-login **callback URL** (`allowedRedirectUris`). These are two different fields; members needs **both**, and only the first is automatic.
- **This is a post-release step** — the callback URL embeds the deployed origin, which is unknown until `release` prints it. Do it right after release, once the URL is known.
- **⚠️ `allowedRedirectUris` IS writable via the API — do not conclude it's read-only/dashboard-only.** The `UpdateOAuthApp` reference may not list it among the obvious updatable fields, but a masked `PATCH` sets it. The trap is a **required field mask**: without `mask.paths` the `PATCH` returns `200` and **silently no-ops**.

```bash
ID="<clientId>"   # the OAuth app id == the public clientId
# 1) GET first and append — the PATCH REPLACES the array, so include what's already there:
curl -sS -w "\nHTTP_STATUS:%{http_code}" https://www.wixapis.com/oauth-app/v1/oauth-apps/$ID \
  -H "Authorization: Bearer $TOKEN"
# 2) PATCH with the field mask (register BOTH the exact callback and the versioned-preview wildcard):
curl -sS -X PATCH https://www.wixapis.com/oauth-app/v1/oauth-apps/$ID \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -w "\nHTTP_STATUS:%{http_code}" -d '{
    "oAuthApp": { "id": "'"$ID"'",
      "allowedRedirectUris": [ <existing…>, "https://<host>/callback", "https://*-<host>/callback" ] },
    "mask": { "paths": ["allowedRedirectUris"] }
  }'
```

- Include **both** the exact URL **and** the `https://*-<host>/…` wildcard — Wix serves versioned preview subdomains. The callback path must match the recipe's `redirectUri` **exactly** (e.g. `window.location.origin + '/callback'`).
- `allowedRedirectDomains` and `allowedRedirectUris` can go in **one** `PATCH` (list both under `mask.paths`) if you ever need to set the origin by hand too.
- **If you're not the one deploying**, you can't know the domain — flag the member-login callback URI to the user to register, and note **login is dead until they do** (higher-stakes than the origin flag).

> **Custom-login** (`how-to-code-members-custom-login.md`) does **not** need this — `register`/`login` are direct API calls with no login-page redirect. Only `sendPasswordResetEmail`'s `redirectUri` and logout's return URL need allow-listing there.

## Static frontends (no build step)

These two fixes are **Wix-hosting facts** — they apply to a connected **static** site (plain HTML, no bundler) on the managed path, and the docs are silent on both. A bundler SPA that builds to its own output directory doesn't need them.

- **The entry file must be named `index.html`.** Wix serves `index.html` at the site root. A brought-in design named anything else (e.g. `"My Design.html"`) **publishes "successfully" but 500s/404s at runtime**. Rename the entry to `index.html` **before** release and fix internal references to it.
- **`site.outputDirectory` must point at the directory holding `index.html`.** `init` writes `site.outputDirectory: "./dist"`, which assumes an SPA that *builds* to `dist`. A static site has no build, so `./dist` is wrong — set `outputDirectory` in `wix.config.json` to the directory that actually contains `index.html`, or `release` publishes but the live site 404s at root.

## Transient errors

A release can hit transient infrastructure errors (`ECONNRESET`, `ETIMEDOUT`, `STATE_MISMATCH`, "try again shortly"). Retry the release serially up to **3×** with a short backoff. **Build failures are not retryable** — they're code bugs; fix the code, not the retry.

That's the whole of finalize for `managed` — no `site-publisher` call, and no `oauth-app` **origin** PATCH (the origin is auto-registered). The **one** exception is the member-login callback on a non-Astro frontend above — that `allowedRedirectUris` PATCH is manual and required.

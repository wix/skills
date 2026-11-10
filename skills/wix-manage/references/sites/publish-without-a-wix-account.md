---
name: "Publish a Site Without a Wix Account"
description: Publish HTML, CSS and JavaScript as a live Wix site with no Wix account or login, then give the user a link to keep it. Covers creating the site, publishing changes while it is unclaimed, and claiming it into the user's account through the claim link, the Wix MCP or the Wix CLI. Use when you publish for a user who has no Wix account or is not signed in. Not for a site already in the user's account (use Upload a Website or HTML Files).
---

# Publish a Site Without a Wix Account

A shell that reaches `https://www.wixapis.com` can publish a static site with no
Wix login. The site goes live on a `*.wix-site-host.com` URL and lasts one hour
from its creation unless the user claims it; after that every call on it returns
`404`.

Publish static files: HTML, CSS, JavaScript and assets, up to 20 MiB in all,
with an `index.html` at the top level when there is more than one HTML file.
Build a project first and publish its output. A Wix Astro build is released
with a login: [Upload a Website or HTML Files](upload-static-site.md#release-a-wix-astro-build).

## Publish

Generate one UUID as `anonymousId` and create the site once, not per edit:

```bash
# 1. Create: returns { metaSiteId, projectId }
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"

# 2. Upload the complete file set: returns { uploadId }; not live yet
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp&agent=$AGENT" \
  -F "files=@index.html;filename=index.html" -F "files=@assets/styles.css;filename=assets/styles.css"

# 3. Release: returns { siteUrl }
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' -d "{\"uploadId\":\"$UPLOAD_ID\"}"
```

Keep `anonymousId`, `metaSiteId` and `projectId`, and put their values in every
later URL, not placeholders. Open `siteUrl` and check the pages.

## Hand it to the user

Give the live site, `{siteUrl}`, and the claim link, each on its own line:
`https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}`.
The site lasts one hour unless the user claims it, and then moves to a new
address. **Whoever opens the link while signed in gets the site; give it only to
the user.** Never create an account or sign in for them.

## Publish changes

```bash
# Status: 200 { metaSiteId, projectId, createdAt } while unclaimed
curl -sS "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID"

# The live files, when you have no copy
curl -sS -o site.zip "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/download.zip"
```

- `200`: upload and release again with the same IDs and every file, changed and
  unchanged; a release replaces the whole site. Leave the zip's
  `wix.config.json` out. The address stays the same.
- `404`: the site was claimed or its hour ended. With the user's login, the
  HEADLESS site query in [Find an existing site](upload-static-site.md#find-an-existing-site)
  finds a claimed site; change it through [Change it later](upload-static-site.md#change-it-later).
  An ended site is gone: say so and ask before creating another.

## Claim it

Claiming moves the site into a Wix account and to a new address; the old
address stops working. Claim after the last anonymous release, in one of three
ways:

- **The claim link:** the user opens it in their own browser and signs in or
  signs up.
- **The Wix MCP** (`ExecuteWixAPI` in your tool list): `POST
  https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/{anonymousId}/{metaSiteId}/claim`
  with body `{}`, through `wix.request({ scope: 'account', ... })`. The site
  goes to the account the MCP is signed in as.
- **The Wix CLI:** the user approves `npx @wix/cli@latest login` in their
  browser; `npx @wix/cli@latest token` then gives a token that lasts 15
  minutes, and the same `POST` with `Authorization: Bearer $ACCESS_TOKEN`
  claims the site into that account.

The claim call returns `{}`. Read the site's new `viewUrl` with the HEADLESS
site query in [Find an existing site](upload-static-site.md#find-an-existing-site)
and give it with the site's dashboard link, as
[Verify and report](upload-static-site.md#verify-and-report) says. Later changes
need the user's login: [Change it later](upload-static-site.md#change-it-later).

## When no shell reaches Wix

The user drags the files onto [the drop page](upload-static-site.md#the-drop-page)
in their own browser; the site goes live the same way and the page offers to
keep it.

## Failures

| Failure | Action |
| --- | --- |
| `400` with `MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE` | Read `details.applicationError.code` and fix the files. |
| `404` on any call | The site was claimed or its hour ended: see [Publish changes](#publish-changes). |

Offer [feedback to Wix](send-feedback-to-wix.md) when a step fails or guidance
is missing.

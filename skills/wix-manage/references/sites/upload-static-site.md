---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a live Wix site. Covers every way to get there — publishing straight into the user's Wix account when you hold their identity, publishing anonymously with a save link when you don't, and handing the user the Wix Headless drop page — and how to get the user's identity through the Wix CLI. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site published this way (replace its files on the same site and URL). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix. Three routes
reach the same result: a live, Wix-hosted static site.

## Choose the route

Two facts decide it.

**Whose identity do you hold?** Either the user's Wix identity, through a Wix API
tool that carries their login or a shell token from the
[Wix CLI](#getting-the-users-identity), or none.

**What carries the files?** Every route sends them as one `multipart/form-data`
request.

- **A shell** — `curl -F` reads files from disk and streams them: any type, any
  number, up to the [limits](#what-the-upload-accepts-and-how-it-fails), at no cost
  to you. With a shell, files always go this way, even when a Wix API tool is
  also connected; a page you generated goes to disk first.
- **Only a Wix API tool that runs JavaScript with `wix.request`** — the runtime
  has no filesystem, so the file contents are written out inside the call itself:
  every byte is code you generate, and each change resends all of it. That fits a
  generated page or a few small text files (HTML, CSS, JS, SVG). A string body is
  sent as UTF-8, so binary files (PNG, JPG, fonts, zips) arrive corrupted;
  reference images by absolute URL instead. Many files, a long page or binary
  assets go to the drop page.
- **Files only on the user's machine** — nothing you run can carry them.

| Identity | Files | Route |
| --- | --- | --- |
| Yes | Can be carried | [Publish into the user's account](#publish-into-the-users-account) — two calls, the site is theirs from the start |
| No | Can be carried | [Publish anonymously](#publish-anonymously) — live at once, kept through a save link or a later claim |
| Any | Can't be carried | [The drop page](#the-drop-page) — the user uploads in the browser |

**A shell plus a Wix API tool, and no CLI login:** the identity is in the tool,
the files are on disk. Keep the files in the shell. Either log in with the
[Wix CLI](#getting-the-users-identity) and publish into the account with `curl`,
or publish anonymously with `curl` and [claim](#claim-it-into-the-users-account)
through the API tool — a claim is a small JSON call.

Publishing yourself beats the drop page whenever a route fits — the user gets a
live site without uploading anything. Decide honestly: never report an upload you
couldn't perform. Whenever a route fails partway, hand over the drop page.

## Publish into the user's account

```
Base URL: https://www.wixapis.com/headless-business-setup
```

### 1. Create the site

The [Create Headless Site](create-headless-site.md) call with no Wix Business
Solutions. Name it after the page's `<title>`.

```bash
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"newMetasite":{"namingStrategy":{"metaSiteName":"Northwind Studio"},"seedOptions":[]},
       "synchronousSteps":["SET_METASITE_NAME","CONFIGURE_HEADLESS_APP"]}'
```

```json
{ "metaSiteId": "7597a72e-bedc-4d86-af86-9a25d11f0632", "appId": "9f0a8b59-1acb-4a67-aafd-f8602259cbfa" }
```

### 2. Drop the files — the site goes live

One multipart request uploads and releases. Each file is a part named `files`
whose **filename is its path relative to the site root** — that is how
subdirectories survive; with `curl`, set it with `;filename=` whenever it isn't
just the basename. A single `.zip` part works too — it's unpacked server-side, a
single wrapping folder stripped.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/$META_SITE_ID/drop" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
```

```json
{ "uploadId": "c0d5b3bb-60a9-43f9-9d27-7ca8df967825",
  "siteUrl": "https://headless-zjfqzddjtww-ayalg5-1406.wix-site-host.com" }
```

With no shell, the same two calls through `wix.request`, for a page or a few small
text files held in memory:

```javascript
async function run() {
  const created = await wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
            synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] } });
  const files = { 'index.html': html, 'assets/styles.css': css };   // path → text content
  const boundary = '----wixdropboundary';
  const body = Object.entries(files).flatMap(([path, text]) => [
    '--' + boundary,
    `Content-Disposition: form-data; name="files"; filename="${path}"`,
    '', text,
  ]).concat('--' + boundary + '--', '').join('\r\n');
  return await wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${created.metaSiteId}/drop`,
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body });                                                          // a string body is sent verbatim
}
```

`siteUrl` is the site's final address — it's already in the user's account. Give
the user two links: `siteUrl`, and its dashboard at
`https://manage.wix.com/dashboard/{metaSiteId}`.

### Change it later

Re-run step 2 on the same `metaSiteId` with the **full** file set: each drop
replaces the site's files (a file left out is gone), and `siteUrl` stays the same.
Never create another site for a change. The same call updates any site the user
owns that was published this way, including one claimed from an
[anonymous publish](#publish-anonymously).

## Publish anonymously

No identity needed: the site is created under a temporary owner and lives for one
hour unless the user keeps it.

Generate `anonymousId` yourself — any UUID, **once per site, not once per
request** — and reuse it, with the returned `metaSiteId`, for every call for that
site. **Finish within one hour of step 1**: after that the record expires and
every later call, claim included, returns `404`.

### 1. Create the site

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"
```

```json
{ "metaSiteId": "f0ad8672-09e9-4111-b6fe-070c70bd2df5",
  "projectId":  "54528d34-b23c-4fbe-b07d-2c522350abd7" }
```

Keep both: `metaSiteId` addresses the site, `projectId` builds the save link.

### 2. Upload the files

Same multipart shape as the [drop](#2-drop-the-files--the-site-goes-live), to the
upload path, with the attribution parameters:

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp&agent=$AGENT" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css"
```

```json
{ "uploadId": "03244542-d820-42f6-acfa-166c6658b1a6" }
```

Keep `campaign=mcp` (the referral tag — don't change it) and set `agent` to your
own identifier: a short, stable, lowercase-hyphenated slug for the coding agent or
tool you are (e.g. `claude-code`, `cursor`, `codex-cli`, `windsurf`,
`github-copilot`, or your product's name; `unknown-agent` if you can't name
yourself). Nothing is live yet; this only stages and validates.

### 3. Release — the site goes live

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' -d "{\"uploadId\":\"$UPLOAD_ID\"}"
```

```json
{ "siteUrl": "https://instant-hguwrvtcrniw-headlessstack-140d.wix-site-host.com" }
```

**To change it**, re-run steps 2–3 with the same `anonymousId` and `metaSiteId` and
the full file set; `siteUrl` stays the same. Never go back to step 1 for a change.

**When it's final:** with the user's identity, [claim it](#claim-it-into-the-users-account).
Without it, stop here — a finished result. Give the user `siteUrl` plus the save
link, which is how the site survives:

```
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

That page shows the site with a countdown and signs the user in to keep it. Treat
the link as a secret — whoever opens it while signed in to Wix claims the site
into *their* account — so give it only to the user who asked.

### Claim it into the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `{}`. Claim after the release, never before — it consumes the anonymous
record, so the anonymous endpoints stop working for this site; later changes go
through the [drop](#change-it-later).

**The URL changes on claim**: the step-3 host stops resolving. Read the new one
with [Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites),
filtered to the `HEADLESS` namespace (the default query omits headless sites, and
an `id` filter is rejected, so match the id yourself):

```bash
curl -sS -X POST "https://www.wixapis.com/site-list/v2/sites/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"namespace":"HEADLESS"},"cursorPaging":{"limit":100}}}'
```

Take `viewUrl` from the entry whose `id` is your `metaSiteId` (page with
`metadata.cursors.next` if needed), and give the user it plus
`https://manage.wix.com/dashboard/{metaSiteId}`.

## The drop page

```
https://www.wix.com/headless/drop?utm_campaign=mcp&agent=<your-agent-id>
```

Keep `utm_campaign=mcp` and set `agent` to your own identifier, as in the
[upload](#2-upload-the-files). The user drags in their files (no login), Wix hosts
them on a live URL at once, and a banner offers to sign in and keep the site. Tell
them the [requirements](#what-the-upload-accepts-and-how-it-fails) so it doesn't
fail on the first try.

## Getting the user's identity

- **A Wix API tool that carries the user's login** — call through it with
  `scope: 'account'`; no token to handle. Use it for the JSON calls (create, claim,
  Query Sites); with a shell, the files themselves still go through `curl`.
- **The Wix CLI, for a shell** — the user signs in once in the browser, then
  `wix token` prints a token for `curl`:

  ```bash
  npx @wix/cli login
  ACCESS_TOKEN=$(npx @wix/cli token)
  ```

  The same login is what [Keep building](#keep-building-add-a-backend-when-you-need-one)
  needs, so it's never wasted.

## What the upload accepts, and how it fails

These apply to every route:

- **A top-level HTML file is required.** A lone top-level HTML of any name becomes
  the homepage; with more than one, an `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only** — HTML, CSS, JS, images, fonts. Framework source that
  needs a build step (a `package.json`, React/Vue sources) must be built first;
  upload the build output.

Failures come back as HTTP 400 with a code in `details.applicationError.code`:
`MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE`. A drop onto a site the
caller doesn't own returns `PERMISSION_DENIED`. On the anonymous route, a `404`
after step 1 means the hour passed or the site was claimed — start again.

**If publishing fails for any reason you can't quickly fix, hand the user the
[drop page](#the-drop-page).** Never leave them with a failed publish and no way
forward.

## Keep building: add a backend when you need one

A dropped site is **static**. When it needs a real backend — stores, payments,
bookings, a CMS, members, forms — it becomes a **Wix Headless project**, keeping
the same site, appId and URL. This is a choice the user makes when the need
appears; static changes never need it, they're a [drop](#change-it-later).

In a shell, once the site is in the user's account:

```bash
curl -sSL -o project.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip project.zip -d project      # the site's files + wix.config.json
```

Then follow `https://wix.com/headless/skill.md`: it turns the files into a
headless project bound to the same site, released with the Wix CLI from then on.

## Route the request correctly

- **Files you can carry, user's identity held** — publish into their account;
  return `siteUrl` + dashboard.
- **Files you can carry, no identity** — publish anonymously; return `siteUrl` +
  save link.
- **Files only on the user's machine, or nothing can carry them** — the drop page.
  It's also the fallback whenever publishing fails partway.
- **A change to a site published this way** — re-drop (owned) or re-upload and
  release (still anonymous) on the same site, full file set.
- **An anonymous site the user wants to keep** — claim it with their identity,
  else the save link.
- **A site that now needs a backend** — [Keep building](#keep-building-add-a-backend-when-you-need-one).
- **Migrating a live site/store from another platform by URL, or CSV/TSV
  exports** — [Site Import](site-import.md).
- **Adding HTML, an embed, or code to an existing Wix site** — not this recipe
  (that's custom code in the editor).
- **Images, videos, or documents for a site** —
  [Upload Media to Wix](../media/upload-media-to-wix.md).

Don't create the site from a template — that makes an empty site, not a published
copy of the user's files.

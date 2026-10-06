---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a live Wix site. Covers every way to get there — publishing straight into the user's Wix account when you hold their identity, publishing anonymously with a save link when you don't, and handing the user the Wix Headless drop page, or releasing it as a Wix Headless project — and how to get the user's identity through the Wix CLI. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site published this way (replace its files on the same site and URL). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website as files — hand-written HTML, a static build, a
zip, or the output of an AI site builder — and wants it live on Wix as a static,
Wix-hosted site.

## Choose the route

Five ways to get the files live; what you have decides which are open to you.

| Option | Needs | Carries | The user ends up with |
| --- | --- | --- | --- |
| **A.** `curl` + CLI token → [into the account](#publish-into-the-users-account) | A shell; a Wix CLI login | Anything on disk | A site in their account, final URL |
| **B.** `ExecuteWixAPI` → [into the account](#publish-into-the-users-account) | The Wix MCP | Small text files already in the conversation | A site in their account, final URL |
| **C.** `curl` → [anonymous](#publish-anonymously) | A shell | Anything on disk | A live site for one hour; kept by a [claim](#claim-it-into-the-users-account) (through the Wix MCP or a CLI token) or the save link |
| **D.** [The drop page](#the-drop-page) | Nothing | Whatever the user uploads | The same, after they upload it themselves |
| **E.** [The headless skill](#keep-building-add-a-backend-when-you-need-one) | A shell; Node; a Wix CLI login | A project folder, source included (built for you) | A site in their account as a Wix Headless project, released with the Wix CLI, ready for Wix Business Solutions |

What sets them apart:

- **`curl -F` streams files from disk** — the bytes never pass through you: any type, any
  number, up to the [limits](#what-the-upload-accepts-and-how-it-fails).
- **`ExecuteWixAPI` has no filesystem.** The Wix MCP's tool runs JavaScript whose
  `wix.request` calls carry the user's login — no install, no token — but every
  byte is written out inside the call. That costs nothing extra for a page you
  generated or the user pasted (it's already in the conversation); for files on
  disk it means reading them in and writing them back out, and each change
  resends all of it. A string body is sent as UTF-8, so binary files (PNG, JPG,
  fonts, zips) arrive corrupted; link images by absolute URL.
- **A CLI login** is one approval by the user in the browser: run
  `npx @wix/cli login` and have them approve; `npx @wix/cli token` then prints a
  token (see [Before the calls](#before-the-calls)). It also unlocks later
  changes from disk and
  [Keep building](#keep-building-add-a-backend-when-you-need-one).
- **Anonymous** needs no identity, but the record expires after an hour and the
  URL changes on claim.
- **The headless skill** is the heaviest — an install, a project, a build — and
  the only one that takes framework source as is and leaves a project ready for a
  backend. A drop site can still move to it [later](#keep-building-add-a-backend-when-you-need-one).

So: a small page already in the conversation, with the Wix MCP connected — B,
shell or not. Static files on disk — A with a CLI login, else C (claimed through
the Wix MCP when it's connected). A framework project (a `package.json`), or a
site that needs stores, bookings, a CMS or members from the start — E. Files out
of your reach, or nothing above fits — D.

Publishing yourself beats the drop page whenever an option fits — the user gets a
live site without uploading anything. Never report an upload you couldn't
perform; whenever a route fails partway, hand over the drop page.

## Before the calls

The `curl` examples here and in the anonymous route read shell variables.

- **`$ACCESS_TOKEN`** is the user's access token, from wherever you have it. A
  token from the Wix CLI (`npx @wix/cli token`) lasts 15 minutes; running the
  command again returns a valid one, refreshed if needed, so set `$ACCESS_TOKEN`
  again when it may have expired, and always after a `403`.
- **`$META_SITE_ID`, `$UPLOAD_ID`, …** come from the previous response; set each
  one before the next call.

In an `ExecuteWixAPI` script there is no token to handle, and the ids go into the
URL as values; a `$NAME` there is sent as is.

## Publish into the user's account

### 1. Create the site

The [Create Headless Site](create-headless-site.md) call with no Wix Business
Solutions. Name it after the page's `<title>`, and keep `"origin": "drop"`: it marks
the site as a dropped one, the same as the drop page and the anonymous route do.

```bash
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"origin":"drop","newMetasite":{"namingStrategy":{"metaSiteName":"Northwind Studio"},"seedOptions":[]},
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
  "siteUrl": "https://headless-zjfqzddjtww-northwind-1406.wix-site-host.com" }
```

Option B — the same two calls as one `ExecuteWixAPI` script, for small text files
already in the conversation:

```javascript
async function run() {
  const created = await wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { origin: 'drop', newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
            synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] } });
  // path → text content, as template literals. Escape \ as \\ first, then ` as \` and ${ as \${
  // (an unescaped \ is dropped or reinterpreted: /\d+/ would arrive as /d+/).
  const files = {
    'index.html': `<!doctype html><html><head><title>Northwind Studio</title>
<link rel="stylesheet" href="assets/styles.css"></head><body><h1>Northwind Studio</h1></body></html>`,
    'assets/styles.css': `body { font-family: sans-serif; margin: 0; padding: 4rem; }`,
  };
  const boundary = '----wixdropboundary';
  const body = Object.entries(files).flatMap(([path, text]) => [
    '--' + boundary,
    `Content-Disposition: form-data; name="files"; filename="${path}"`,
    '', text,
  ]).concat('--' + boundary + '--', '').join('\r\n');
  return await wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${created.data.metaSiteId}/drop`,
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body });                                                          // a string body is sent verbatim
}
```

`wix.request` returns `{ status, data }`; read a response's fields from `data`
(`created.data.metaSiteId`). Keep the body's shape exactly. It's a string; an
object is sent as JSON and rejected. Lines end in `\r\n`, the body ends with
`--<boundary>--`, and the header names the same boundary the body uses. Break any of these and the drop
fails with a bare `500`.

`siteUrl` is the site's final address — it's already in the user's account. Give
the user two links: `siteUrl`, and its dashboard at
`https://manage.wix.com/dashboard/{metaSiteId}`.

### Change it later

Re-run step 2 on the same `metaSiteId` with the **full** file set: each drop
replaces the site's files (a file left out is gone), and `siteUrl` stays the same.
Never create another site for a change. The same call updates any site the user
owns that was published this way, including one claimed from an
[anonymous publish](#publish-anonymously). For a site from an earlier conversation,
find its `metaSiteId` with the [Query Sites](#claim-it-into-the-users-account) call
below, matching the site's name or `viewUrl`.

**When you no longer have the files** (a small change to a site from an earlier
conversation), download what the site serves, edit it, and drop the full set
back. Leave out `wix.config.json`; the download adds it, and it isn't part of the
site.

```bash
curl -sSL -o current.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip -o current.zip -d current      # the site's files + wix.config.json
```

In an `ExecuteWixAPI` script, request the same URL with `responseType: 'base64'`
and read the zip in memory. Entries are stored (method 0) or deflated (method 8):

```javascript
const r = await wix.request({ scope: 'account', method: 'GET', responseType: 'base64',
  url: `https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/${metaSiteId}/download.zip` });
const z = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
const u16 = (o) => z[o] | (z[o + 1] << 8), u32 = (o) => (u16(o) | (u16(o + 2) << 16)) >>> 0;
let e = z.length - 22; while (u32(e) !== 0x06054b50) e--;            // end of central directory
const files = {};
for (let i = 0, p = u32(e + 16); i < u16(e + 10); i++) {            // one central-directory entry each
  const name = new TextDecoder().decode(z.slice(p + 46, p + 46 + u16(p + 28)));
  const at = u32(p + 42), start = at + 30 + u16(at + 26) + u16(at + 28);
  const raw = z.slice(start, start + u32(p + 20));
  files[name] = u16(p + 10) === 0 ? new TextDecoder().decode(raw)
    : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  p += 46 + u16(p + 28) + u16(p + 30) + u16(p + 32);
}
// files: { 'index.html': '…', 'assets/styles.css': '…', 'wix.config.json': '…' }
```

The live URL itself (`*.wix-site-host.com`) can't be read from a script; this
download is the way back to the files. Don't rebuild the site from memory.

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
Iterate first, claim last: after a claim, changes are a [drop](#change-it-later),
which needs the user's identity — a CLI token for files on disk.

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

## What the upload accepts, and how it fails

These apply to every route:

- **A top-level HTML file is required.** A lone top-level HTML of any name becomes
  the homepage; with more than one, an `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only** — HTML, CSS, JS, images, fonts. Framework source that
  needs a build step (a `package.json`, React/Vue sources) must be built first;
  upload the build output, or take the project to the headless skill (option E).

Failures come back as HTTP 400 with a code in `details.applicationError.code`:
`MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE`. Beyond those:

- **`403 PERMISSION_DENIED` on a drop** — the token expired or is missing (see
  [Before the calls](#before-the-calls)), or the site isn't the caller's. A site
  that's still anonymous is changed by upload + release, not by a drop.
- **`500` on a drop or upload** — the multipart body is malformed (see the shape
  above). Rebuild it from the example; sending it again unchanged fails the
  same way.
- **`404` on the anonymous route after step 1** — the hour passed or the site was
  claimed; start again.

**If publishing fails for any reason you can't quickly fix, hand the user the
[drop page](#the-drop-page).** Never leave them with a failed publish and no way
forward.

## Keep building: add a backend when you need one

The headless skill, `https://wix.com/headless/skill.md`, builds and releases a
**Wix Headless project** with the Wix CLI: it adopts a project folder (a
`package.json`, or an `index.html` at its root) into a new site, or takes a
dropped one. A dropped site is **static**; when it needs a real backend — stores,
payments, bookings, a CMS, members, forms — it moves to a headless project,
keeping the same site, appId and URL. This is a choice the user makes when the
need appears; static changes never need it, they're a [drop](#change-it-later).

To move a dropped site, in a shell, once it's in the user's account:

```bash
curl -sSL -o project.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
unzip project.zip -d project      # the site's files + wix.config.json
```

Then follow the headless skill from that folder: it turns the files into a
headless project bound to the same site, released with the Wix CLI from then on.

## Route the request correctly

- **A new site from the user's files** — [Choose the route](#choose-the-route).
- **A change to a site published this way** — the same site, full file set: a
  [drop](#change-it-later) when it's in the user's account, upload + release while
  it's anonymous.
- **An anonymous site the user wants to keep** — [claim](#claim-it-into-the-users-account)
  it, else the save link.
- **A site that now needs a backend** — [Keep building](#keep-building-add-a-backend-when-you-need-one).
- **Migrating a live site/store from another platform by URL, or CSV/TSV
  exports** — [Site Import](site-import.md).
- **Adding HTML, an embed, or code to an existing Wix site** — not this recipe
  (that's custom code in the editor).
- **Images, videos, or documents for a site** —
  [Upload Media to Wix](../media/upload-media-to-wix.md).

Don't create the site from a template — that makes an empty site, not a published
copy of the user's files.

---
name: "Upload a Website or HTML Files"
description: Publish a user's ready-made website — an index.html, a static build, or a zip exported from an AI builder or any other tool — as a live Wix site. Covers every way to get there — publishing straight into the user's Wix account when you hold their identity, publishing anonymously with a save link when you don't, and handing the user the Wix Headless drop page, or releasing it as a Wix Headless project — and how to get the user's identity through the Wix CLI. Use whenever the user wants to upload, publish, deploy, or host their own HTML/CSS/JS as a NEW site, including files generated for them earlier in the conversation, or to update a site published this way (replace its files on the same site and URL). Not for migrating a live store/site from another platform by URL or from CSV exports (use Site Import), not for adding HTML or custom code into an existing Wix site, and not for uploading images or documents to a site's media files.
---

# Upload a Website or HTML Files

The user has a finished website — hand-written HTML, a static build, a zip, a
project an AI builder exported — and wants it live on Wix. Every route below ends
the same way: a headless site in the user's Wix account that serves those files
at a `*.wix-site-host.com` URL.

## What decides the route

Three things about where you run decide it:

- **Does your shell reach Wix?** `curl -sI https://www.wixapis.com` answers with an
  HTTP status line. When it fails, or there is no shell, it doesn't.
- **Is the Wix MCP connected?** Its tools are in your tool list: `ExecuteWixAPI`,
  and usually `UploadHeadlessWebsiteFiles`.
- **Do your files travel as files?** Some clients resolve a tool's `attachments`
  param themselves: a file the user attached, or one you wrote to disk, reaches
  the upload tool as the file. Elsewhere `attachments` comes back unresolved, and
  every file you send through the MCP is text you write into the call.

| Your situation | Route |
| --- | --- |
| The shell reaches Wix | [Create the site](#create-the-site) and [drop the files with `curl`](#drop-with-curl) and a CLI token; without a login, [publish anonymously](#publish-anonymously). A site of text files can take the MCP route below instead, with no login. |
| The shell doesn't reach Wix, or there is no shell, and the Wix MCP is connected | [Create the site](#create-the-site) and [drop through the MCP](#drop-through-the-wix-mcp): the files themselves when they travel as files, a text bundle when they don't. |
| A project that needs a build (a `package.json`) | Build it where its dependencies install, then drop the build output. When the shell reaches Wix, the [headless skill](#connect-a-backend) builds and releases it. When it can't be built anywhere you are, ask the user for the build output. |
| None of these, or every route failed | The [drop page](#the-drop-page): the user uploads the files. |

When files don't travel as files, writing them costs nothing for a page already
in the conversation and a read and a rewrite for text files on disk; images never
travel as text (see [Images](#images)). Publishing yourself beats the drop page
whenever a route fits. Never report an upload you couldn't perform; when a route
fails partway, hand over the drop page.

## Before the calls

- **With a shell that reaches Wix**, `$ACCESS_TOKEN` is the user's token: run
  `npx @wix/cli@latest login` once (the user approves in the browser), then
  `npx @wix/cli@latest token` prints a token that lasts 15 minutes. Run it again
  when the token may have expired, and always after a `403`.
- **Through the Wix MCP**, `ExecuteWixAPI` runs JavaScript
  whose `wix.request` calls carry the user's login: no token. Ids go into URLs as
  values; a `$NAME` there is sent as is. `wix.request` returns `{ status, data }`.
- **`$AGENT`** is a short lowercase slug naming you (`claude-code`, `cursor`,
  `codex-cli`, `chatgpt`, `claude-ai`; `unknown-agent` if you can't tell). Every drop and upload
  carries `?campaign=mcp&agent=$AGENT`, which attributes the site to you in Wix's
  reports.
- **`$META_SITE_ID`, `$UPLOAD_ID`, …** come from the previous response.

**Reading the pages this recipe links.** A Wix skill you have installed is read
from disk. Otherwise a `www.wix.com/skills/…` or `dev.wix.com/docs/…` page is read
with the Wix MCP's `ReadFullDocsArticle` when the MCP is connected; it returns the
page whole. A web fetch is the fallback.

## Create the site

The [Create Headless Site](create-headless-site.md) call with no Wix Business
Solutions. Name it after the page's `<title>` and keep `"origin": "drop"`.

```bash
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"origin":"drop","newMetasite":{"namingStrategy":{"metaSiteName":"Northwind Studio"},"seedOptions":[]},
       "synchronousSteps":["SET_METASITE_NAME","CONFIGURE_HEADLESS_APP"]}'
# {"metaSiteId":"7597a72e-bedc-4d86-af86-9a25d11f0632","appId":"9f0a8b59-1acb-4a67-aafd-f8602259cbfa"}
```

In a script, the same call:

```javascript
const created = await wix.request({ scope: 'account', method: 'POST',
  url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
  body: { origin: 'drop', newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
          synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] } });
// created.data.metaSiteId
```

The site is in the user's account. When it goes live, give the user its
`siteUrl` and the dashboard, `https://manage.wix.com/dashboard/{metaSiteId}`.

## Drop with curl

One multipart request uploads and releases. Each file is a part named `files`
whose **filename is its path relative to the site root**; that is how
subdirectories survive. A single `.zip` part works too: it is unpacked
server-side, a single wrapping folder stripped.

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/$META_SITE_ID/drop?campaign=mcp&agent=$AGENT" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "files=@index.html;filename=index.html" \
  -F "files=@assets/styles.css;filename=assets/styles.css" \
  -F "files=@assets/logo.png;filename=assets/logo.png"
# {"uploadId":"c0d5b3bb-…","siteUrl":"https://headless-zjfqzddjtww-northwind-1406.wix-site-host.com"}
```

`siteUrl` is final.

## Drop through the Wix MCP

### With the Wix MCP's upload tool

When the Wix MCP lists `UploadHeadlessWebsiteFiles`, it is the drop: pass it the
`metaSiteId` from [Create the site](#create-the-site) as `siteId`, and the files.
It replaces the whole file set, stamps the attribution itself, and returns
`siteUrl` and the dashboard link. It creates no site and makes no other call.

- **When your files travel as files**, pass them as `attachments`: zip the whole
  site folder, images included, and pass the zip as one attachment. It is
  unpacked, a wrapping folder stripped, up to 10 MB per call. Nothing is written
  out by you.
- **When they don't**, pass a `files` text bundle: each file starts with a line
  `=== FILE: <path> ===` followed by its raw text, `<path>` relative to the site
  root. Nothing in it is escaped. It carries text files: HTML, CSS, JavaScript,
  SVG. Other images reach the site as [Images](#images) says.

```
=== FILE: index.html ===
<!doctype html><html><head><title>Northwind Studio</title>
<link rel="stylesheet" href="assets/styles.css"></head><body><h1>Northwind Studio</h1><img src="assets/logo.svg"></body></html>
=== FILE: assets/styles.css ===
body { font-family: sans-serif; margin: 0; padding: 4rem; }
=== FILE: assets/logo.svg ===
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
```

The bundle can't carry a file with a line that reads exactly `=== FILE: … ===`.

### From an ExecuteWixAPI script

Without the upload tool, both calls run in one script. The same bundle goes in
the tool's **`files` param**, never in `code`; in `code` it is the `files` global
(`[{ path, content, encoding? }]`), and `wix.multipart()` turns it into the body.

```javascript
async function run() {
  const agent = 'your-agent-slug';         // $AGENT
  const created = await wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/headless-business-setup/v1/headless-business/provision',
    body: { origin: 'drop', newMetasite: { namingStrategy: { metaSiteName: 'Northwind Studio' }, seedOptions: [] },
            synchronousSteps: ['SET_METASITE_NAME', 'CONFIGURE_HEADLESS_APP'] } });
  const mp = wix.multipart();              // from the `files` param; or pass [{ path, content | base64 | bytes }]
  return await wix.request({ scope: 'account', method: 'POST',
    url: `https://www.wixapis.com/headless-business-setup/v1/headless-business/${created.data.metaSiteId}/drop?campaign=mcp&agent=${agent}`,
    headers: { 'Content-Type': mp.contentType }, body: mp.body });
}
```

A zip passed through `attachments` is one entry; unpack it first:
`wix.multipart(await wix.unzip(files[0].content))`. Don't build a multipart body
by hand while `wix.multipart()` exists (a malformed one is a bare `500`).

**An older `ExecuteWixAPI` with no `files` param** still has `wix.multipart()`:
pass it the entries written in `code`, `[{ path, content }]`, the text as template
literals. Escape `\` as `\\` first, then `` ` `` as `` \` `` and `${` as `\${`; an
unescaped `\` is dropped or reinterpreted. Only when
`typeof wix.multipart !== 'function'` is the body a string you build: parts named
`files` with the path as `filename`, lines ending in `\r\n`, the body ending with
`--<boundary>--`, and `Content-Type: multipart/form-data; boundary=<the same
boundary>`.

## Change it later

On the same `metaSiteId`, never a new site. Each drop replaces every file, and
`siteUrl` stays.

- **With a shell that reaches Wix**, edit the files and drop the full set with
  `curl`.
- **Through the MCP**, change the site in one `ExecuteWixAPI` script: download
  what it serves, edit in code, and drop the full set back. Only the edit is
  written; images travel back as they are. When your files travel as files, a
  new zip of the whole site through the upload tool works as well. A full
  rewrite of the text bundle is for a site rewritten wholesale.

For a site from an earlier conversation, find its `metaSiteId` with
[Query Sites](#claim-it-into-the-users-account), matching the name or `viewUrl`.
The download holds what the site serves plus a `wix.config.json`, which is left
out of the drop:

```bash
curl -sSL -o current.zip \
  "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
```

In a script, request that URL with `responseType: 'base64'` and pass `r.data` to
`wix.unzip()`. Each entry is `{ path, bytes, text() }`; call `text()` only on text
files, since a decoded image is corrupted. Entries go back to `wix.multipart()` as
they are, an edited one as `{ path, content }`:

```javascript
const r = await wix.request({ scope: 'account', method: 'GET', responseType: 'base64',
  url: `https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/${metaSiteId}/download.zip` });
const entries = (await wix.unzip(r.data)).filter((e) => e.path !== 'wix.config.json').map((e) =>
  e.path === 'index.html' ? { path: e.path, content: e.text().replace('Welcome', 'Bloom Cafe — Now Open') } : e);
const mp = wix.multipart(entries);
// then the drop call: headers { 'Content-Type': mp.contentType }, body mp.body
```

Never rebuild a site from memory.

## Connect a backend

A dropped site is static. Stores, payments, bookings, a CMS, members or forms
need a **Wix Headless project**, which the headless skill builds and releases on
the same site, appId and URL.

**A mock that shows a business solution: publish it, then ask before connecting.**
Any control on the page that promises what static files can't deliver —
something to buy, book, order, join, submit or pay — is a Wix Business Solution
the page pretends to have. First get the site live from what the user gave you.
Then, with the live URL, name each such control, the solution that would make it
work, and what connecting it involves: what gets created from the page's own
content (the products, services or form). Ask whether to go ahead, and connect only after the user says
yes; a request that already asks for it (a working shop, real bookings) is that
yes. A page that promises nothing beyond its content stops at the pages.

The headless skill starts at its cold-start page,
`https://www.wix.com/skills/headless-cold-start/headless-kit.md` (read it as
[Before the calls](#before-the-calls) says). It installs the skills, runs a
bootstrap that checks the Wix CLI login, and hands off to the kit's `SKILL.md`,
which reads the folder, deploys the solution's code, seeds, builds and releases.
Its commands run:

- **With a shell that reaches Wix**, in a folder holding the site, from the
  site's own download:

  ```bash
  curl -sSL -o project.zip \
    "https://www.wix.com/_api/wixstro-deployments/v1/instant-sites/$META_SITE_ID/download.zip"
  unzip project.zip -d project
  ```
- **Through the Wix MCP alone**, the kit's API-call guide,
  `https://www.wix.com/skills/wix-headless-kit/guides/api-run.md`, does the same
  run as Wix API calls through the Wix MCP, with the frontend dropped as this
  recipe says.

## Images

You never write an image's bytes yourself, as base64 or in any other form: model
output corrupts them past a few thousand characters, and every byte costs tokens.
An SVG is text and goes in like a page. Every other image reaches Wix one of four
ways:

1. **With a shell that reaches Wix**, in the `curl` drop, from disk.
2. **When your files travel as files**, inside the zip you pass the upload tool.
3. **A public URL**: the page keeps the absolute URL.
4. **The user uploads it** to the site's Media Manager. This is the way for images
   that exist only as files you can't send. Publish the pages first, then name
   the missing files, give the user
   `https://manage.wix.com/dashboard/{metaSiteId}/media-manager`, and ask them to
   tell you once they're uploaded. Then [list the site's files](../media/upload-media-to-wix.md),
   match each to the page's reference by `displayName`, point the reference at the
   file's `static.wixstatic.com` URL, and drop again.

Never stand in drawings or placeholders of your own for the user's images, and
never shrink or re-encode them. The closing message names every image still
missing.

## Publish anonymously

With a shell that reaches Wix and no login: the site belongs to a temporary owner and
lives one hour unless the user keeps it. Generate `anonymousId` yourself, any
UUID, once per site, and reuse it with the returned `metaSiteId` for every call.
After one hour every call, claim included, returns `404`.

```bash
# 1. create
curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID"
# {"metaSiteId":"f0ad8672-…","projectId":"54528d34-…"}

# 2. upload: the drop's multipart shape; nothing is live yet
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/upload?campaign=mcp&agent=$AGENT" \
  -F "files=@index.html;filename=index.html" -F "files=@assets/styles.css;filename=assets/styles.css"
# {"uploadId":"03244542-…"}

# 3. release: the site goes live
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/release" \
  -H 'Content-Type: application/json' -d "{\"uploadId\":\"$UPLOAD_ID\"}"
# {"siteUrl":"https://instant-hguwrvtcrniw-headlessstack-140d.wix-site-host.com"}
```

To change the site, repeat steps 2 and 3 with the full file set. When it's final,
claim it with the user's identity. Without one, give the user `siteUrl` and the
save link, which signs them in to keep the site. Whoever opens the link while
signed in to Wix gets the site, so give it only to the user:

```
https://www.wix.com/live-headless-site/{projectId}?anonymousId={anonymousId}
```

### Claim it into the user's account

```bash
curl -sS -X POST \
  "https://www.wixapis.com/headless-business-setup/v1/headless-business/anonymous/$ANONYMOUS_ID/$META_SITE_ID/claim" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Claim last: it ends the anonymous record, and later changes are
[drops](#change-it-later). **The URL changes on claim.** Read the new `viewUrl`
with Query Sites in the `HEADLESS` namespace; the default query omits headless
sites and rejects an `id` filter, so match the id yourself, paging with
`metadata.cursors.next`:

```bash
curl -sS -X POST "https://www.wixapis.com/site-list/v2/sites/query" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":{"filter":{"namespace":"HEADLESS"},"cursorPaging":{"limit":100}}}'
```

## The drop page

```
https://www.wix.com/headless/drop?utm_campaign=mcp&agent=<your-agent-id>
```

The user drags in the files without logging in, the site is live at once, and a
banner offers to keep it. Tell them the limits below first.

## Limits and failures

- **A top-level HTML file.** A lone one of any name is the homepage; with more
  than one, `index.html` must be among them.
- **3 MB per file, 20 MB per site.**
- **Static files only** in a drop. A project that needs a build is built first,
  and its build output is dropped.

| Failure | Meaning |
| --- | --- |
| `400` `MISSING_INDEX_HTML`, `FILE_TOO_LARGE`, `TOTAL_TOO_LARGE` | In `details.applicationError.code`; fix the files. |
| `403 PERMISSION_DENIED` on a drop | The token expired or is missing, or the site isn't the caller's. An anonymous site takes upload and release, not a drop. |
| `500` on a drop or upload | A malformed multipart body; rebuild it as shown. The same body fails again. |
| `404` on the anonymous route | The hour passed or the site was claimed. |

## Send feedback to Wix

When this flow didn't work well enough, offer to send it to Wix as feedback,
following [Send Feedback to Wix](send-feedback-to-wix.md): a route failed and you
fell back, a call errored or needed retries, images had to wait on the user, or
the recipe left you guessing and you had to invent a
workaround.

## Route the request correctly

- **A new site from the user's files**: [What decides the route](#what-decides-the-route).
- **A change to a site published this way**: the [same site](#change-it-later);
  upload and release while it's anonymous.
- **An anonymous site the user wants to keep**: [claim it](#claim-it-into-the-users-account), or the save link.
- **A site that now needs a backend**: [Connect a backend](#connect-a-backend).
- **Migrating a live site or store from another platform by URL, or CSV/TSV
  exports**: [Site Import](site-import.md).
- **HTML, an embed or code inside an existing Wix site**: not this recipe; that is
  custom code in the editor.
- **Images, videos or documents for a site's media**: [Upload Media to Wix](../media/upload-media-to-wix.md).

Don't create the site from a template: that makes an empty site, not a copy of
the user's files.
